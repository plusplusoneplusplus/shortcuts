---
status: done
---
---
status: done
---

# 001: Add Branch Range API Endpoints

## Summary

Add 4 REST endpoints under `/api/workspaces/:id/git/branch-range` that expose `GitRangeService` from `pipeline-core`, enabling feature-branch range detection, changed file listing, full range diff, and per-file diff retrieval.

## Motivation

The API layer must exist before any UI can be built. This commit adds the REST surface that the SPA dashboard (and future VS Code webview) will consume. It follows the exact route registration pattern already established by the `git-info`, `git/commits`, `git/commits/:hash/files`, and `git/commits/:hash/diff` endpoints in `api-handler.ts`.

## Changes

### Files to Create

- `packages/coc-server/test/git-branch-range-api.test.ts` — Vitest tests for all 4 endpoints mirroring the structure and patterns in `git-api.test.ts`.

### Files to Modify

- `packages/coc-server/src/api-handler.ts` — Add 4 new `routes.push()` blocks and a module-level lazy singleton for `GitRangeService`.

### Files to Delete

- (none)

## Implementation Notes

### Import additions (line ~17 area)

Add to the existing `@plusplusoneplusplus/pipeline-core` imports:

```typescript
import { GitRangeService } from '@plusplusoneplusplus/pipeline-core';
```

`GitRangeService` is exported from `packages/pipeline-core/src/git/index.ts` (line 37: `export { GitRangeService } from './git-range-service';`) and re-exported via the package's main barrel. Types `GitCommitRange` and `GitCommitRangeFile` are also exported from the same path but are only needed for documentation/typing — the service returns them directly.

### Lazy singleton for GitRangeService

Unlike the existing `execGitSync` (a stateless function), `GitRangeService` has a constructor that accepts `GitRangeConfig` and maintains internal caches. Create a module-level lazy singleton:

```typescript
let _gitRangeService: GitRangeService | undefined;
function getGitRangeService(): GitRangeService {
    if (!_gitRangeService) {
        _gitRangeService = new GitRangeService();
    }
    return _gitRangeService;
}
```

Place this right above or below the `execGitSync` function definition (around line 868–871). Using default config (`maxFiles: 100`, `showOnDefaultBranch: false`) is correct for the API.

### Route insertion location

Insert the 4 new routes **after** the existing `git/commits/:hash/diff` route (ends at line 432) and **before** the filesystem browse endpoint (line 434). This groups all git routes together.

### Route 1: `GET /api/workspaces/:id/git/branch-range`

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) {
            return handleAPIError(res, notFound('Workspace'));
        }

        try {
            const rangeService = getGitRangeService();
            const range = rangeService.detectCommitRange(ws.rootPath);
            if (!range) {
                return sendJSON(res, 200, { onDefaultBranch: true });
            }
            sendJSON(res, 200, range);
        } catch {
            sendJSON(res, 200, { onDefaultBranch: true });
        }
    },
});
```

**Key behavior:** `detectCommitRange()` returns `null` when on the default branch (0 commits ahead) or when no default remote branch is found. The API returns `{ onDefaultBranch: true }` in both cases, matching the existing pattern where `git-info` returns `{ isGitRepo: false }` on error rather than a 500.

### Route 2: `GET /api/workspaces/:id/git/branch-range/files`

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range\/files$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) {
            return handleAPIError(res, notFound('Workspace'));
        }

        try {
            const rangeService = getGitRangeService();
            const range = rangeService.detectCommitRange(ws.rootPath);
            if (!range) {
                return sendJSON(res, 200, { files: [] });
            }
            sendJSON(res, 200, { files: range.files });
        } catch {
            sendJSON(res, 200, { files: [] });
        }
    },
});
```

**Note:** Reuses `detectCommitRange()` which already computes files. The `GitCommitRangeFile` objects in `range.files` include `path`, `status`, `additions`, `deletions`, `oldPath`, and `repositoryRoot`.

