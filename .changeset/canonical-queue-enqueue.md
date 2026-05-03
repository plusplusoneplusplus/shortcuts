---
"@plusplusoneplusplus/coc": major
"@plusplusoneplusplus/coc-client": minor
"@plusplusoneplusplus/forge": patch
---

Collapse queue task creation onto `POST /api/queue` and remove the `/api/queue/tasks`, `/api/queue/enqueue`, and `QueueClient.enqueueTask()` compatibility surfaces.
