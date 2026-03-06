# Plan: Q Tab — Keep Timestamp on the Same Line as Task Title

## Problem

In the **Q tab** of the CoC dashboard, task cards in the **Completed Tasks** section
sometimes render the timestamp (`12m ago`) on a second line, split from the task title.
This happens when the title reaches its 35-character hard-truncation limit and there is
not enough horizontal space left for the timestamp.

By contrast, the **Running / Queued** section uses the `QueueTaskItem` component which
already has correct CSS (`shrink-0 whitespace-nowrap` on the timestamp, `min-w-0` +
`truncate` on the title container) that keeps everything on one line consistently.

The two rendering paths are in the same file:

| Section | Path | Status |
|---|---|---|
| Running / Queued | `QueueTaskItem` component (~line 512) | ✅ Correct |
| Completed Tasks | Inline JSX inside `completedTasks.map` (~line 423) | ❌ Wraps |

## Root Cause

Completed-tasks inline JSX (line 423–431 of `RepoQueueTab.tsx`):

```tsx
<div className="flex items-center justify-between text-xs">
    <span>
        {icon}{' '}{name.substring(0, 35)}
    </span>
    <span className="text-[10px] text-[#848484]">
        {timestamp}
    </span>
</div>
```

Three CSS deficiencies vs. `QueueTaskItem`:
1. Title `<span>` has no `min-w-0` — flex item cannot shrink below its content width.
2. Title `<span>` has no `truncate` (CSS ellipsis) — relies solely on JS `substring`.
3. Timestamp `<span>` has no `shrink-0 whitespace-nowrap` — can wrap when space is tight.

## Proposed Fix

**File:** `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

Replace the completed-tasks header row (lines 423–431) with the same flex pattern used by `QueueTaskItem`:

```tsx
<div className="flex items-center justify-between gap-1.5 text-xs">
    <span className="flex items-center gap-1 min-w-0 truncate">
        <span className="shrink-0">
            {task.type === 'chat' ? '💬' : task.status === 'completed' ? '✅' : task.status === 'failed' ? '❌' : '🚫'}
        </span>
        <span className="truncate">
            {task.displayName || task.type || 'Task'}
        </span>
    </span>
    <span className="text-[10px] text-[#848484] shrink-0 whitespace-nowrap tabular-nums">
        {task.completedAt ? formatRelativeTime(new Date(task.completedAt).toISOString()) : ''}
    </span>
</div>
```

Key changes:
- Wrap the title area in a `min-w-0 truncate` container so it shrinks properly.
- Separate icon into its own `shrink-0` span so it never gets clipped.
- Remove JS `substring(0, 35)` and rely on CSS `truncate` (ellipsis) instead — cleaner and dynamic.
- Add `shrink-0 whitespace-nowrap tabular-nums` to the timestamp span.
- Add `gap-1.5` to the outer row and `gap-1` between icon and name (matching `QueueTaskItem`).

## Scope

- **One file, one JSX block** — no logic changes, no API changes, no style-sheet changes.
- No changes to `QueueTaskItem` (already correct).
- No changes to `formatRelativeTime` or `getTaskPromptPreview`.

## Tasks

1. Edit the completed-tasks header row in `RepoQueueTab.tsx` as described above.
2. Build the SPA (`npm run build` in `packages/coc`) and visually verify in the browser that:
   - Short titles: timestamp stays right-aligned on the same line.
   - Long titles (≥35 chars): title truncates with `…` and timestamp stays on the same line.
   - The prompt-preview line below still renders correctly.
