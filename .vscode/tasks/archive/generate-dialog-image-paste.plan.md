---
status: done
---

# Plan: Image Paste (Ctrl+V) in Generate Task with AI Dialog

## Problem

The CoC web dashboard's **GenerateTaskDialog** (React) does not support image paste (Ctrl+V) attachments. Users cannot paste screenshots or diagrams to provide visual context when generating tasks with AI. The VS Code extension's equivalent dialog already supports this, and the shared infrastructure (`useImagePaste` hook, `image-utils.ts`, SDK `Attachment[]`) exists — it just isn't wired into the task generation flow.

## Approach

Three atomic commits, ordered by dependency: types → server → frontend.

---

## Commit 1: Extend `TaskGenerationPayload` with `images` field

**Motivation:** The type system must support images before any runtime code can handle them.

**Files to Modify:**
- `packages/pipeline-core/src/queue/types.ts` — add `images?: string[]` to `TaskGenerationPayload`

**Changes:**
- Add optional `images` field (array of base64 data URL strings) to the existing `TaskGenerationPayload` interface
- Follows same pattern as other payloads that carry images

**Tests:**
- Type-level change; existing tests should still compile
- Optionally add a type assertion test

**Acceptance Criteria:**
- [x] `TaskGenerationPayload` has `images?: string[]`
- [x] Existing code compiles without changes (field is optional)

---

## Commit 2: Server — accept and forward images through task generation pipeline

**Motivation:** The API endpoint and executor bridge must parse, validate, and convert images into SDK `Attachment[]` objects before the frontend can benefit.

**Files to Modify:**
- `packages/coc/src/server/task-generation-handler.ts` — extract `images` from request body, validate (filter strings, cap at 10), include in `TaskGenerationPayload`
- `packages/coc-server/src/queue-executor-bridge.ts` — in `executeTaskGeneration()`, extract images from payload, call `saveImagesToTempFiles()`, pass attachments to `executeWithAI()`, cleanup temp dir in `finally`

**Implementation Notes:**
- Reuse `saveImagesToTempFiles()` and `cleanupTempDir()` from `image-utils.ts` (already imported in executor bridge for other task types)
- Follow the same pattern as `executeFollowUp()` which already handles images: validate array → save to temp → pass `Attachment[]` → cleanup
- Cap at 10 images server-side (matches existing API handler convention)
- Invalid images silently skipped (same error tolerance as existing code)

**Tests:**
- Unit test: `task-generation-handler` forwards images in payload
- Unit test: `queue-executor-bridge.executeTaskGeneration()` converts images to attachments and passes them through
- Unit test: cleanup happens even on AI error (finally block)

**Acceptance Criteria:**
- [x] POST `/api/workspaces/:id/queue/generate` accepts optional `images: string[]` in body
- [x] Images are validated (strings only, max 10)
- [x] `executeTaskGeneration()` converts images to temp files and SDK attachments
- [x] Temp files cleaned up after AI invocation (success or failure)
- [x] No behavior change when `images` is absent or empty

---

## Commit 3: Frontend — wire `useImagePaste` into GenerateTaskDialog

**Motivation:** The user-facing paste experience and image preview UI.

**Files to Modify:**
- `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` — import and use `useImagePaste` hook, bind `addFromPaste` to prompt textarea's `onPaste`, render image previews with remove buttons, pass `images` array to `enqueue()`
- `packages/coc/src/server/spa/client/react/hooks/useQueueTaskGeneration.ts` — extend `enqueue()` function signature and API call to include optional `images: string[]`

**Implementation Notes:**
- Use the existing `useImagePaste` hook (max 5 images, already built)
- Image preview strip below the prompt textarea (thumbnails with × remove button)
- Follows the same UI pattern as the VS Code extension dialog (80×80 thumbnails)
- Disable paste when form is submitting (check `status === 'submitting'`)
- Pass images in the POST body alongside other fields to `/queue/generate`
- Use Tailwind classes consistent with existing dark/light theme

**Tests:**
- Unit test: `GenerateTaskDialog` renders image previews after paste
- Unit test: images are included in the enqueue payload
- Unit test: images are cleared after successful submission
- Unit test: paste is disabled during submission

**Acceptance Criteria:**
- [x] Ctrl+V in prompt textarea captures clipboard images
- [x] Image thumbnails displayed below textarea with remove (×) button
- [x] Max 5 images enforced (client-side)
- [x] Images included as base64 data URLs in API request
- [x] Images cleared on successful submission
- [x] No visual regression when no images are pasted

---

## Dependency Flow

```
Commit 1 (types) → Commit 2 (server) → Commit 3 (frontend)
```

All three are sequential — each depends on the previous.

## Key Files Reference

| File | Role |
|------|------|
| `packages/pipeline-core/src/queue/types.ts` | `TaskGenerationPayload` type |
| `packages/coc/src/server/task-generation-handler.ts` | API endpoint handler |
| `packages/coc-server/src/queue-executor-bridge.ts` | Queue task executor |
| `packages/coc-server/src/image-utils.ts` | `saveImagesToTempFiles()`, `cleanupTempDir()` |
| `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` | React dialog component |
| `packages/coc/src/server/spa/client/react/hooks/useImagePaste.ts` | Existing paste hook |
| `packages/coc/src/server/spa/client/react/hooks/useQueueTaskGeneration.ts` | Queue enqueue hook |
