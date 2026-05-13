---
"@plusplusoneplusplus/coc": patch
---

Gate the Loop subsystem (recurring follow-ups, `scheduleWakeup` / `createLoop` / `cancelLoop` / `listLoops` LLM tools, `/loop` skill auto-install, loop REST routes, dashboard `LoopBadge`/`LoopManagementPanel`, and `/loop` slash-command) behind a new `loops.enabled` config flag (default off). The flag can be toggled at runtime from the Admin Panel Features card; toggling requires a server restart to (un)wire the loop infrastructure.
