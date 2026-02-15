---
commit: "007"
title: Add review editor REST API routes to CoC serve
status: pending
---

# 007 — Add review editor REST API routes to CoC serve

## Why

The CoC standalone server needs REST endpoints so the review editor SPA (commit 008+) can load markdown files, read/write comments, and serve embedded images — all without VS Code.

## Dependencies

- **002** — CommentsManager extracted to pure Node.js (no `vscode` imports). This commit consumes it.
- **Router / api-handler pattern** — already landed in `packages/coc/src/server/`.

## What changes

### 1. New file: `packages/coc/src/server/review-handler.ts`

Single `registerReviewRoutes(routes, projectDir)` function that pushes `Route[]` entries, mirroring the pattern in `api-handler.ts` (`registerApiRoutes`) and `queue-handler.ts` (`registerQueueRoutes`).

Internally instantiates a `CommentsManager(projectDir)` and calls `initialize()` once. All route handlers delegate to CommentsManager methods.

#### Routes

| Method | Pattern | Description | CommentsManager method(s) |
|--------|---------|-------------|---------------------------|
| `GET` | `/api/review/files` | List `.md` files in `projectDir` (recursive, respects `.gitignore` if feasible) | *fs only — `glob` or manual walk* |
| `GET` | `/api/review/files/:path` | Return file content (UTF-8) + comments for that path | `getCommentsForFile(path)`, `fs.readFileSync` |
| `POST` | `/api/review/files/:path/comments` | Add a comment (body: selection, selectedText, comment, author?, tags?, type?) | `addComment(...)` |
| `PATCH` | `/api/review/files/:path/comments/:id` | Edit text, resolve, reopen, update tags | `updateComment(id, updates)` |
| `DELETE` | `/api/review/files/:path/comments/:id` | Delete a single comment | `deleteComment(id)` |
| `POST` | `/api/review/files/:path/comments/resolve-all` | Resolve all open comments for the file | `resolveAllComments()` filtered to file — *or* iterate `getCommentsForFile` + `resolveComment` per ID |
| `DELETE` | `/api/review/files/:path/comments` | Delete all comments for the file | iterate `getCommentsForFile` + `deleteComment` per ID |
| `GET` | `/api/review/images/:path` | Serve image files (png/jpg/gif/svg/webp) referenced in markdown | *fs only — stream with correct MIME* |

#### Route patterns (regex)

All `:path` segments are encoded (the router already calls `decodeURIComponent` on `pathname`). Use a single capture group for the rest-of-path:

```typescript
// Files list (exact string match)
{ method: 'GET', pattern: '/api/review/files', handler: ... }

// Single file content + comments
{ method: 'GET', pattern: /^\/api\/review\/files\/(.+)$/, handler: ... }

// Add comment (POST — must match before the GET regex above in the array)
{ method: 'POST', pattern: /^\/api\/review\/files\/(.+)\/comments$/, handler: ... }

// Resolve-all (POST — match before single-comment PATCH/DELETE)
{ method: 'POST', pattern: /^\/api\/review\/files\/(.+)\/comments\/resolve-all$/, handler: ... }

// Delete-all comments for file
{ method: 'DELETE', pattern: /^\/api\/review\/files\/(.+)\/comments$/, handler: ... }

// Single comment PATCH
{ method: 'PATCH', pattern: /^\/api\/review\/files\/(.+)\/comments\/([^/]+)$/, handler: ... }

// Single comment DELETE
{ method: 'DELETE', pattern: /^\/api\/review\/files\/(.+)\/comments\/([^/]+)$/, handler: ... }

// Image serving
{ method: 'GET', pattern: /^\/api\/review\/images\/(.+)$/, handler: ... }
```

#### Response shapes

**`GET /api/review/files`**
```json
{
  "files": [
    { "path": "README.md", "name": "README.md", "commentCount": 3 },
    { "path": "docs/guide.md", "name": "guide.md", "commentCount": 0 }
  ]
}
```

**`GET /api/review/files/:path`**
```json
{
  "path": "README.md",
  "content": "# Hello\n...",
  "comments": [ /* MarkdownComment[] */ ]
}
```

**`POST /api/review/files/:path/comments`** — body:
```json
{
  "selection": { "startLine": 5, "startColumn": 1, "endLine": 5, "endColumn": 20 },
  "selectedText": "some markdown text",
  "comment": "Needs rewording",
  "author": "alice",
  "tags": ["wording"],
  "type": "user"
}
```
Response: `201` with the created `MarkdownComment`.

