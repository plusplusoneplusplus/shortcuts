# Plan: Disable File Path Hover Preview on Mobile

## Problem

On mobile devices, hovering over file path links to display a content preview (first ~20 lines) causes UI issues. Touch devices don't have a natural "hover" state — a touch triggers both `mouseover` and `click` simultaneously, which can open unexpected tooltips, block interaction, and break the layout. The feature should be disabled entirely on mobile.

## Affected Files

Three separate implementations each need mobile detection and disabling:

### 1. React SPA — Event Delegation
`packages/coc/src/server/spa/client/react/file-path-preview.ts`
- Attaches `mouseover`/`mouseout` listeners on `document.body` for `.file-path-link` spans.
- The tooltip is shown after a short delay on hover.

### 2. React Component — `FilePreview.tsx`
`packages/coc/src/server/spa/client/react/shared/FilePreview.tsx`
- Hooks-based component that attaches `mouseenter`/`mouseleave` handlers to trigger tooltip display.

### 3. Markdown Comments Webview — `file-path-preview.ts`
`src/shortcuts/markdown-comments/webview-scripts/file-path-preview.ts`
- Standalone webview script; attaches `mouseover`/`mouseout` listeners on `.file-path-link` spans.
- Shows first ~50 lines in tooltip, up to 500 lines in click-modal.

## Approach

Use a **shared mobile detection utility** that checks:
```ts
const isMobile = () =>
  window.matchMedia('(pointer: coarse)').matches ||
  /Mobi|Android|iPhone|iPad|Touch/i.test(navigator.userAgent);
```

`pointer: coarse` is the most reliable CSS media query signal for touch-primary devices. The UA-string check is a fallback for edge cases.

### Changes Per File

#### `packages/coc/src/server/spa/client/react/file-path-preview.ts`
- Add `isMobile()` guard at the top of the event delegation setup (the `init` / listener-attachment block).
- If mobile, skip registering `mouseover`/`mouseout` listeners entirely. Click-to-open behaviour (if any) is preserved.

#### `packages/coc/src/server/spa/client/react/shared/FilePreview.tsx`
- Add `isMobile()` guard inside `onMouseEnter` handler.
- If mobile, return early without scheduling or showing the tooltip.
- `onClick` behaviour (file open / modal) is not affected.

#### `src/shortcuts/markdown-comments/webview-scripts/file-path-preview.ts`
- Add `isMobile()` guard in the `mouseover` handler (or at listener registration).
- If mobile, skip the hover tooltip path. The click handler (opens modal/editor) remains untouched.

## Out of Scope

- Changing click / tap behavior — tapping a file path link to open or expand it is unaffected.
- CSS-only `@media (hover: none)` — not sufficient alone because the JS listeners still fire and can interfere.
- Any server-side changes — purely client-side fix.

## Notes

- The `isMobile()` helper can be inlined in each file (they live in separate bundles) or extracted to a shared util if one already exists nearby.
- No new dependencies are required.
- Tests should verify that hover handlers are not invoked when `window.matchMedia` reports `pointer: coarse`.
