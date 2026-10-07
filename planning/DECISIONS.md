# SitePulse — Decisions

This document records the final architectural decisions for SitePulse. Append-only — do not re-litigate a settled decision without a new entry explaining what changed.

## 1. Backend Language/Framework
Date: 2026-08-07
Chosen: Node.js + TypeScript + Express
Rejected alternatives: Java + Spring Boot (safer "expected" campus stack, but ramp-up cost too high for a stack-agnostic target pool and a 30-day timeline); Python/FastAPI or Django (no prior experience)
Why: Zero ramp-up time (prior EventOps experience) preserves time for architectural depth. Target companies are product/startup-leaning, so Node isn't a liability. Must be ready to defend Node's event-loop/concurrency model for I/O-bound work (health checks, webhooks).

## 2. Database Strategy
Date: 2026-08-07
Chosen: Single PostgreSQL instance, manual indexing + partitioning on the check-history table
Rejected alternatives: Postgres + separate time-series store (InfluxDB) — added deployment/consistency complexity with thin interview payoff; Postgres + TimescaleDB extension — reasonable middle ground, but plain Postgres gives the same core partitioning talking point without an extra extension to defend
Why: One database keeps operational complexity low and lets you go deep on indexing/partitioning strategy for an unboundedly growing table — a classic, defensible DBMS interview topic.

## 3. Database Access Layer
Date: 2026-08-07
Chosen: Raw SQL via `node-postgres` (`pg`)
Rejected alternatives: Prisma — faster to build with, but abstracts away the SQL and query-plan reasoning that's a stronger interview asset; Knex — middle ground, not chosen
Why: Writing raw SQL forces (and demonstrates) real understanding of joins, indexes, and query performance — more defensible than "the ORM generated this query" when asked to explain a query plan.

## 4. Background Job Architecture
Date: 2026-08-07
Chosen: In-process scheduler (interval loop, concurrent batched checks, per-check timeout via `AbortController`)
Rejected alternatives: BullMQ + Redis job queue — gives persistence, retries, and a live horizontal-scaling story, but adds a second service to run and reason about
Why: Keeps the stack to one process and one database. Known limitations (lost in-flight checks on restart, single-instance-only, no automatic retry/backoff) are explainable trade-offs. "How would you scale this" answer: move to a queue; explain why it wasn't needed yet at this scale.

## 5. Monolith vs. Service Split
Date: 2026-08-07
Chosen: Monolith — checker runs in-process alongside the API
Rejected alternatives: Splitting the checker into its own service — would add deployment overhead without independent scaling benefit, since it'd still hit the same Postgres directly with no queue between them
Why: Consistent with the in-process scheduler decision. Interview answer: "the checker is the natural first extraction point if this needed to scale."

## 6. Auth Strategy
Date: 2026-08-07
Chosen: JWT — short-lived access token (~15 min) + longer-lived refresh token (~7 days), refresh tokens stored hashed in a Postgres `refresh_tokens` table for revocability
Rejected alternatives: Server-side sessions — simpler and trivially revocable, but a DB lookup on every request is a weaker fit for an API-first product
Why: Stateless access tokens keep the hot path fast; a server-tracked refresh token gives real revocation (logout, compromise). Enables talking about rotation, revocation, and refresh-token-reuse detection.

## 7. Real-Time Updates
Date: 2026-08-07
Chosen: Server-Sent Events (SSE) for live monitor status
Rejected alternatives: WebSockets — full-duplex not needed for a one-directional status feed, adds reconnection/scaling complexity without benefit; Polling — simplest but weaker interview story and unnecessary request overhead
Why: SSE matches the use case exactly (server pushes, client never talks back), auto-reconnects natively, needs zero new infrastructure — consistent with the monolith/single-instance decisions.

