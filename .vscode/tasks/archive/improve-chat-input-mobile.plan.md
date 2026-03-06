# Improve Chat Input Bar on Mobile

## Problem

On mobile, the follow-up chat input bar crams three elements—textarea, model badge ("claude-sonnet-4.6"), and Send button—into a single `flex items-end gap-2` row (RepoChatTab.tsx L836). The model badge's `whitespace-nowrap` prevents wrapping, so the textarea shrinks to a tiny sliver on narrow screens (~375px). The screenshot (red circle) shows the input field barely fits 15 characters of visible text, making chat follow-ups frustrating.

**Secondary issues in the same area:**
- New-chat form (L708) also puts read-only checkbox, model select, and Start Chat button on one row, cramped on mobile.
- Image preview remove buttons use `group-hover:opacity-100` which is invisible on touch devices.
- SuggestionChips may overflow horizontally on narrow screens.

## Root Cause

The follow-up input row has no mobile-specific layout. All three children are flex siblings with no `flex-wrap` or breakpoint conditional:

```tsx
<div className="flex items-end gap-2 relative">    {/* L836 — one row, no wrap */}
  <div className="flex-1 relative">                 {/* textarea */}
  <span className="... whitespace-nowrap">           {/* model badge — eats ~140px */}
  <Button>Send</Button>                              {/* ~60px */}
</div>
```

On a 375px screen with 24px total padding, the textarea gets ~150px — unacceptable.

## Approach

Stack the input controls vertically on mobile: textarea on its own row spanning full width, with model badge and Send button on a second row. This gives the textarea the full width while keeping model info visible.

## Tasks

### 1. Reflow follow-up input bar for mobile
**File:** `packages/coc/src/server/spa/client/react/chat/RepoChatTab.tsx` (~L836–882)

On mobile (`isMobile` from `useBreakpoint`), change the layout from a single row to a two-row stack:

- **Row 1:** Textarea at full width (`w-full`)
- **Row 2:** Model badge (left-aligned) + Send button (right-aligned), using `flex justify-between`

On desktop, keep the existing single-row layout unchanged.

```tsx
// Proposed structure (mobile):
<div className="space-y-2">
  <div className="relative">
    <textarea ... className="w-full ..." />
    <SlashCommandMenu ... />
  </div>
  <div className="flex items-center justify-between gap-2">
    {modelBadge}
    <Button>Send</Button>
  </div>
</div>

// Desktop: keep existing `flex items-end gap-2` layout
```

### 2. Reflow new-chat form for mobile
**File:** `packages/coc/src/server/spa/client/react/chat/RepoChatTab.tsx` (~L708–732)

On mobile, stack the controls below the textarea:

- **Row 1:** Read-only checkbox + model `<select>` (both taking available width)
- **Row 2:** Start Chat button at full width

On desktop, keep the existing horizontal layout unchanged.

### 3. Make image preview remove buttons touch-friendly
**File:** `packages/coc/src/server/spa/client/react/shared/ImagePreviews.tsx` (~L38)

The `×` remove button uses `opacity-0 group-hover:opacity-100` which never triggers on touch. Fix:

- On mobile: always show the remove button (`opacity-100`)
- Use the same `isMobile` breakpoint pattern, or use Tailwind `md:opacity-0 md:group-hover:opacity-100` to only hide on desktop where hover works

### 4. Constrain SuggestionChips overflow on mobile
**File:** `packages/coc/src/server/spa/client/react/chat/RepoChatTab.tsx` (~L828–833)

Ensure the `SuggestionChips` container uses `flex-wrap` and doesn't overflow the viewport width. If chips already wrap, verify they don't push the input bar off-screen.

### 5. Add tests
**File:** `packages/coc/src/server/spa/client/react/chat/__tests__/RepoChatTab.test.tsx` (or similar)

- Test that on mobile (`useBreakpoint` mocked to `isMobile: true`), the follow-up input bar renders model badge and Send button in a separate row from the textarea
- Test that the new-chat form stacks controls vertically on mobile
- Test that ImagePreviews remove button is visible (not `opacity-0`) on mobile

## Files to Modify

| File | Changes |
|------|---------|
| `packages/coc/src/server/spa/client/react/chat/RepoChatTab.tsx` | Reflow follow-up input bar (task 1), new-chat form (task 2), suggestion chips (task 4) |
| `packages/coc/src/server/spa/client/react/shared/ImagePreviews.tsx` | Touch-friendly remove buttons (task 3) |
| Test files | Add mobile layout assertions (task 5) |

## Testing

- Verify on mobile viewport (375px width) in Chrome DevTools
- Test iPhone SE (375×667), iPhone 14 (390×844)
- Confirm textarea gets full width on mobile
- Confirm model badge + Send button are on a separate row
- Confirm Send button is still reachable and functional
- Confirm virtual keyboard handling (`useVisualViewport` padding) still works with new layout
- Confirm SlashCommandMenu still positions correctly above textarea
- Confirm SuggestionChips don't overflow
- Run `cd packages/coc && npm run test:run`
