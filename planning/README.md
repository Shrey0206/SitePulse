# SitePulse Planning Package

This package is the "project brain" for building SitePulse across sessions with an AI coding agent that has no memory between sessions.

Files:

- `PROJECT.md` — product scope, architecture, and reasoning (the north star)
- `DECISIONS.md` — locked backend architecture decisions, append-only
- `UI_TECH_DECISIONS.md` — locked frontend tech decisions (framework, state management, SSE handling), append-only
- `TASKS.md` — 30-day day-by-day build plan with checkboxes
- `AGENT_PROMPT.md` — coding-agent working rules and constraints
- `UI_DESIGN.md` — frontend design system and page specifications
- `DAILY_LEARNING_TEMPLATE.md` — daily engineering/interview-prep log (copy per day into `/logs`)
- `PROGRESS.md` — running session log; read this first at the start of every session

## Session Start Ritual

1. Read `PROGRESS.md` (what happened last, what's half-done, known issues)
2. Read today's task in `TASKS.md`
3. Ask the agent to summarize its understanding before writing any code
4. If resuming mid-task: `git log --oneline -20` and `git diff` against the last commit

## Session End Ritual

1. Update `PROGRESS.md` with what was done, what's half-done, what broke and how it was fixed
2. Fill out a copy of `DAILY_LEARNING_TEMPLATE.md`
3. Add any new decision to `DECISIONS.md`
4. Check off today's item in `TASKS.md`
5. Commit with a clear message