## 8. Alert Evaluation Design
Date: 2026-08-07
Chosen: State machine per monitor (`up → suspected_down → down`, `down → suspected_up → up`, requiring N consecutive failing/passing checks to transition) + incident-scoped alert firing (alert fires on first transition into `down`, not on every failing check; resolves + optionally fires "recovered" alert on transition back to `up`). Evaluated synchronously, in-process, at check-write time. N (`failure_threshold`, `recovery_threshold`) is user-configurable per monitor, not a fixed global default.
Rejected alternatives: Naive event-driven alerting on every status change — no flapping protection; async/queued evaluation — unnecessary given no queue infrastructure; fixed global threshold — a real monitoring tool needs this to vary per monitor
Why: Directly answers "how do you avoid false positives from a single blip" — near-guaranteed for a monitoring product. Incident-scoped firing prevents duplicate alerts on every subsequent failing check. No real concurrency concern to defend, since one scheduler means checks for a given monitor never run concurrently with themselves.

**Worked example** (monitor with thresholds 3/3):
```
OK, OK, OK                → status: up (steady state, no incident)
FAIL, FAIL, FAIL           → suspected_down → down → incident opens → alert sent
FAIL, FAIL, FAIL (still down) → no new incident, no new alert (same open incident)
OK, OK, OK                 → suspected_up → up → incident resolves → recovery alert sent
FAIL, FAIL, FAIL           → suspected_down → down → NEW incident opens → NEW alert sent
```
A resolved incident does not stay "open" waiting to see if the monitor flaps again — each `down` transition after a resolution starts a fresh incident and a fresh alert. This is a deliberate simplicity trade-off: a monitor that flaps repeatedly (down→up→down→up in quick succession) will generate one incident + one alert per full down/up cycle, not one suppressed incident. A dedicated "flap detection" layer (suppressing repeated alerts within a cooldown window) is a reasonable v1.1 extension, called out explicitly rather than left ambiguous.

## 9. API Design
Date: 2026-08-07
Chosen: REST only, URL-based versioning (`/api/v1/...`), OpenAPI/Swagger spec with auto-generated docs UI
Rejected alternatives: GraphQL — adds a schema/resolver layer and a second auth/rate-limit story with no scoped feature that needs flexible querying; header-based versioning — more "correct" in some views but invisible in a live demo
Why: Matches original scope directly (versioned, documented, API-key auth, rate-limited REST API). URL versioning is demo-visible.

## 10. Multi-Tenancy
Date: 2026-08-07
Chosen: Built in from day 1 — `organization_id` scoping across monitors, incidents, alerts, and status pages
Rejected alternatives: Single-tenant with "here's how I'd extend it" — contradicts the already-scoped "status page per organization" feature, and retrofitting tenant scoping later is more expensive than including it from the schema up
Why: Already implicitly committed to by the status-pages feature. Avoids a costly retrofit; gives a real, working multi-tenant system to demo.

## 11. Deployment Target
Date: 2026-08-07
Chosen: Railway (Node/Express monolith + Postgres, git-push deploy)
Rejected alternatives: Render — equally viable, free tier cold-starts on inactivity; Fly.io — more infra-flavored setup; VPS — full control but real time cost (nginx, process manager, OS updates) for a non-scored part of the project
Why: Least operational overhead for a solo 30-day build; git-push deploy fits the "deploy by end of week 1" goal.

## 12. Project Name
Date: 2026-08-07
Chosen: SitePulse (renamed from working title "BetterStack-Lite")
Why: Original working title was descriptive-but-derivative; SitePulse stands as its own product name for the portfolio/resume.

## 13. Checker Self-Monitoring
Date: 2026-08-07
Chosen: A `GET /health` endpoint that reports the last time the in-process scheduler completed a check cycle, alongside standard app liveness. If the last cycle timestamp is older than 2x the longest configured monitor interval, the endpoint returns a `warning` (or `degraded`) status instead of `ok`.
Rejected alternatives: No self-monitoring — rejected because a monitoring tool whose own checker silently dies is a real, ironic failure mode, and it's a cheap, high-payoff addition (one timestamp tracked in memory, one conditional in the health endpoint)
Why: Directly answers "how do you know your own system is working" — a natural question for a monitoring product specifically. Costs almost nothing to build (no new infrastructure — just a tracked timestamp and a threshold check) and is a concrete, demoable thing ("watch what the health endpoint reports if I kill the checker").

## 14. Frontend Stack
Date: 2026-08-07
Chosen: React + Vite + TypeScript. See `UI_TECH_DECISIONS.md` for the full frontend decision log (state management, SSE connection handling, HTTP client).
Why: Matches prior experience, minimal ramp-up, sufficient for a functional dashboard. Full reasoning in `UI_TECH_DECISIONS.md`.

