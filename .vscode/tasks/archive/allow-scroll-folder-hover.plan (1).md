# Plan: Allow Scrolling in Folder Hover Tooltip (Pending/Queued Task State)

## Problem

When hovering over the **Working Directory** folder path in a pending/queued task's detail panel,
a directory-listing tooltip appears. However, the user cannot scroll through the listing — the
tooltip dismisses before a scroll action can complete.

**Root cause:** Clicking or dragging the scrollbar fires a `mouseleave` event on the
`.file-preview-tooltip` element **before** the `scroll` event fires. The `mouseleave` handler
calls `scheduleHide()` while `isScrollingTooltip` is still `false`. The 200 ms hide timer then
dismisses the tooltip before the user can actually scroll.

Relevant file: `packages/coc/src/server/spa/client/react/file-path-preview.ts`

The tooltip infrastructure already has:
- `.file-preview-tooltip-body` with `overflow: auto` (CSS)
- A `scroll` listener on the tooltip (capture phase) that sets `isScrollingTooltip = true`
- A `mouseleave` guard that checks `isScrollingTooltip` before scheduling hide

But the **timing gap** between `mouseleave` (fires first) and `scroll` (fires after pointer
interaction begins) breaks the guard.

---

## Proposed Fix

### 1. Track `mousedown` on the tooltip element

Add a `mousedown` listener to set `isScrollingTooltip = true` immediately when the user presses a
mouse button anywhere inside the tooltip (including on the scrollbar).

```typescript
el.addEventListener('mousedown', () => {
    isScrollingTooltip = true;
    if (scrollEndTimer) clearTimeout(scrollEndTimer);
});
```

### 2. Clear the flag on `mouseup` (document-level)

Add a `mouseup` listener on `document` (registered once alongside the delegation listeners) to
clear `isScrollingTooltip` and, if the mouse has already left the tooltip, schedule a hide.

```typescript
document.addEventListener('mouseup', () => {
    if (!isScrollingTooltip) return;
    if (scrollEndTimer) clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(() => {
        isScrollingTooltip = false;
        if (tooltipEl && !tooltipEl.matches(':hover')) {
            scheduleHide();
        }
    }, 150);
});
```

This mirrors the existing `scroll`-event pattern already in the code.

### 3. (Optional / belt-and-suspenders) Guard `mouseleave` with `event.buttons`

As an extra safety net, check that no mouse button is held when `mouseleave` fires:

```typescript
el.addEventListener('mouseleave', (event: MouseEvent) => {
    if (!isScrollingTooltip && event.buttons === 0) scheduleHide();
});
```

This prevents the hide timer from starting while a button is still physically pressed (e.g., during
a click-drag on the scrollbar track).

---

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/file-path-preview.ts` | Add `mousedown` listener in `createTooltip`; update `mouseleave` guard with `event.buttons`; register `document mouseup` in `initFilePathPreviewDelegation` |

No CSS changes are needed — `overflow: auto` is already in place on `.file-preview-tooltip-body`.

---

## Acceptance Criteria

- Opening the working-directory hover on a pending/queued task shows a scrollable list.
- Moving the mouse onto the scrollbar does **not** dismiss the tooltip.
- Click-dragging the scrollbar track scrolls content without dismissing the tooltip.
- Moving the mouse fully outside the tooltip still dismisses it (normal hide behaviour preserved).
- No regressions for file-preview tooltips (code/markdown files).
