---
status: done
---

# 003: API Endpoint for Externalized Images

## Summary

Add a `GET /api/queue/:id/images` endpoint that loads externalized image blobs from disk, and modify `serializeTask()` to strip inline `payload.images` from API responses (replacing them with `imagesCount` and `hasImages` metadata).

## Motivation

Commits 1–2 moved base64 images out of the persisted JSON into separate blob files, but the API layer still needs a way for the SPA dashboard to retrieve those images on demand. Without this endpoint the dashboard cannot display user-attached images. Stripping inline images from `serializeTask()` keeps the list/get responses lightweight — in-memory running tasks may still carry the full `payload.images` array, so the serialization change is necessary even though persistence already omits them.

## Changes

### Files to Create
(none)

### Files to Modify

- `packages/coc/src/server/queue-handler.ts` — two changes:
  1. **New route `GET /api/queue/:id/images`** — Insert a new route block immediately before the existing `GET /api/queue/:id` catch-all route (line ~1024). Follow the same pattern as the `GET /api/queue/:id/resolved-prompt` route:
     - Extract `id` from `match![1]` via `decodeURIComponent`
     - Look up the task with `findTaskManager(bridge, id)?.getTask(id)`
     - Return `sendError(res, 404, 'Task not found')` if not found
     - Read `(task.payload as any).imagesFilePath`
     - If the path is present, call `ImageBlobStore.loadImages(filePath)` (async, returns `string[]`), return `sendJSON(res, 200, { images })`. If the file is missing on disk (ENOENT), return `{ images: [] }` (graceful degradation, not 404 — the task exists but images were cleaned up).
     - If no `imagesFilePath`, return `sendJSON(res, 200, { images: [] })`
  2. **Modify `serializeTask()`** (line 87) — When building the serialized payload object, strip `images` from the spread of `task.payload` and replace with computed fields:
     - `imagesCount: number` — length of `payload.images` array if present, else `payload.imagesCount ?? 0`
     - `hasImages: boolean` — `imagesCount > 0 || !!payload.imagesFilePath`
     - Do **not** include `imagesFilePath` in the response (it's a server-side absolute path).
  3. **Add import** for `ImageBlobStore` from `./image-blob-store` (to be created in commit 1).

### Files to Delete
(none)

## Implementation Notes

- **Route ordering matters.** The `/api/queue/:id/images` route must be registered before the `/api/queue/:id` catch-all, just like `/api/queue/:id/resolved-prompt` already is. The catch-all has a guard that skips known sub-route names (`stats`, `history`, etc.) — but images would be a task ID segment, not a sub-route, so the sub-route must come first.
- **`ImageBlobStore.loadImages`** is an `async` method that reads the JSON blob file and returns `string[]`. It should already handle ENOENT gracefully (returning `[]`), matching the `OutputFileManager.loadOutput` pattern. If it throws, wrap in try/catch and return empty array with a log warning.
- **`serializeTask` is synchronous** and called in many places (list endpoints, WS broadcasts, POST responses). The image-stripping logic must remain synchronous — it just reads properties from the in-memory task, no I/O.
- **Payload shape:** The existing payload is untyped (`task.payload` is `Record<string, unknown>`). Use `as any` cast consistent with existing code (see resolved-prompt handler at line 973).
- **fs import:** `queue-handler.ts` already imports `* as fs from 'fs'`. The new endpoint needs `fs.promises` for async file access, which is available from the same import (or use the ImageBlobStore abstraction directly).

## Tests

Add tests to `packages/coc/test/server/queue-handler-images.test.ts` (new file):

- **`GET /api/queue/:id/images` — task with images file**: Enqueue a task, manually write a blob file to the expected path and patch `task.payload.imagesFilePath` to point to it, then GET the endpoint and assert `{ images: [<base64 strings>] }` with status 200.
- **`GET /api/queue/:id/images` — task without images**: Enqueue a plain task (no images), GET the endpoint, assert `{ images: [] }` with status 200.
- **`GET /api/queue/:id/images` — task not found**: GET with a bogus ID, assert 404.
- **`serializeTask` strips inline images**: Enqueue a task with `payload.images` containing base64 strings, GET `/api/queue/:id` and assert the response has `imagesCount` and `hasImages: true` but no `images` array in `payload`.

## Acceptance Criteria

- [ ] `GET /api/queue/:id/images` returns `{ images: string[] }` for tasks with externalized images
- [ ] `GET /api/queue/:id/images` returns `{ images: [] }` for tasks without images
- [ ] `GET /api/queue/:id/images` returns 404 for unknown task IDs
- [ ] `serializeTask()` output contains `imagesCount` (number) and `hasImages` (boolean) instead of `images` array
- [ ] `serializeTask()` does not leak `imagesFilePath` (server-internal absolute path) to the client
- [ ] Existing queue-handler tests still pass (no regression in list/get/enqueue responses)
- [ ] New tests pass in `queue-handler-images.test.ts`

## Dependencies
- Depends on: 001 (ImageBlobStore must exist), 002 (tasks on disk already have `imagesFilePath`/`imagesCount`)

## Assumed Prior State
`ImageBlobStore` exists at `packages/coc/src/server/image-blob-store.ts` with a static `loadImages(filePath: string): Promise<string[]>` method. Tasks persisted to disk have `payload.imagesFilePath` and `payload.imagesCount` (from commit 2), but in-memory tasks may still have inline `payload.images`.