## 15. Load Testing Tool
Date: 2026-08-07
Chosen: k6
Rejected alternatives: Artillery — also viable, no strong reason to pick over k6; custom Node script — reinvents what a purpose-built tool already does well, and produces less credible/standard output to show in the README
Why: k6 is scriptable (JS-based test scripts, no new language to learn), produces clean summary metrics (p95/p99 latency, throughput) suitable for pasting real numbers into the README, and is a recognized, standard tool — "I load tested with k6" is a concrete, checkable claim.

Target for Day 23 (checker load test): 100 monitors at 30s intervals; measure check-cycle completion time, target p95 < 5s per cycle.
Target for Day 24 (API load test): realistic concurrent request mix across auth, monitor CRUD, and status-page endpoints; record actual p95/p99 latency and error rate — no invented numbers, whatever k6 reports is what goes in the README.

## 16. Validation Library
Date: 2026-08-13
Chosen: Zod
Rejected alternatives: Joi — mature and widely used, but no native TypeScript type inference, so the validation schema and the TS type for the same entity can drift apart over time; express-validator — middleware-chain style that couples validation to Express routing, weaker fit with the project's service/controller separation
Why: Zod schemas double as the single source of truth for both runtime validation and the static TypeScript type (`z.infer<...>`), so a monitor's shape is defined once, not twice. Fits the project's TypeScript-everywhere philosophy and is the standard modern choice for Node/Express + TS stacks.

## 17. Testing Library
Date: 2026-08-13
Chosen: Vitest + Supertest
Rejected alternatives: Jest + Supertest — more universally recognized and slightly more StackOverflow coverage, but heavier TS/ESM config (ts-jest or babel transform) for no functional benefit at this project's scale
Why: Vitest is fast (esbuild-based), has native ESM/TypeScript support with minimal config, and exposes a Jest-compatible API so there's nothing new to learn. Keeps tooling consistent with the frontend's Vite choice. Supertest remains the HTTP assertion layer for API integration tests regardless of runner.

## 18. Token Delivery & CSRF Model
Date: 2026-08-13
Chosen: Access token kept in memory only (React state/Context, never persisted), sent via `Authorization: Bearer` header. Refresh token delivered as an `httpOnly`, `Secure`, `SameSite=Strict` cookie, scoped to the `/api/v1/auth/refresh` (and `/logout`) path only. In production the built frontend is served by the same Express app (single origin), removing the cross-site cookie question entirely; in dev, the Vite dev server proxies API calls to the Express origin so cookies stay first-party.
Rejected alternatives: Refresh token in localStorage — already ruled out (XSS-readable, not revocable-in-place); both tokens in cookies — simpler but makes every request CSRF-relevant instead of just the refresh endpoint; separately hosted frontend/backend origins — would force a cross-site cookie (`SameSite=None`) and a real CSRF-token scheme, extra complexity with no scoped feature requiring split hosting
Why: `httpOnly` keeps the refresh token off-limits to XSS; `SameSite=Strict` means the browser never attaches it to a request that didn't originate on the app itself, which neutralizes CSRF on the one endpoint that relies on the cookie. The access token is never in a cookie, so it's immune to CSRF by construction (a forged cross-site request has no way to attach it) — the trade-off is that it must be re-supplied on a hard page refresh, handled by a silent call to `/refresh` on app load.

## 19. State Machine Counter Persistence
Date: 2026-08-13
Chosen: `consecutive_failures` and `consecutive_successes` are integer columns on `monitors`, updated in the same transaction as the triggering check write (check insert + counter update + state transition, if any, commit together).
Rejected alternatives: In-memory counters on the scheduler process — simplest to write, but silently reset on every restart, and decision #11 already commits to a deploy model (Railway git-push) that restarts the process routinely; a monitor sitting at 2-of-3 failures would lose that progress on every deploy with no record it happened
Why: A monitoring product's own alert state has to survive its own restarts, or "does your system correctly detect an outage that started right before a deploy" has no good answer. Storing the counters as ordinary columns costs nothing new (same table, same transaction) and keeps the state machine's memory durable without adding infrastructure.

