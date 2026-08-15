# SitePulse — Agent Prompt

Use this prompt when asking an AI coding agent to help build SitePulse.

## Main Instruction

You are helping me build **SitePulse**, a backend-heavy uptime monitoring and incident management platform, for my software engineering placement portfolio.

This project must be explainable in interviews and implemented with clean, understandable architecture. Do not overcomplicate it into a production observability platform, and do not reduce it to a basic CRUD wrapper either.

## My Goal

I am a B.Tech IT student targeting backend SDE-1 / Backend Engineer campus placement roles at product-based/startup companies. SitePulse should demonstrate:

- Raw SQL / relational schema design (no ORM)
- JWT auth with refresh token rotation
- Multi-tenant data isolation
- A defensible background scheduling design
- A state-machine-based alert evaluation pipeline
- Real-time updates via SSE
- A versioned, documented, rate-limited REST API
- Honest, load-test-backed performance claims

## Session Start Protocol

At the start of every session:
1. Read `PROJECT.md`, `PROGRESS.md`, and today's task in `TASKS.md`.
2. Summarize your understanding back to me before writing any code.
3. If resuming mid-task, run `git log --oneline -20` and `git diff` against the last commit.

## Tech Stack (locked — see DECISIONS.md)

### Backend
- Node.js, Express, TypeScript
- PostgreSQL, raw SQL via `node-postgres` (no ORM)
- In-process scheduler (no Redis, no BullMQ)
- JWT auth: access + refresh, refresh tokens hashed and stored in Postgres
- Server-Sent Events for real-time updates

### Testing
- Vitest + Supertest

### Deployment
- Railway (Node app + Postgres)

## Architecture Style

Modular Express architecture, service/controller separation:

```txt
src/
  app.ts
  server.ts

  config/
    env.ts
    db.ts

  modules/
    auth/
      auth.routes.ts
      auth.controller.ts
      auth.service.ts
      auth.schemas.ts
      auth.middleware.ts

    organizations/
    monitors/
    checker/
    incidents/
    alerts/
    statuspages/
    sse/

  shared/
    errors/
    middlewares/
    utils/
    types/
```

- Routes define endpoints
- Controllers handle HTTP request/response
- Services contain business logic and raw SQL queries
- Middlewares handle auth, org-scoping, errors, and request validation

## Auth Requirements

