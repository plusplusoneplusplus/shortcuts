# Plan: Fix Follow-up Messages Not Appearing in Queue Tab / Not Going Through Scheduler

## Problem Statement

When a user sends a follow-up message in the CoC chat tab, it is **invisible to the queue tab** and **bypasses the scheduler entirely**. This means:

- Follow-ups don't appear in the queue UI.
- Follow-ups ignore queue pause/resume state.
- Follow-ups bypass rate limiting, concurrency limits, and any scheduler policies.
- There is no way to cancel or inspect a running follow-up from the queue tab.

### Root Cause

There are two completely separate code paths:

| | First message | Follow-up message |
|---|---|---|
| **Frontend call** | `POST /api/queue` | `POST /api/processes/:id/message` |
| **Server handler** | `queue-handler.ts → enqueueViaBridge()` | `api-handler.ts:1366 → bridge.executeFollowUp()` |
| **Goes through queue** | ✅ `TaskQueueManager.enqueue()` | ❌ Direct call, no queue |
| **Appears in queue tab** | ✅ Yes | ❌ No |
| **Respects scheduler** | ✅ Yes | ❌ No |

When a follow-up arrives at `POST /api/processes/:id/message`, the handler immediately calls `bridge.executeFollowUp(id, messageContent, attachments)` as fire-and-forget. No task is enqueued, no `queueChange` WebSocket event is fired, and the queue tab never learns about it.

---

## Proposed Fix

### Approach: Route Follow-ups Through the Queue as a New Task Type

Add a `chat-followup` task type. When a follow-up message arrives, instead of calling `bridge.executeFollowUp()` directly, enqueue a `chat-followup` task that carries the process ID, message content, and attachments. The scheduler picks it up and calls `executeFollowUp()` just as it does today — but now it goes through the queue.

This is the cleanest fix because it:
- Makes follow-ups visible in the queue tab automatically (same rendering path as `chat` tasks).
- Makes follow-ups respect queue pause/resume and scheduler policies.
- Requires no frontend changes (the follow-up response already streams via SSE on the process ID).
- Keeps the `executeFollowUp()` logic in `queue-executor-bridge.ts` unchanged.

---

## Implementation Tasks

### Task 1 — Add `chat-followup` task type to pipeline-core

**File:** `packages/pipeline-core/src/workflow/task-types.ts` (or wherever task type literals are defined)

- Add `'chat-followup'` to the task type union.
- Define its payload shape: `{ processId: string; content: string; attachments?: Attachment[] }`.

---

### Task 2 — Handle `chat-followup` in the queue executor bridge

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

- In the task dispatch method (wherever `chat` / `readonly-chat` types are handled), add a case for `chat-followup`.
- For `chat-followup`, call `this.executeFollowUp(payload.processId, payload.content, payload.attachments)`.
- This reuses all the existing follow-up streaming, timeline, status update, and suggestion logic without modification.

---

### Task 3 — Enqueue follow-ups instead of executing them directly

**File:** `packages/coc-server/src/api-handler.ts` (route `POST /api/processes/:id/message`, lines ~1445–1458)

- Replace the fire-and-forget `bridge.executeFollowUp(...)` call with a call to `enqueueViaBridge()` (or an equivalent injected enqueue function passed in when the handler is wired up in `coc/src/server/index.ts`).
- Pass a `chat-followup` `CreateTaskInput` with `{ type: 'chat-followup', payload: { processId: id, content: messageContent, attachments } }`.
- Return the task ID (or process ID) in the 202 response so the frontend can track it if needed.

**Note:** `api-handler.ts` lives in `coc-server` but the enqueue bridge lives in `coc`. The enqueue function should be injected as a dependency (already a common pattern in `createApiRoutes` / handler factory functions in this codebase) rather than importing from `coc` directly, to preserve the package boundary.

---

### Task 4 — Pass the enqueue function into the api-handler

**File:** `packages/coc/src/server/index.ts` (or wherever `createApiRoutes` / `createApiHandler` is called)

- Pass the `enqueueViaBridge` function (or a thin wrapper) into the api-handler factory so it can be used by the follow-up route.
- Verify the handler still receives `bridge` for session-liveness checks (`bridge.isSessionAlive`).

---

### Task 5 — Queue tab display: ensure `chat-followup` tasks show meaningful labels

**File:** `packages/coc/src/server/spa/client/react/queue/` (task label/type rendering components)

- If the queue tab renders the `type` field as a label (e.g. "chat", "readonly-chat"), add a display label for `"chat-followup"` → e.g. `"Follow-up"`.
- Optionally link the follow-up task in the queue view back to the parent chat process so the user can navigate to the conversation.

---

### Task 6 — Tests

**Files:**
- `packages/coc/src/server/__tests__/` or `packages/coc-server/src/__tests__/`

- Unit test: `chat-followup` task type is dispatched correctly to `executeFollowUp()` in the bridge.
- Unit test: `POST /api/processes/:id/message` now enqueues a task instead of calling the bridge directly.
- Integration test: Follow-up respects queue pause state (enqueue when paused → task is queued but not executed until resumed).

---

## Files to Change

| File | Change |
|------|--------|
| `packages/pipeline-core/src/workflow/task-types.ts` (or equivalent) | Add `'chat-followup'` type + payload |
| `packages/coc/src/server/queue-executor-bridge.ts` | Dispatch `chat-followup` tasks to `executeFollowUp()` |
| `packages/coc-server/src/api-handler.ts` | Replace direct `bridge.executeFollowUp()` with injected `enqueue()` call |
| `packages/coc/src/server/index.ts` | Inject `enqueueViaBridge` into api-handler |
| `packages/coc/src/server/spa/client/react/queue/` | Add display label for `chat-followup` type |
| Test files (coc / coc-server) | New unit + integration tests |

---

## Out of Scope

- Changing the SSE streaming mechanism (follow-up responses still stream on the original process ID — no change needed).
- Changing the `executeFollowUp()` implementation logic.
- Migrating in-flight sessions at deploy time.

---

## Risks / Considerations

- **Queue ordering**: Once routed through the queue, follow-ups will be subject to queue concurrency limits. If the queue is at capacity, a follow-up will wait. This is generally desirable but may feel slower than the current fire-and-forget. Consider giving `chat-followup` tasks priority or a dedicated concurrency slot if needed.
- **Session expiry race**: The session-liveness check (`bridge.isSessionAlive`) currently happens synchronously at request time. After enqueuing, there could be a delay before execution. The executor should re-check session liveness when it dequeues the task, and emit an appropriate error turn if the session has expired.
- **Package boundary**: `api-handler.ts` is in `coc-server`; the queue bridge is in `coc`. Use dependency injection (already the pattern here) — do not add a direct import from `coc` into `coc-server`.
