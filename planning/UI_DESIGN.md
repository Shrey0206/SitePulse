# SitePulse — UI Design Specification

This is the authoritative visual and interaction spec for the SitePulse frontend. It should look like a credible engineering/operations tool, not a generic admin template or a college project.

## 1. Design Direction

- **Dark-first authenticated dashboard** (monitors, incidents, alerts, settings)
- **Dark auth pages and public status page too** (signup/login, public status page): one theme across the product. This replaces the original light-theme choice (2026-10-08): a second theme meant a second set of colour variables, and text that inherited its colour from <body> rendered near-white on the light surfaces. Contrast is held to WCAG AA: --text-faint is #7d8590, and filled buttons use --accent-solid
- Compact left sidebar + contextual top bar in the authenticated app
- Dense but readable: status lists, incident timelines, response-time charts
- Restrained accent color for interactive elements; semantic colors for status (up = green/success, down = red/error, degraded = amber/warning) — never color alone to communicate status (pair with text/icon)
- Border-led surfaces (subtle 1px borders) over heavy drop shadows
- Functional over decorative — no gradients, no glassmorphism, no oversized hero cards — except the landing page at `/`, a marketing surface that uses larger type and one soft glow behind the hero (web/src/pages/landing.css). Its product visuals are built from the real components with sample data, and it makes no claims the product does not back up (no customer logos, statistics or testimonials)

## 2. Major Frontend Surfaces

1. **Auth pages** — Login, Signup (light theme)
2. **Monitor dashboard** — list of monitors with live status, response time sparkline, quick create
3. **Monitor detail page** — check history, uptime %, incident history for that monitor, threshold config
4. **Incident timeline** — list of past + open incidents, org-wide
5. **Alert/notification settings** — configure email/webhook channels per monitor or org-wide
6. **Public status page** — read-only, no auth, shows current status of all monitors for an org + recent incident history

## 3. Page-by-Page Notes

### Monitor Dashboard
- Route: `/dashboard/monitors`
- List view: each row/card shows monitor name, URL, current status (live via SSE), uptime % (e.g. last 24h/7d/30d), last checked time
- Empty state: "No monitors yet" + create-monitor CTA
- Loading state: skeleton rows, not a blocking spinner
- Realtime-disconnected state: a small persistent banner ("Live updates paused — reconnecting…"), not a page-blocking error
- Create/edit monitor: modal or dedicated route with URL, interval, timeout, expected status, failure/recovery thresholds

### Monitor Detail
- Route: `/dashboard/monitors/:id`
- Response-time chart over selectable time range
- Check history table (paginated)
- Related incidents for this monitor
- Threshold settings inline-editable

### Incident Timeline
- Route: `/dashboard/incidents`
- Chronological list, open incidents pinned/highlighted at top
- Each incident: affected monitor, opened time, resolved time (if resolved), duration, linked alert deliveries
- Filter by status (open/resolved) and by monitor

### Alert Settings
- Route: `/dashboard/alerts`
- List of notification channels (email, webhook) with per-monitor or org-wide scope
- Delivery log (did the alert actually send, and if not, why) — this is a real debuggability feature worth building, not just decoration

### Public Status Page
- Route: `/status/:orgSlug` (no auth)
- Light theme, minimal
- Overall status banner (all systems operational / degraded / outage)
- Per-monitor status list
- Recent incident history (last N days)

## 4. States to Define for Every Data-Bearing Page

- Loading
- Empty (no data yet)
- Error (request failed)
- Permission denied (wrong org / not authenticated)
- Realtime disconnected/reconnecting (dashboard + status page, since both use SSE)

## 5. Accessibility

- Full keyboard navigation for all interactive elements
- Visible focus states
- Labels for icon-only controls (e.g. refresh, delete)
- Status never communicated by color alone — pair with text or icon
- Sufficient contrast, checked against WCAG AA at minimum

## 6. Component System

Build reusable components rather than page-specific duplicated markup:
- `StatusBadge` (up/down/degraded/unknown — icon + text + color)
- `MonitorCard` / `MonitorRow`
- `IncidentListItem`
- `ResponseTimeChart`
- `ThresholdEditor`
- `ConnectionBanner` (SSE connection state)

## 7. Definition of Done (Frontend)

For each feature, before calling it complete:
- Route and page component paths documented
- Desktop behavior confirmed
- Loading, empty, error, permission, and realtime-disconnected states implemented
- Keyboard-accessible
- Clear success/failure feedback on any action (create monitor, save settings, etc.)
