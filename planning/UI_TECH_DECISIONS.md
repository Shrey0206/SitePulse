# SitePulse — Frontend Tech Decisions

Companion to `DECISIONS.md`, split out because the frontend has its own set of choices that don't belong in the backend architecture log.

## 1. Frontend Framework
Date: 2026-08-07
Chosen: React + TypeScript
Rejected alternatives: Plain vanilla JS/HTML — lowest overhead, but weaker signal for a full-stack-capable backend candidate and doesn't showcase component/state design; Svelte — smaller and faster, but no prior experience and less commonly asked about in Tier-3 campus interviews than React
Why: Matches prior EventOps experience (zero ramp-up), is the most commonly expected frontend choice in campus interviews, and is more than sufficient for a "functional, not fancy" dashboard.

## 2. Build Tooling
Date: 2026-08-07
Chosen: Vite
Rejected alternatives: Webpack — more configuration surface for no benefit at this project's scale
Why: Fast dev server, minimal config, simple to explain in an interview if asked about the build pipeline.

## 3. State Management (including SSE)
Date: 2026-08-07
Chosen: React Context + `useReducer` for global state (auth session, live monitor status); local component state (`useState`) elsewhere
Rejected alternatives: Redux / Zustand — real state-management libraries solve cross-cutting, complex state; SitePulse has one real-time data source (SSE monitor status) and one auth session, neither of which needs a dedicated library
Why: Matches the project's overall philosophy of not adding infrastructure/abstraction without a concrete need. Defensible answer to "why not Redux": no complex cross-cutting state to justify it.

## 4. SSE Client-Side Connection Management
Date: 2026-08-07 (amended 2026-08-13 — see `DECISIONS.md` #27)
Chosen: A top-level provider component fetches a short-lived, single-use SSE ticket via an authenticated REST call (`POST /api/v1/sse/ticket`), then opens `new EventSource('/api/v1/sse?ticket=...')` and dispatches received events into the Context reducer. Connection state (`connecting` / `open` / `disconnected`) is tracked in the same reducer and drives the `ConnectionBanner` component (see `UI_DESIGN.md`).
Reconnection: because the ticket is single-use and short-lived, the browser's native `EventSource` auto-retry (which reopens the same, now-stale URL) can't be relied on. On an `error` event, the provider closes the connection, fetches a fresh ticket, and opens a brand-new `EventSource` — a small custom retry step, not a full reconnect/backoff library. Disconnection state is surfaced to the user via the banner throughout, never hidden.
Why: `EventSource` can't send an `Authorization` header, so it can't use the header-only access token from `DECISIONS.md` #18 directly — the ticket indirection is what makes SSE auth work at all under that model. Once a valid connection is open, native `EventSource` behavior is used as-is; the only custom logic is re-minting a ticket on reconnect, kept as small as the original browser-native-reconnect reasoning intended.

## 5. HTTP Client for REST Calls
Date: 2026-08-07
Chosen: Native `fetch`, wrapped in a small typed API client module (attach JWT access token, handle 401 → refresh-token retry once, then redirect to login)
Rejected alternatives: Axios — convenient, but adds a dependency for functionality `fetch` already covers at this scale
Why: One more "why did you add this" question avoided; the wrapper module is small enough to be fully understood and explained.
