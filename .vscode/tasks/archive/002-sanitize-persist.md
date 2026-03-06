---
status: done
---

# 002: Sanitize Payloads on Persist and Externalize Images

## Summary

Add a `sanitizeTaskForPersistence()` function that deep-clones a `QueuedTask`, externalizes any `payload.images` array to a blob file via `ImageBlobStore`, and replaces the inline data with metadata (`imagesFilePath`, `imagesCount`). Wire this into both `QueuePersistence.save()` and `MultiRepoQueuePersistence.save()` so persisted JSON files no longer contain base64 image data.

## Motivation

This is separated from commit 001 (ImageBlobStore utility) because it touches the persistence hot path — the debounced `save()` methods in both persistence classes. Making `save()` async is a non-trivial change that affects the debounce timer, `dispose()` flush, and the change-listener callback chain. Isolating this in its own commit keeps the diff reviewable and the blast radius contained.

## Changes

### Files to Create

(none — all changes are modifications)

### Files to Modify

- `packages/coc/src/server/queue-persistence.ts`
  - **Add import** for `ImageBlobStore` from `./image-blob-store`
  - **Add exported function** `sanitizeTaskForPersistence(task: QueuedTask, dataDir: string): Promise<QueuedTask>`
    - Deep-clone `task` via `JSON.parse(JSON.stringify(task))`
    - Check `(clone.payload as any).images` — if it's an array with length > 0:
      - Call `ImageBlobStore.saveImages(task.id, images, dataDir)` → get `filePath`
      - Set `(clone.payload as any).imagesFilePath = filePath`
      - Set `(clone.payload as any).imagesCount = images.length`
      - Set `(clone.payload as any).images = []`
    - Return clone
  - **Add private helper** `sanitizeTasks(tasks: QueuedTask[]): Promise<QueuedTask[]>`
    - `Promise.all(tasks.map(t => sanitizeTaskForPersistence(t, this.dataDir)))`
  - **Change `save()` from sync to async**: `private save(): void` → `private async save(): Promise<void>`
    - Before building `PersistedQueueState`, sanitize both `pending` and `hist` arrays via `await this.sanitizeTasks(...)`
    - The `atomicWrite` call remains synchronous (fs.writeFileSync) — only the sanitization is async
  - **Update `scheduleSave()`**: The debounce callback calls `this.save()` which now returns a Promise — add `.catch(err => process.stderr.write(...))` to avoid unhandled rejection
  - **Update `dispose()`**: The `this.save()` call now returns a Promise — but `dispose()` is called synchronously. Two options:
    - *Option A (preferred)*: Keep `dispose()` synchronous. Change the flush logic: if `this.dirty`, call `this.save()` and attach a `.catch()`. The caller does not await. This is acceptable because `atomicWrite` is sync — the only async part is `ImageBlobStore.saveImages` which writes a small JSON file and is effectively instant.
    - *Option B*: Make `dispose()` async. This cascades further and is avoided in this commit.

- `packages/coc/src/server/multi-repo-queue-persistence.ts`
  - **Add import** for `sanitizeTaskForPersistence` from `./queue-persistence`
  - **Change `save(rootPath)` from sync to async**: `save(rootPath: string): void` → `async save(rootPath: string): Promise<void>`
    - Before building `PersistedQueueState`, sanitize `[...queued, ...running]` and `history` via `Promise.all(tasks.map(t => sanitizeTaskForPersistence(t, this.dataDir)))`
    - `atomicWrite` remains synchronous
  - **Update `scheduleSave()`**: The debounce callback calls `this.save(rootPath)` — add `.catch(...)` for unhandled rejections
  - **Update `dispose()`**: The `this.save(rootPath)` call in the flush loop now returns a Promise — same pattern as `QueuePersistence`: fire-and-forget with `.catch()`, keeping `dispose()` synchronous

- `packages/coc/src/server/queue-executor-bridge.ts` — Add image rehydration before the attachment decoding block (~line 578-585). If `payload.imagesFilePath` exists and `payload.images` is empty/absent, call `ImageBlobStore.loadImages(payload.imagesFilePath)` to populate `payload.images` before decoding into `Attachment[]`.

### Files to Delete

(none)

## Implementation Notes

### Async save() — cascading impact

The `save()` method is called from three sites in each class:
1. **Debounce timer callback** (`scheduleSave`) — Already fire-and-forget; just add `.catch()`
2. **`dispose()` flush** — Called synchronously by the server shutdown path. Keep synchronous signature, fire `.save().catch(...)`. The actual fs writes are sync; the only async part is `ImageBlobStore.saveImages` which is a single `writeFile` call for a small JSON file.
3. **Directly from `QueuePersistence.save()`** in the single-repo class — only called from the above two sites.