### Route 3: `GET /api/workspaces/:id/git/branch-range/diff`

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range\/diff$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) {
            return handleAPIError(res, notFound('Workspace'));
        }

        try {
            const rangeService = getGitRangeService();
            const range = rangeService.detectCommitRange(ws.rootPath);
            if (!range) {
                return sendJSON(res, 200, { diff: '' });
            }
            const diff = rangeService.getRangeDiff(ws.rootPath, range.baseRef, 'HEAD');
            sendJSON(res, 200, { diff });
        } catch {
            sendJSON(res, 200, { diff: '' });
        }
    },
});
```

**Key detail:** First calls `detectCommitRange()` to get the `baseRef`, then calls `getRangeDiff(repoRoot, baseRef, 'HEAD')` for the actual diff content. The three-dot diff (`baseRef...HEAD`) is performed internally by `getRangeDiff`.

### Route 4: `GET /api/workspaces/:id/git/branch-range/files/*/diff`

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range\/files\/(.+)\/diff$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const filePath = decodeURIComponent(match![2]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) {
            return handleAPIError(res, notFound('Workspace'));
        }

        try {
            const rangeService = getGitRangeService();
            const range = rangeService.detectCommitRange(ws.rootPath);
            if (!range) {
                return sendJSON(res, 200, { diff: '', path: filePath });
            }
            const diff = rangeService.getFileDiff(ws.rootPath, range.baseRef, 'HEAD', filePath);
            sendJSON(res, 200, { diff, path: filePath });
        } catch {
            sendJSON(res, 200, { diff: '', path: filePath });
        }
    },
});
```

**Regex note:** The `(.+)` capture group greedily matches everything between `/files/` and the trailing `/diff`, which correctly handles file paths with slashes (e.g., `src/utils/helper.ts`). The `decodeURIComponent` handles URL-encoded path separators.

### Error handling pattern

All 4 routes follow the existing graceful-degradation pattern:
- **Unknown workspace** → `404` via `handleAPIError(res, notFound('Workspace'))`
- **Non-git repo / git errors** → `200` with fallback response (not 500), matching `git-info` and `git/commits` behavior
- **On default branch (no range)** → `200` with appropriate empty/sentinel response

### Route ordering concern

The per-file diff route (`/files/(.+)/diff`) must be registered **after** the files list route (`/files$`) to prevent the regex from matching first. Since the files route uses `$` anchor and the per-file route has the `/diff$` suffix, there's no actual conflict — but keeping them in logical order improves readability.

## Tests

Test file: `packages/coc-server/test/git-branch-range-api.test.ts`

Follow the exact pattern from `git-api.test.ts`:
- Mock `child_process.execSync` via `vi.mock`
- Create mock process store with `createMockProcessStore()`
- Register routes via `registerApiRoutes()`, create HTTP server, bind to random port
- Use the same `request()` helper function

### Test scenarios for each endpoint:

**`GET /api/workspaces/:id/git/branch-range`**
1. Returns `GitCommitRange` when on a feature branch (mock: `rev-parse --abbrev-ref HEAD` → `feature/foo`, `rev-parse --verify origin/main` → success, `merge-base` → hash, `rev-list --count` → `3`, `diff --numstat` → file stats, `diff --name-status` → file statuses, `diff --shortstat` → `3 files changed, 10 insertions(+), 2 deletions(-)`)
2. Returns `{ onDefaultBranch: true }` when `rev-list --count` returns `0` (on default branch, no commits ahead)
3. Returns `{ onDefaultBranch: true }` on git error (non-git repo — `execSync` throws)
4. Returns 404 for unknown workspace
5. Returns `{ onDefaultBranch: true }` when no default remote branch found (all `rev-parse --verify` calls throw)

**`GET /api/workspaces/:id/git/branch-range/files`**
1. Returns file list when on feature branch
2. Returns `{ files: [] }` when on default branch
3. Returns `{ files: [] }` on git error
4. Returns 404 for unknown workspace

**`GET /api/workspaces/:id/git/branch-range/diff`**
1. Returns diff string when on feature branch
2. Returns `{ diff: '' }` when on default branch
3. Returns `{ diff: '' }` on git error
4. Returns 404 for unknown workspace

**`GET /api/workspaces/:id/git/branch-range/files/*/diff`**
1. Returns per-file diff when on feature branch
2. Returns `{ diff: '', path }` when on default branch
3. Returns `{ diff: '', path }` on git error
4. Returns 404 for unknown workspace
5. Handles file paths with slashes (e.g., `src/utils/helper.ts`)
6. Handles URL-encoded file paths

### Mock strategy

The mock for `child_process.execSync` needs to handle multiple git commands that `GitRangeService` calls internally:
- `git rev-parse --abbrev-ref HEAD` — current branch name
- `git rev-parse --verify origin/main` — default branch detection
- `git merge-base HEAD origin/main` — merge base
- `git rev-list --count origin/main..HEAD` — commits ahead
- `git diff --numstat origin/main...HEAD` — per-file stats
- `git diff --name-status -M -C origin/main...HEAD` — file statuses
- `git diff --shortstat origin/main...HEAD` — summary stats
- `git diff origin/main...HEAD` — full range diff
- `git diff origin/main...HEAD -- <path>` — per-file diff

Use `mockExecSync.mockImplementation((cmd: string) => { ... })` with `cmd.includes()` checks, same pattern as `git-api.test.ts`.

**Important:** Unlike the existing git/commits tests which mock `execGitSync` (a shell-out via `childProcess.execSync`), the `GitRangeService` uses its own `execGit()` from `pipeline-core/src/git/exec.ts`. That function also uses `childProcess.execSync`, so the same `vi.mock('child_process')` approach works. However, verify that the import resolution in the test correctly intercepts the calls — the mock must catch `execSync` calls from **both** `api-handler.ts` and the `pipeline-core` git exec module.

If the cross-package mock doesn't work cleanly, an alternative is to mock `@plusplusoneplusplus/pipeline-core` partially and provide a mock `GitRangeService` class directly. This is actually cleaner for unit tests:

```typescript
const mockDetectCommitRange = vi.fn();
const mockGetRangeDiff = vi.fn();
const mockGetFileDiff = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        GitRangeService: vi.fn().mockImplementation(() => ({
            detectCommitRange: mockDetectCommitRange,
            getRangeDiff: mockGetRangeDiff,
            getFileDiff: mockGetFileDiff,
        })),
    };
});
```

This approach isolates the API layer tests from `GitRangeService` internals (which have their own tests in `pipeline-core`).

## Acceptance Criteria

- [x] All 4 endpoints return correct responses for feature branches with commits ahead
- [x] All 4 endpoints gracefully handle being on the default branch (no 500s)
- [x] All 4 endpoints gracefully handle non-git repos (no 500s)
- [x] All 4 endpoints return 404 for unknown workspace IDs
- [x] Per-file diff endpoint correctly handles paths with slashes and URL-encoded characters
- [x] `GitRangeService` is lazily instantiated as a singleton (not created per-request)
- [x] Import of `GitRangeService` from `@plusplusoneplusplus/pipeline-core` compiles correctly
- [x] All new tests pass: `cd packages/coc-server && npx vitest run test/git-branch-range-api.test.ts`
- [x] Existing tests still pass: `cd packages/coc-server && npx vitest run test/git-api.test.ts`
- [x] `npm run build` succeeds with no type errors

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit. `GitRangeService` and all types already exist in `pipeline-core` and are fully exported.
