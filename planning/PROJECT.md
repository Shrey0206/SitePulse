# SitePulse — Project Overview

## 1. Project Summary

**SitePulse** is a backend-heavy uptime monitoring and incident management platform. Organizations register HTTP/HTTPS monitors, SitePulse checks them on configurable intervals, tracks response times and uptime history, auto-creates incidents on failure, fires alerts through email and webhooks, and publishes a public status page per organization.

This is a **backend-heavy placement portfolio project**, built by a B.Tech IT student targeting on-campus SDE-1 / Backend Engineer roles at product-based/startup companies. The goal is not feature count — it is five features implemented with enough depth to defend every design decision under interview questioning.

## 2. Project Positioning

Resume-friendly description:

> Built SitePulse, a backend-focused uptime monitoring platform using Node.js, Express, TypeScript, and PostgreSQL. Implemented configurable HTTP/HTTPS health checks, a state-machine-based alert evaluation pipeline with flapping protection, JWT auth with rotating refresh tokens, real-time dashboard updates via SSE, multi-tenant data isolation, and a documented, versioned REST API.

Interview-friendly explanation:

> SitePulse periodically checks HTTP/HTTPS endpoints on a schedule and tracks uptime history. Instead of firing an alert on every failed check, each monitor is modeled as a state machine that requires N consecutive failures before declaring it down — this prevents alert spam from single transient blips. Alerts are scoped to open incidents rather than raw status changes, so a monitor that stays down doesn't re-alert on every check. The dashboard updates live over Server-Sent Events, and the whole system runs as a single Node.js monolith against one PostgreSQL database, which was a deliberate choice given the project's scope and timeline.

## 3. Target Users

Organizations (multi-tenant from day 1) sign up, add monitors, invite team members (future scope — v1 is single-user-per-org unless stated otherwise), and configure alerting. The public can view a read-only status page per organization with no login required.

## 4. Core Features (v1 Scope)

### 4.1 Uptime Monitoring
- Configurable HTTP/HTTPS checks per monitor (interval, timeout, expected status)
- Response time tracking per check
- Up/down history stored and queryable

### 4.2 Incident Management
- Incidents auto-created on the first transition into `down` (not on every failed check)
- Manual incident CRUD (for maintenance windows, manually-declared incidents)
- Status transitions: `open → monitoring → resolved` (or similar)

### 4.3 Alerting
- State-machine-based evaluation: `up → suspected_down → down`, `down → suspected_up → up`
- Per-monitor, user-configurable failure/recovery thresholds (`failure_threshold`, `recovery_threshold`)
- Alerts scoped to open incidents — one alert on incident open, one on resolve, not one per failing check
- Email + webhook notification channels

### 4.4 Status Pages
- Public, read-only, per-organization status page
- No login required to view

### 4.5 REST API
- Versioned (`/api/v1`)
- API-key authentication for programmatic access
- Rate-limited
- Documented via OpenAPI/Swagger

### 4.6 Checker Self-Monitoring
- `GET /health` reports last completed check-cycle timestamp
- Returns `warning`/`degraded` status if the checker hasn't run in over 2x the longest configured monitor interval
- Answers the obvious question for a monitoring product: "how do you know your own system is working?"

## 5. Explicitly Out of Scope for v1

Log management/search, custom metrics dashboards, distributed tracing, Kubernetes, Terraform, Elasticsearch, mobile app, synthetic/browser monitoring, error tracking, infrastructure monitoring.

Reason: five features defensible in depth beat nine shallow ones. If time remains after day 21, this list can be revisited — no speculative extra features before then.

## 6. Recommended Tech Stack

### Backend
- Node.js + Express + TypeScript
- PostgreSQL (single instance, manual indexing + partitioning for check-history)
- Raw SQL via `node-postgres` (no ORM) — chosen deliberately for stronger DBMS/query talking points
- In-process scheduler for the uptime checker (no queue/Redis)
- JWT auth: short-lived access token + longer-lived refresh token, refresh tokens stored (hashed) in PostgreSQL for revocability
- Server-Sent Events (SSE) for live dashboard updates

### Frontend
- React + Vite + TypeScript
- React Context + `useReducer` for global state (auth session, live SSE monitor status) — no Redux/Zustand, not enough cross-cutting state to justify it
- Native `fetch` wrapped in a small typed API client (JWT attach + refresh-on-401)
- See `UI_TECH_DECISIONS.md` for the full frontend decision log

### Testing
- Vitest + Supertest (see `DECISIONS.md` #17)

### Load Testing
- k6 (checker load test: 100 monitors/30s intervals, target p95 cycle time < 5s; API load test: realistic concurrent mix, record real p95/p99 latency)

### Deployment
- Railway (Node app + PostgreSQL, git-push deploy)

## 7. High-Level Architecture

```txt
Frontend (functional, not fancy)
  ├── Auth pages (login/signup)
  ├── Monitor dashboard (live via SSE)
  ├── Incident timeline
  ├── Alert/notification settings
  └── Public status page (no auth)

Express API (monolith)
  ├── Auth Module (JWT + refresh rotation)
  ├── Organizations Module (multi-tenant scoping)
  ├── Monitors Module
  ├── Checker (in-process scheduler)
  ├── Incidents Module
  ├── Alerts Module (state machine + incident-scoped firing)
  ├── Status Pages Module
  ├── SSE Module (live updates)
  └── API Module (versioned, API-key auth, rate-limited, OpenAPI docs)

PostgreSQL (single instance)
  ├── organizations
  ├── users
  ├── refresh_tokens
  ├── monitors (incl. failure_threshold, recovery_threshold)
  ├── checks (indexed/partitioned by time)
  ├── incidents
  ├── alerts
  └── status_pages
```

## 8. Why These Decisions (Quick Reference)

See `DECISIONS.md` for the full log. In short: every "add more infrastructure" option (Redis/BullMQ, a second time-series database, WebSockets, a service split, GraphQL) was evaluated and rejected in favor of the simpler alternative, because the interview payoff of defending a well-reasoned, understood monolith exceeds the payoff of a half-understood distributed system for a solo 30-day build. The exceptions where added complexity *was* chosen (multi-tenancy from day 1, JWT with refresh rotation, state-machine alert evaluation) were kept because they were either already implied by the scoped features or directly answer likely interview questions.

## 9. Interview Talking Points to Prepare

- Why raw SQL instead of an ORM, and what that costs/buys you
- Why in-process scheduling instead of a job queue, and its known limitations
- How the alert state machine prevents flapping-related alert spam
- Why alerts are scoped to incidents, not raw status transitions
- Why SSE instead of WebSockets for this specific use case
- How multi-tenancy is enforced at the query level
- How refresh token rotation and revocation work
- What you would change first if this had to scale to 10,000 monitors
