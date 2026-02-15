---
status: pending
---

# 001: Add ConversationTurn data types and serialization

## Summary

Add foundational `ConversationTurn` interface to `process-types.ts`, wire it into `AIProcess` / `SerializedAIProcess`, and update `serializeProcess()` / `deserializeProcess()` to handle `Date ↔ ISO-string` conversion for the `timestamp` field on each turn.

## Motivation

Conversation turns are the atomic building block for multi-turn chat. Every subsequent commit (streaming, UI, follow-up messaging) depends on this type existing and round-tripping through serialization correctly. Isolating the type addition in its own commit keeps the diff small, reviewable, and independently testable with zero risk to existing functionality.

## Changes

### Files to Modify

- `packages/pipeline-core/src/ai/process-types.ts` — Define `ConversationTurn` interface (`role`, `content`, `timestamp`, `turnIndex`, `streaming?`). Add optional `conversationTurns?: ConversationTurn[]` to `AIProcess`. Add serialized counterpart `SerializedConversationTurn` (with `timestamp: string`) and `conversationTurns?: SerializedConversationTurn[]` to `SerializedAIProcess`. Update `serializeProcess()` to map each turn's `Date` → ISO string. Update `deserializeProcess()` to map ISO string → `Date`. Both functions must gracefully handle `undefined` / empty arrays (pass through as-is).

- `packages/pipeline-core/src/file-process-store.ts` — **Verify only** (no code change expected). The existing `updateProcess()` uses `{ ...existing, ...updates }` spread merge, which replaces `conversationTurns` wholesale. This is correct: callers will supply the full updated array when appending turns. Add a code comment near the merge line clarifying this contract for future readers.

### Files to Create

- `packages/pipeline-core/test/conversation-turn-types.test.ts` — Vitest test suite covering serialize/deserialize round-trip for `conversationTurns`: empty array, single user turn, multiple mixed turns, `undefined` turns (backward compat), and the `streaming` flag. Also test that existing processes without `conversationTurns` still deserialize identically (no regression).

## Implementation Notes

- `SerializedConversationTurn` mirrors `ConversationTurn` but with `timestamp: string` (ISO 8601) instead of `Date`, following the same pattern used for `startTime` / `endTime` on the process itself.
- `serializeProcess` should use optional chaining: `process.conversationTurns?.map(...)` so that `undefined` stays `undefined` and an empty `[]` stays `[]`.
- `deserializeProcess` should likewise guard: `serialized.conversationTurns?.map(...)`.
- The `streaming` field on `ConversationTurn` is an ephemeral UI hint (true while the assistant response is still being streamed). It will be serialized/deserialized but has no behavioral effect in the store layer.
- The spread-merge in `updateProcess()` (`{ ...existing, ...updates }`) replaces arrays wholesale. This is intentional — callers must pass the complete `conversationTurns` array on each update. Document this in a brief inline comment.
- Export `ConversationTurn` and `SerializedConversationTurn` from the package barrel (`index.ts`) so downstream packages (coc, extension) can import them.

## Tests

- Serialize then deserialize a process with `conversationTurns: undefined` — verify output matches input (backward compat)
- Serialize then deserialize a process with `conversationTurns: []` — empty array preserved
- Serialize a process with one user turn — verify `timestamp` becomes ISO string in serialized form
- Round-trip a process with multiple turns (user + assistant, with and without `streaming`) — all fields preserved, `Date` objects reconstructed
- Existing `serializeProcess` / `deserializeProcess` behavior unchanged for processes without turns (snapshot-style regression check)

## Acceptance Criteria

- [ ] `ConversationTurn` interface is defined and exported from `pipeline-core`
- [ ] `SerializedConversationTurn` interface is defined and exported from `pipeline-core`
- [ ] `AIProcess.conversationTurns` optional field exists
- [ ] `SerializedAIProcess.conversationTurns` optional field exists
- [ ] `serializeProcess()` converts `ConversationTurn.timestamp` (Date) → ISO string
- [ ] `deserializeProcess()` converts ISO string → Date
- [ ] `undefined` and empty-array cases handled gracefully (no crash, preserved through round-trip)
- [ ] `updateProcess()` in `FileProcessStore` has an inline comment clarifying array-replace semantics
- [ ] All new tests pass (`npm run test:run` in `packages/pipeline-core/`)
- [ ] All existing pipeline-core tests still pass
- [ ] No changes to any other package

## Dependencies

- Depends on: None — this is the foundation commit for the conversation feature.