**`PATCH .../comments/:id`** — body (all optional):
```json
{ "comment": "Updated text", "status": "resolved", "tags": ["done"] }
```
Response: `200` with updated `MarkdownComment`.

**Error envelope** — reuse `sendError(res, status, message)` from `api-handler.ts`:
```json
{ "error": "File not found: foo.md" }
```

#### Security: path traversal guard

Before resolving any `:path` to the filesystem, validate it stays within `projectDir`:

```typescript
function safePath(projectDir: string, relativePath: string): string | null {
    const resolved = path.resolve(projectDir, relativePath);
    if (!resolved.startsWith(path.resolve(projectDir) + path.sep) &&
        resolved !== path.resolve(projectDir)) {
        return null; // traversal attempt
    }
    return resolved;
}
```

Return `400 "Invalid path"` if `safePath` returns `null`.

### 2. Wire into server: `packages/coc/src/server/index.ts`

Add to imports:
```typescript
import { registerReviewRoutes } from './review-handler';
```

After existing `registerQueueRoutes(routes, queueManager)` call, add:
```typescript
const projectDir = options.projectDir ?? process.cwd();
registerReviewRoutes(routes, projectDir);
```

Add `projectDir?: string` to `ExecutionServerOptions` in `types.ts` so callers can override the review root directory.

### 3. Update types: `packages/coc/src/server/types.ts`

Add to `ExecutionServerOptions`:
```typescript
/** Root directory for the review editor file tree (default: `process.cwd()`). */
projectDir?: string;
```

### 4. Re-export: `packages/coc/src/server/index.ts`

Add to the re-export block:
```typescript
export { registerReviewRoutes } from './review-handler';
```

## Implementation notes

### CommentsManager instantiation

The base class `CommentsManagerBase` currently imports `vscode` for `EventEmitter`, `FileSystemWatcher`, and safe file helpers. Commit 002 extracts a pure-Node version. This handler only needs:
- `initialize()` — loads from `.vscode/md-comments.json`
- `addComment(filePath, selection, selectedText, comment, author?, tags?, mermaidContext?, type?)`
- `updateComment(id, { comment?, status?, tags? })`
- `deleteComment(id)`
- `resolveComment(id)` / `reopenComment(id)`
- `resolveAllComments()`
- `deleteAllComments()`
- `getCommentsForFile(filePath)`
- `getAllComments()`
- `getFilesWithComments()`

If post-002 CommentsManager still retains `vscode.Disposable`, create a thin wrapper or use the extracted interface only.

### File listing strategy

Walk `projectDir` recursively for `*.md` files, skipping `node_modules`, `.git`, and hidden directories. Use `fs.readdirSync` with `{ withFileTypes: true }` and recursion (no external deps). Cross-reference with `getFilesWithComments()` for comment counts.

### Image serving

Only serve images that live under `projectDir`. Use the same `safePath` guard. Set `Content-Type` from extension mapping (`.png` → `image/png`, `.jpg`/`.jpeg` → `image/jpeg`, `.gif` → `image/gif`, `.svg` → `image/svg+xml`, `.webp` → `image/webp`). Stream via `fs.createReadStream().pipe(res)`.

### Error handling pattern

Follow existing convention from `api-handler.ts`:
- Parse errors → `sendError(res, 400, 'Invalid JSON')`
- Not found → `sendError(res, 404, 'File not found: ...')`
- Path traversal → `sendError(res, 400, 'Invalid path')`
- Internal errors → caught by router's `Promise.resolve(...).catch(() => send500(res))` wrapper

## Files touched

| File | Action |
|------|--------|
| `packages/coc/src/server/review-handler.ts` | **Create** — `registerReviewRoutes` + helpers |
| `packages/coc/src/server/index.ts` | **Edit** — import + call `registerReviewRoutes`, add re-export |
| `packages/coc/src/server/types.ts` | **Edit** — add `projectDir` to `ExecutionServerOptions` |

## Estimated size

~250–300 lines for `review-handler.ts`, ~5 lines in `index.ts`, ~3 lines in `types.ts`.

## Testing notes

- Unit tests in `packages/coc/test/review-handler.test.ts` using Vitest
- Create temp directory with sample `.md` files and a pre-seeded `.vscode/md-comments.json`
- Test each route: happy path, 404 for missing file/comment, 400 for bad JSON / path traversal
- Test image serving with a sample `.png` under the temp dir
- Test resolve-all and delete-all bulk operations
- Verify comment count in file listing response
