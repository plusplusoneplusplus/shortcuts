---
status: done
---

# 002: Backend — Persist User-Attached Images in Conversation Turns

## Summary

Store user-attached base64 data URL images on the `ConversationTurn` when a follow-up message is sent, and ensure they survive serialization/deserialization so SSE snapshots deliver them to the frontend.

## Motivation

Currently, images arrive in the POST body, get decoded to temp files for the SDK, and are then deleted. The `ConversationTurn` only records `content: string`, so images are lost after the request completes. This commit closes the gap so that persisted turns carry the original data URLs and SSE replay delivers them to the client.

## Changes

### Files to Create
- None

### Files to Modify

- `packages/coc-server/src/api-handler.ts` — Store validated image data URLs on the user turn
  - Around **line 640–648**: extract a `validatedImages` array of data URLs (validated with `isImageDataUrl()`, capped at 5) *before* converting to temp files, so we have the originals to persist.
  - Around **line 668–674**: add `images: validatedImages.length > 0 ? validatedImages : undefined` to the `userTurn` object literal.
  - Import `isImageDataUrl` from `@plusplusoneplusplus/pipeline-core` (or wherever commit 001 places it).

- `packages/pipeline-core/src/ai/process-types.ts` — Add `images` to serialized turn type and both serialize/deserialize functions
  - **`SerializedConversationTurn`** (line 138–147): add `images?: string[]` field.
  - **`serializeProcess`** — in the `conversationTurns?.map` callback (around line 476–531): add `images: turn.images` to the returned object.
  - **`deserializeProcess`** — in the `conversationTurns?.map` callback (around line 563–618): add `images: turn.images` to the returned object.

### Files to Delete
- None

## Implementation Notes

1. **Validation gate**: Use `isImageDataUrl()` (from commit 001) to reject non-image or malformed data URLs before persisting. Only store data URLs that pass validation — never raw binary or arbitrary strings.

2. **Limit to 5 images**: The client-side `useImagePaste` hook enforces `DEFAULT_MAX_IMAGES = 5` (`packages/coc/src/server/spa/client/react/hooks/useImagePaste.ts:14`). Apply the same `.slice(0, 5)` cap server-side when persisting. Note: the existing temp-file path uses `.slice(0, 10)` — that's fine; it handles a broader set for SDK attachment. Persistence is the stricter path.

3. **SSE requires no changes**: `sse-handler.ts` line 149 sends `{ turns }` via `JSON.stringify`, which automatically includes `images` if present on the turn. No code change needed there.

4. **Bridge requires no changes**: `queue-executor-bridge.ts` only creates *assistant* turns (lines 398–405 and 427–433). User turns with images are created solely in `api-handler.ts`. The bridge receives `attachments` for SDK invocation but doesn't need to store them — the user turn already holds the data URLs.

5. **Size considerations**: Base64 data URLs are ~33% larger than raw binary. A 5 MB image → ~6.7 MB string. With 5 images max, worst case is ~33 MB per turn. This is stored in `~/.coc/` JSON files. For this commit, we accept the size as-is; a future commit can add per-image size limits or thumbnail generation if needed.

6. **Serialization is pass-through**: `images` is `string[]` (no Date objects), so serialize/deserialize just copy the array. No transformation needed — just ensure the field is carried through.

## Tests

- **api-handler.ts**: Add/extend the POST `/processes/:id/message` test to verify:
  - When `body.images` contains valid data URLs, the persisted `conversationTurns` user turn has `images` set.
  - When `body.images` is empty or absent, `images` is `undefined` on the user turn.
  - When `body.images` has >5 entries, only the first 5 are stored.
  - Invalid data URLs (non-image, malformed) are filtered out.

- **process-types.ts**: Add/extend serialization round-trip test to verify:
  - A `ConversationTurn` with `images: ['data:image/png;base64,...']` survives `serializeProcess` → `deserializeProcess` with the images intact.
  - A turn with `images: undefined` serializes/deserializes without adding a spurious `images` field.

- **SSE integration** (optional, can be manual): Verify that a `conversation-snapshot` event for a process with image turns includes the `images` array in the JSON payload.

## Acceptance Criteria
- [ ] POST `/processes/:id/message` with `images` in the body persists them on the user `ConversationTurn`
- [ ] Images are validated with `isImageDataUrl()` before persistence — invalid entries are dropped
- [ ] At most 5 images are stored per turn (server-side cap)
- [ ] `serializeProcess` and `deserializeProcess` round-trip the `images` field correctly
- [ ] `SerializedConversationTurn` type includes `images?: string[]`
- [ ] SSE `conversation-snapshot` events include `images` on user turns (no SSE code change needed — just passes through)
- [ ] Existing tests continue to pass (no regressions)
- [ ] Images are still decoded to temp files for SDK attachment (existing behavior unchanged)

## Dependencies
- Depends on: 001

## Assumed Prior State
Commit 001 has added `images?: string[]` to `ConversationTurn` and `ClientConversationTurn` types, and an `isImageDataUrl()` utility function.
