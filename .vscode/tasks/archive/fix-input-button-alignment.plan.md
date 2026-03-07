# Fix: Follow-up Input & Send Button Vertical Alignment

## Problem

In the chat follow-up row, the text input (`<textarea>`) and the Send button are not vertically leveled. The button appears lower/misaligned relative to the input because the flex container uses `items-end` while both elements have fixed single-row height. On mobile the button has `min-h-[44px]` which makes it taller than the textarea (`rows={1}`, ~36–38 px), so with bottom-alignment the textarea sits higher visually.

Screenshot: input box and blue "..." button are not on the same visual baseline.

## Root Cause

Both files use:
```tsx
<div className="flex items-end gap-2 relative">
```

`items-end` aligns children to the **bottom edge**. When the button's effective height differs from the textarea height (especially on mobile due to `min-h-[44px]`), the two elements look misaligned.

## Proposed Fix

Change `items-end` → `items-center` on the flex container so both elements are vertically centered against each other.

```tsx
// Before
<div className="flex items-end gap-2 relative">

// After
<div className="flex items-center gap-2 relative">
```

> **Note:** `items-end` is the conventional choice when a textarea can auto-grow to multiple lines (button should stay pinned at the bottom). However, neither file auto-grows the textarea, so `items-center` gives a better single-line appearance. If auto-grow is added later, revert to `items-end`.

## Affected Files

| File | Location |
|------|----------|
| `NewChatDialog.tsx` | `packages/coc/src/server/spa/client/react/chat/NewChatDialog.tsx` |
| `RepoChatTab.tsx` | `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` |

## Acceptance Criteria

- [ ] Follow-up input and Send button appear visually level (same vertical center) on both desktop and mobile viewports.
- [ ] No regression on multi-line textarea behavior (if text wraps, button stays visually acceptable).
- [ ] Both `NewChatDialog` and `RepoChatTab` are updated.

## Subtasks

1. In `NewChatDialog.tsx`, change `items-end` → `items-center` on the follow-up row container.
2. In `RepoChatTab.tsx`, change `items-end` → `items-center` on the follow-up row container.
3. Visual smoke-test: open the dashboard, type in the follow-up box, verify alignment at desktop and mobile widths.

## Notes

- The `Button` component uses `min-h-[44px] md:min-h-0` for touch target compliance on mobile — this is intentional and should not be changed.
- The textarea uses `resize-none`; no JS auto-resize is present in either component at the time of writing.
- Both components are near-identical for this section; the fix is purely a one-word Tailwind class change per file.
