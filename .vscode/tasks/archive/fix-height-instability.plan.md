# Fix: Running Task Card Height Instability

## Problem

The running task card (`QueueTaskItem`) changes height as the elapsed timer updates every second.

**Root cause:** The elapsed time string (e.g. `"10m 30s"`) is rendered *inline* inside the same flex row as the task name. When the time string changes width (e.g. `"9m 5s"` → `"10m 0s"`), the available space for the name shifts, causing it to wrap or unwrap — changing the card height.

As seen in the screenshots:
- **Wrapped state:** `"Follow: impl on git-tab-commit-"` / `"deta"` with `"10m"` / `"30s"` stacked
- **Single-line state:** `"Follow: impl on git-tab-commit-deta  10m 47s"` on one line

## File to Change

`packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

## Proposed Fix

Separate the task **name** and **elapsed time** into two independent flex children so the elapsed time can never affect the text-wrap of the name.

### Current layout (lines 493–498)
```tsx
<div className="flex items-center justify-between">
    <div className="flex items-center gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
        <span>{icon}</span>
        <span>{name}</span>
        {elapsed && <span className="text-[10px] text-[#848484]">{elapsed}</span>}
    </div>
</div>
```

### Target layout
```tsx
<div className="flex items-center justify-between gap-1.5">
    <div className="flex items-center gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] min-w-0">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{name}</span>
    </div>
    {elapsed && (
        <span className="text-[10px] text-[#848484] shrink-0 whitespace-nowrap tabular-nums">
            {elapsed}
        </span>
    )}
</div>
```

Key changes:
- Move `elapsed` **outside** the name flex group, making it the second flex child of `justify-between`
- Add `min-w-0` + `truncate` on the name side so it shrinks gracefully without reflowing height
- Add `shrink-0 whitespace-nowrap tabular-nums` on the elapsed side so its width is stable and it never wraps
- `tabular-nums` ensures digit-width consistency so even number changes don't shift surrounding text

## Acceptance Criteria

- The running task card maintains a **fixed single-line height** as the timer ticks
- Elapsed time appears right-aligned and never causes the task name to reflow
- Long task names are truncated with `…` rather than wrapping to a second line
- No visual regression for queued tasks (elapsed shows relative time the same way)
