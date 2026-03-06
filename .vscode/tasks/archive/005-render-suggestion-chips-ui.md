---
status: pending
---

# 005: Render Follow-Up Suggestion Chips in Chat UI

## Summary

Add a `SuggestionChips` component that renders server-provided follow-up suggestions as clickable rows below the last assistant message, and wire the `suggestions` SSE event into both `RepoChatTab` and `QueueTaskDetail` so that clicking a chip sends the suggestion as a follow-up message.

## Motivation

This commit is separated from the server-side plumbing (004) because it is purely client-side React/CSS work, touches different files, and can be reviewed and tested independently of the backend changes.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/shared/SuggestionChips.tsx` — new shared component rendering an array of suggestion strings as a vertical list of clickable rows with fade-in animation.

### Files to Modify

- `packages/coc/src/server/spa/client/react/shared/index.ts` — add `SuggestionChips` re-export.
- `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` — add `suggestions` state, listen for `suggestions` SSE event, clear on typing/send, render `SuggestionChips` above the input area, pass click handler that calls `sendFollowUp`.
- `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` — same treatment: `suggestions` state, SSE listener, clear on typing/send, render `SuggestionChips`, click handler calls `sendFollowUp(text)`.
- `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` — filter out `suggest_follow_ups` tool calls from the tool tree so they don't render as visible tool-call nodes alongside the chips.

### Files to Delete

- (none)

## Implementation Notes

### 1. `SuggestionChips` component (`shared/SuggestionChips.tsx`)

```tsx
interface SuggestionChipsProps {
    suggestions: string[];
    onSelect: (text: string) => void;
    disabled?: boolean;
}
```

- Render a `<div>` wrapping one `<button>` per suggestion.
- Each button shows `→ {text}` (right-arrow prefix) as a single line, left-aligned.
- Layout: vertical stack (`flex flex-col gap-1.5`), full width, placed above the input area.
- Styling per row: `rounded-md border px-3 py-1.5 text-sm text-left cursor-pointer transition-colors`, with hover highlight. Use the same border / background tokens as the secondary `Button` variant for theme parity:
  - Light: `border-[#e0e0e0] bg-white hover:bg-[#f3f3f3] text-[#1e1e1e]`
  - Dark: `border-[#3c3c3c] bg-[#1e1e1e] hover:bg-[#2a2d2e] text-[#cccccc]`
- Arrow prefix span: `text-[#0078d4]` (brand blue) for visual affordance.
- Fade-in: apply a CSS `animate-fadeIn` class. Define the keyframe inline via Tailwind arbitrary syntax or add a small `@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }` block. Use `animation: fadeIn 0.2s ease-out forwards` on the wrapper.
- `disabled` prop: when true, set `pointer-events-none opacity-50` on the container (covers the sending state).
- On click: call `onSelect(text)`. The parent is responsible for sending the message and clearing suggestions.

### 2. SSE event listener — `RepoChatTab`

In the two places where an `EventSource` is constructed (`useEffect` for initial running task at line ~230 and `waitForFollowUpCompletion` at line ~103):

```ts
es.addEventListener('suggestions', (event: Event) => {
    try {
        const data = JSON.parse((event as MessageEvent).data);
        if (Array.isArray(data.suggestions)) {
            setSuggestions(data.suggestions);
        }
    } catch { /* ignore */ }
});
```

Add state:
```ts
const [suggestions, setSuggestions] = useState<string[]>([]);
```

Clear suggestions:
- In `sendFollowUp` at the top (when user explicitly sends): `setSuggestions([])`.
- In the `onChange` handler of the follow-up textarea — clear on first keystroke:
  ```ts
  onChange={e => {
      setInputValue(e.target.value);
      if (suggestions.length > 0) setSuggestions([]);
  }}
  ```
- In `handleSelectSession` and `handleNewChat` — reset suggestions on session switch.
- In `waitForFollowUpCompletion`'s `finish()` callback: do **not** clear suggestions (the SSE `suggestions` event arrives before `done`, so the state is already set).

Click handler: wrap `sendFollowUp` to accept an optional message parameter (it currently reads `inputValue`). Modify `sendFollowUp` signature to `sendFollowUp(overrideContent?: string)`:
- At the top: `const content = (overrideContent ?? inputValue).trim();`
- This matches `QueueTaskDetail.sendFollowUp` which already takes `overrideContent`.
- The chip's `onSelect` callback: `(text) => { setSuggestions([]); void sendFollowUp(text); }`.

### 3. SSE event listener — `QueueTaskDetail`

Same approach in the two EventSource sites (main SSE at line ~356 and `waitForFollowUpCompletion` at line ~150):

```ts
es.addEventListener('suggestions', (event: Event) => {
    try {
        const data = JSON.parse((event as MessageEvent).data);
        if (Array.isArray(data.suggestions)) {
            setSuggestions(data.suggestions);
        }
    } catch { /* ignore */ }
});
```

Add state: `const [suggestions, setSuggestions] = useState<string[]>([]);`

Clear on:
- `sendFollowUp` call start.
- Follow-up textarea `onChange` (first keystroke clears).
- Task selection change (`selectedTaskId` effect).

Click handler: `(text) => { setSuggestions([]); void sendFollowUp(text); }` — `sendFollowUp` already accepts `overrideContent`.

### 4. Rendering location

In both `RepoChatTab.renderConversation()` and `QueueTaskDetail`'s JSX, place `<SuggestionChips>` inside the bottom input area `<div>`, **above** the `<ImagePreviews>` and textarea row, **below** error messages:

```tsx
{/* Input area */}
<div className="border-t ... p-3 space-y-2">
    {error && <div className="text-xs text-red-500">{error}</div>}
    {suggestions.length > 0 && !isStreaming && (
        <SuggestionChips
            suggestions={suggestions}
            onSelect={(text) => { setSuggestions([]); void sendFollowUp(text); }}
            disabled={sending || sessionExpired}
        />
    )}
    <ImagePreviews ... />
    <div className="flex items-end gap-2"> ... </div>
</div>
```

The `!isStreaming` guard prevents showing stale chips while a new response is being streamed.

### 5. Hiding `suggest_follow_ups` tool calls in `ConversationTurnBubble`

In `renderToolTree` (line ~366), add a guard immediately after the existing `report_intent` guard:

```ts
// Hide suggest_follow_ups — its output is rendered as suggestion chips, not as a tool call.
if (toolCall.toolName === 'suggest_follow_ups') return null;
```

This prevents the tool from appearing in the tool tree while still keeping it in the data model for debugging purposes.

### 6. Theme support

All color tokens are already chosen from the existing palette (`#0078d4`, `#e0e0e0`/`#3c3c3c`, `#1e1e1e`/`#cccccc`, etc.) which are the same tokens used by the `Button`, `Badge`, and input components. Dark mode uses `dark:` Tailwind prefixes. No new CSS variables needed.

## Tests

- **SuggestionChips unit test** (`SuggestionChips.test.tsx`): renders N buttons for N suggestions, calls `onSelect` with correct text on click, applies disabled styling when `disabled=true`, renders nothing when `suggestions` is empty.
- **RepoChatTab integration test**: mock `EventSource` to emit a `suggestions` event, verify chips appear in DOM, simulate click on a chip, verify `sendFollowUp` POST is made with the chip text and chips disappear, simulate typing in the textarea and verify chips disappear.
- **QueueTaskDetail integration test**: same as above but in the QueueTaskDetail context.
- **ConversationTurnBubble test**: provide a turn with a `suggest_follow_ups` tool call in the timeline, verify it is not rendered in the tool tree output.

## Acceptance Criteria

- [ ] After an assistant turn completes, suggestion chips appear above the input area within ~200ms of the `suggestions` SSE event.
- [ ] Clicking a chip sends it as a follow-up message (same behavior as typing + pressing Send) and the chips disappear immediately.
- [ ] Typing any character into the follow-up input dismisses the chips.
- [ ] Switching sessions or starting a new chat clears suggestions.
- [ ] Chips are not shown while a response is streaming.
- [ ] The `suggest_follow_ups` tool call does not appear in the assistant bubble's tool tree.
- [ ] Chips render correctly in both light and dark themes.
- [ ] Chips are visually disabled (non-interactive) while a message is being sent.
- [ ] Works in both `RepoChatTab` (repo chat) and `QueueTaskDetail` (queue task detail) views.

## Dependencies

- Depends on: 004 (server emits `suggestions` SSE event)

## Assumed Prior State

Server emits `suggestions` SSE event with `{ suggestions: string[], turnIndex: number }` after each assistant turn completes. The `suggest_follow_ups` tool is already registered and invoked by the chat executor; its result is included in the assistant turn's timeline as a tool-start/tool-complete pair.