- Email/password auth, hashed passwords (bcrypt — see `DECISIONS.md` #22)
- Short-lived JWT access token (~15 min), kept in memory only (React state), sent via `Authorization: Bearer` header — never persisted client-side
- Refresh token, stored hashed in a Postgres `refresh_tokens` table, delivered to the client as an `httpOnly`, `Secure`, `SameSite=Strict` cookie scoped to the auth endpoints only (see `DECISIONS.md` #18)
- Refresh token rotation on use, with reuse detection: each token belongs to a `family_id`; presenting an already-rotated token revokes the whole family and forces re-login (see `DECISIONS.md` #31)
- Session/token revocation on logout
- Production frontend served from the same Express app as the API (single origin) so the refresh cookie stays first-party; dev uses the Vite proxy for the same reason

Do not use:
- LocalStorage or a non-httpOnly cookie for refresh tokens
- Hardcoded accounts
- External auth providers (Auth0/Clerk) unless explicitly requested later

## Multi-Tenancy

Every relevant table carries `organization_id`. Every query must be scoped to the authenticated user's organization — treat an unscoped query touching tenant data as a bug, not a style choice. Signup creates exactly one organization per user in the same transaction, with a slug auto-generated from the org name (collision → random suffix on retry, not a pre-check race); the slug is editable later but renaming breaks the old public status-page URL for v1, by design (see `DECISIONS.md` #34).

## Checker & Alert Design

- In-process interval scheduler; batched concurrent checks with a per-check timeout (`AbortController`).
- Scheduler tracks in-flight monitor IDs in memory; a monitor already being checked is skipped (and the skip logged) on the next tick rather than run concurrently with itself (see `DECISIONS.md` #20).
- Scheduler also ensures `checks` partitions exist for the current month + a 2-month lookahead buffer (checked at startup and once daily) — native Postgres `RANGE` partitioning does not auto-create partitions, so this is required or inserts start failing once an uncovered month boundary passes (see `DECISIONS.md` #32).
- Each monitor tracked as a state machine (`up → suspected_down → down`, `down → suspected_up → up`), transitioning only after `failure_threshold`/`recovery_threshold` consecutive results (user-configurable per monitor). Consecutive-failure/success counts are persisted as columns on `monitors`, updated in the same transaction as the check write — never held only in memory (see `DECISIONS.md` #19).
- Incidents (`source='auto'`) are kept in sync with monitor state as a standing invariant, not a one-time transition event: down ⇒ an open auto incident must exist, up ⇒ any open auto incident is resolved, re-checked on every check write. This self-corrects after a manual resolve-while-still-down or a restart. Manual incidents (`source='manual'`, nullable `monitor_id`) are separate rows that don't suppress or merge with auto incidents, and never fire alerts themselves — only the auto-incident invariant fires alerts (see `DECISIONS.md` #28, #36).
- Alerts are scoped to open (auto) incidents — fire once on open, once on resolve. Never one alert per failing check.
- Webhook deliveries are single-attempt with a 5s `AbortController` timeout, HMAC-SHA256 signed (`X-SitePulse-Signature`), secret encrypted at rest (not hashed — it must be read back to sign). Every delivery attempt on both channels (email and webhook) is logged to `alert_deliveries` with a `channel` column — not webhooks only — regardless of outcome; no retry/backoff without a queue (see `DECISIONS.md` #23, #33).

## Real-Time Dashboard

Use Server-Sent Events, not WebSockets or polling. One-directional server→client push of monitor status changes. `EventSource` can't send an `Authorization` header, so the client fetches a short-lived, single-use ticket via an authenticated REST call first, then connects `EventSource` with that ticket in the query string; a dropped connection re-fetches a fresh ticket rather than relying on native retry against a stale URL (see `DECISIONS.md` #27). The server force-closes each connection after ~15 min (matching access-token TTL) so a logged-out client's stream can't outlive its session indefinitely — the forced close routes through the same reconnect path, which fails closed once the session is actually gone (see `DECISIONS.md` #35).

## API

- REST only, no GraphQL.
- URL-based versioning: `/api/v1/...`
- API-key auth for programmatic access (`sp_live_...`, SHA-256 hashed + short unhashed prefix stored for display — not bcrypt, see `DECISIONS.md` #29), rate-limited (IP-keyed for session traffic, key-ID-keyed for API-key traffic — see `DECISIONS.md` #25). v1 keys are full-access within their org and non-expiring until revoked — no scoped/read-only keys, no auto-expiry (see `DECISIONS.md` #37).
- OpenAPI/Swagger spec with auto-generated docs UI.

## Non-Goals for v1

Do not build: log management/search, custom metrics dashboards, distributed tracing, Kubernetes, Terraform, Elasticsearch, mobile app, synthetic/browser monitoring, error tracking, infrastructure monitoring, GraphQL, a job queue/Redis, WebSockets, an ORM.

## Coding Standards

- TypeScript everywhere
- Validate all external input using Zod
- Centralized error handling, consistent API response format
- Use database constraints/transactions for correctness-critical flows (e.g. incident creation)
- No sensitive data in logs
- Keep modules separated, avoid unnecessary abstraction
- Write code that is easy to explain in interviews
- Any performance/scale claim in the README must come from an actual load test, never an assumption

## API Response Format

Success:
```json
{ "success": true, "data": {} }
```

Error:
```json
{ "success": false, "error": { "code": "MONITOR_NOT_FOUND", "message": "Monitor not found" } }
```

## Build Order

Follow `TASKS.md` day by day. Do not jump ahead to later-week features before the current week's vertical slice works end-to-end.

## What to Ask Me Before Making Big Changes

Ask before changing:
- Any decision already recorded in `DECISIONS.md`
- Database schema in ways that affect multiple modules
- Auth design
- Alert/incident evaluation logic
- Deployment approach
- Scope of v1 vs. later

## Working Agreement

- Do not generate project structure, config, or code beyond what the current day's task calls for.
- Ask one question at a time when clarification is needed, not a batch.
- Push back directly if a request is high-effort for low interview payoff at this level — explain why.
- Before writing code for a new module, briefly restate the plan (endpoints, schema, job flow) first.
- Flag any new library/service before adding it — no silent scope creep.
- At the end of each session, output that day's Decision Log entry (if any) and update `PROGRESS.md`.

## Expected Output Quality

- Complete enough to run
- Include file paths
- Explain important decisions briefly
- Prefer small modules over large files
- Comments only where they clarify non-obvious logic
- Keep code interview-explainable

## Frontend

Before generating frontend code, read `UI_DESIGN.md` — it is the authoritative visual and interaction spec for SitePulse. The frontend should be functional and clean, not a generic admin template, and should define loading, empty, error, permission, and realtime-disconnected states for every page — not just the success state.
