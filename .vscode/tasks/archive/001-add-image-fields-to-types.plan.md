---
status: pending
---

# 001: Add Image Fields to ConversationTurn Types

## Summary

Add an optional `images?: string[]` field to `ConversationTurn` (pipeline-core), `SerializedConversationTurn`, and `ClientConversationTurn` (SPA dashboard) so that user-attached images survive serialization and are available for rendering. Also add a lightweight `isImageDataUrl` predicate to `image-utils.ts`.

## Motivation

Currently the follow-up handler in `api-handler.ts` (line 640) receives `body.images` as base64 data URLs, decodes them to temp files for the AI SDK, but never stores them on the `ConversationTurn` written to the process store. Once the temp directory is cleaned up (line 686), the images are permanently lost. This commit adds the type plumbing so later commits can persist images on the turn and render them in chat bubbles.

## Changes

### Files to Create

- None

### Files to Modify

- `packages/pipeline-core/src/ai/process-types.ts`
  - Add `images?: string[]` to `ConversationTurn` (after line 132, alongside `timeline`). Stores base64 data-URL strings for user-attached images.
  - Add `images?: string[]` to `SerializedConversationTurn` (after line 146, mirrors the runtime type).
  - Thread the field through `serializeProcess` (line 476–531 mapping block) — copy `images` verbatim since it is already string[].
  - Thread the field through `deserializeProcess` (line 563–618 mapping block) — copy `images` verbatim.

- `packages/coc/src/server/spa/client/react/types/dashboard.ts`
  - Add `images?: string[]` to `ClientConversationTurn` (after line 39, alongside `timeline`). Carries data-URL strings to the React/vanilla renderers.

- `packages/coc-server/src/image-utils.ts`
  - Add `isImageDataUrl(value: string): boolean` — returns `true` when the string matches `data:image/<type>;base64,…`. Uses the same regex prefix as `parseDataUrl` but avoids decoding the full buffer.

### Files to Delete

- None

## Implementation Notes

- **Field semantics:** `images` holds base64 data-URL strings (`data:image/png;base64,…`). This is the exact format the SPA client already sends in the follow-up POST body. Storing the raw data URLs avoids an extra encoding step and allows the dashboard to render them directly in `<img src="">` tags.
- **Serialization is trivial:** `string[]` needs no Date↔ISO conversion, so `serializeProcess`/`deserializeProcess` just passes the array through (no special handling like `toolCalls` or `timeline`).
- **`isImageDataUrl` vs `parseDataUrl`:** The new predicate is a fast O(1) check (regex test, no Buffer allocation) suitable for hot paths like filtering conversation turn content. `parseDataUrl` remains for when the actual decoded buffer is needed.
- **Wire compatibility:** The field is optional (`images?: string[]`), so existing persisted processes without it deserialize correctly. The SSE `conversation-snapshot` event in `sse-handler.ts` (line 146) already sends the full turn object, so the new field flows to the client automatically once populated.
- **No behavioral change in this commit.** No code writes to `images` yet; that happens in commit 002.

## Tests

- `packages/coc-server/test/image-utils.test.ts` — Add tests for `isImageDataUrl`:
  - Returns `true` for valid `data:image/png;base64,…` string
  - Returns `true` for `data:image/jpeg;base64,…` string
  - Returns `false` for `data:text/plain;base64,…`
  - Returns `false` for empty string
  - Returns `false` for plain URLs (`https://example.com/image.png`)
  - Returns `false` for truncated data URL (`data:image/png;base64,`)

- `packages/pipeline-core/test/ai/process-types.test.ts` (new file if not present) — Add round-trip test:
  - Create an `AIProcess` with `conversationTurns` containing a user turn with `images: ['data:image/png;base64,abc']`
  - `serializeProcess` → `deserializeProcess` round-trip preserves `images` array
  - Round-trip with `images: undefined` (absent field) also works correctly

## Acceptance Criteria

- [ ] `ConversationTurn` has `images?: string[]`
- [ ] `SerializedConversationTurn` has `images?: string[]`
- [ ] `ClientConversationTurn` has `images?: string[]`
- [ ] `serializeProcess` copies `images` to serialized turns
- [ ] `deserializeProcess` copies `images` to deserialized turns
- [ ] `isImageDataUrl` exported from `image-utils.ts`
- [ ] All existing tests pass (`npm run test` at root, `npm run test:run` in affected packages)
- [ ] New tests pass for `isImageDataUrl` and serialization round-trip

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit.
