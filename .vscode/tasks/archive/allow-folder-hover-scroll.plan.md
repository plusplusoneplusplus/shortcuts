# Plan: Allow Scrolling for Folder Hover Tooltip

## Problem

When hovering over a folder path link in the CoC SPA, a tooltip displays the folder contents (e.g., "16 folders, 14 files"). For folders with many entries (up to 30 shown, or more), the tooltip body is clipped and the user cannot scroll to see all entries. Additionally, attempting to scroll inside the tooltip may cause it to dismiss prematurely or scroll the underlying page instead.

## Root Cause Analysis

**Files involved:**
- `packages/coc/src/server/spa/client/react/file-path-preview.ts` — tooltip DOM creation and event handling
- `packages/coc/src/server/spa/client/tailwind.css` — tooltip CSS

**Current state:**
- `.file-preview-tooltip` has `overflow: hidden`, `max-height: min(75vh, 560px)`, and `display: flex; flex-direction: column`
- `.file-preview-tooltip-body` has `flex: 1` and `overflow: auto` — scrolling is CSS-ready
- The tooltip is hidden via `mouseleave` → `scheduleHide()` on the tooltip element
- `document.body` `mouseout` on a `.file-path-link` also calls `scheduleHide()`

**Two issues preventing usable scrolling:**
1. **Scroll wheel propagation**: `wheel` events on the tooltip bubble up to the page, causing the underlying page to scroll rather than the tooltip body. This makes the tooltip appear non-scrollable.
2. **Tooltip dismissal during scroll**: Mouse micro-movements during a scroll gesture can trigger `mouseleave` on the tooltip, causing it to hide before the user finishes scrolling.

## Proposed Solution

### Change 1 — Stop wheel event propagation on the tooltip (`file-path-preview.ts`)

In `createTooltip()`, after setting up `mouseenter`/`mouseleave` listeners, add a `wheel` listener that calls `event.stopPropagation()` (and optionally `event.preventDefault()` when the body is at its scroll limits) to keep scroll events inside the tooltip:

```ts
el.addEventListener('wheel', (event) => {
    const body = el.querySelector('.file-preview-tooltip-body');
    if (!body) return;
    // Allow default scroll within the body; just prevent page scroll
    event.stopPropagation();
}, { passive: true });
```

### Change 2 — Keep tooltip visible while scrolling (`file-path-preview.ts`)

Introduce an `isScrolling` flag (set on `scroll` inside the body, cleared on `mouseleave` when not scrolling) to prevent `scheduleHide()` from firing mid-scroll:

```ts
let isScrollingTooltip = false;
let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;

// In createTooltip(), after creating the element:
el.addEventListener('scroll', () => {
    isScrollingTooltip = true;
    if (scrollEndTimer) clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(() => { isScrollingTooltip = false; }, 150);
}, true); // capture phase to catch scroll on the body child

el.addEventListener('mouseleave', () => {
    if (!isScrollingTooltip) scheduleHide();
});
```

### Change 3 — Ensure the tooltip body itself is the scroll target (CSS, `tailwind.css`)

The body already has `overflow: auto`. Confirm it has a defined scrollable area via its flex layout. Add `min-height: 0` to `.file-preview-tooltip-body` to ensure flex correctly constrains it (a common flex scrolling bug):

```css
.file-preview-tooltip-body {
    flex: 1;
    overflow: auto;
    min-height: 0; /* ADD THIS */
}
```

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/file-path-preview.ts` | Add `wheel` stop-propagation listener + `isScrollingTooltip` guard in `createTooltip()` |
| `packages/coc/src/server/spa/client/tailwind.css` | Add `min-height: 0` to `.file-preview-tooltip-body` |

## Tests to Update/Add

- `packages/coc/test/spa/react/FilePathPreview.test.ts` — add test that wheel events on tooltip element call `stopPropagation()` and tooltip remains visible during scroll
- Verify existing directory preview tests still pass

## Out of Scope

- Changing the max 30-entry server-side limit in `tasks-handler.ts`
- Virtualizing the directory listing for very large folders
