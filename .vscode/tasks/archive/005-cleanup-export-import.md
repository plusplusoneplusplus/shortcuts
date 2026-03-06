---
status: done
---

# 005: Data Lifecycle Support for Image Blobs

## Summary

Update `DataWiper`, `DataExporter`, and `DataImporter` to handle the `~/.coc/blobs/` directory so that externalized task images are included in wipe, export, and import operations alongside existing queue/process/wiki data.

## Motivation

Commits 1–4 introduced `ImageBlobStore` and the `blobs/` directory, but the admin data lifecycle tools (`wipe`, `export`, `import`) are unaware of it. Without this commit, wiping data leaves orphan blob files, exports miss image data, and imports fail to restore images. This is a separate commit because it touches three independent utilities plus their shared type definitions, and is logically distinct from the runtime read/write path.

## Changes

### Files to Create
(none expected)

### Files to Modify

- `packages/coc-server/src/export-import-types.ts` — Add `ImageBlobEntry` type (`{ taskId: string; images: unknown[] }`), add optional `imageBlobs?: ImageBlobEntry[]` to `CoCExportPayload`, add `blobFileCount: number` to `ExportMetadata`, add `importedBlobFiles: number` to `ImportResult`. Update `validateExportPayload()` to accept (but not require) the new fields for forward compatibility.

- `packages/coc/src/server/data-wiper.ts` — Add `deletedBlobs: number` to `WipeResult`. In `doWipe()`: count `*.images.json` files in `<dataDir>/blobs/` (step 3b, after queue counting). On execute: delete each blob file with `fs.unlinkSync()`, following the same pattern as queue file deletion. Add private `listBlobFiles(blobsDir)` helper mirroring `listQueueFiles()`.

- `packages/coc/src/server/data-exporter.ts` — Add `readBlobFiles(dataDir)` helper that reads `<dataDir>/blobs/*.images.json`, parses each into `{ taskId, images }` (extracting `taskId` from filename pattern `<taskId>.images.json`), and skips corrupt files. In `exportAllData()`: call `readBlobFiles()`, include result as `imageBlobs` in payload, add `blobFileCount` to metadata.

- `packages/coc/src/server/data-importer.ts` — Add `writeBlobFiles(dataDir, blobs, errors)` and `mergeBlobFiles(dataDir, blobs, errors)` helpers. In `replaceImport()`: after queue file restore (step 6), call `writeBlobFiles()` to write each `ImageBlobEntry` to `<dataDir>/blobs/<taskId>.images.json` using atomic tmp+rename (matching `writeQueueFiles` pattern). In `mergeImport()`: after queue merge (step 4), call `mergeBlobFiles()` which skips writing if the file already exists on disk. Track count in `result.importedBlobFiles`.

- `packages/coc/test/server/data-wiper.test.ts` — Add tests for blob handling.

- `packages/coc/test/server/data-exporter.test.ts` — Add tests for blob export.

- `packages/coc/test/server/data-importer.test.ts` — Add tests for blob import.

### Files to Delete
(none)

## Implementation Notes

### Blob file naming convention
Files are named `<taskId>.images.json` in the `<dataDir>/blobs/` directory (established by commit 1's `ImageBlobStore`). The exporter derives `taskId` by stripping the `.images.json` suffix from the filename.

### Export payload backward compatibility
`imageBlobs` is optional in `CoCExportPayload` so that payloads exported before this feature still import successfully. The importer should treat `undefined`/missing `imageBlobs` as an empty array. Similarly, `blobFileCount` in `ExportMetadata` should be optional (default 0) — the validator must **not** require it for schema version 1 to avoid breaking existing exports.

### Atomic writes
Use the same tmp-file-then-rename pattern as `writeQueueFiles()` for blob writes in the importer to avoid partial-write corruption.

### Wiper ordering
Delete blob files **after** queue files but **before** wiki directories. This keeps the wipe order consistent: store data → queue files → blob files → preferences → wiki dirs.

### `getBlobsDir` reuse
Import `getBlobsDir` from `ImageBlobStore` (or inline `path.join(dataDir, 'blobs')`) depending on whether the blob store module is importable without side effects. If `getBlobsDir` is a static/standalone function, import it. If it requires instantiation, use the inline path join.

### Schema version
Do **not** bump `EXPORT_SCHEMA_VERSION` — the new fields are additive and optional. Existing v1 payloads remain valid. The validator allows extra unknown fields per its existing design.

## Tests

### DataWiper tests (`data-wiper.test.ts`)
- `getDryRunSummary` should count blob files in `blobs/` directory
- `getDryRunSummary` should return `deletedBlobs: 0` when blobs dir does not exist
- `wipeData` should delete all blob files from `blobs/` directory
- `wipeData` should handle missing blobs directory gracefully
- `getDryRunSummary` should not delete blob files (dry-run safety)

### DataExporter tests (`data-exporter.test.ts`)
- Should include `imageBlobs` and `blobFileCount` in export payload when blob files exist
- Should return empty `imageBlobs` array and `blobFileCount: 0` when no blobs dir
- Should skip corrupt blob files and continue
- Exported payload with blobs should still pass `validateExportPayload()`
- Should extract `taskId` from filename correctly

### DataImporter tests (`data-importer.test.ts`)
- **Replace mode**: should write blob files to `blobs/` directory from payload `imageBlobs`
- **Replace mode**: wipe should clear existing blob files before writing new ones
- **Replace mode**: should handle empty `imageBlobs` gracefully
- **Replace mode**: should handle payload without `imageBlobs` field (backward compat)
- **Merge mode**: should skip existing blob files, write only new ones
- **Merge mode**: should write all blob files when blobs dir is empty
- **Merge mode**: should handle missing `imageBlobs` in payload

### Export type validation tests (inline or in existing validation test)
- `validateExportPayload` should accept payload with `imageBlobs` array
- `validateExportPayload` should accept payload without `imageBlobs` (backward compat)

## Acceptance Criteria
- [ ] `DataWiper.getDryRunSummary()` returns accurate `deletedBlobs` count
- [ ] `DataWiper.wipeData()` deletes all `*.images.json` files from `blobs/`
- [ ] `exportAllData()` includes `imageBlobs` array and `blobFileCount` in metadata
- [ ] Corrupt blob files are skipped during export (no throw)
- [ ] `importData()` in replace mode writes blob files after wiping
- [ ] `importData()` in merge mode skips existing blob files
- [ ] Payloads without `imageBlobs` (pre-feature exports) import without error
- [ ] `validateExportPayload()` accepts both old and new payload shapes
- [ ] All new tests pass; no existing tests broken
- [ ] Atomic write pattern used for blob file creation in importer

## Dependencies
- Depends on: 001 (ImageBlobStore with `getBlobsDir`), 002 (queue persistence saving images to `~/.coc/blobs/<taskId>.images.json`)

## Assumed Prior State
`ImageBlobStore` exists with `getBlobsDir()`. Queue persistence saves images to `~/.coc/blobs/<taskId>.images.json`. Export/import types are in `packages/coc-server/src/export-import-types.ts`.