## 20. Checker Cycle-Overlap Policy
Date: 2026-08-13
Chosen: The scheduler tracks in-flight monitor IDs in an in-memory `Set`. On each tick, a monitor is only checked if it's due (`now - last_checked_at >= interval`) AND not already in the in-flight set. A monitor whose previous check hasn't finished by the next tick is simply skipped for that tick and picked up on the following one; the skip is logged.
Rejected alternatives: Allow concurrent checks for the same monitor — breaks the "checks for a given monitor never run concurrently with themselves" assumption decision #8 relies on to avoid a state-machine race; queue overdue checks to run immediately on completion — adds scheduling complexity for a case (a check outliving its own interval) that a sane per-monitor timeout should make rare
Why: This is the direct answer to "what happens if a check takes longer than its interval" — a question the DAILY_LEARNING_TEMPLATE.md edge-case list already anticipated but DECISIONS.md hadn't resolved. Skipping instead of queuing keeps the single-check-in-flight-per-monitor guarantee intact with no new data structures beyond one `Set`.

## 21. Email Notification Provider
Date: 2026-08-13
Chosen: Nodemailer over SMTP (provider-agnostic — Mailtrap or similar in dev, any real SMTP relay in production)
Rejected alternatives: A transactional email API (Resend, SendGrid) — nicer DX and deliverability tooling, but ties the project to a specific vendor's SDK/API and hides the protocol; for a backend-depth portfolio project, sending real SMTP is the more defensible "I understand what's happening" answer
Why: Consistent with the project's recurring theme (raw SQL over an ORM, in-process scheduler over a queue) of favoring the fundamental mechanism over a managed abstraction when the extra vendor dependency isn't buying a scoped feature. SMTP is also swappable — a real provider in production is a config change, not a code change.

## 22. Password Hashing
Date: 2026-08-13
Chosen: bcrypt
Rejected alternatives: argon2 — OWASP's current recommendation and arguably stronger, but the `argon2` npm package requires native compilation, which adds a deployment-environment risk on Railway for no scoped requirement driving the extra hardening
Why: bcrypt is the standard, well-understood default, has no native-build surprises, and is universally recognized in interviews without needing extra justification.

