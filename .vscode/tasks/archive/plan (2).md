# Fix: Generate Plan Dialog Not Showing on Mobile

## Problem

On mobile, tapping "✨ Generate Plan" in the repo actions BottomSheet does nothing — no dialog appears.

## Root Cause

`RepoDetail.tsx` has a click-outside `mousedown` listener (lines 92–102) to close the `moreMenuOpen` dropdown:

```tsx
useEffect(() => {
    if (!moreMenuOpen) return;
    const handler = (e: MouseEvent) => {
        if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
            setMoreMenuOpen(false);
        }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
}, [moreMenuOpen]);
```

The BottomSheet renders as a **portal to `document.body`**, outside `moreMenuRef` in the DOM. When the user taps "Generate Plan":

1. `mousedown` fires on the button → `moreMenuRef.contains(target)` is `false` → `setMoreMenuOpen(false)` called
2. React flushes synchronously → BottomSheet **unmounts** before `click` fires
3. `click` fires on now-unmounted button → React cannot dispatch `onClick` → `handleOpenGenerateDialog()` never runs
4. Dialog never opens

The panel only stops **`click`** propagation (`onClick={e => e.stopPropagation()}`), not `mousedown`, so `mousedown` always reaches `document`.

## Approach

Two changes:

1. **Primary fix — `RepoDetail.tsx` (line 94):** Guard the click-outside effect with `isMobile`. On mobile the BottomSheet handles its own dismissal via backdrop click; the mousedown listener is redundant and harmful.

2. **Defense-in-depth — `BottomSheet.tsx`:** Add `onMouseDown={e => e.stopPropagation()}` to the panel div. This prevents `mousedown` from leaking out of the BottomSheet portal to any click-outside listeners anywhere in the codebase (future-proofs other similar bugs).

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Line 94: `if (!moreMenuOpen) return;` → `if (!moreMenuOpen \|\| isMobile) return;` |
| `packages/coc/src/server/spa/client/react/shared/BottomSheet.tsx` | Add `onMouseDown={e => e.stopPropagation()}` on the panel `<div>` (alongside existing `onClick` stopPropagation) |

## Out of Scope

- Other `mousedown` click-outside handlers in the codebase (ChatSessionSidebar, ConversationMetadataPopover, etc.) — these don't use BottomSheet portals and are unaffected.
- The `newChatDropdownOpen` click-outside handler in RepoDetail (lines 164–173) — it also uses `mousedown` but that dropdown doesn't use BottomSheet on mobile.

## Testing

After the fix, verify on mobile:
1. Tap "⋯" to open the actions BottomSheet
2. Tap "✨ Generate Plan"
3. Dialog should open (full-screen on mobile)
4. Tap "×" to close
5. Verify BottomSheet backdrop tap still dismisses the sheet
