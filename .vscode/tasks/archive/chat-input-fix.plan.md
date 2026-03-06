# Plan: Fix CoC Chat UI — Type & Send on Mobile

## Problem

On mobile, the **RepoChatTab** chat interface has two related issues:

1. **Input area obscured by BottomNav** — The fixed `BottomNav` (56 px + `safe-area-inset-bottom`) sits on top of the input/send row at the bottom of the chat screen. Users cannot see or tap the textarea or Send button without scrolling.

2. **Virtual-keyboard overlap** — When the textarea gains focus the mobile keyboard rises, shrinking `window.innerHeight` but not the layout container. The input row gets pushed further under the keyboard or the BottomNav, making it impossible to type and send.

### Root cause

`WikiAsk.tsx` already compensates with `pb-[calc(0.75rem+56px)]` when `isMobile` is true, but **`RepoChatTab.tsx`** (the primary chat view) has no equivalent adjustment. The input container (line 817) uses only `p-3` with no bottom-padding override.

---

## Proposed Approach

### Fix 1 — Add bottom padding to the RepoChatTab input container

In `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`, change the input area `<div>` at line 817:

```tsx
// Before
<div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">

// After
<div className={cn(
  "border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2",
  isMobile && "pb-[calc(0.75rem+56px)]"  // 56px = BottomNav h-14
)}>
```

Also ensure `safe-area-inset-bottom` is forwarded where needed (matching `BottomNav`'s own style).

### Fix 2 — Handle virtual-keyboard viewport shrink

Add a `visualViewport` resize listener (or use the CSS `env(keyboard-inset-height)` approach where supported) so that when the mobile keyboard opens:

- The conversation scroll container (`conversationContainerRef`) height is recalculated.
- The page is scrolled so the focused input is visible.

A lightweight hook (`useVisualViewport`) can encapsulate this:

```ts
// packages/coc/src/server/spa/client/react/hooks/useVisualViewport.ts
export function useVisualViewport() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => setKeyboardHeight(window.innerHeight - vv.height);
    vv.addEventListener('resize', handler);
    return () => vv.removeEventListener('resize', handler);
  }, []);
  return keyboardHeight;
}
```

Use it in `RepoChatTab` to add dynamic `marginBottom` / `paddingBottom` to the root `flex-col` container when the keyboard is open.

### Fix 3 — Scroll-into-view on textarea focus

When the textarea (`onFocus`) is triggered on mobile, call `element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` so the browser scrolls it above the keyboard.

---

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Add `isMobile && pb-[calc(0.75rem+56px)]` to input container; add `onFocus` scroll-into-view on textarea; consume `useVisualViewport` hook |
| `packages/coc/src/server/spa/client/react/hooks/useVisualViewport.ts` | New hook — encapsulates `window.visualViewport` resize listener |

---

## Tasks

1. **Investigate** — Confirm `isMobile` is already in scope inside `RepoChatTab` (it should be via `useBreakpoint`).
2. **Create** `useVisualViewport` hook.
3. **Fix input-container padding** — apply bottom padding when `isMobile`.
4. **Add keyboard-height dynamic padding** — apply `keyboardHeight` offset to the root container.
5. **Add scroll-into-view** on textarea `onFocus` for mobile.
6. **Test** — Verify on Chrome DevTools mobile emulator (375 px wide) and a real device if available.

---

## Out of Scope

- `WikiAsk.tsx` — already has the bottom-padding fix.
- `ChatSessionSidebar` — not involved in message input.
- Desktop layout — changes are guarded by `isMobile`.
