# Generate Task — Floating Dialog (Non-Mobile)

## Problem

The **Generate Task** dialog currently renders as a centred modal with a dark backdrop overlay (`fixed inset-0 … bg-black/40`). On desktop the overlay blocks the rest of the UI while the user is composing a prompt. Converting it to a **floating (non-blocking) panel** on non-mobile lets the user keep the rest of the dashboard visible and accessible behind the dialog.

Mobile behaviour is unchanged: the dialog still occupies the full screen as today.

## Proposed Approach

Introduce a `FloatingDialog` variant in (or alongside) the existing `Dialog` component.  
When `isMobile` is `false`, `GenerateTaskDialog` renders as a draggable, fixed-position floating panel (no overlay/backdrop) instead of the current centred modal.

The existing **minimized pill** that already floats bottom-right stays as-is; it is only shown when `minimized={true}`.

---

## Acceptance Criteria

1. On **desktop / tablet** (`isMobile === false`):
   - Dialog renders as a floating panel with **no dark backdrop/overlay**.
   - Panel has a fixed default position (e.g., centered horizontally, top ~15% of viewport) so it doesn't cover key content by default.
   - Panel is **draggable** by its title bar so the user can reposition it.
   - The rest of the page remains fully interactive (click-through around the panel).
   - Keyboard shortcut `Ctrl+Enter` still submits; `Esc` still closes (or minimizes if `onMinimize` is provided).
2. On **mobile** (`isMobile === true`):
   - Behaviour is **identical** to today (full-screen overlay).
3. Visual appearance of the panel itself (form fields, buttons, footer) is **unchanged**.
4. The existing **minimized pill** behaviour is **unchanged**.
5. No regressions on existing Vitest tests; update snapshot/unit tests that assert dialog markup if needed.

---

## Subtasks

### 1. Create / update `FloatingDialog` component
- **File:** `packages/coc/src/server/spa/client/react/shared/FloatingDialog.tsx` (new) **or** extend `Dialog.tsx`.
- Render a `fixed`-position panel (no overlay div) using a React portal.
- Add drag-to-move via `onMouseDown` on the title bar + `mousemove`/`mouseup` listeners on `window` (store offset in `useRef`).
- Accept the same props as `Dialog` (`title`, `children`, `footer`, `onClose`, `onMinimize`, `className`, `id`, `disableClose`).
- Keep `z-[10002]` so it sits above other UI elements.
- Default position: `top: 10vh; left: 50%; transform: translateX(-50%)` (centered, no overlay needed).
- On drag start, replace the `transform` with absolute `left`/`top` pixel values.

### 2. Update `GenerateTaskDialog` to use `FloatingDialog` on desktop
- **File:** `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx`
- Import `useBreakpoint` (already available via `Dialog`).
- On `!isMobile`, swap `<Dialog …>` for `<FloatingDialog …>`.
- No changes to form state, submission logic, or minimized pill rendering.

### 3. (Optional) Update `Dialog` to delegate to `FloatingDialog`
- If the floating panel is built inside `Dialog.tsx` rather than as a separate file, add a prop `floating?: boolean` and branch on `!isMobile && floating`.
- Keep backward-compat: existing callers of `<Dialog>` that do **not** set `floating` stay as centred modals.

### 4. Tests
- Add / update Vitest unit tests for `FloatingDialog` (renders without overlay, drag interaction).
- Check `GenerateTaskDialog` tests — update any snapshots that assert the wrapping markup.

---

## Notes

- **No new dependencies** required — drag logic can be implemented with plain DOM events.
- `useBreakpoint` breakpoints: mobile ≤ 767 px, tablet 768–1023 px, desktop ≥ 1024 px. Treat tablet as non-mobile (floating) since the dashboard shows full layout there.
- The panel width should remain `max-w-[600px]` as today; add `min-w-[480px]` so it doesn't collapse on narrow desktops.
- Consider adding a subtle resize handle in the bottom-right corner as a follow-up (out of scope here).
- The `MarkdownReviewEditor` already has a floating pattern; refer to it for drag-handle styling inspiration.
