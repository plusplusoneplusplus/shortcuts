# Plan: Fix File Link Hover Preview Blocking Click in CoC Chat

## Problem

In the CoC chat conversation panel, hovering over a `.file-path-link` span triggers a large file preview tooltip (showing ~20 lines). Under certain viewport/scroll conditions the tooltip, once rendered, **covers the file link itself**, making it impossible to click the link to open the file.

### Root cause (traced in `file-path-preview.ts`)

`positionTooltip()` places the tooltip at `rect.bottom + 6px` (below the link). When the fully-rendered tooltip is too tall to fit below, it flips above: `top = rect.top - tipHeight - TOOLTIP_GAP_PX`. If that `top` value is negative it gets clamped to `TOOLTIP_EDGE_MARGIN_PX = 8px`. In that clamped state the tooltip's rendered height (up to 560 px) can reach **past** the link's y-position, visually and interactively covering the link. Clicks land on the `z-index: 10000` tooltip instead of the underlying link.

A secondary concern: the tooltip's horizontal extent (up to 960 px, starting at `rect.left`) can also overlap the link in narrow/scrolled layouts.

---

## Approach

Apply a layered fix in `packages/coc/src/server/spa/client/react/file-path-preview.ts` and its CSS in `packages/coc/src/server/spa/client/tailwind.css`:

### Fix 1 — Enforce a non-overlapping vertical safe zone (core positioning fix)

**File:** `file-path-preview.ts` → `positionTooltip()`

After computing `top` (whether below or above), clamp `max-height` so the tooltip can never extend into the link's bounding rect:

- **Below placement:** `maxHeight = Math.min(availableBelow, TOOLTIP_DEFAULT_MAX_HEIGHT_PX)`  
  *(already done, but confirm `availableBelow = window.innerHeight - TOOLTIP_VIEWPORT_PADDING_PX - top`)*
- **Above placement (flip):** compute `maxHeight = rect.top - TOOLTIP_GAP_PX - top` so the tooltip's **bottom edge** is always ≤ `rect.top - TOOLTIP_GAP_PX`.  
  If `maxHeight < MIN_USEFUL_HEIGHT_PX (80)`, fall back to below with scroll, never clamping into the link.

This guarantees the tooltip bounding box never intersects the link rect in either placement direction.

### Fix 2 — Brief pointer-events deferral on first appearance

**File:** `file-path-preview.ts` → `showTooltip()` / `renderLoading()`

When the tooltip first becomes visible, set `pointer-events: none` for `~150 ms`, then restore. This creates a grace window where the user can still click the link even if the tooltip renders briefly over it, without meaningfully degrading the scroll/interact UX.

```ts
tip.style.pointerEvents = 'none';
setTimeout(() => { if (tooltipEl) tooltipEl.style.pointerEvents = ''; }, 150);
```

### Fix 3 — Click-through fallback on tooltip click

**File:** `file-path-preview.ts` → `initFilePathPreviewDelegation()` click handler

In the existing tooltip `click` listener (line ~457), add: if the click target is inside `.file-preview-tooltip` and is not an interactive element (button, link), use `document.elementFromPoint` after briefly hiding the tooltip to find the underlying `.file-path-link` and dispatch the open action on it.

This is a safety net for cases where Fixes 1 & 2 are insufficient.

---

## Files to change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/file-path-preview.ts` | Fix `positionTooltip` max-height logic (Fix 1); add pointer-events grace period (Fix 2); add click-through fallback (Fix 3) |
| `packages/coc/src/server/spa/client/tailwind.css` | Ensure `.file-preview-tooltip` has no `pointer-events: auto` override that would conflict with Fix 2 |

---

## Test plan

- Existing E2E tests in `packages/coc/test/e2e/queue-file-path-hover.spec.ts` must still pass.
- Manual verification: hover a file link near the bottom of the viewport → tooltip flips above → link remains clickable.
- Manual verification: hover a file link in a narrow left-side panel → tooltip appears → link still clickable.
- Manual verification: tooltip scroll still works (pointer-events restored after grace period).