## 23. Webhook Delivery Semantics
Date: 2026-08-13
Chosen: Single-attempt delivery (no retry), 5s timeout via `AbortController` (same pattern as the checker's own HTTP calls), payload signed with HMAC-SHA256 using a per-webhook secret and sent as an `X-SitePulse-Signature` header, delivery attempt (status, latency, response code/error) logged to an `alert_deliveries` table. The per-webhook secret is encrypted at rest (AES-256-GCM, key from an env var, never committed) rather than hashed, since — unlike a password or API key — it has to be read back in plaintext to compute the outgoing signature; a one-way hash can't be reversed for that.
Rejected alternatives: Retry with backoff — would need to survive process restarts to be reliable, which means persistence/a queue, contradicting decision #4's no-queue constraint; unsigned payloads — cheaper but drops a standard, cheap-to-build security property (receiver can verify the request actually came from SitePulse) that's a natural talking point alongside the alert pipeline
Why: Matches the no-queue constraint honestly — a fire-and-forget single attempt is what "no queue" actually implies, rather than pretending to retry without the infrastructure to do it reliably. Signing is nearly free to add and mirrors a pattern candidates are likely to have seen (Stripe-style webhook signatures). Retry-with-backoff is a reasonable v1.1 extension once a queue exists, same framing as the flapping/cooldown extension already noted in decision #8.

## 24. Test Database Strategy
Date: 2026-08-13
Chosen: A dedicated `sitepulse_test` database, migrated with the same migration runner used in dev/prod. Tests truncate the tables they touch in a shared `beforeEach`/`afterEach` helper rather than wrapping each test in a rolled-back transaction.
Rejected alternatives: Transaction-per-test rollback — faster and a common pattern, but the app code itself opens transactions (e.g. incident creation, decision #8's synchronous evaluation), and nesting the test's own transaction around code that starts its own is extra complexity to get right with a raw `pg` client and no ORM-provided test helpers
Why: Truncation is simple to reason about with raw SQL, works regardless of what the code under test does with transactions internally, and is fast enough at this project's data volume. Keeps the same migration path used everywhere else instead of a parallel test-only schema setup.

## 25. Rate Limiting Store & Granularity
Date: 2026-08-13
Chosen: `express-rate-limit` with its default in-memory store. `app.set('trust proxy', 1)` is set explicitly so the limiter keys off the real client IP forwarded by Railway's edge proxy, not the proxy's own IP. Two separate limiter configs: IP-keyed for unauthenticated/JWT-session traffic (login, signup, public status pages), API-key-keyed (by key ID, from decision #29) for programmatic `/api/v1` traffic authenticated with an API key.
Rejected alternatives: A Redis-backed store — would give rate limits that are consistent across horizontal instances, but decision #4/#5 already committed to a single-instance monolith with no Redis, so a distributed limiter store has no scoped need to serve; IP-only keying everywhere — simpler, but a poor fit for API-key traffic, where the real caller identity is the key, not the IP it happens to originate from (shared NAT, multi-server clients, etc.)
Why: Consistent with every other "don't add infrastructure the current scale doesn't need" decision in this log. Named explicitly here (rather than left implicit) so it reads as a choice, not an oversight — known limitation: limits reset on restart and wouldn't hold if ever run as multiple instances, same honest trade-off already accepted for the in-process scheduler. `trust proxy` matters specifically because every PaaS deployment (Railway included) puts the app behind a reverse proxy — without it, every user is indistinguishable from every other user for rate-limiting purposes, which would throttle the whole app off one shared bucket almost immediately.

## 26. Check-History Partitioning Scheme
Date: 2026-08-13
Chosen: Native PostgreSQL declarative `RANGE` partitioning on `checks.checked_at`, one partition per month, with an index on `(monitor_id, checked_at)` local to each partition.
Rejected alternatives: Hash partitioning on `monitor_id` — evens out write load across monitors, but the actual query pattern (dashboard/uptime-% queries filtering by recent time range) benefits from time-based partition pruning, not monitor-based; no partitioning — simplest, but forfeits the classic ever-growing-table interview story decision #2 was chosen specifically to enable
Why: Time-range partitioning matches the dominant access pattern (recent-window queries) and gives a clean, demoable retention story (drop old partitions instead of a slow `DELETE`) — the standard justification for partitioning a time-series-shaped table, and the one decision #2 already committed to being able to defend.

## 27. SSE Authentication Mechanism
Date: 2026-08-13
Chosen: A short-lived, single-use SSE ticket. The client calls an authenticated REST endpoint (`POST /api/v1/sse/ticket`, normal JWT access token via `Authorization` header) which mints a random ticket and stores it server-side (in-memory `Map<ticket, {userId, orgId, expiresAt}>` — consistent with the no-new-infra pattern used everywhere else) with a ~30s TTL and single-use semantics. The client immediately opens `new EventSource('/api/v1/sse?ticket=...')`; the server validates the ticket (exists, unexpired, unused), consumes it, and identifies the user/org for the stream's lifetime. On any SSE `error` event, the client closes the connection, fetches a fresh ticket, and opens a brand-new `EventSource` (see `UI_TECH_DECISIONS.md` #4) instead of relying on the browser's native retry against a now-stale, already-consumed URL.
Rejected alternatives: A readable (non-httpOnly) cookie carrying the access token just for SSE — reintroduces the XSS exposure decision #18 was written specifically to avoid; widening the refresh cookie's path scope to cover the SSE endpoint — increases that cookie's blast radius for no reason beyond convenience
Why: `EventSource` cannot send custom headers, so the header-only access-token model in #18 has no direct way to authenticate an SSE connection. A short-lived, single-use ticket keeps the real bearer credential out of both the URL and any long-lived cookie — a leaked ticket (e.g., in a server access log) is worthless within seconds and can't be replayed.

## 28. Incident Lifecycle Invariant & Manual/Auto Interaction
Date: 2026-08-13
Chosen: `incidents` gets a `source` column (`auto` | `manual`) and a nullable `monitor_id` (auto incidents always reference exactly one monitor; manual incidents may reference one, none, or — via a join table — several). Auto-incident correctness is enforced as a standing invariant evaluated on every check write, not a one-time transition event: after the state machine updates, (a) if the monitor's state is `down` and no open `source='auto'` incident exists for it, one is created; (b) if the monitor's state is `up` and an open `source='auto'` incident exists for it, it's resolved. A partial unique index (`monitor_id WHERE source='auto' AND resolved_at IS NULL`) guarantees at most one open auto incident per monitor at a time. Manual incidents are independent rows that neither suppress nor merge with auto incidents — a monitor can have an open manual incident (e.g., a declared maintenance window) and an open auto incident simultaneously; both surface on the status page and timeline, distinctly labeled.
Rejected alternatives: Firing incident creation only at the literal transition edge (as #8 originally implied) — breaks if a user manually resolves an incident while the monitor is still actually `down`: no new "transition" ever occurs afterward, so no incident reopens and the status page silently claims "operational" while the monitor stays down; auto-suppressing alerts during an open manual maintenance window — a real, reasonable feature, but scope creep for v1, named explicitly below rather than left ambiguous
Why: Modeling incident-open as an invariant ("state is down implies exactly one open auto incident exists") rather than an edge-triggered side effect makes the system self-correcting after a manual override, a missed transition, or (combined with #19's persisted counters) a restart, without special-casing any of those as separate bug fixes. Not building maintenance-window alert suppression for v1 is the same kind of named, honest trade-off as the flapping behavior in #8 — "can I silence alerts during planned maintenance" has a clear, prepared answer ("not in v1; I'd add a `suppressed_until` on the monitor, checked before firing").

## 29. API Key Storage & Format
Date: 2026-08-13
Chosen: An API key is a random high-entropy token issued once at creation (`sp_live_<32+ random chars>`), shown to the user exactly once. The server stores a SHA-256 hash of the full key plus a short unhashed prefix (first 8 chars) for display/identification in the UI, in an `api_keys` table scoped by `organization_id`. Verification hashes the presented key and looks up by exact hash match; the row's ID is also what decision #25's API-key rate-limit bucket keys off.
Rejected alternatives: bcrypt, matching password storage — bcrypt's deliberate slowness defends against low-entropy, guessable secrets (human passwords) and can't be looked up by index, only compared one row at a time; an API key is already high-entropy and random, so it needs neither property
Why: Matches the pattern used by GitHub/Stripe-style tokens — a fast, indexable hash is the right primitive for a random secret, while bcrypt is the right primitive for a human-chosen, low-entropy one. Distinguishing the two is itself a good answer to "why not bcrypt everywhere."

## 30. Migration Runner
Date: 2026-08-13
Chosen: `node-pg-migrate`
Rejected alternatives: A fully custom runner (a `schema_migrations` tracking table + hand-rolled `.sql` file loader) — marginally more "raw," but reinvents solved, boring infrastructure (up/down tracking, transaction wrapping, ordering) for no interview payoff beyond what `node-pg-migrate` already demonstrates; Prisma Migrate — tied to the Prisma ecosystem, contradicts decision #3's no-ORM choice
Why: Runs plain SQL (or thin JS migration files) directly against Postgres via `pg`, with no query-builder/ORM layer, so it doesn't compromise decision #3 — it's purely a migration *runner*, not a data-access layer. Avoids rebuilding transaction-safe up/down tracking by hand for a part of the project with no scoped depth requirement of its own.

## 31. Refresh Token Reuse Detection
Date: 2026-08-13
Chosen: Each `refresh_tokens` row carries a `family_id` (shared by every token descended from one login) and a `revoked_at` / `replaced_by_token_id` pair. On rotation, the presented token is marked revoked and linked to its replacement, which keeps the same `family_id`. If a token that's already been rotated (has `replaced_by_token_id` set) is presented again, that's treated as reuse of a stolen/leaked token: the entire `family_id` is revoked immediately, forcing re-login on every session descended from that login.
Rejected alternatives: Rotation without reuse detection (just overwrite/delete the old token on refresh) — simpler, but drops the one property that makes rotation worth doing over a single long-lived refresh token in the first place: detecting that a token was used out-of-band by someone who isn't the legitimate client
Why: `PROJECT.md` §9 already lists "refresh-token-reuse detection" as an expected interview talking point, but it wasn't actually scoped as a build task — silently claiming a feature that isn't built. This closes that gap as a small addition on top of the rotation logic already planned for Day 4 (see `TASKS.md`), not new infrastructure.

## 32. Partition Maintenance
Date: 2026-08-14
Chosen: The in-process scheduler ensures partitions exist for the current month plus a 2-month lookahead buffer, checked once per day (a cheap `CREATE TABLE IF NOT EXISTS checks_YYYY_MM PARTITION OF checks FOR VALUES FROM (...) TO (...)` — a no-op if already present) and once at process startup.
Rejected alternatives: `pg_partman` extension — automates exactly this, but is a new Postgres extension to install and defend, contradicting decision #2's plain-Postgres-only reasoning; pre-creating a year's worth of partitions once at migration time — simpler, but doesn't actually solve partition maintenance, just defers the same failure by a year with nothing to catch it recurring
Why: Native declarative `RANGE` partitioning (#26) does not auto-create partitions — an insert whose `checked_at` falls outside every existing partition's range fails outright. Without an explicit maintenance mechanism, the checker (the one part of the system that must never silently stop working) would start failing every check-write the moment a month boundary passed uncovered. Reusing the already-running scheduler avoids adding a second cron/job mechanism; the 2-month buffer means even a delayed deploy has slack before anything breaks.

## 33. Alert Delivery Logging Scope
Date: 2026-08-14
Chosen: `alert_deliveries` logs every attempted notification on both channels, not webhooks only — a `channel` column (`email` | `webhook`) alongside `status` (`sent`/`failed`), a timestamp, and an error detail (SMTP rejection reason, or HTTP status/timeout for webhooks). Email sends (#21) write a row on both success and failure, exactly like webhook deliveries already do under #23.
Rejected alternatives: Logging webhooks only, as #23 originally scoped it — leaves `UI_DESIGN.md`'s Alert Settings page promising a delivery log for whether "the alert actually sent" true for only one of the two channels, a real gap between a stated feature and what was actually decided
Why: The debuggability goal named in `UI_DESIGN.md` ("did the alert actually send, and if not, why") applies equally to both channels — an SMTP send can silently fail (bad credentials, provider rejection, full mailbox) just as easily as a webhook can time out, and a monitoring product whose own alert pipeline is unobservable on one of its two channels undercuts the point of building the log at all.

## 34. Organization Creation & Slug Generation
Date: 2026-08-14
Chosen: Signup creates exactly one organization per new user, in the same transaction as the user row (matches "v1 is single-user-per-org," `PROJECT.md` §3). The org slug is auto-generated from the org name (kebab-cased, lowercased), with a short random suffix appended on collision — detected via a unique constraint violation and retried, not a pre-check-then-insert race. The slug is user-editable later from settings; changing it immediately invalidates the old public status-page URL for v1 (no redirect/alias kept).
Rejected alternatives: Slug = org ID/UUID — collision-free and simpler, but produces an unreadable public status-page URL, undermining the point of a human-facing status page; preserving old-slug redirects on rename — a reasonable real-product feature, but needs a slug-history table for a v1 that doesn't otherwise need one
Why: Closes a genuinely open question — nothing in the doc set previously specified how `/status/:orgSlug` URLs are minted or whether they're stable. Auto-generating from the org name gives a readable default for free; stating "changing the slug breaks the old link" up front is the same honest-limitation pattern already used for flapping (#8) and no maintenance-window suppression (#28), rather than letting it be discovered as a support complaint later.

## 35. SSE Connection Lifetime vs. Logout
Date: 2026-08-14
Chosen: The server closes each SSE connection from its side once it's been open longer than the access-token TTL (~15 min, decision #6). The client's existing reconnect-on-close logic (#27) then re-fires: it requires minting a fresh ticket, which requires a currently-valid access token. A logged-out client has no way to obtain one, so its stream provably stops within one TTL window of logout rather than continuing indefinitely.
Rejected alternatives: Checking revocation on every SSE push (a DB/blocklist lookup per event) — gives immediate correctness, but adds a per-event check to a channel decision #7 chose specifically to keep infrastructure-free; leaving connections unbounded (the original, undecided default) — rejected because "session/token revocation on logout" would otherwise be false for this one channel specifically
Why: Bounds SSE's exposure window to the same ~15-minute revocation-lag trade-off already accepted for the access token itself in decision #6, instead of leaving it open-ended. No new infrastructure — a single `setTimeout` closing its own connection, consistent with how #27 was built.

## 36. Manual Incident Alerting
Date: 2026-08-14
Chosen: Manual incidents (`source='manual'`) do not fire alerts automatically. Creating or resolving one is a declarative action, visible immediately on the status page and incident timeline; email/webhook alerts remain scoped exclusively to the auto-incident open/resolve invariant (#8/#28).
Rejected alternatives: Firing an alert on every manual incident create/resolve too — reasonable for a real product, but splits alert-firing across two independent triggers instead of one, for a feature (manually-declared incidents) that's explicitly secondary scope; making notification opt-in per manual incident — real flexibility, but v1.1-shaped, not core
Why: Keeps "alerts fire once on open, once on resolve" (#8) anchored to a single trigger path rather than "...except manual incidents, which are different." Named explicitly, in the same style as the maintenance-window-suppression gap in #28, so it reads as a stated v1 boundary rather than something nobody thought about.

## 37. API Key Scope & Expiration
Date: 2026-08-14
Chosen: v1 API keys are full-access within their issuing organization (no scoped/restricted permissions) and non-expiring until manually revoked.
Rejected alternatives: Scoped/read-only keys (Stripe-style restricted keys) — a real feature of mature APIs, but adds a permissions model with no scoped v1 feature that needs less than full access; auto-expiring keys — forces a renewal/rotation UX (expiry warnings, renewal flow) for a feature (programmatic API access) that's already secondary to the core monitoring/incident/alert path
Why: Same "don't build flexibility the current scope doesn't need" pattern as the rest of this log — stated explicitly so "can a key be read-only" or "do keys expire" has a prepared, honest v1.1-extension answer instead of silence.

## 38. Discord and Slack Alert Channels
Date: 2026-10-07
Chosen: Add `discord` and `slack` notification channel types that POST each service's native incoming-webhook message format. The pasted webhook URL is treated as a credential: it is validated against the services' real hosts and path shapes (`discord.com`/`discordapp.com`/`ptb.`/`canary.` and `hooks.slack.com` only, https, no userinfo/port/query), stored AES-256-GCM encrypted in `secret_encrypted` with the same key and machinery as webhook signing secrets (#23), and `target` holds a masked label (`discord.com/api/webhooks/<id>/••••••••`) that the API, UI and delivery log show instead. Single attempt, no retry, redirects not followed — same delivery model as #23.
Rejected alternatives: Pointing the existing generic webhook at Discord/Slack — those services reject SitePulse's JSON shape (Discord needs `content`/`embeds`, Slack needs `text`/`blocks`), so every delivery would log as failed; storing the URL plaintext in `target` like the generic webhook — a Discord/Slack URL is a bearer credential (unlike a generic webhook URL, which is protected by a separate HMAC secret), so it would sit in the database, API responses, the delivery log and any demo screenshot; accepting any https URL for these types — would hand every signed-up user a way to make the server POST to arbitrary hosts, whereas pinning to the two real hosts makes these channels SSRF-safe by construction; adding an HTTPS email API (Resend) instead — works, but a different feature and a new vendor dependency
Why: Railway disables outbound SMTP on Free/Trial/Hobby plans, so email alerts cannot send from the deployed app (#21's SMTP choice still holds for local dev and any host that allows it). Chat webhooks are plain HTTPS, work on every Railway plan, need no new vendor or account on SitePulse's side, and give the user a push notification on their phone. User-controlled text (monitor names) is made inert in both formats: Discord `allowed_mentions` is emptied so a monitor named "@everyone" cannot ping a server, and Slack mrkdwn control characters are escaped. The chat-channel secret column is deliberately not constrained to non-null, because Postgres will not let a newly added enum value be used in the transaction that adds it; the delivery path logs a failed delivery for a missing URL instead.
