---
status: done
---

# 001: Add Git History & Diff API Endpoints

## Summary

Add 7 REST endpoints to `coc-server` for commit history, diffs, and file content. These are thin wrappers over `GitLogService` from `pipeline-core`, which already implements all the git plumbing.

## Motivation

The CoC dashboard needs backend endpoints to display commit history and diffs. `GitLogService` already provides the full implementation — this commit adds the HTTP routing layer only, keeping the server's existing patterns for route registration, workspace validation, and error handling.

## Changes

### Files to Create

- `packages/coc-server/test/api-handler-git.test.ts` — Integration tests for all 7 git endpoints using the existing test patterns (real HTTP server + mock store).

### Files to Modify

- `packages/coc-server/src/api-handler.ts` — Import `GitLogService`, create a lazy singleton, add 7 route handlers inside `registerApiRoutes()`.

## Implementation Notes

### Import & Singleton

Add to the import block at the top of `api-handler.ts`:

```typescript
import { GitLogService } from '@plusplusoneplusplus/pipeline-core';
```

Create a lazily-initialized singleton inside `registerApiRoutes()` (not module-level, to avoid import side-effects):

```typescript
export function registerApiRoutes(routes: Route[], store: ProcessStore, bridge?: QueueExecutorBridge): void {
    let gitLogService: GitLogService | undefined;
    function getGitLogService(): GitLogService {
        if (!gitLogService) {
            gitLogService = new GitLogService();
        }
        return gitLogService;
    }
    // ... existing routes ...
```

`GitLogService` has a no-arg constructor and all public methods are **synchronous** (no Promises), so handlers can call them directly without `await`.

### Route Patterns

All 7 routes follow the existing convention: regex pattern, `decodeURIComponent(match![N])` for path params, workspace lookup via `store.getWorkspaces()`, `sendJSON` for responses, `handleAPIError` for errors.

#### Route 1: List commits

```
GET /api/workspaces/:id/git/commits?limit=20&skip=0
```

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits$/,
    handler: async (req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) return handleAPIError(res, notFound('Workspace'));

        const params = new URL(req.url!, `http://${req.headers.host}`).searchParams;
        const limit = Math.min(Math.max(parseInt(params.get('limit') || '20', 10) || 20, 1), 200);
        const skip = Math.max(parseInt(params.get('skip') || '0', 10) || 0, 0);

        try {
            const result = getGitLogService().getCommits(ws.rootPath, { maxCount: limit, skip });
            sendJSON(res, 200, result); // { commits: GitCommit[], hasMore: boolean }
        } catch (err) {
            sendJSON(res, 200, { commits: [], hasMore: false, error: 'Not a git repository' });
        }
    },
});
```

**Query params:** Parse `limit` and `skip` from URL search params. Clamp `limit` to [1, 200] and `skip` to >= 0. Use `URL` constructor (already available via Node.js built-in) rather than `parseQueryParams` since that function returns a `ProcessFilter` shape not suitable here.

**Error strategy:** Non-git repos return `200` with empty commits and an `error` field (not 500), matching the pattern from the existing `git-info` endpoint which returns `{ isGitRepo: false }` rather than erroring.

#### Route 2: Get single commit

```
GET /api/workspaces/:id/git/commits/:hash
```

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]+)$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const hash = match![2];
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) return handleAPIError(res, notFound('Workspace'));

        try {
            const commit = getGitLogService().getCommit(ws.rootPath, hash);
            if (!commit) return handleAPIError(res, notFound('Commit'));
            sendJSON(res, 200, commit);
        } catch (err) {
            handleAPIError(res, badRequest('Failed to read commit'));
        }
    },
});
```

**Hash param:** Regex `[a-f0-9]+` matches short or full SHA hashes. No `decodeURIComponent` needed since hex chars are URL-safe.

#### Route 3: Get commit files

