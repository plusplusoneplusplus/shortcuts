# Fix: Blank Space Below Chat Input on Mobile

## Problem

On mobile, there is a large dead whitespace area between the chat input box and the bottom navigation bar (Tasks / Queue / Chat). This degrades the mobile UX by wasting ~30% of the visible screen.

**Root cause:** `Dialog.tsx` (mobile branch) applies `overflow-y-auto` to the panel, which allows the panel to grow taller than its content. When content height is less than the full viewport, the flex children (conversation + input) don't stretch to fill the remaining space — the panel just scrolls instead of constraining height. The inner `flex-1 min-h-0` trick on the conversation area only works when the parent has a fixed/constrained height (`overflow-hidden`, not `overflow-y-auto`).

**Secondary cause:** No `padding-bottom` compensation for the bottom navigation bar height (~56px), so even after fixing the layout the input box can be obscured by the nav bar on some browsers.

## Acceptance Criteria

- [ ] No blank white space between the chat input box and the bottom navigation bar on mobile.
- [ ] The conversation messages area fills all available vertical space between the header and the input box.
- [ ] The follow-up input box stays visually pinned to the bottom of the chat content area.
- [ ] When the mobile keyboard opens, the input remains visible (keyboard-aware layout).
- [ ] No regression on desktop — layout changes are guarded by `isMobile`.
- [ ] Dark mode works correctly with the fix.

## Subtasks

### 1. Fix Dialog panel overflow on mobile (`Dialog.tsx`)
- Change mobile `panelClass` from `overflow-y-auto` → `overflow-hidden` so the inner flex layout can properly fill height.
- The panel already uses `h-full flex flex-col`, so `overflow-hidden` is the correct pairing.

### 2. Add bottom-nav clearance to chat input (`NewChatDialog.tsx`)
- Add `pb-safe` or an explicit `pb-14` (≈56px) bottom padding to the follow-up input wrapper so it is never hidden behind the bottom nav bar.
- Alternatively, expose a CSS variable `--bottom-nav-height` from the nav bar component and reference it here.

### 3. Verify keyboard-aware behaviour
- Test on iOS Safari and Android Chrome: when the software keyboard opens, the `dvh`/`svh` viewport units (or `window.visualViewport` listener) should keep the input visible.
- If not already using dynamic viewport height, switch the Dialog mobile height from `h-full` (100vh) to `h-dvh` (dynamic viewport height) so the keyboard shrinks the available height correctly.

### 4. (Optional) Extract a `MobileChatLayout` wrapper
- If the keyboard fix requires a JS `visualViewport` listener, encapsulate it in a small hook (`useMobileViewport`) rather than embedding imperative code in `NewChatDialog`.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/shared/Dialog.tsx` | `overflow-y-auto` → `overflow-hidden` in mobile `panelClass` (line ~45) |
| `packages/coc/src/server/spa/client/react/chat/NewChatDialog.tsx` | Add bottom padding to follow-up input wrapper (line ~428) |
| `packages/coc/src/server/spa/client/react/chat/NewChatDialog.tsx` | (optional) Add `h-dvh` keyboard fix |

## Notes

- `isMobile` is already used in `Dialog.tsx` to branch between mobile/desktop styles — all changes can be kept under that guard.
- The bottom navigation bar height should be confirmed empirically (check the nav bar component for its height class).
- Tailwind `dvh` support: available in Tailwind v3.3+ (`h-dvh`). Confirm the project's Tailwind version before using it; fallback is a `style={{ height: '100dvh' }}` inline override.
- iOS 15+ Safari respects `100dvh` correctly. Older versions need the `visualViewport` JS workaround.
- Test with both short conversations (few messages) and long conversations to ensure both cases look correct.
