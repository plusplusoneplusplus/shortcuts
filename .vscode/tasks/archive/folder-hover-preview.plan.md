# Folder Hover Preview

## Problem
When hovering over a file-path link that points to a directory (not a file), the preview tooltip shows "Preview Error: Not a file". The backend rejects directories and the client has no directory-aware rendering.

## Approach
Extend the existing file preview API and client tooltip to support directories by returning a listing of immediate children (directories-first, alphabetical) with a summary line.

## Changes

### 1. Backend: `tasks-handler.ts` — handle `stat.isDirectory()`
- In the `GET /api/workspaces/:id/files/preview` handler, when `stat.isDirectory()` is true, read directory entries with `fs.promises.readdir` (with `withFileTypes: true`).
- Sort: directories first, then files, both alphabetical.
- Cap entries at 30 (configurable via existing `lines` param reuse or a new `maxEntries` default).
- Return a response with `type: 'directory'` to distinguish from file responses:
  ```json
  {
    "type": "directory",
    "path": "/abs/path",
    "dirName": "src",
    "entries": [
      { "name": "components", "isDirectory": true },
      { "name": "index.ts", "isDirectory": false }
    ],
    "totalEntries": 47,
    "truncated": true
  }
  ```
- Skip the binary-ext check for directories (move the `stat()` call before the binary check, or gate the binary check on `!isDirectory`).

### 2. Client: `file-path-preview.ts` — add directory rendering
- Add `DirectoryPreviewResponse` interface alongside existing `FilePreviewResponse`.
- Update `fetchPreview` return type to `FilePreviewResponse | DirectoryPreviewResponse`.
- Add `renderDirectoryPreview(data)` function:
  - Header: folder name
  - Body: list of entries with 📁/📄 icons, entry name
  - Footer info: "3 folders, 12 files" summary; "(47 total)" if truncated
- Update `showTooltip` to dispatch to either `renderPreview` or `renderDirectoryPreview` based on `type` field.
- Update cache key to not include `::20` for directories (or keep it generic).

### 3. Client CSS: `tailwind.css` — directory entry styles
- `.file-preview-dir-entry` — row style for each entry (icon + name)
- `.file-preview-dir-icon` — emoji/icon sizing
- Reuse existing `.file-preview-tooltip-header` and `.file-preview-tooltip-info` classes.

### 4. Tests: `file-preview-api.test.ts` — backend directory tests
- Update existing "returns 404 for directories" test → now expects 200 with directory listing.
- Add tests: directory with mixed files/folders, empty directory, directory with >30 entries (truncation), entry sorting.

### 5. Tests: `FilePathPreview.test.ts` — client directory tooltip tests
- Mock fetch to return `type: 'directory'` response.
- Verify tooltip renders entry list with icons.
- Verify summary line ("3 folders, 12 files").
- Verify truncation indicator.

## Files Modified
| File | Change |
|------|--------|
| `packages/coc/src/server/tasks-handler.ts` | Directory listing logic in preview handler |
| `packages/coc/src/server/spa/client/react/file-path-preview.ts` | Directory response type + render function |
| `packages/coc/src/server/spa/client/tailwind.css` | Directory entry CSS |
| `packages/coc/test/server/file-preview-api.test.ts` | Backend directory tests |
| `packages/coc/test/spa/react/FilePathPreview.test.ts` | Client directory tooltip tests |