### Deep clone strategy

Use `JSON.parse(JSON.stringify(task))` for the deep clone. This is safe because:
- `QueuedTask` payloads are plain JSON-serializable objects (no Dates, functions, or circular refs)
- The clone is only used for persistence — the in-memory task retains the original images
- Performance: structuredClone is not needed; JSON round-trip is sufficient for these objects

### Payload typing

The `images`, `imagesFilePath`, and `imagesCount` fields are accessed via `(payload as any)` cast because:
- Only `TaskGenerationPayload` currently has `images?: string[]`
- `imagesFilePath` and `imagesCount` are new fields not yet on any payload type
- A future commit (003 or 004) will add these fields to the type definitions
- Using `as any` here avoids coupling this commit to type changes

### No changes to restore()

On restore, tasks will have `imagesFilePath` (string) and `imagesCount` (number) instead of `images` (base64 strings). The restore path does not need modification — tasks are enqueued with whatever payload they have. When the executor runs a restored task, it already reads `payload.images` directly from the in-memory task object and decodes them into `Attachment[]` (see `queue-executor-bridge.ts:581-585`). For restored tasks that only have `imagesFilePath`, the executor must rehydrate images before execution.

### Executor rehydration of images on restore

Add a rehydration step in `queue-executor-bridge.ts` at the point where `task.payload.images` is consumed (around line 581). Before decoding images into attachments:
1. Check if `(payload as any).imagesFilePath` exists and `payload.images` is empty/absent
2. If so, call `ImageBlobStore.loadImages(payload.imagesFilePath)` to rehydrate `payload.images`
3. Then proceed with the existing attachment decoding

This ensures restored tasks (which lost their inline images during persistence) can still execute correctly with their original images.

**File to modify:** `packages/coc/src/server/queue-executor-bridge.ts` — add image rehydration before the attachment decoding block (~line 578-585).

### Idempotency

`sanitizeTaskForPersistence` is idempotent: if `payload.images` is already empty (or absent), it returns a clone with no blob written. This means re-saving an already-sanitized task is safe.

## Tests

- **`sanitizeTaskForPersistence` unit tests** (in `queue-persistence.test.ts` or new `sanitize-task.test.ts`):
  - Task with `payload.images` containing 2 base64 data URLs → returns clone with `images: []`, `imagesFilePath` set to expected path, `imagesCount: 2`
  - Task without `payload.images` → returns clone unchanged (no blob file created)
  - Task with `payload.images: []` (empty array) → returns clone unchanged (no blob file created)
  - Original task object is not mutated (deep clone verification)
  - Blob file is actually written to `<dataDir>/blobs/<taskId>.images.json`

- **`QueuePersistence.save()` integration tests**:
  - Enqueue a task with images, trigger save, read the persisted JSON → verify `images` is empty and `imagesFilePath` is present
  - Enqueue a task without images, trigger save → verify persisted JSON is unchanged from current behavior
  - Verify blob file exists at expected path after save

- **`MultiRepoQueuePersistence.save()` integration tests**:
  - Same as above but using `MultiRepoQueuePersistence`

- **Round-trip test**:
  - Save a task with images → verify blob file created → restore → verify restored task has `imagesFilePath` and `imagesCount` but no inline images → (later commit will test that executor rehydrates)

## Acceptance Criteria

- [ ] `sanitizeTaskForPersistence()` is exported from `queue-persistence.ts`
- [ ] Tasks with `payload.images` are persisted with `images: []`, `imagesFilePath`, and `imagesCount`
- [ ] Tasks without `payload.images` are persisted identically to current behavior
- [ ] Blob files are written to `<dataDir>/blobs/<taskId>.images.json`
- [ ] Original in-memory task objects are not mutated by the sanitize function
- [ ] `save()` in both persistence classes handles the async sanitization correctly
- [ ] `dispose()` remains synchronous in both classes (fire-and-forget async save)
- [ ] No unhandled Promise rejections from debounce or dispose save paths
- [ ] All existing persistence tests continue to pass
- [ ] New tests cover: images present, images absent, images empty, deep clone, blob written, round-trip

## Dependencies

- Depends on: 001

## Assumed Prior State

`ImageBlobStore` exists at `packages/coc/src/server/image-blob-store.ts` with `saveImages`, `loadImages`, `deleteImages`, `getBlobsDir` static methods. Storage format is `<dataDir>/blobs/<taskId>.images.json` containing a JSON array of base64 data URL strings.
