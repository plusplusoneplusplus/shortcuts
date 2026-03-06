---
status: pending
---

# 002: API Routes for Repo Tree & Blob

## Summary

Register REST endpoints that expose `RepoTreeService` over HTTP, following the same `registerXxxRoutes(routes, ...)` pattern used by `registerMemoryRoutes` and `registerApiRoutes`. This commit adds no new business logic — it is purely the HTTP wiring layer.

## Motivation

Commit 001 creates `RepoTreeService` with `listRepos`, `listDirectory`, and `readBlob` methods, but those are only callable in-process. A separate HTTP routing commit keeps the transport layer decoupled from the core filesystem logic, making both independently testable and following the existing coc-server convention where route registration functions (`registerMemoryRoutes`, `registerApiRoutes`, `registerSkillRoutes`) live in their own files and are composed in the top-level server setup.

## Changes

### Files to Create

- **`packages/coc-server/src/repos/repo-routes.ts`**

  Exports a single function:

  ```ts
  export function registerRepoRoutes(routes: Route[], dataDir: string): void
  ```

  Pushes the following routes onto the `routes` array:

  | Method | Pattern | Handler |
  |--------|---------|---------|
  | `GET` | `'/api/repos'` (string literal) | Instantiate `RepoTreeService(dataDir)`, call `listRepos()`, respond with `sendJson(res, repos)` |
  | `GET` | `/^\/api\/repos\/([^/]+)\/tree$/` (regex, captures `:repoId`) | Parse `?path=` and `?showIgnored=` from `url.parse(req.url, true).query`. Decode `repoId` via `decodeURIComponent(match![1])`. Call `resolveRepo(repoId)` — if `undefined`, `send404(res, 'Unknown repo: ...')`. Validate `path` is a string, default to `'.'`, reject paths containing `..` with `send400(res, 'Invalid path: directory traversal not allowed')`. Call `listDirectory(repoId, path)` which returns `TreeListResult { entries, truncated }`, respond with `sendJson(res, result)`. Catch errors and call `send500`. |
  | `GET` | `/^\/api\/repos\/([^/]+)\/blob$/` (regex, captures `:repoId`) | Same param parsing for `?path=`. Decode repoId. Resolve repo — `send404` if missing. Require `path` query param — `send400` if absent. Reject `..` traversal. Call `readBlob(repoId, path)`. On success: if `encoding === 'utf-8'`, set `Content-Type` to the returned `mimeType` and write the string body; if `encoding === 'base64'`, set `Content-Type` to `mimeType`, write the decoded `Buffer`. On "file not found" errors, `send404`; on other errors, `send500`. |

  Import style matches `memory-routes.ts`:
  ```ts
  import * as url from 'url';
  import type { Route } from '../shared/router';
  import { sendJson, send400, send404, send500 } from '../shared/router';
  import { RepoTreeService } from './tree-service';
  ```

  A shared `parseRepoRequest` helper inside the file extracts and validates `repoId` + `path` from the request to avoid duplication between the tree and blob handlers.

- **`packages/coc-server/test/repo-routes.test.ts`**

  Unit tests (see Tests section below).

### Files to Modify

- **`packages/coc-server/src/index.ts`**

  Add public export:
  ```ts
  export { registerRepoRoutes } from './repos/repo-routes';
  ```

  This follows the pattern of `export { registerMemoryRoutes } from './memory/memory-routes'` (line 155) and `export { registerSkillRoutes } from './skill-handler'` (line 152).

- **`packages/coc/src/server/index.ts`** (around line 219–246)

  Import `registerRepoRoutes` from `@plusplusoneplusplus/coc-server` and call it alongside the other route registrations:
  ```ts
  registerRepoRoutes(routes, dataDir);
  ```

  Placed after `registerApiRoutes(routes, store, bridge, dataDir)` and before `registerMemoryRoutes(...)`, consistent with the existing registration order (core → domain-specific).

### Files to Delete

- (none)

## Implementation Notes

### Endpoint Paths & Regex Patterns

Following the coc-server convention (see `memory-routes.ts` lines 131–132 for regex with `([^/]+)` capture group):

```
GET  /api/repos                          — string literal pattern
GET  /api/repos/:repoId/tree             — /^\/api\/repos\/([^/]+)\/tree$/
GET  /api/repos/:repoId/blob             — /^\/api\/repos\/([^/]+)\/blob$/
```

The `[^/]+` capture group matches any URL-safe repo ID (which may be URL-encoded). Handlers decode the capture via `decodeURIComponent(match![1])`, matching the pattern at `memory-routes.ts` line 135.

### Query Parameter Parsing

Use `url.parse(req.url ?? '', true).query` (same as `memory-routes.ts` line 80):

| Param | Type | Default | Validation |
|-------|------|---------|------------|
| `path` | `string` | `'.'` (tree) / required (blob) | Reject if contains `..` segment |
| `showIgnored` | `string` | `undefined` (= false) | Truthy if `=== 'true'` |

### Error Handling

| Condition | Response |
|-----------|----------|
| Unknown `repoId` (resolveRepo returns undefined) | `send404(res, 'Unknown repo: <repoId>')` |
| Missing `path` on blob endpoint | `send400(res, 'Missing required query parameter: path')` |
| Path contains `..` | `send400(res, 'Invalid path: directory traversal not allowed')` |
| `listDirectory` / `readBlob` throws (e.g. ENOENT) | `send404(res, 'Path not found: <path>')` for ENOENT; `send500(res, err.message)` otherwise |
| Unexpected error | `send500(res, err instanceof Error ? err.message : String(err))` (matches `memory-routes.ts` pattern, line 89) |

