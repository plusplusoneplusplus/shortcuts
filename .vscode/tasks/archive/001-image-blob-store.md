---
status: pending
---

# 001: Image Blob Store Infrastructure

## Summary

Create a static utility class `ImageBlobStore` that externalizes base64 image data-URLs from queue persistence payloads into standalone JSON files under `<dataDir>/blobs/`. This follows the same structural conventions as `OutputFileManager` but adds atomic writes (temp file + rename) to match the safety guarantees already established in `QueuePersistence.atomicWrite`.

## Motivation

Queue persistence files (`~/.coc/queues/repo-<hash>.json`) store full task history including `payload.images` arrays containing base64 data-URL strings. A single image can be 1–5 MB, so a queue with a handful of image-bearing tasks easily reaches 20+ MB, causing slow reads/writes and high memory usage. Externalizing images to per-task blob files is the prerequisite for all later commits that will actually strip images from the queue payload and replace them with file references. This commit is isolated because the store itself has no callers yet — it can be reviewed and tested in complete isolation.

## Changes

### Files to Create

- `packages/coc/src/server/image-blob-store.ts` — Static utility class with four methods:
  - `saveImages(taskId, images, dataDir)` → writes `<dataDir>/blobs/<taskId>.images.json`, returns the absolute file path (or `undefined` when the images array is empty)
  - `loadImages(filePath)` → reads and parses the JSON file, returns `string[]` (returns `[]` on any error — missing file, corrupt JSON, wrong shape)
  - `deleteImages(filePath)` → removes the file, silently ignores if already gone
  - `getBlobsDir(dataDir)` → returns `path.join(dataDir, 'blobs')` (pure helper, used by pruners later)

- `packages/coc/test/server/image-blob-store.test.ts` — Vitest test suite (see Tests section)

### Files to Modify

(none)

### Files to Delete

(none)

## Implementation Notes

### Pattern Alignment

Follow the class shape of `OutputFileManager` (static methods, no constructor, async, `fs/promises`), but upgrade the write path to use the atomic pattern already established in `QueuePersistence.atomicWrite` and `FileProcessStore.writeProcessFile`:

```
const tmpPath = filePath + '.tmp';
await fs.writeFile(tmpPath, data, 'utf-8');
await fs.rename(tmpPath, filePath);
```

On failure, clean up the temp file in a catch block (matching the `QueuePersistence` approach).

### Save Logic

```typescript
static async saveImages(
    taskId: string,
    images: string[],
    dataDir: string,
): Promise<string | undefined> {
    if (!images || images.length === 0) { return undefined; }
    const dir = path.join(dataDir, BLOBS_SUBDIR);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${taskId}.images.json`);
    const tmpPath = filePath + '.tmp';
    try {
        await fs.writeFile(tmpPath, JSON.stringify(images), 'utf-8');
        await fs.rename(tmpPath, filePath);
        return filePath;
    } catch {
        try { await fs.unlink(tmpPath); } catch { /* ignore */ }
        return undefined;
    }
}
```

Key decisions:
- **No pretty-print** (`JSON.stringify(images)` without indent) — these files are machine-only and can be large; no benefit to formatting.
- **Return `undefined` on empty array** — callers should not store a blob reference when there are no images. This mirrors `OutputFileManager.saveOutput` returning `undefined` for empty content.
- **Atomic write with temp cleanup** — consistent with `QueuePersistence.atomicWrite` (write `.tmp`, rename, unlink tmp on failure).
- **`mkdir` before write** — same as `OutputFileManager`; `{ recursive: true }` is idempotent.

### Load Logic

```typescript
static async loadImages(filePath: string): Promise<string[]> {
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
```

Returns `[]` (not `undefined`) because callers will spread the result into a payload; an empty array is a safer default than forcing null-checks everywhere. Defensive: validates `Array.isArray` after parse in case the file is corrupt or has the wrong shape.

### Delete Logic

```typescript
static async deleteImages(filePath: string): Promise<void> {
    try { await fs.unlink(filePath); } catch { /* ignore */ }
}
```

Identical to `OutputFileManager.deleteOutput`. Silent on ENOENT.

### Constants

```typescript
const BLOBS_SUBDIR = 'blobs';
```

### Imports

Only Node.js built-ins: `fs/promises`, `path`. No VS Code dependencies.

### File Name Format

`<taskId>.images.json` — the `.images.json` suffix is chosen to:
1. Distinguish from other potential blob types in the future
2. Be immediately recognizable when inspecting `~/.coc/blobs/` manually
3. Allow glob-based cleanup (e.g., `*.images.json`)

## Tests

Test file: `packages/coc/test/server/image-blob-store.test.ts`

Mirror the structure and conventions of `output-file-manager.test.ts`: OS temp dirs for isolation, `beforeEach`/`afterEach` for setup/teardown.

### `saveImages`

- **writes file to correct path** — call `saveImages('task-1', ['data:image/png;base64,abc'], tmpDir)`, assert file path is `<tmpDir>/blobs/task-1.images.json`, read file and assert content matches `JSON.stringify(['data:image/png;base64,abc'])`
- **creates blobs/ directory on first write** — assert directory does not exist before, exists after
- **returns undefined for empty array** — call with `[]`, assert result is `undefined`, assert no `blobs/` directory created
- **returns undefined for null/undefined images** — edge case guard
- **overwrites existing file for same taskId** — save twice with different arrays, assert second content wins
- **handles multiple images** — save array of 3 data-URLs, reload and verify all three round-trip
- **atomic write cleans up temp file on failure** — (optional, harder to test) could mock `fs.rename` to throw and verify `.tmp` file is removed

### `loadImages`

- **reads previously saved images** — round-trip: save then load, assert deep equality
- **returns empty array for missing file** — load from non-existent path, assert `[]`
- **returns empty array for corrupt JSON** — write garbage to a file, call `loadImages`, assert `[]`
- **returns empty array if file contains non-array JSON** — write `"hello"` or `{}`, assert `[]`

### `deleteImages`

- **removes an existing file** — save then delete, assert file is gone
- **is a no-op for missing file** — delete non-existent path, assert does not throw

### `getBlobsDir`

- **returns correct path** — assert `getBlobsDir('/data')` equals `path.join('/data', 'blobs')`

## Acceptance Criteria

- [ ] `ImageBlobStore` class exported from `packages/coc/src/server/image-blob-store.ts`
- [ ] All four static methods implemented: `saveImages`, `loadImages`, `deleteImages`, `getBlobsDir`
- [ ] `saveImages` uses atomic write pattern (temp file + rename) with temp cleanup on failure
- [ ] `saveImages` returns `undefined` for empty/missing images array (no file created)
- [ ] `loadImages` returns `[]` on any error (missing file, corrupt JSON, non-array)
- [ ] `deleteImages` is silent on ENOENT
- [ ] `getBlobsDir` returns `path.join(dataDir, 'blobs')`
- [ ] No VS Code dependencies — only `fs/promises` and `path`
- [ ] JSON written without pretty-printing (compact format for large payloads)
- [ ] All tests pass: `cd packages/coc && npx vitest run test/server/image-blob-store.test.ts`
- [ ] Existing tests unaffected: `cd packages/coc && npm run test:run` passes

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit. The `ImageBlobStore` is a self-contained utility with no callers yet.
