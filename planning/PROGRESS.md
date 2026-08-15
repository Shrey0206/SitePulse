# SitePulse — Progress Log

Read this file first at the start of every session. Update it at the end of every session, even if the day's task isn't finished — an honest "half-done" beats a missing entry.

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
