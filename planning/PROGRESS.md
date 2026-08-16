# SitePulse — Progress Log

Read this file first at the start of every session. Update it at the end of every session, even if the day's task isn't finished — an honest "half-done" beats a missing entry.

---

## Days 8–14 — 2026-08-16 (Week 2 complete)

**Status:** The full monitoring pipeline works end-to-end — checks run on schedule, drive a persisted state machine, open/resolve incidents as a standing invariant, and fire deduplicated alerts over email and signed webhooks. 86 tests pass. Railway deploy still owner-driven and not done.

**What's done:**
- **Day 8+9 (merged)** — `checks` table, monthly `RANGE`-partitioned on `checked_at`, plus the in-process scheduler. Merged because the scheduler's first startup action is partition maintenance, so shipping it before the table existed would have meant committing a scheduler that crashes on boot. 5s tick, per-monitor due logic, concurrent checks, `AbortController` timeouts, in-flight `Set` to skip overlapping checks. `/health` now reports checker liveness.
- **Day 10** — State machine (`pending`/`up`/`suspected_down`/`down`/`suspected_up`) as a pure function, with counters persisted on `monitors` and updated in the same transaction as the check write.
- **Day 11** — `incidents` with `source` (`auto`/`manual`), the auto-incident invariant re-asserted on every check write, and a partial unique index enforcing one open auto incident per monitor. Manual incident CRUD is fully independent.
- **Day 12** — Incident-scoped alerting with an email channel (Nodemailer/SMTP, mailpit added to docker-compose). `alert_deliveries` logs every attempt on both channels.
- **Day 13** — Webhook channel: AES-256-GCM-encrypted secrets, HMAC-SHA256 signatures over `timestamp.body`, single-attempt delivery with a 5s timeout.
- **Day 14** — Flapping and consistency tests, plus checker-layer coverage (HTTP execution, due-monitor selection, partition maintenance including a year-boundary rollover).

**Bugs found and fixed during the week — all three by testing, none by inspection:**
1. **Partition creation used bind parameters.** Postgres accepts no parameters anywhere in DDL, so `CREATE TABLE ... FOR VALUES FROM ($1)` failed at runtime. The error was caught and logged and the process stayed up, so nothing looked broken — but no partitions existed, and every check insert would have failed. Fixed by interpolating shape-asserted literals.
2. **State machine punished monitors for blips.** `suspected_down` was routed through the recovery threshold, so a monitor with one bad check needed N consecutive successes to look healthy again — in exactly the case flapping protection exists to absorb. Recovery thresholds now apply only after a confirmed `down`.
3. **Tests had no `checks` partitions.** Tests import `app` directly and never start the scheduler, so nothing created them. Added a vitest setup file running the same maintenance the scheduler does.

**Verified against the live checker, not just tests:** a monitor left down produced 7 failing checks and exactly 1 alert, then 1 more on recovery; a signed webhook arrived at a real receiver and its delivery was logged `sent`/200; the stored webhook secret column contains only ciphertext.

