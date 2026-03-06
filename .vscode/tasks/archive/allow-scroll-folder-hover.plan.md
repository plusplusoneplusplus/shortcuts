# Plan: Allow Scroll in Folder Hover Display

## Problem

When hovering over a folder path link in the CoC dashboard (e.g., the working directory field in a task detail panel), a popup appears showing the directory listing. For large directories (many subfolders/files), the popup content overflows the visible area without scrolling, making it impossible to view all entries.

## Affected Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/file-path-preview.ts` | Hover tooltip logic: `renderDirectoryPreview`, `createTooltip`, `positionTooltip`, scroll-tracking guards |
| `packages/coc/src/server/spa/client/tailwind.css` | CSS for `.file-preview-tooltip`, `.file-preview-tooltip-body`, `.file-preview-dir-listing` |

## Current Behavior

The outer tooltip element (`.file-preview-tooltip`) has:
```css
overflow: hidden;
max-height: min(75vh, 560px);
display: flex;
flex-direction: column;
```

The inner body (`.file-preview-tooltip-body`) has:
```css
flex: 1;
overflow: auto;
min-height: 0;
```

In principle this should scroll, but in practice the scroll event listener is attached to the **outer** tooltip element (capture phase), and the scroll-dismiss guard (`isScrollingTooltip`) may not fire reliably when scrolling the inner body. Additionally, `positionTooltip` estimates height from the loading-state height (small), so after content loads the popup may extend beyond the viewport without re-clamping its own max-height to available space.

## Root Causes

1. **`positionTooltip` does not clamp `max-height`** — it only adjusts `top`/`left`. After content loads and the popup grows, no dynamic `max-height` is applied to keep it within the viewport.
2. **Scroll-dismiss guard may interfere** — the `scroll` listener (capture phase) on the outer element tracks `isScrollingTooltip`. If the body scroll event doesn't propagate to the outer element in capture phase consistently across browsers, the guard won't fire and mouse-leave during scroll will dismiss the tooltip.
3. **`.file-preview-dir-listing` has no explicit height constraint** — it relies entirely on the parent's flex/overflow chain which can break under edge cases.

## Proposed Solution

### 1. Clamp `max-height` dynamically in `positionTooltip`

After computing `top`, calculate the remaining vertical space and set `tip.style.maxHeight` explicitly:

```typescript
const availableBelow = window.innerHeight - top - TOOLTIP_VIEWPORT_PADDING_PX;
const availableAbove = rect.top - TOOLTIP_GAP_PX - TOOLTIP_EDGE_MARGIN_PX;
const space = top === rect.bottom + TOOLTIP_GAP_PX ? availableBelow : availableAbove;
tip.style.maxHeight = `${Math.min(space, TOOLTIP_DEFAULT_MAX_HEIGHT_PX)}px`;
```

### 2. Attach scroll listener to `file-preview-tooltip-body` specifically

Move the scroll-tracking guard from the outer tooltip to the body element, or keep capture but ensure it's attached before the body is populated. Alternatively, use `addEventListener('scroll', ..., { capture: true })` on the body element reference when it is appended.

### 3. Ensure `.file-preview-dir-listing` does not break the flex scroll chain

No CSS change needed for directory listing specifically — the existing `.file-preview-tooltip-body { flex: 1; overflow: auto; min-height: 0 }` is correct. Remove any potential issue by verifying no inline styles override it.

### 4. (Optional) Add a minimum height for the directory listing popup

Give the popup a minimum useful height so small directories still render cleanly:
```css
.file-preview-tooltip {
  min-height: 80px;
}
```

## Tasks

1. **Investigate scroll behavior** — Add a quick test: hover over a large directory, open DevTools, verify whether `.file-preview-tooltip-body` has a scrollbar and whether `isScrollingTooltip` is set on wheel events.
2. **Fix `positionTooltip`** — Compute and apply a dynamic `max-height` based on available viewport space above/below the trigger, capped at `TOOLTIP_DEFAULT_MAX_HEIGHT_PX`.
3. **Fix scroll-dismiss guard** — Verify the scroll event listener fires during body scroll; if not, attach it directly to the body element after the tooltip is populated.
4. **Regression test** — Confirm:
   - File hover (non-directory) still scrolls line content normally.
   - Tooltip hides on mouse leave after scroll ends.
   - Tooltip stays visible while the user is scrolling.
   - Works for directories with few entries (no unnecessary scrollbar).

## Non-Goals

- Changing the hover trigger target or the API endpoint that returns directory listings.
- Adding keyboard navigation inside the popup.
- Changing the CoC React `FilePreview.tsx` component (used in the React tree, not the global delegation path).
