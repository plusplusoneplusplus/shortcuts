# Fix Extra Space Below Chat Input Area

## Problem

On the mobile chat tab, there is an empty/blank space below the follow-up input + Send button
and above the bottom navigation bar. The space appears to be caused by excessive bottom padding
added to the input container when `isMobile` is true.

**Screenshot:** Red-circled area below the "Follow up… Type / for skills" textarea.

## Root Cause

Two components apply large `pb-*` on mobile to avoid overlap with the bottom nav bar (~56px tall):

| File | Line | Mobile class |
|------|------|--------------|
| `packages/coc/src/server/spa/client/react/chat/NewChatDialog.tsx` | ~436 | `pb-14` (56 px) |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | ~977 | `pb-[calc(0.75rem+56px)]` (68 px) |

The space may be too large, double-counted, or the outer layout already accounts for the nav
height (e.g., via a `safe-area-inset-bottom` CSS variable or a fixed-height shell container),
making the extra padding redundant.

## Acceptance Criteria

- [ ] No visible blank gap between the chat input row and the bottom navigation bar on mobile.
- [ ] The input area is not obscured by (overlapping with) the bottom nav bar.
- [ ] Behaviour is unchanged on desktop (non-mobile) views.
- [ ] Both `NewChatDialog` and `RepoChatTab` chat views are fixed.

## Subtasks

1. **Investigate outer layout** – Check how the chat page shell/container positions the bottom
   nav and whether it already reserves space (e.g., `pb-14` on the page root, CSS
   `env(safe-area-inset-bottom)`, or a fixed-positioned nav that the flex parent already
   accounts for).
   - Key files to check: mobile shell/layout component, bottom nav component, any global CSS.

2. **Determine correct padding value** – Decide whether the inner input wrapper needs any
   bottom padding at all, or what the correct value should be (e.g., remove `pb-14` /
   `pb-[calc(...)]` if the outer shell already handles it; or reduce to just `pb-safe` /
   `env(safe-area-inset-bottom)` if needed for notch devices).

3. **Fix `NewChatDialog.tsx`** – Update or remove the `isMobile && "pb-14"` class on the
   follow-up wrapper div (line ~436).

4. **Fix `RepoChatTab.tsx`** – Update or remove the `isMobile && "pb-[calc(0.75rem+56px)]"`
   class on the input area div (line ~977).

5. **Visual verification** – Check the chat tab on a mobile viewport in the browser to confirm
   the gap is gone without the input being hidden behind the nav bar.

## Notes

- `pb-14` = `3.5rem` = `56px` in Tailwind, matching the bottom nav height.
- `pb-[calc(0.75rem+56px)]` = `68px` (includes `p-3` = `0.75rem` already set on the div,
  suggesting double-counting was intended but may be wrong).
- If the nav bar is `position: fixed`, the page content flow doesn't shrink; padding on the
  input wrapper is the right approach — but only if the outer container does **not** already
  add equivalent padding.
- Search for other uses of `pb-14` or `isMobile` + padding to understand the pattern used
  elsewhere in the SPA.