```
GET /api/workspaces/:id/git/commits/:hash/files
```

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]+)\/files$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const hash = match![2];
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) return handleAPIError(res, notFound('Workspace'));

        try {
            const files = getGitLogService().getCommitFiles(ws.rootPath, hash);
            sendJSON(res, 200, { files });
        } catch (err) {
            handleAPIError(res, badRequest('Failed to read commit files'));
        }
    },
});
```

**Returns:** `{ files: GitCommitFile[] }` where each file has `{ path, originalPath?, status, commitHash, parentHash, repositoryRoot }`.

#### Route 4: Get full commit diff

```
GET /api/workspaces/:id/git/commits/:hash/diff
```

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]+)\/diff$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const hash = match![2];
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) return handleAPIError(res, notFound('Workspace'));

        try {
            const diff = getGitLogService().getCommitDiff(ws.rootPath, hash);
            sendJSON(res, 200, { diff });
        } catch (err) {
            handleAPIError(res, badRequest('Failed to read commit diff'));
        }
    },
});
```

**Returns:** `{ diff: string }` — the full unified diff output.

#### Route 5: Get per-file diff

```
GET /api/workspaces/:id/git/commits/:hash/files/*/diff
```

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]+)\/files\/(.+)\/diff$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const hash = match![2];
        const filePath = decodeURIComponent(match![3]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) return handleAPIError(res, notFound('Workspace'));

        try {
            const fullDiff = getGitLogService().getCommitDiff(ws.rootPath, hash);
            const fileDiff = extractFileDiff(fullDiff, filePath);
            sendJSON(res, 200, { diff: fileDiff, path: filePath, commitHash: hash });
        } catch (err) {
            handleAPIError(res, badRequest('Failed to read file diff'));
        }
    },
});
```

**File path strategy:** The regex `(.+)` captures everything after `/files/` and before `/diff`, including slashes in nested paths (e.g., `src%2Futils%2Fhelper.ts` or `src/utils/helper.ts`). Apply `decodeURIComponent` for encoded slashes.

**`extractFileDiff` helper** (add as a private function in `api-handler.ts`):

```typescript
function extractFileDiff(fullDiff: string, targetPath: string): string {
    const lines = fullDiff.split('\n');
    const chunks: string[] = [];
    let capturing = false;

    for (const line of lines) {
        if (line.startsWith('diff --git ')) {
            // Check if this diff section is for our target file
            // Format: "diff --git a/path b/path"
            capturing = line.includes(`a/${targetPath}`) || line.includes(`b/${targetPath}`);
        }
        if (capturing) {
            chunks.push(line);
        }
    }
    return chunks.join('\n');
}
```

**Alternative:** If `GitRangeService` has a per-file diff method, prefer that. But `getCommitDiff` + filter is simpler and avoids an additional import.

#### Route 6: Get file content at commit

```
GET /api/workspaces/:id/git/commits/:hash/files/*/content
```

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]+)\/files\/(.+)\/content$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const hash = match![2];
        const filePath = decodeURIComponent(match![3]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) return handleAPIError(res, notFound('Workspace'));

        try {
            const content = getGitLogService().getFileContentAtCommit(ws.rootPath, hash, filePath);
            if (content === undefined) return handleAPIError(res, notFound('File'));
            sendJSON(res, 200, { content, path: filePath, commitHash: hash });
        } catch (err) {
            handleAPIError(res, badRequest('Failed to read file content'));
        }
    },
});
```

**Returns:** `{ content: string, path: string, commitHash: string }` or 404 if file doesn't exist at that commit.

#### Route 7: Get working tree / staged diff (not consumed by UI yet — included for API completeness)

```
GET /api/workspaces/:id/git/diff?staged=false
```

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/diff$/,
    handler: async (req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) return handleAPIError(res, notFound('Workspace'));

        const params = new URL(req.url!, `http://${req.headers.host}`).searchParams;
        const staged = params.get('staged') === 'true';

        try {
            const svc = getGitLogService();
            const diff = staged
                ? svc.getStagedChangesDiff(ws.rootPath)
                : svc.getPendingChangesDiff(ws.rootPath);
            sendJSON(res, 200, { diff, staged });
        } catch (err) {
            sendJSON(res, 200, { diff: '', staged, error: 'Not a git repository' });
        }
    },
});
```

**Query param:** `staged=true` calls `getStagedChangesDiff()`; anything else (default) calls `getPendingChangesDiff()` which includes both staged and unstaged with section headers.

### Route Registration Order

Place all 7 routes **after** the existing `git-info` endpoint (around line ~316) and **before** other unrelated routes, grouped together with a comment block:

```typescript
// ── Git history & diff endpoints ──────────────────────────────────
```

**Important ordering note:** Routes 5 and 6 (`/files/*/diff` and `/files/*/content`) must be registered **before** Route 3 (`/files`) because the regex engine matches top-down and `/files$` won't conflict, but keeping them grouped logically (3 before 5, 6) is fine since Route 3's pattern ends with `\/files$` (exact match).

### Response Schemas Summary

| Endpoint | Success Shape | Error Shape |
|----------|--------------|-------------|
| List commits | `{ commits: GitCommit[], hasMore: boolean }` | `{ commits: [], hasMore: false, error: string }` |
| Single commit | `GitCommit` | 404 `{ error: 'Not found: Commit' }` |
| Commit files | `{ files: GitCommitFile[] }` | 400 `{ error: string }` |
| Commit diff | `{ diff: string }` | 400 `{ error: string }` |
| Per-file diff | `{ diff: string, path: string, commitHash: string }` | 400 `{ error: string }` |
| File content | `{ content: string, path: string, commitHash: string }` | 404 or 400 |
| Working diff | `{ diff: string, staged: boolean }` | `{ diff: '', staged: boolean, error: string }` |

### Workspace Validation

Every endpoint performs the same workspace lookup:

```typescript
const id = decodeURIComponent(match![1]);
const workspaces = await store.getWorkspaces();
const ws = workspaces.find(w => w.id === id);
if (!ws) return handleAPIError(res, notFound('Workspace'));
```

This is intentionally duplicated per-handler (not extracted) to match the existing codebase pattern where each route is self-contained.

### GitLogService Sync Methods

All `GitLogService` methods are **synchronous** (they call `execSync` internally). This means:
- No `await` needed when calling service methods
- Errors surface as thrown exceptions (caught by `try/catch`)
- Handlers are still `async` because `store.getWorkspaces()` is async

## Tests

Test file: `packages/coc-server/test/api-handler-git.test.ts`

Follow the exact pattern from `api-handler-images.test.ts`: real HTTP server + mock store + `request()` helper.

### Setup

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import type { Route } from '../src/types';
import { registerApiRoutes } from '../src/api-handler';
import { createRouter } from '../src/shared/router';
import { createMockProcessStore } from './helpers/mock-process-store';

// Mock GitLogService at module level
vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        GitLogService: vi.fn().mockImplementation(() => mockGitLogService),
    };
});

const mockGitLogService = {
    getCommits: vi.fn(),
    getCommit: vi.fn(),
    getCommitFiles: vi.fn(),
    getCommitDiff: vi.fn(),
    getPendingChangesDiff: vi.fn(),
    getStagedChangesDiff: vi.fn(),
    getFileContentAtCommit: vi.fn(),
};
```

### Mock Store with Workspace

```typescript
const store = createMockProcessStore();
// Patch getWorkspaces to return a test workspace
store.getWorkspaces = vi.fn(async () => [
    { id: 'ws-1', rootPath: '/test/repo', name: 'test-repo' } as any,
]);
```

### Test Cases

1. **`GET /api/workspaces/ws-1/git/commits` — returns commit list**
   - Mock `getCommits` → `{ commits: [fakeCommit], hasMore: true }`
   - Assert 200, correct shape, `maxCount: 20, skip: 0` defaults

2. **`GET /api/workspaces/ws-1/git/commits?limit=5&skip=10` — respects query params**
   - Assert `getCommits` called with `{ maxCount: 5, skip: 10 }`

3. **`GET /api/workspaces/ws-1/git/commits?limit=999` — clamps limit to 200**
   - Assert `getCommits` called with `{ maxCount: 200, skip: 0 }`

4. **`GET /api/workspaces/unknown/git/commits` — workspace not found → 404**
   - Assert 404 response

5. **`GET /api/workspaces/ws-1/git/commits` — non-git repo → graceful fallback**
   - Mock `getCommits` to throw
   - Assert 200 with `{ commits: [], hasMore: false, error: ... }`

6. **`GET /api/workspaces/ws-1/git/commits/abc123` — returns single commit**
   - Mock `getCommit` → fake commit object
   - Assert 200

7. **`GET /api/workspaces/ws-1/git/commits/abc123` — commit not found → 404**
   - Mock `getCommit` → `undefined`
   - Assert 404

8. **`GET /api/workspaces/ws-1/git/commits/abc123/files` — returns file list**
   - Mock `getCommitFiles` → `[{ path: 'src/foo.ts', status: 'modified', ... }]`
   - Assert 200, `{ files: [...] }`

9. **`GET /api/workspaces/ws-1/git/commits/abc123/diff` — returns unified diff**
   - Mock `getCommitDiff` → `'diff --git a/foo b/foo\n...'`
   - Assert 200, `{ diff: '...' }`

10. **`GET /api/workspaces/ws-1/git/commits/abc123/files/src%2Futils%2Fhelper.ts/diff` — per-file diff with encoded path**
    - Mock `getCommitDiff` → full diff with multiple file sections
    - Assert response contains only the matching file's diff section

11. **`GET /api/workspaces/ws-1/git/commits/abc123/files/README.md/content` — returns file content**
    - Mock `getFileContentAtCommit` → `'# Hello'`
    - Assert 200, `{ content: '# Hello', path: 'README.md', commitHash: 'abc123' }`

12. **`GET /api/workspaces/ws-1/git/commits/abc123/files/gone.txt/content` — file not found → 404**
    - Mock `getFileContentAtCommit` → `undefined`
    - Assert 404

13. **`GET /api/workspaces/ws-1/git/diff` — returns pending changes diff**
    - Mock `getPendingChangesDiff` → diff string
    - Assert 200, `{ diff: '...', staged: false }`

14. **`GET /api/workspaces/ws-1/git/diff?staged=true` — returns staged diff**
    - Mock `getStagedChangesDiff` → diff string
    - Assert `getStagedChangesDiff` was called (not `getPendingChangesDiff`)

## Acceptance Criteria

- [ ] `GitLogService` imported from `@plusplusoneplusplus/pipeline-core` (not deep import)
- [ ] Singleton is lazily created inside `registerApiRoutes`, not at module scope
- [ ] All 7 endpoints registered with correct HTTP method and regex pattern
- [ ] Every endpoint validates workspace exists → 404 if missing
- [ ] Non-git workspace errors return graceful responses (not 500)
- [ ] `limit` query param clamped to [1, 200], `skip` clamped to >= 0
- [ ] File path parameters support nested paths via `(.+)` capture + `decodeURIComponent`
- [ ] `extractFileDiff` helper correctly isolates a single file's diff from full output
- [ ] `staged=true` query param switches between staged and pending diffs
- [ ] All 14 test cases pass
- [ ] `npm run test:run` passes in `packages/coc-server/`
- [ ] No changes to `pipeline-core` (all functionality already exists)

## Dependencies

- Depends on: None

## Assumed Prior State

None — `GitLogService` and all its methods already exist in `pipeline-core` and are exported from the barrel file.
