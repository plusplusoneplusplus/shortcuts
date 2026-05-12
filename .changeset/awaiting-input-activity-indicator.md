---
"@plusplusoneplusplus/forge": minor
"@plusplusoneplusplus/coc": minor
---

Activity list now visually distinguishes running chat tasks that are waiting on a user `ask_user` response. ProcessIndexEntry and ProcessSummary gain an optional `pendingAskUserCount`, surfaced via `getProcessSummaries` (both SQLite and file-process-store implementations) and `toProcessSummary` so dashboards can render an amber "Needs input" affordance instead of the default "Thinking" indicator. The `/api/queue` endpoint also enriches running tasks with `pendingAskUserCount` for first-paint correctness.
