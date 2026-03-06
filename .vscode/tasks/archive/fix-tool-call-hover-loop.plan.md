# Fix: Tool Call Hover Loop on Mobile

## Problem

On mobile (touch devices), tapping a tool call header causes a loop where the result
dialog (BottomSheet) flickers — briefly appearing then immediately dismissing, repeatedly.

**Root cause:** Touch events generate synthetic mouse events in sequence:
`touchstart → mouseenter → [300ms timer] → hoverVisible=true → BottomSheet mounts`
`touchend → mouseleave → [100ms grace timer] → hoverVisible=false → BottomSheet unmounts`
Because the mount/unmount cycle re-triggers layout, the loop continues.

The desktop hover interaction (`onMouseEnter` / `onMouseLeave`) is fundamentally incompatible
with touch input. The `BottomSheet` is already the correct mobile UI (in `ToolResultPopover.tsx`),
but the trigger mechanism must change.

**Affected files:**
- `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx`
- `packages/coc/src/server/spa/client/react/processes/ToolResultPopover.tsx` (reference only)

## Acceptance Criteria

- [ ] On mobile, tapping a tool call header with a result **shows** the BottomSheet once, stably, without flickering.
- [ ] Tapping the BottomSheet close button (or outside) **dismisses** it correctly.
- [ ] On desktop, existing hover-to-preview behaviour is **unchanged**.
- [ ] Expanding/collapsing tool call details (the `expanded` toggle) still works on mobile.
- [ ] No regressions in existing `ToolCallView-hover.test.tsx` tests.

## Approach

Replace the `onMouseEnter` / `onMouseLeave` hover trigger with a **tap-to-toggle** on mobile.

### Implementation Steps

1. **Import `useBreakpoint`** in `ToolCallView.tsx`.

2. **Guard hover handlers by device type:**
   - Only attach `onMouseEnter` / `onMouseLeave` to the header `<div>` when `!isMobile`.
   - On mobile the hover timer/grace-period code should never run.

3. **Add a mobile tap handler for the popover:**
   - On mobile, an `onClick` on the header (when `hasHoverResult`) should set `hoverVisible = true`
     and record the `anchorRect` (same logic as the 300ms timer today, but immediate).
   - Separate this from the expand/collapse `onClick` using a dedicated icon/button, OR conditionally
     mutate the existing `onClick` to set `hoverVisible` when `isMobile && hasHoverResult`.
   - Recommended: add a small "preview" icon button (e.g., 👁 or an info icon) in the header that
     is only visible on mobile and opens the BottomSheet. This avoids conflating expand and preview.

4. **BottomSheet close already works:** `onClose={() => onMouseLeave()}` in `ToolResultPopover.tsx`
   maps to `handlePopoverMouseLeave` → `setHoverVisible(false)`. No change needed there.

5. **Update / add tests** in `ToolCallView-hover.test.tsx`:
   - Add a test that simulates a click on mobile and verifies BottomSheet renders once without cycling.
   - Verify the existing desktop hover tests still pass.

## Notes

- `useBreakpoint` is already imported in `ToolResultPopover.tsx`; the hook is ready to use.
- Do **not** remove or disable `BottomSheet` from `ToolResultPopover` — the mobile rendering path is correct.
- Avoid using `pointer: coarse` CSS-only approaches; the loop is a JS state issue, not a CSS one.
- Consider whether tablet (`isTablet`) should behave like mobile or desktop — lean toward mobile (touch).
- The 300ms hover delay on desktop exists for UX (avoid accidental triggers); this is irrelevant on mobile.
