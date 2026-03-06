# Improve Chats Tab Mobile Experience

## Problem

The Chats tab in the CoC dashboard (`coc serve`) has several mobile UX issues visible from the screenshot:

1. **No pin/unpin on mobile** — The pin button uses `opacity-0 group-hover:opacity-100`, which is invisible on touch devices (no hover state). The context menu is triggered via `onContextMenu` (right-click), which doesn't fire on mobile browsers.
2. **No long-press support** — Unlike `TaskTreeItem` which already implements long-press → context menu, `ChatSessionSidebar` has no touch-based context menu trigger.
3. **Clipped play/arrow indicators** — Small `▶` indicators appear partially visible on the right edge of some chat cards, likely from an overflow or scrollbar issue in the drawer.
4. **Chat card touch targets are small** — Cards use `p-2` with `text-xs` content, making them difficult to tap accurately on mobile.
5. **No swipe-to-action** — No way to swipe individual chat items for quick actions (pin, delete).
6. **Missing pinned chats feature** — `onTogglePin` is not passed from `RepoChatTab` to `ChatSessionSidebar`, so pin/unpin is completely unavailable regardless of mobile vs desktop.

## Affected Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` | Chat list sidebar — needs long-press, bigger touch targets, mobile pin visibility |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Parent — needs to wire `pinnedIds`/`onTogglePin` and pass to sidebar |
| `packages/coc/src/server/spa/client/react/shared/ResponsiveSidebar.tsx` | Mobile drawer — potential overflow clipping fix |
| `packages/coc/src/server/spa/client/react/chat/usePinnedChats.ts` | Hook for pinned chats — already exists, needs integration |
| `packages/coc/src/server/spa/client/react/shared/Card.tsx` | May need `data-testid` passthrough |

## Todos

### 1. Wire pinned chats into RepoChatTab
- Import and call `usePinnedChats(workspaceId)` in `RepoChatTab`
- Pass `pinnedIds` and `onTogglePin` to `ChatSessionSidebar`
- This enables the pin/unpin feature that's currently completely disconnected

### 2. Add long-press → context menu on chat cards (mobile)
- Follow the same pattern as `TaskTreeItem.tsx` lines 157-196
- Add `onTouchStart`, `onTouchMove`, `onTouchEnd` handlers to each chat `<Card>`
- On long-press (~500ms), open the `ContextMenu` (which already renders as `BottomSheet` on mobile)
- Include menu items: Pin/Unpin, Cancel (for queued sessions)
- Suppress `onClick` navigation if long-press fired

### 3. Make pin button always visible on mobile
- Change the hover-only pin button (`opacity-0 group-hover:opacity-100`) to be always visible on mobile
- Use `opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100` pattern, or detect `isMobile` from `useBreakpoint` and conditionally set classes
- Simpler approach: always show a small action affordance (e.g., `⋮` overflow button) on mobile that opens the context menu bottom sheet

### 4. Increase touch targets on mobile
- Increase card padding from `p-2` to `p-3` on mobile (`p-2 md:p-2` → `p-3 md:p-2`)
- Increase text from `text-xs` to `text-sm` on mobile for the first-message preview
- Ensure minimum 44px touch target height on cards (already enforced for `Button` via `min-h-[44px] md:min-h-0`)

### 5. Fix overflow clipping in mobile drawer
- The `ResponsiveSidebar` drawer uses `overflow-hidden` on the `<aside>` — this clips content at the edges
- The chat list container (`overflow-y-auto`) nested inside may cause horizontal overflow for elements near the card edges
- Ensure the session list `<div>` has proper `overflow-x-hidden` to prevent horizontal scrollbar artifacts
- Check if `w-[85vw] max-w-[360px]` combined with card borders/shadows causes edge clipping

### 6. Add tests
- Test long-press triggers context menu on mobile (mock `useBreakpoint` to return `isMobile: true`)
- Test pin button visibility on mobile vs desktop
- Test that `onTogglePin` is wired from `RepoChatTab` to sidebar
- Test touch target sizes meet 44px minimum

## Implementation Notes

- The `ContextMenu` component already handles mobile rendering via `BottomSheet` — just need to trigger it
- `usePinnedChats` hook exists at `packages/coc/src/server/spa/client/react/chat/usePinnedChats.ts` and persists to `localStorage`
- Long-press pattern is well-established in `TaskTreeItem.tsx` — reuse the same approach
- All changes are in the React SPA layer (`packages/coc/src/server/spa/client/react/`)
- Build with `cd packages/coc && npm run build` and test with `npm run test`