### Content-Type for Blob Responses

The `readBlob` return value includes a `mimeType` field. Use it directly:

- UTF-8 text: `res.writeHead(200, { 'Content-Type': mimeType })` then `res.end(content)`
- Base64 binary: `res.writeHead(200, { 'Content-Type': mimeType, 'Content-Length': buf.length })` then `res.end(buf)` where `buf = Buffer.from(content, 'base64')`

Do not use `sendJson` for blob — this is a raw content endpoint.

### Service Instantiation

Create `RepoTreeService(dataDir)` per-request inside each handler (same pattern as `FileMemoryStore` instantiation in `memory-routes.ts` lines 78–79, 111–112). This keeps the route registration function stateless and avoids shared mutable state.

## Tests

**File:** `packages/coc-server/test/repo-routes.test.ts`

Follow the in-process HTTP server pattern from `memory-routes.test.ts` (create server with `createRouter`, bind to port 0, use `fetch`):

```ts
function makeServer(dataDir: string): http.Server {
    const routes: Route[] = [];
    registerRepoRoutes(routes, dataDir);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}
```

### Test Cases

1. **`GET /api/repos` — returns repo list**
   - Seed a `workspaces.json` in `tmpDir` with one entry pointing to a temp git repo (run `git init` in beforeEach).
   - Assert 200, body is an array with one `RepoInfo` object containing `id`, `name`, `localPath`, `headSha`.

2. **`GET /api/repos` — empty when no workspaces**
   - No `workspaces.json`. Assert 200, body is `[]`.

3. **`GET /api/repos/:repoId/tree` — lists root directory**
   - Seed a temp repo with `README.md` and `src/` directory.
   - Assert 200, body has `entries` array with dirs-first sorting, correct `name`/`type` fields.

4. **`GET /api/repos/:repoId/tree?path=src` — lists subdirectory**
   - Assert 200, body lists contents of `src/`.

5. **`GET /api/repos/:repoId/tree` — 404 for unknown repo**
   - Request with non-existent repoId. Assert 404, body has `error` field.

6. **`GET /api/repos/:repoId/tree?path=../../etc` — 400 for traversal**
   - Assert 400, body has `error` mentioning "directory traversal".

7. **`GET /api/repos/:repoId/blob?path=README.md` — returns file content**
   - Seed repo with a known README.md. Assert 200, response body matches file content, `Content-Type` is `text/markdown; charset=utf-8` or similar.

8. **`GET /api/repos/:repoId/blob` — 400 when path is missing**
   - Assert 400, body has `error` mentioning "path".

9. **`GET /api/repos/:repoId/blob?path=nonexistent.txt` — 404 for missing file**
   - Assert 404.

10. **`GET /api/repos/:repoId/blob?path=../outside` — 400 for traversal**
    - Assert 400.

## Acceptance Criteria

- [ ] `GET /api/repos` returns JSON array of repos discovered from `workspaces.json`
- [ ] `GET /api/repos/:repoId/tree` returns `{ entries: TreeEntry[] }` with dirs-first sort
- [ ] `GET /api/repos/:repoId/tree?path=<sub>` resolves subdirectories correctly
- [ ] `GET /api/repos/:repoId/tree?showIgnored=true` passes through to service layer
- [ ] `GET /api/repos/:repoId/blob?path=<file>` returns raw content with correct `Content-Type`
- [ ] Base64-encoded binary blobs return the decoded `Buffer` (not JSON-wrapped)
- [ ] Unknown `repoId` returns 404 JSON error
- [ ] Missing `path` on blob returns 400 JSON error
- [ ] Path traversal (`..`) returns 400 JSON error
- [ ] `registerRepoRoutes` is exported from `packages/coc-server/src/index.ts`
- [ ] `registerRepoRoutes` is called in `packages/coc/src/server/index.ts`
- [ ] All 10 test cases pass (`npm run test:run` in `packages/coc-server`)
- [ ] No changes to `RepoTreeService` or `types.ts` (those belong to commit 001)

## Dependencies

- Depends on: 001 (provides `RepoTreeService`, `RepoInfo`, `TreeEntry` in `packages/coc-server/src/repos/`)

## Assumed Prior State

Commit 001 has already landed, providing:

- **`packages/coc-server/src/repos/types.ts`** — `RepoInfo { id, name, localPath, headSha, clonedAt, remoteUrl? }`, `TreeEntry { name, type: 'file'|'dir', size?, path }`, `TreeListResult { entries, truncated }`
- **`packages/coc-server/src/repos/tree-service.ts`** — `RepoTreeService` class with:
  - `constructor(dataDir: string, options?: RepoTreeServiceOptions)` — reads workspaces from `dataDir/workspaces.json`
  - `listRepos(): Promise<RepoInfo[]>` — returns all known repos with resolved `headSha`
  - `resolveRepo(repoId: string): RepoInfo | undefined` — lookup by ID
  - `listDirectory(repoId: string, relativePath: string): Promise<TreeListResult>` — dirs-first sort, 5000-entry guard, .gitignore filtering
  - `readBlob(repoId: string, relativePath: string): Promise<{ content: string, encoding: 'utf-8' | 'base64', mimeType: string }>` — reads file content with MIME detection
- **`packages/coc-server/src/repos/index.ts`** — barrel re-exports
- **`packages/coc-server/src/index.ts`** — has `export * from './repos'`
