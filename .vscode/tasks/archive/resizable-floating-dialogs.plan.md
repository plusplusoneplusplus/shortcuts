# Resizable Floating Dialogs

## Problem

The `FloatingDialog` React component (`packages/coc/src/server/spa/client/react/shared/FloatingDialog.tsx`) was recently made draggable (commit `d606515a`), but it does not support resizing. Users should be able to resize floating dialogs (e.g., the Generate Task dialog) by dragging their edges or corners — matching the drag-to-move UX that already exists.

## Approach

Add **optional** resize support directly to the `FloatingDialog` component via a prop (e.g., `resizable?: boolean`). When enabled, the component renders invisible edge/corner grab handles and tracks `mousemove`/`mouseup` to update width/height, respecting min/max constraints and viewport bounds. The existing `Dialog` (full-screen overlay / mobile) is **not** affected.

## Affected Files

| File | Change |
|------|--------|
| `packages/coc/.../shared/FloatingDialog.tsx` | Add resize state, handles, mousemove logic, and `resizable` prop |
| `packages/coc/.../tasks/GenerateTaskDialog.tsx` | Pass `resizable` to `FloatingDialog` |
| `packages/coc/test/spa/shared/FloatingDialog.test.tsx` | Add resize interaction tests |

## Acceptance Criteria

- [ ] `FloatingDialog` accepts an optional `resizable` prop (default `false` or `true` — caller decides).
- [ ] When `resizable` is true, the panel renders 8-direction resize handles (n, s, e, w, ne, nw, se, sw) as thin transparent hit-areas along edges/corners.
- [ ] Dragging a handle resizes the panel width/height accordingly, updating the DOM in real-time.
- [ ] Resize respects min-width (480 px), min-height (200 px), and does not extend outside the viewport.
- [ ] North/west handles adjust `top`/`left` in tandem so the opposite edge stays anchored.
- [ ] Cursor changes to the appropriate `resize` cursor on hover (`ew-resize`, `ns-resize`, `nwse-resize`, `nesw-resize`).
- [ ] Dragging and resizing do not interfere with each other (title-bar drag ≠ edge resize).
- [ ] `Dialog` component (mobile overlay) is **unchanged**.
- [ ] Dimensions reset when the dialog re-opens (same as position reset).
- [ ] Unit tests cover: initial render without handles (`resizable=false`), render with handles, resize interaction updates width/height, min constraint enforcement, and dimension reset on reopen.

## Subtasks

1. **Add resize state & constraints to `FloatingDialog`**
   - New state: `size: { width: number; height: number } | null` (null = use CSS defaults).
   - New prop: `resizable?: boolean`.
   - Optional props: `minWidth`, `minHeight`, `maxWidth`, `maxHeight` (with sensible defaults).
   - Reset `size` to `null` in the existing `useEffect` that resets `pos` on open.

2. **Render resize handles**
   - When `resizable` is true, append 8 invisible `<div>` handles around the panel with `data-resize` attributes (n/s/e/w/ne/nw/se/sw).
   - Style handles with `position: absolute`, appropriate insets, and resize cursors. Use Tailwind utility classes where feasible; inline styles for cursor/position if needed.

3. **Implement resize mouse interaction**
   - On `mousedown` on a handle: record `startX/Y`, `initialWidth/Height`, `initialLeft/Top`, and handle direction.
   - On `mousemove`: compute delta, clamp to constraints & viewport, call `setSize`/`setPos`.
   - On `mouseup`: clear resizing state.
   - Reuse the existing global `mousemove`/`mouseup` pattern from the drag logic (combine into a single effect or keep separate — whichever is cleaner).

4. **Wire up in `GenerateTaskDialog`**
   - Pass `resizable` (or `resizable={true}`) to the `<FloatingDialog>` usage.

5. **Tests**
   - Extend `FloatingDialog.test.tsx` with resize-specific tests (see acceptance criteria).

## Notes

- The VS Code extension side (`src/shortcuts/shared/webview/base-panel-manager.ts`) already has a vanilla-JS `setupElementResize()` utility with 8-direction handles. The React implementation should follow the same directional math but use React state instead of direct DOM manipulation.
- `FollowPromptDialog` and `BulkFollowPromptDialog` use the overlay-based `Dialog`, not `FloatingDialog`. They are **out of scope** for this change but could opt-in later via a future conversion to `FloatingDialog`.
- Keep the resize handles invisible (transparent or very thin border) to avoid visual clutter; cursor change on hover is sufficient affordance.
- Consider a subtle resize grip icon in the bottom-right corner (similar to `createResizeHandlesHTML()` in base-panel-manager) for discoverability.
