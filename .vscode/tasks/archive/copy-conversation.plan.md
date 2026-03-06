# Copy Conversation Button

## Problem

There is no way to quickly export a chat session as text. Users want to copy the full conversation to paste elsewhere (e.g. into a doc or another chat). The exported text should be compact — tool call results longer than a threshold should be truncated so the output stays readable.

## Approach

Add a **"Copy"** icon button to the existing chat header toolbar (right-side action area in `RepoChatTab.tsx`). When clicked, it serializes the current `turns` array into a compact plain-text format and writes it to the clipboard using the existing `copyToClipboard` utility. The button shows a brief **✓ Copied** confirmation state, then reverts.

---

## Acceptance Criteria

- [ ] A copy icon button appears in the chat header when there is at least one turn in the active conversation.
- [ ] Clicking the button copies the full conversation to the clipboard as plain text.
- [ ] The output format is compact and human-readable (see format spec below).
- [ ] Tool call `result` or `error` fields longer than **100 characters** are truncated to `<first 100 chars>…`.
- [ ] Tool call `args` fields (JSON) longer than **100 characters** are also truncated.
- [ ] The button shows a **✓** checkmark for ~2 seconds after a successful copy, then reverts to the copy icon.
- [ ] The button is disabled (or hidden) while the conversation is streaming.
- [ ] Works in both light and dark themes.
- [ ] No new dependencies are introduced.

---

## Output Format Spec

```
[user]
<content>

[assistant]
<content>
[tool: read_file] args: {"path":"src/foo.ts"} → result: <content or truncated>
[tool: write_file] args: {"path":"…"} → error: File not found…

[user]
…
```

- Turns are separated by a blank line.
- Each turn starts with `[user]` or `[assistant]` on its own line, followed by the message content.
- Tool calls appear as indented lines immediately after the assistant content (no blank line between content and tool calls).
- Tool call `args` is rendered as compact JSON (no pretty-print). If the JSON string exceeds 100 chars, it is truncated.
- Tool call result/error: if length > 100 chars, truncate to 100 and append `…`.
- If a tool call is still `pending` or `running`, omit its result.

---

## Subtasks

### 1. Add `formatConversationAsText` utility
- **File:** `packages/coc/src/server/spa/client/react/utils/format.ts`
- Accepts `turns: ClientConversationTurn[]` and `truncateAt = 100` (configurable).
- Implements the format spec above.
- Pure function — easy to unit-test.

### 2. Add copy button to chat header
- **File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`
- Import `formatConversationAsText` and `copyToClipboard`.
- Add `useState<boolean>` for `copied` visual feedback.
- Insert button in the right-side action cluster (before the model badge, around line 797).
- Button: `<button title="Copy conversation">` with a clipboard SVG icon inline (no extra icon library).
- Disabled when `isStreaming` or `turns.length === 0`.
- On click: `copyToClipboard(formatConversationAsText(turns)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })`.

### 3. (Optional) Unit tests for the formatter
- **File:** `packages/coc/src/server/spa/client/react/utils/format.test.ts` (new)
- Test: basic user/assistant round-trip.
- Test: tool call result truncation at 100 chars.
- Test: tool call with no result (pending/running) — omitted.
- Test: empty turns array returns empty string.

---

## Notes

- `copyToClipboard` already exists in `utils/format.ts` — no new clipboard abstraction needed.
- The truncation threshold (100 chars) is a parameter with a default — can be changed without touching call sites.
- Button placement: right of the model badge cluster, left of the metadata popover — this keeps it near other action buttons.
- Consider keeping the button visible even when there are no turns, but in a disabled state, so users know it exists.
- The copy format intentionally omits `timestamp`, `images`, and `timeline` entries — those add noise and are not useful when pasting as text.
