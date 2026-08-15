# SitePulse — Daily Learning Template

Use this template every day while building SitePulse. The goal is not just to generate code, but to understand the architecture deeply enough to explain it in interviews.

## Date
`YYYY-MM-DD`

## Day Number
`Day X`

## Main Build Goal for Today

```txt
e.g. Build the monitor state machine with configurable failure/recovery thresholds.
```

## What I Built Today

- [ ] Feature 1
- [ ] Feature 2
- [ ] Feature 3

## Files I Touched

```txt
src/modules/monitors/monitors.service.ts
src/modules/checker/statemachine.ts
src/modules/checker/scheduler.ts
```

## New Concepts I Learned

Write concepts, not just library names.

Examples:
- Refresh token rotation
- Raw SQL indexing/partitioning strategy
- State machine design for flapping protection
- Incident-scoped alert deduplication
- SSE vs. WebSockets trade-offs
- Multi-tenant query scoping

## Explain This Like an Interview Answer

Answer in 5–8 lines:

```txt
What did I build today and why was it designed this way?
```

## Important Backend Decisions Made Today

| Decision | Reason |
|---|---|
| | |

## Bugs or Confusions

- Bug/confusion:
- What caused it:
- How I fixed it:

## Code I Need to Revisit

- [ ] File/function:
- [ ] Why I need to revisit it:

## Testing Done Today

- [ ] Manual API test
- [ ] Frontend test
- [ ] Database check
- [ ] Unit test
- [ ] Integration test

Specific test cases:

```txt
1.
2.
3.
```

## Edge Cases Considered

Examples:
- Monitor flapping (rapid up/down transitions)
- Duplicate alert on repeated failing checks
- Refresh token reuse after rotation
- Query missing organization_id scope
- Checker overlap if a cycle runs long
- Status page requested for a monitor with no check history yet

Today's edge cases:

- [ ] Edge case 1
- [ ] Edge case 2
- [ ] Edge case 3

## Interview Questions From Today's Work

1.
2.
3.

## My Answers

### Q1
Answer:

### Q2
Answer:

### Q3
Answer:

## System Design Notes

```txt
e.g. The checker never runs two checks for the same monitor concurrently
(single scheduler, one check per monitor per cycle), so there's no real
race condition on state-machine transitions — worth stating honestly
rather than inventing a lock that isn't needed.
```

Today's notes:

```txt

```

## Commands Used

```bash
npm run dev
npm run test
npm run migrate
```

Today's commands:

```bash

```

## Tomorrow's Plan

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

## Confidence Score

```txt
Build completion: __/10
Concept understanding: __/10
Interview explanation readiness: __/10
```

## One Thing I Must Explain Better

```txt

```

## Final Daily Summary

```txt

```

---

## UI/UX Review

Complete this section on days involving frontend work.

### Reference Pattern Used

```txt
e.g. compact metric cards, monitor status list, live-updating incident timeline
```

### Page States Implemented

- [ ] Loading
- [ ] Empty
- [ ] Error
- [ ] Permission denied
- [ ] Realtime disconnected/reconnecting

### Accessibility Check

- [ ] Keyboard navigation
- [ ] Visible focus state
- [ ] Labels for icon-only controls
- [ ] Status not communicated by color alone
- [ ] Contrast checked

### UI Decision I Can Explain

```txt
What interface decision did I make, and how does it improve the workflow?
```