**Known limitations (all stated in `DECISIONS.md`, not accidental):**
- A monitor flapping through *complete* down/up cycles alerts once per cycle — no cooldown layer (#8, v1.1 scope). There's a test pinning this so it stays a known trade-off.
- Webhook delivery is single-attempt with no retry (#23) — reliable retry needs a queue, and #4 has none.
- In-flight checks are lost on restart (#4). Persisted counters (#19) mean state machine progress survives, but a check mid-flight does not.

**What's half-done / not started:** Week 3 (Days 15–21) — status pages, SSE, API keys/rate limiting, OpenAPI, frontend.

**Next session:** Day 15 — public status page backend.

---

## Days 2–7 — 2026-08-15 (Week 1 complete)

**Status:** Full Week 1 vertical slice works end-to-end and is test-covered: signup → login → refresh/rotate/logout → create/list/get/update/delete monitors, all multi-tenant-scoped. Railway deploy for this update is still owner-driven and not done.

**What's done:**
- **Day 2** — `organizations`/`users`/`refresh_tokens` migrated via `node-pg-migrate` (raw SQL, up/down both verified). Added a reusable `set_updated_at()` trigger, reused again on `monitors` in Day 6.
- **Day 3** — Signup (org + user in one transaction, slug collision resolved via `SAVEPOINT`/retry, not a precheck race) and login, both issuing a 15m JWT access token. Login compares against a dummy bcrypt hash when the email doesn't exist, so response timing can't be used to enumerate accounts.
- **Day 4** — Refresh token issuance/rotation/reuse-detection/logout. **Caught and fixed a real bug via manual testing, not inspection:** the reuse-detection branch revoked the whole token family but then threw, and the function's own generic `catch { ROLLBACK }` was undoing that exact revocation before it could commit — reuse detection was silently a no-op. Fixed by explicitly committing the revocation before throwing and tracking transaction state so the generic rollback only fires when there's actually something uncommitted. Also closed a benign-double-submit race with `SELECT ... FOR UPDATE` so two concurrent refreshes on the same token can't both succeed.
- **Day 5** — `requireAuth` middleware (verifies the Bearer token, attaches `req.auth = {userId, orgId}`); `GET /api/v1/organizations/me` as the first org-scoped query, template for everything after it.
- **Day 6** — Monitors CRUD. `timeout_seconds <= interval_seconds` enforced at two layers: Zod on full payloads, a DB `CHECK` constraint as the backstop for partial updates Zod can't cross-validate against the existing row (a `23514` now maps to a clean 400, not a 500). Every query scopes by `(id, organization_id)` together, so cross-org access 404s identically to a nonexistent id — verified with two orgs directly.
- **Day 7** — Vitest + Supertest, dedicated `sitepulse_test` DB (`docker/init-test-db.sql` for fresh clones; created manually this session since the running container's volume predates it), truncate-based reset in a shared `beforeEach` (`DECISIONS.md` #24). `fileParallelism: false` in `vitest.config.ts` — the truncate strategy shares one DB across test files, so parallel files would race each other's resets. Added `tsconfig.test.json` + `npm run typecheck` since the base `tsconfig.json` only covers `src/` and Vitest's esbuild transpile doesn't type-check. 16 tests, all passing: auth (signup, duplicate email, slug collision, login success/failure, malformed input, refresh rotation, reuse detection kills the whole family, logout), monitors (create defaults, auth required, URL scheme, cross-field validation on create *and* on partial update via the CHECK constraint, full cross-tenant CRUD isolation), and one explicit vertical-slice test.

**What's half-done / not started:**
- Railway deploy of this update — owner-driven (needs `railway login`), same as Day 1.

**Known issues:** None outstanding — the Day 4 reuse-detection bug above was caught and fixed in this same session, before commit.

**Next session:** Deploy to Railway if not already done, then start Week 2 / Day 8 — in-process scheduler (interval loop, batched concurrent checks, per-monitor overlap skip, partition maintenance, `/health` cycle-staleness reporting).

---

## Day 1 — 2026-08-15

**Status:** Repo scaffolded and working end-to-end locally. Railway deploy not done yet — needs the account owner to log in.

**What's done:**
- Git repo initialized. Planning docs moved into `planning/` to keep the repo root focused on code.
- TypeScript + Express skeleton (`src/app.ts`, `src/index.ts`), `tsconfig.json` (strict mode)
- ESLint (flat config, `typescript-eslint`) + Prettier configured, both run clean
- Env config via `dotenv` (`src/config/env.ts`, `.env.example` committed, `.env` gitignored)
- Postgres connection pool via `node-postgres` (`src/db/pool.ts`)
- `GET /health` — checks DB connectivity, returns `200 {status: "ok"}` or `503` if the DB is unreachable. (This is the Day 1 liveness/DB-connectivity version — `DECISIONS.md` #13's fuller "checker cycle staleness" health check lands on Day 8 once the scheduler exists.)
- Local Postgres via `docker-compose.yml` (postgres:16, named volume). Verified locally: `npm run dev` + `curl /health` → `200 {"status":"ok"}`.
- `railway.json` committed (Nixpacks build via `npm run build`, start via `npm start`) so the app is deploy-ready.

**What's half-done / not started:**
- Actual Railway deploy — needs the account owner to run `railway login`, `railway init`, attach a Postgres plugin, set `DATABASE_URL`/`PORT` env vars, and `railway up`. Not something I can do without their account access.

**Known issues:** None.

**Next session:** Finish the Railway deploy (owner-driven), then start Day 2 — database schema v1 (`organizations`, `users`, `refresh_tokens`) via `node-pg-migrate`.

---

## Day 0.4 — 2026-08-14 (Planning)

**Status:** Third review pass, specifically checking whether the #18–31 fixes themselves introduced or exposed new gaps. They did — one real future outage bug, one doc-vs-decision contradiction, one long-open item finally closed, plus several smaller design gaps. Still no code written.

**What's done:** Locked `DECISIONS.md` #32–37:
- #32 Partition maintenance — real bug: native Postgres `RANGE` partitioning (#26) never auto-creates partitions, so without an explicit mechanism the checker's own writes would start failing the first time a month boundary passed uncovered. Fixed: the scheduler ensures the current + next 2 months' partitions exist, checked at startup and daily.
- #33 Alert delivery logging scope — `UI_DESIGN.md`'s Alert Settings page promises a delivery log for whether an alert "actually sent," but #23 only ever scoped that for webhooks. `alert_deliveries` now logs both channels via a `channel` column; email sends (#21) log success/failure exactly like webhooks already did.
- #34 Organization creation & slug generation — closes a gap flagged back on the first review pass and never actually resolved: signup now creates one org per user in the same transaction, slug auto-generated from the org name with collision retry, editable later with the "renaming breaks the old status-page link" limitation stated up front.
- #35 SSE connection lifetime vs. logout — the ticket model in #27 authenticates only at connect time; nothing previously closed the stream on logout. Now the server force-closes each connection after ~15 min (access-token TTL), so a logged-out session's stream can't outlive it by more than that window.
- #36 Manual incident alerting — #28 never said whether manual incidents fire alerts. Decided: no, only the auto-incident invariant fires alerts; manual incidents are visible on the status page/timeline but silent, named explicitly rather than left ambiguous.
- #37 API key scope & expiration — v1 keys are full-access and non-expiring, stated explicitly (same "don't build unneeded flexibility" pattern as the rest of the log) rather than left as an unstated default.

Also fixed, not a new decision: `TASKS.md` flags Day 4 and Day 11 as the two days that have grown the most from three rounds of fixes (refresh-token-family reuse detection; the incident invariant + partial unique index + manual/auto split) and gives each an explicit split point to fall back on if a session runs out of day, rather than an ad hoc stopping point.

`AGENT_PROMPT.md` (Multi-Tenancy, Checker & Alert Design, Real-Time Dashboard, API sections) and `TASKS.md` (Days 2, 3, 4, 8, 11, 12, 13, 16, 17, Notes) updated to reflect all of the above at the point in the build where they land.

**What's half-done / not started:**
- Everything in `TASKS.md` Day 1 onward — no code, no repo scaffold yet

**Known issues:** None yet — nothing built.

**Next session:** Start Day 1 — repo setup, TypeScript + Express skeleton, Postgres connection, health-check endpoint, bare-bones Railway deploy.

---

## Day 0.3 — 2026-08-13 (Planning)

**Status:** Fixed a hard architectural conflict and several design/logic gaps found on a second review pass. Still no code written.

**What's done:** Locked `DECISIONS.md` #27–31, amended #23 and #25:
- #27 SSE authentication — fixes a real conflict: `EventSource` can't send an `Authorization` header, so decision #18's header-only access token had no way to authenticate the live-dashboard connection. Fixed with a short-lived, single-use ticket fetched over REST, passed as a query param on the `EventSource` URL. `UI_TECH_DECISIONS.md` #4 amended to match (client re-fetches a ticket on reconnect instead of relying on native retry against a stale URL).
- #28 Incident lifecycle invariant — auto-incident open/resolve is now enforced continuously (down ⇒ open auto incident must exist, up ⇒ resolved), not just at the transition edge. Fixes a real bug: manually resolving an incident while the monitor is still actually down would previously leave the status page silently claiming "operational" with no way to reopen. Added `incidents.source` (`auto`/`manual`) and nullable `monitor_id`; manual incidents (maintenance windows etc.) are independent of the auto invariant. Maintenance-window alert suppression is explicitly named as an out-of-scope v1.1 extension, not left ambiguous.
- #29 API key storage — SHA-256 hash + stored prefix, not bcrypt (bcrypt is for low-entropy human secrets; API keys are already high-entropy, and need to be index-lookupable).
- #30 Migration runner — `node-pg-migrate` (Day 2 previously just said "basic migration runner" with no tool chosen).
- #31 Refresh token reuse detection — closes a gap where `PROJECT.md` §9 already claimed this as an interview talking point but `TASKS.md` Day 4 never actually scoped it as a build task.
- #23 amended: webhook HMAC secret is encrypted at rest, not hashed (it has to be read back in plaintext to sign outgoing requests, so one-way hashing doesn't work for it — this was simply unspecified before).
- #25 amended: `trust proxy` must be set explicitly since Railway sits behind a reverse proxy (otherwise every user shares one rate-limit bucket keyed off the proxy's IP); rate limiting is now IP-keyed for session traffic but API-key-ID-keyed for programmatic traffic.

`AGENT_PROMPT.md` (Auth, Checker & Alert Design, Real-Time Dashboard, API sections) and `TASKS.md` (Days 2, 3, 4, 8–13, 16, 17, 22) updated to reflect all of the above at the point in the build where they land, so a future session hits the right design the first time instead of rediscovering these mid-implementation.

**What's half-done / not started:**
- Everything in `TASKS.md` Day 1 onward — no code, no repo scaffold yet

**Known issues:** None yet — nothing built.

**Next session:** Start Day 1 — repo setup, TypeScript + Express skeleton, Postgres connection, health-check endpoint, bare-bones Railway deploy.

---

## Day 0.2 — 2026-08-13 (Planning)

**Status:** Reviewed the plan for gaps beyond the tooling choices — found and closed 9 more open decisions that would otherwise have been discovered mid-implementation. Still no code written.

**What's done:** Locked `DECISIONS.md` #18–26:
- #18 Token delivery & CSRF model (access token in memory + header, refresh token in `httpOnly`/`Secure`/`SameSite=Strict` cookie, single-origin serving)
- #19 State-machine counters persisted as columns on `monitors`, not in-memory (matters because Railway restarts on every deploy)
- #20 Checker cycle-overlap policy (skip + log if previous check still in-flight, tracked via in-memory `Set`)
- #21 Email provider: Nodemailer over SMTP
- #22 Password hashing: bcrypt
- #23 Webhook delivery: single-attempt, 5s timeout, HMAC-signed, logged to `alert_deliveries`
- #24 Test DB strategy: dedicated `sitepulse_test` DB, truncate-between-tests
- #25 Rate limiting: `express-rate-limit` in-memory store (documented explicitly, not left implicit)
- #26 Check-history partitioning: monthly `RANGE` partitions on `checked_at`

`AGENT_PROMPT.md` updated (Auth Requirements, Checker & Alert Design sections) to reflect #18–20 and #23 directly so future sessions don't need to cross-reference `DECISIONS.md` for load-bearing rules.

**What's half-done / not started:**
- Everything in `TASKS.md` Day 1 onward — no code, no repo scaffold yet

**Known issues:** None yet — nothing built.

**Next session:** Start Day 1 — repo setup, TypeScript + Express skeleton, Postgres connection, health-check endpoint, bare-bones Railway deploy.

---

## Day 0.1 — 2026-08-13 (Planning)

**Status:** All architecture decisions now locked, including the two previously open items. Still no code written.

**What's done:**
- Validation library decided: Zod (see `DECISIONS.md` #16)
- Testing library decided: Vitest + Supertest (see `DECISIONS.md` #17)
- `PROJECT.md` and `AGENT_PROMPT.md` updated to drop the "Vitest or Jest" / "choose a validation library" open items

**What's half-done / not started:**
- Everything in `TASKS.md` Day 1 onward — no code, no repo scaffold yet

**Known issues:** None yet — nothing built.

**Next session:** Start Day 1 — repo setup, TypeScript + Express skeleton, Postgres connection, health-check endpoint, bare-bones Railway deploy.

---

## Day 0 — 2026-08-07 (Planning)

**Status:** Architecture fully decided (see `DECISIONS.md`). No code written yet.

**What's done:**
- All 11 architecture decisions locked (language, database, DB access layer, background jobs, monolith/split, auth, real-time, alert evaluation, API design, multi-tenancy, deployment)
- Project renamed BetterStack-Lite → SitePulse
- `PROJECT.md`, `DECISIONS.md`, `TASKS.md`, `AGENT_PROMPT.md`, `UI_DESIGN.md`, `DAILY_LEARNING_TEMPLATE.md` created

**What's half-done / not started:**
- Everything in `TASKS.md` Day 1 onward — no code, no repo scaffold yet
- Validation library not yet chosen (flag and decide on Day 1)
- Testing library not yet chosen (Vitest vs Jest — decide on Day 1 or Day 7)

**Known issues:** None yet — nothing built.

**Next session:** Start Day 1 — repo setup, TypeScript + Express skeleton, Postgres connection, health-check endpoint, bare-bones Railway deploy.

---

<!-- Add new entries above this line, most recent at top -->
