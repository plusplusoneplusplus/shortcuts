# Drag to Reorder Queue Items

## Problem

The queue panel in the CoC SPA dashboard currently supports reordering queued tasks only via ▲ (move-up) and ⏬ (move-to-top) buttons. Users want to drag-and-drop tasks to arbitrary positions in the queue for faster, more intuitive reordering.

## Approach

Add HTML5 drag-and-drop to the **React queue panel** (`RepoQueueTab.tsx`). The queue is rendered by `RepoQueueTab` → `QueueTaskItem` in `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`. This requires:

1. A new `moveToPosition(id, targetIndex)` method on `TaskQueueManager` and a corresponding REST endpoint
2. A new `useQueueDragDrop` React hook (modeled after the existing `useTaskDragDrop.ts` pattern)
3. Drag-and-drop event wiring on each `QueueTaskItem` in the queued tasks list
4. Visual feedback (opacity on dragged item, drop indicator line between items)

State flows through React context: WebSocket `queue-updated` events → `QueueContext` reducer → re-render. No polling suppression needed since React reconciliation handles state updates cleanly.

## Key Files

| File | Change |
|------|--------|
| `packages/pipeline-core/src/queue/task-queue-manager.ts` | Add `moveToPosition(id, index)` method |
| `packages/pipeline-core/test/queue/task-queue-manager.test.ts` | Tests for `moveToPosition` |
| `packages/coc/src/server/queue-handler.ts` | Add `POST /api/queue/:id/move-to/:position` route |
| `packages/coc/test/server/queue-handler.test.ts` | Tests for new endpoint |
| `packages/coc/src/server/spa/client/react/hooks/useQueueDragDrop.ts` | New hook: drag-and-drop state & event handlers for queue reordering |
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Wire drag handlers on `QueueTaskItem`, add drop indicator styles |

## Todos

### 1. Add `moveToPosition()` to TaskQueueManager

In `task-queue-manager.ts`, add a method that splices a task from its current index and re-inserts it at a target index:

```typescript
moveToPosition(id: string, targetIndex: number): boolean {
    const currentIndex = this.queue.findIndex(t => t.id === id);
    if (currentIndex === -1) return false;
    const clamped = Math.max(0, Math.min(targetIndex, this.queue.length - 1));
    if (currentIndex === clamped) return true;
    const [task] = this.queue.splice(currentIndex, 1);
    this.queue.splice(clamped, 0, task);
    this.emitChange('reordered', task);
    return true;
}
```

`getPosition(id)` already exists (returns 1-based index).

### 2. Add `POST /api/queue/:id/move-to/:position` endpoint

In `queue-handler.ts`, add a new route alongside existing `move-up`/`move-down`/`move-to-top`:

```typescript
{
    method: 'POST',
    pattern: /^\/api\/queue\/([^/]+)\/move-to\/(\d+)$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const position = parseInt(match![2], 10);
        const moved = findTaskManager(bridge, id)?.moveToPosition(id, position) ?? false;
        if (!moved) return sendError(res, 404, 'Task not found in queue');
        const finalPos = findTaskManager(bridge, id)?.getPosition(id);
        sendJSON(res, 200, { moved: true, position: finalPos });
    },
}
```

### 3. Create `useQueueDragDrop` hook

New file: `packages/coc/src/server/spa/client/react/hooks/useQueueDragDrop.ts`

Follows the same factory-handler pattern as `useTaskDragDrop.ts` (enter-count ref for flicker prevention, custom MIME type):

```typescript
const QUEUE_DRAG_MIME = 'application/x-queue-drag';

interface UseQueueDragDrop {
    draggedTaskId: string | null;
    dropTargetIndex: number | null;    // index where the indicator line shows
    dropPosition: 'above' | 'below' | null;
    createDragStartHandler: (taskId: string, index: number) => (e: React.DragEvent) => void;
    createDragEndHandler: () => (e: React.DragEvent) => void;
    createDragOverHandler: (index: number) => (e: React.DragEvent) => void;
    createDragEnterHandler: (index: number) => (e: React.DragEvent) => void;
    createDragLeaveHandler: (index: number) => (e: React.DragEvent) => void;
    createDropHandler: (index: number, onReorder: (taskId: string, newIndex: number) => void) => (e: React.DragEvent) => void;
}
```

