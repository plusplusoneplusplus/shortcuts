# Plan: Followup Chip — Append to Input Instead of Send Directly

## Problem

In the SPA chat UI (`RepoChatTab.tsx`), clicking a suggested followup chip currently:
1. Immediately **sends the message** via `sendFollowUp(text)` without giving the user a chance to edit
2. **Replaces** any text the user has already typed (the chip bypasses `inputValue` entirely)
3. The chips **disappear** as soon as the user types anything (via the `onChange` handler)

## Proposed Approach

Two behaviour changes:

### 1. Chip click → append to input, don't send
Modify the `onSelect` handler in `RepoChatTab.tsx` so clicking a chip appends the chip text to `inputValue` (with a space separator if the field is non-empty) and focuses the textarea, instead of calling `sendFollowUp`.

### 2. Typing does not dismiss chips
Remove the line in the textarea `onChange` handler that clears `suggestions` when the user types. Chips should remain visible until the user explicitly sends a message (suggestions are already cleared inside `sendFollowUp`).

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/RepoChatTab.tsx` | (1) Update `onSelect` callback to append to `inputValue` and focus textarea; (2) remove `setSuggestions([])` from textarea `onChange` |

No changes needed to `SuggestionChips.tsx` — its API already accepts an arbitrary `onSelect` callback.

## Detailed Changes

### `RepoChatTab.tsx`

**Current `onSelect` (around line 987):**
```tsx
onSelect={(text) => { setSuggestions([]); void sendFollowUp(text); }}
```

**New `onSelect`:**
```tsx
onSelect={(text) => {
    setInputValue(prev => prev ? `${prev} ${text}` : text);
    textareaRef.current?.focus();
}}
```
- `setSuggestions([])` removed — chips stay visible
- `sendFollowUp` not called — user can review/edit before sending
- `textareaRef.current?.focus()` — move cursor to textarea so user can continue typing immediately

**Current textarea `onChange` handler (around line 1004):**
```ts
if (suggestions.length > 0) setSuggestions([]);
```

**New:** delete those two lines entirely. Chips are dismissed naturally when a message is sent (the `sendFollowUp` function already resets suggestions state via the server response cycle, or we can keep an explicit clear on send).

## Todos

1. Locate exact line numbers for the two change sites in `RepoChatTab.tsx`
2. Apply change (1): update `onSelect` callback
3. Apply change (2): remove suggestions dismissal from `onChange`
4. Verify textarea ref (`textareaRef`) is accessible at the `onSelect` call site; add ref if missing
5. Manual smoke-test: type something → click chip → text appended, not replaced, chips still visible → send works normally
