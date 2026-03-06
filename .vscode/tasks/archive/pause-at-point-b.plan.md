# Plan: Pause Queue at a Specific Task (Point B)

## Problem

Currently, the CoC queue supports a single pause mode (**Point A**): pressing the global pause button stops the queue from picking up any new tasks. This is all-or-nothing — either the whole queue runs, or nothing does.

The user wants **Point B** pausing: the ability to designate a specific task in the queue as a "pause boundary". Once that task finishes executing, the queue automatically pauses and will not pick up the task immediately after it — even if more queued tasks exist.

**Visual reference from screenshot:**
- Point A = the pause icon at top of the Queue section (existing)
- Point B = a specific item in the QUEUED TASKS list (e.g., "Follow: impl on fix-image-not-clear")

---

## Proposed Approach

### Concept: "Pause Marker" Queue Item

Introduce a **pause marker** as a first-class item in the queue — a positional separator, not a flag on any task. The marker sits at a specific index in the queue. When the executor dequeues it, the queue pauses (equivalent to clicking ⏸ manually) and the marker is consumed/removed.

**Key distinction from the per-task flag approach:**
- Reordering tasks does not move the pause point — the marker keeps its position.
- Adding/removing tasks before the marker shifts the tasks, not the marker.
- The marker is added to the queue by the user independently of any task.

This reuses all existing pause infrastructure — only the trigger point changes (reaching the marker position instead of user clicking pause).

---

## Data Model Changes

### `packages/pipeline-core/src/queue/task-queue-manager.ts`

Extend the queue item type to support a discriminated union:

```ts
type QueueItem =
  | { kind: 'task'; /* existing QueuedTask fields */ }
  | { kind: 'pause-marker'; id: string; createdAt: number };
```

The executor dequeues items one by one. When `item.kind === 'pause-marker'`, it calls `pauseRepo()` and does not advance further.

### `packages/coc/src/server/queue-persistence.ts`
- `kind` field persists naturally alongside other item fields. Verify schema handles the new shape; bump version if needed.

---

## Backend Changes

### 1. New API endpoint — Insert/Remove pause marker
**File:** `packages/coc/src/server/queue-handler.ts`

```
POST   /api/queue/pause-marker          { afterIndex: number }   → inserts marker at position
DELETE /api/queue/pause-marker/:markerId                         → removes marker by id
```

`afterIndex` is the 0-based index in the current pending queue after which the marker is inserted (e.g., `afterIndex: 2` inserts after the 3rd pending item).

### 2. Queue executor — Consume marker and pause
**File:** `packages/pipeline-core/src/queue/queue-executor.ts`

In the dequeue loop, before running any item:

```ts
const item = this.queueManager.peek(repoId);
if (item?.kind === 'pause-marker') {
    this.queueManager.dequeue(repoId);   // consume the marker
    this.queueManager.pauseRepo(repoId);
    return;
}
```

### 3. Expose markers in queue listing
**File:** `packages/coc/src/server/queue-handler.ts` (GET `/api/queue`)

Include pause-marker items in the ordered queue list so the UI can render them inline between tasks.

---

## Frontend Changes

### `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

1. **Render pause marker as a separator row** — when iterating queue items and `item.kind === 'pause-marker'`, render a distinct divider row with a ⏸ icon and label "Queue pauses here".

2. **"Insert pause" hover zone** — a thin, normally-invisible line in the gap between any two queued task cards (and after the last card). The line is only `2px` tall in resting state and carries no label or icon, so the queue list stays compact. Behaviour:
   - **Hover:** the gap expands to ~`28px`, a faint dashed divider line appears with a centered ⏸ icon and the label "Insert pause here". A subtle CSS transition (150 ms ease) drives the expand/collapse so it feels intentional rather than jumpy.
   - **Click:** POSTs `{ afterIndex: N }` to insert the marker; the hover zone collapses back to rest; a marker row appears in its place.
   - **Cursor:** `pointer` only when the zone is hovered.
   - The hover zone is not keyboard-focusable by default (it would bloat tab-order); if accessibility is later needed, add `role="button"` with an `aria-label="Insert pause after task N"` and make it focusable.

3. **Remove marker** — an ✕ on the marker row DELETEs the marker by id.

4. **Drag-and-drop reordering** — if tasks are reorderable, pause markers participate in reordering as independent items (they move to wherever the user drags them, independent of tasks).

5. **Tooltip text:** "Queue will pause when it reaches this point"

---

## Behavior Details

| Scenario | Behavior |
|----------|----------|
| Executor reaches a pause marker | Marker is consumed; queue pauses (same state as clicking ⏸ manually) |
| Tasks before the marker are reordered | Marker stays at its queue position; different tasks may now precede it |
| Tasks are added before the marker | Marker shifts down in index; still executes after all items above it |
| User resumes queue after auto-pause | Clears the repo's paused state; next item in queue is the first task after the marker |
| User removes the marker before it is reached | No auto-pause; queue continues normally |
| Multiple markers in the queue | Queue pauses at each one in order; user resumes between them |
| Queue is cleared | All markers are discarded with it |

---

## Files to Change

| File | Change |
|------|--------|
| `packages/pipeline-core/src/queue/task-queue-manager.ts` | Add `pause-marker` variant to queue item type; handle in dequeue/peek logic |
| `packages/pipeline-core/src/queue/queue-executor.ts` | Detect `pause-marker` item before running next task; consume and call `pauseRepo()` |
| `packages/coc/src/server/queue-handler.ts` | `POST /api/queue/pause-marker` and `DELETE /api/queue/pause-marker/:id`; include markers in GET response |
| `packages/coc/src/server/queue-persistence.ts` | Verify `kind` field persists; bump schema version if needed |
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Separator row for markers; insert/remove controls between task cards |

---

## Out of Scope

- Scheduling-based pauses (pause at a time of day)
- Pausing mid-task (the existing behavior is task-boundary granularity)
- Persisting marker position across queue clears/resets
- Per-task `pauseAfter` flag (rejected: reordering tasks would silently move the pause point)