Key behaviors:
- `dragstart`: set `dataTransfer` with task ID via custom MIME, `effectAllowed = 'move'`, store `draggedTaskId`
- `dragover`: `preventDefault()`, compute above/below midpoint → set `dropPosition`
- `dragenter`/`dragleave`: enter-count ref pattern (from `useTaskDragDrop`) to prevent child-element flicker
- `drop`: read task ID from `dataTransfer`, compute target index from `dropTargetIndex` + `dropPosition`, call `onReorder` callback
- `dragend`: clear all state

### 4. Wire drag-and-drop in RepoQueueTab

In `RepoQueueTab.tsx`:

**4a.** Import and use `useQueueDragDrop` hook.

**4b.** Add `handleMoveToPosition` handler:
```typescript
const handleMoveToPosition = async (taskId: string, newIndex: number) => {
    await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/move-to/' + newIndex, { method: 'POST' });
    fetchQueue();
};
```

**4c.** In the `filteredQueued.map(...)` block, attach drag handlers to each `QueueTaskItem`:
```tsx
{filteredQueued.map((task, index) => (
    <div
        key={task.id}
        draggable
        onDragStart={createDragStartHandler(task.id, index)}
        onDragEnd={createDragEndHandler()}
        onDragOver={createDragOverHandler(index)}
        onDragEnter={createDragEnterHandler(index)}
        onDragLeave={createDragLeaveHandler(index)}
        onDrop={createDropHandler(index, handleMoveToPosition)}
        className={clsx(
            draggedTaskId === task.id && 'opacity-40',
            dropTargetIndex === index && dropPosition === 'above' && 'border-t-2 border-[#007fd4]',
            dropTargetIndex === index && dropPosition === 'below' && 'border-b-2 border-[#007fd4]',
        )}
    >
        <QueueTaskItem ... />
    </div>
))}
```

**4d.** Add grab cursor via Tailwind: `cursor-grab active:cursor-grabbing` on draggable items.

### 5. Add tests

- **Unit test** `moveToPosition()` in `task-queue-manager.test.ts`:
  - Move to same position → noop, returns true
  - Move forward (index 0 → 2)
  - Move backward (index 3 → 1)
  - Move to 0 → equivalent to move-to-top (but without priority change)
  - Move to end → last position
  - Invalid ID → returns false
  - Out-of-bounds index → clamped to valid range
- **API test** `POST /api/queue/:id/move-to/:position` in `queue-handler.test.ts`:
  - 200 with `{ moved: true, position }` on success
  - 404 for unknown task
  - Position 0 moves to first slot

## Design Decisions

- **Only queued tasks are draggable** — running tasks and completed tasks are not reorderable
- **No priority mutation on drag** — unlike `moveToTop()` which forces `priority: 'high'`, `moveToPosition()` preserves the task's current priority
- **React hook pattern** — follows the existing `useTaskDragDrop.ts` factory-handler architecture with enter-count flicker prevention
- **Existing buttons remain** — ▲/⏬/✕ buttons stay as keyboard-accessible alternatives and mobile fallback
- **Optimistic feel via WebSocket** — after the `fetch`, the server emits `queue-updated` via WebSocket which triggers a React re-render through `QueueContext`, so the UI updates promptly without manual state manipulation

## Edge Cases

- Drag a task when only 1 item in queue → noop, no visual change
- Drop on a running task → ignored (running section items are not wired as drop targets)
- Queue changes server-side during drag (e.g., task starts running) → `moveToPosition` uses current server-side array; WebSocket update reconciles UI after drop
- Drop on self (same index) → noop
- Filtered view (type filter active) → drag operates on `filteredQueued` indices; `moveToPosition` uses 0-based server index. Need to map filtered index to absolute queue index before sending to API
- Touch devices → HTML5 drag-and-drop has limited mobile support; the existing ▲/⏬ buttons remain as fallback
