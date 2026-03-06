# Fix "tool: undefined" in Conversation Turn Rendering

## Problem

When a completed or historical process is replayed via the `conversation-snapshot` SSE event,
the server sends raw `ConversationTurn[]` objects whose `timeline[].toolCall` and `toolCalls[]`
entries use the `ToolCall` interface from `pipeline-core` (property: `.name`).

The client-side `buildRawContent` function in `ConversationTurnBubble.tsx` reads `tc.toolName`
instead of `tc.name`, so every tool call is rendered as:

```
--- tool: undefined [completed] ---
```

This is purely a field-name mismatch between the server-side `ToolCall` (`.name`) and the
client-side `ClientToolCall` (`.toolName`). It only surfaces in the **snapshot replay path**;
live streaming events (`tool-start`) already send `toolName` correctly.

Secondary: `formatConversationAsText` in `format.ts` (used for clipboard copy) has the same
issue if a caller passes raw `ToolCall[]` objects instead of `ClientToolCall[]`.

## Root Cause

| Location | Wrong access | Correct access |
|----------|-------------|----------------|
| `ConversationTurnBubble.tsx:471` | `tc.toolName` | `tc.name \|\| tc.toolName` |
| `ConversationTurnBubble.tsx:477` | `tc.toolName` | `tc.name \|\| tc.toolName` |
| `format.ts ConversationTurnLike` | `toolName` only | add optional `name?: string` |
| `format.ts:122,124,127` | `tc.toolName` | `tc.toolName \|\| tc.name` |

The `normalizeToolCall` helper (line 90) already handles this correctly with
`raw?.toolName || raw?.name || 'unknown'` — the fix is to apply the same pattern
to the two code paths that bypass normalization.

## Acceptance Criteria

- [ ] Viewing a completed process in the SPA shows tool names (e.g. `grep`, `glob`, `view`)
      instead of `undefined` in the `--- tool: ... ---` separator lines.
- [ ] "Copy conversation" action (clipboard) also shows correct tool names.
- [ ] No regressions in live-streaming tool call display.
- [ ] Existing format.test.ts tests pass; new test added for the `name` field path.

## Subtasks

1. **Fix `ConversationTurnBubble.tsx`** (primary fix)
   - Line 471: `tc.toolName || 'unknown'` → `tc.name || tc.toolName || 'unknown'`
   - Line 477: same change

2. **Fix `format.ts`** (secondary fix)
   - Extend `ConversationTurnLike.toolCalls` item type with optional `name?: string`
   - Lines 122, 124, 127: use `` `[tool: ${tc.toolName ?? tc.name}]` ``

3. **Add/update tests**
   - `packages/coc/test/spa/react/utils/format.test.ts`: add a test case where
     `toolCalls` items carry `.name` instead of `.toolName` and assert the output
     does not contain `undefined`.

## Notes

- The `normalizeToolCall` function (ConversationTurnBubble.tsx:88–104) is the correct
  reference implementation — it already does `raw?.toolName || raw?.name || 'unknown'`.
- The `buildAssistantRender` path (which calls `normalizeToolCall`) is unaffected.
  Only `buildRawContent` (which processes historical/snapshot turns) has the bug.
- No server-side changes are needed; the field naming is intentional (`name` on the
  wire matches the `ToolCall` interface).
- `format.ts` is only used via clipboard copy in `RepoChatTab.tsx:910`; the type
  extension is a safety fix for future callers.
