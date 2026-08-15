# SitePulse — 30-Day Task Plan

Each day = one small, independently-shippable, testable unit. End every session in a working (not broken) state. Commit at the end of each day. Update `PROGRESS.md` at the end of each session.

Read `PROJECT.md` and `DECISIONS.md` before Day 1. Read `PROGRESS.md` and today's task before every session after that.

---

## Week 1 — Foundation, Auth, Monitors (Days 1–7)

- [ ] **Day 1** — Repo setup: TypeScript + Express skeleton, ESLint/Prettier, env config, Postgres connection via `node-postgres`, health-check endpoint. Deploy bare-bones "hello world" to Railway.
- [ ] **Day 2** — Database schema v1: `organizations` (incl. unique `slug` — see `DECISIONS.md` #34), `users`, `refresh_tokens` (incl. `family_id`, `revoked_at`, `replaced_by_token_id` — see `DECISIONS.md` #31). Write raw SQL migrations run via `node-pg-migrate` (`DECISIONS.md` #30, no ORM).
- [ ] **Day 3** — Auth: signup (creates the user's org in the same transaction, slug auto-generated from org name with collision retry — `DECISIONS.md` #34) + login (bcrypt password hashing — `DECISIONS.md` #22), JWT access token issuance (memory-only on the client, `Authorization` header — `DECISIONS.md` #18).
- [ ] **Day 4** — Auth: refresh token flow (issue, rotate, store hashed in Postgres, `httpOnly`/`Secure`/`SameSite=Strict` cookie — `DECISIONS.md` #18), reuse detection (revoke token family on reuse — `DECISIONS.md` #31), logout/revocation. *Natural split point if this overflows: (4a) issue/rotate/store/cookie, (4b) reuse detection + logout/revocation — see Notes.*
- [ ] **Day 5** — Multi-tenancy scaffolding: `organization_id` on all relevant tables, middleware to scope every query by the authenticated user's org.
- [ ] **Day 6** — Monitors CRUD: schema (`monitors` table incl. `failure_threshold`, `recovery_threshold`, interval, URL, expected status), REST endpoints, validation.
- [ ] **Day 7** — Write basic tests for auth + monitors CRUD. Confirm Week 1 vertical slice works end-to-end (signup → login → create monitor). Deploy update to Railway.

## Week 2 — Checker, Incidents, Alerts (Days 8–14)

- [ ] **Day 8** — In-process scheduler: interval loop, per-monitor due-check logic, concurrent batched HTTP checks with `AbortController` timeout; skip (and log) a monitor whose previous check is still in-flight rather than overlapping it (`DECISIONS.md` #20). Scheduler also ensures `checks` partitions exist for the current + next 2 months, checked at startup and once daily (`DECISIONS.md` #32) — required because native partitioning doesn't auto-create partitions. Include `GET /health` reporting last completed check-cycle timestamp; returns `warning` if stale beyond 2x the longest configured monitor interval.
- [ ] **Day 9** — `checks` table, monthly `RANGE` partitioned on `checked_at` with a local `(monitor_id, checked_at)` index (`DECISIONS.md` #26), write check results, response time tracking.
- [ ] **Day 10** — Monitor state machine: `up → suspected_down → down`, `down → suspected_up → up`, using per-monitor thresholds. Consecutive-failure/success counts persisted as columns on `monitors`, updated in the same transaction as the check write (`DECISIONS.md` #19).
- [ ] **Day 11** — Incidents: `source` column (`auto`/`manual`), nullable `monitor_id`. Auto incidents kept in sync with monitor state as a standing invariant (down ⇒ open auto incident exists, up ⇒ resolved), re-checked every check write, not just at the transition edge — see `DECISIONS.md` #28 for why. Partial unique index enforcing at most one open auto incident per monitor. Manual incident CRUD as separate, independent rows — these never fire alerts on their own (`DECISIONS.md` #36). *Natural split point if this overflows: (11a) source column + auto-incident invariant + unique index, (11b) manual incident CRUD + tests — see Notes.*
- [ ] **Day 12** — Alerts: incident-scoped firing logic (fire once on incident open, once on resolve). Email notification channel via Nodemailer/SMTP (`DECISIONS.md` #21), every send (success or failure) logged to `alert_deliveries` with `channel='email'` (`DECISIONS.md` #33).
- [ ] **Day 13** — Webhook notification channel: single-attempt, 5s `AbortController` timeout, HMAC-SHA256 signed payload (secret encrypted at rest, not hashed), every attempt logged to `alert_deliveries` with `channel='webhook'` — same table as Day 12's email log, not a separate one (`DECISIONS.md` #23, #33).
- [ ] **Day 14** — Tests for state machine + incident/alert logic (including flapping scenarios). Deploy update.

## Week 3 — Status Pages, Real-Time, API Polish, Frontend (Days 15–21)

- [ ] **Day 15** — Public status page backend: read-only endpoint per organization, no auth required, aggregates current monitor status.
- [ ] **Day 16** — SSE endpoint for live monitor status, authenticated via a short-lived single-use ticket (`POST /api/v1/sse/ticket` → `EventSource` with `?ticket=`, since `EventSource` can't send an `Authorization` header — see `DECISIONS.md` #27); server force-closes each connection after ~15 min so a logged-out session's stream can't run forever (`DECISIONS.md` #35); frontend subscribes and updates without refresh, re-fetching a ticket on reconnect rather than relying on native retry.
- [ ] **Day 17** — API versioning (`/api/v1`), API-key auth for programmatic access (`sp_live_...`, SHA-256 hashed + stored prefix, full-access/non-expiring for v1 — `DECISIONS.md` #29, #37), rate limiting (`trust proxy` set for Railway's edge proxy, IP-keyed for session traffic / key-ID-keyed for API-key traffic — `DECISIONS.md` #25).
- [ ] **Day 18** — OpenAPI/Swagger spec + docs UI for the full API surface built so far.
- [ ] **Day 19** — Frontend scaffold: React + Vite + TypeScript, API client wrapper (fetch + JWT + refresh-on-401), SSE provider with Context/useReducer (see `UI_TECH_DECISIONS.md`). Monitor dashboard (list, status, create/edit) — functional, not fancy.
- [ ] **Day 20** — Frontend: incident timeline + public status page view.
- [ ] **Day 21** — Frontend: alert/notification settings page. Checkpoint: is there time for anything beyond core scope? If not, move directly to Week 4.

## Week 4 — Testing, Load Testing, Deployment, Docs (Days 22–30)

- [ ] **Day 22** — Expand test coverage: edge cases (monitor flapping, duplicate alert prevention, token expiry/rotation, refresh-token reuse triggers family revocation, manual-resolve-while-still-down reopens an auto incident, multi-tenant isolation).
- [ ] **Day 23** — Load test the checker with **k6**: simulate 100 monitors at 30s intervals, measure check-cycle completion time, target p95 < 5s. Document actual numbers in the README — no unverified performance claims. Verify `/health` correctly reports `warning` if the checker is stopped.
- [ ] **Day 24** — Load test the API with **k6**: realistic concurrent mix across auth, monitor CRUD, and status-page endpoints. Record actual p95/p99 latency and error rate.
- [ ] **Day 25** — Fix issues found during load testing. Re-test.
- [ ] **Day 26** — Production deployment hardening on Railway: env vars, secrets, error logging, basic monitoring of SitePulse itself (dogfooding, optional).
- [ ] **Day 27** — Architecture diagram (one, clear). README: scope, limitations, setup instructions.
- [ ] **Day 28** — Demo video recording — walk through the full flow (signup → monitor → incident → alert → status page).
- [ ] **Day 29** — Final DECISIONS.md/PROJECT.md review — make sure docs match what was actually built, not what was planned.
- [ ] **Day 30** — Buffer day: fix anything broken, polish README, final deploy check, final commit.

---

## Notes
- If a day's task turns out too big, split it further rather than ending in a broken state.
- Any new library/service not already in `DECISIONS.md` must be flagged before adding.
- Days are a planning aid, not a contract — if Day N's work spills into Day N+1, adjust honestly in `PROGRESS.md` rather than forcing an artificial "done."
- Day 4 and Day 11 have grown the most from decisions added after the initial plan (refresh-token-family reuse detection; the incident invariant + partial unique index + manual/auto split) and are the two most likely to spill over. Each has a suggested split point noted inline — use it as the stopping point for a half-finished session instead of an ad hoc one.
