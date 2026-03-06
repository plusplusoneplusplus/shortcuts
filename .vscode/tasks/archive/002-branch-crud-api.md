---
status: pending
commit: 2 of 5
title: "Branch CRUD API endpoints + tests"
depends_on: "001-branch-listing-status-api"
---

# Branch CRUD API Endpoints + Tests

## Motivation

Adds mutation endpoints for creating, switching, deleting, and renaming branches. These are the core branch management operations that the dashboard UI will consume. Separated from listing (commit 1) because mutations are higher-risk and deserve focused review.

## Assumed Prior State

- `BranchService` is instantiated in `registerApiRoutes` (from commit 1) and accessible as a local variable `branchService`.
- Branch listing endpoints (`GET /api/workspaces/:id/git/branches`) exist.
- `GitOperationResult = { success: boolean, error?: string }` is exported from `@plusplusoneplusplus/pipeline-core/git`.

## Files to Modify

### `packages/coc-server/src/api-handler.ts`

Add four route handlers after the existing branch-listing routes. Pattern: same workspace resolution guard used by the commit/listing routes (look up workspace by id, 404 if missing, read `ws.rootPath`).

#### Body / query parsing conventions (from existing handlers)

- POST body: `await parseBody(req)` inside a `try/catch` that calls `handleAPIError(res, invalidJSON())` on failure.
- Validation: call `handleAPIError(res, missingFields([...]))` for missing required fields (returns 400).
- Query params: `url.parse(req.url!, true).query` for DELETE's `force` flag.
- Success: `sendJSON(res, 200, result)` where `result` is the `GitOperationResult`.
- Git errors: `branchService` methods return `{ success: false, error }` on failure — always return 200 with the result object (mirrors how `switchBranch` etc. self-handle errors). Do **not** map `success: false` to a 4xx/5xx.

#### Route 1 — POST `/api/workspaces/:id/git/branches`

```
pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches$/
method: 'POST'
body: { name: string, checkout?: boolean }
```

- Validate `body.name` is a non-empty string → 400 if missing.
- `checkout` defaults to `false` when absent (`body.checkout ?? false`).
- Call: `const result = await branchService.createBranch(ws.rootPath, body.name, checkout)`
- Respond: `sendJSON(res, 200, result)`

**Note:** `createBranch` signature defaults `checkout` to `true` internally, so pass the resolved value explicitly to honour the API contract (default `false` at the HTTP layer).

#### Route 2 — POST `/api/workspaces/:id/git/branches/switch`

```
pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/switch$/
method: 'POST'
body: { name: string, force?: boolean }
```

- Validate `body.name` → 400 if missing.
- Call: `const result = await branchService.switchBranch(ws.rootPath, body.name, { force: body.force ?? false })`
- Respond: `sendJSON(res, 200, result)`

**Important:** Register this route **before** the DELETE route whose regex also matches `/branches/...`, and before any wildcard branch-name pattern.

#### Route 3 — DELETE `/api/workspaces/:id/git/branches/:name`

```
pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/(.+)$/
method: 'DELETE'
```

- `match![1]` = workspace id (decoded via `decodeURIComponent`).
- `match![2]` = branch name — use `.+` (not `[^/]+`) to capture names containing slashes (e.g., `feature/foo`). Decode with `decodeURIComponent`.
- `force` from query: `url.parse(req.url!, true).query.force === 'true'`.
- Call: `const result = await branchService.deleteBranch(ws.rootPath, branchName, force)`
- Respond: `sendJSON(res, 200, result)`

#### Route 4 — POST `/api/workspaces/:id/git/branches/rename`

```
pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/rename$/
method: 'POST'
body: { oldName: string, newName: string }
```

- Validate both `body.oldName` and `body.newName` are present → 400 if either is missing.
- Call: `const result = await branchService.renameBranch(ws.rootPath, body.oldName, body.newName)`
- Respond: `sendJSON(res, 200, result)`

#### Route registration order

To prevent the `.+` DELETE pattern from swallowing the `/switch` and `/rename` paths, register in this order:

1. `POST .../git/branches` (exact)
2. `POST .../git/branches/switch` (exact)
3. `POST .../git/branches/rename` (exact)
4. `DELETE .../git/branches/:name` (wildcard `.+`)

### `packages/coc-server/test/git-branches-api.test.ts` (modify — created in commit 1)

Extend the existing test file from commit 1. Use the same mock strategy (mocking `BranchService` at the module level via `vi.mock`). Add a new `describe('Branch CRUD', () => { ... })` block with the tests below.

- Use the same `vi.mock('@plusplusoneplusplus/pipeline-core/git', ...)` from commit 1, adding mocks for `createBranch`, `switchBranch`, `deleteBranch`, `renameBranch` methods.
- `beforeEach`: reset all mocks.

```typescript
// Mock setup needed (mutation methods use execAsync)
const mockExecAsync = vi.fn();
vi.mock('@plusplusoneplusplus/pipeline-core/utils/exec-utils', () => ({
    execAsync: (...args: any[]) => mockExecAsync(...args),
}));
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
    execSync: (...args: any[]) => mockExecSync(...args),
}));
```

Default mock value for `mockExecAsync`: resolve with `{ stdout: '', stderr: '' }`.

#### Test cases

**`POST /api/workspaces/:id/git/branches` — createBranch**

| # | Description | Setup | Expected |
|---|-------------|-------|----------|
| 1 | Valid name, no checkout | `mockExecAsync` resolves `{ stdout: '' }` | 200, `{ success: true }` |
| 2 | Missing name | — | 400 |
| 3 | Empty string name | body `{ name: '' }` | 400 |
| 4 | checkout=true passed | `mockExecAsync` resolves | 200, assert `mockExecAsync` called with cmd containing `-b` |
| 5 | checkout=false (default) | — | assert `mockExecAsync` called with `git branch "..."` (no `-b`) |
| 6 | Git failure | `mockExecAsync` rejects | 200, `{ success: false, error: <msg> }` |

**`POST /api/workspaces/:id/git/branches/switch` — switchBranch**

| # | Description | Expected |
|---|-------------|----------|
| 7 | Valid name | 200, `{ success: true }` |
| 8 | Missing name | 400 |
| 9 | force=true passed | assert cmd contains `-f` |
| 10 | Git failure | 200, `{ success: false, error: <msg> }` |

**`DELETE /api/workspaces/:id/git/branches/:name` — deleteBranch**

| # | Description | Expected |
|---|-------------|----------|
| 11 | Valid branch name | 200, `{ success: true }` |
| 12 | force=true query param | assert cmd contains `-D` |
| 13 | force absent | assert cmd contains `-d` (not `-D`) |
| 14 | Branch name with slash (`feature/foo`) | `decodeURIComponent('feature%2Ffoo')` decoded correctly; assert branchName passed to git |
| 15 | Unknown workspace | 404 |
| 16 | Git failure | 200, `{ success: false, error: <msg> }` |

**`POST /api/workspaces/:id/git/branches/rename` — renameBranch**

| # | Description | Expected |
|---|-------------|----------|
| 17 | Valid oldName + newName | 200, `{ success: true }` |
| 18 | Missing oldName | 400 |
| 19 | Missing newName | 400 |
| 20 | Git failure | 200, `{ success: false, error: <msg> }` |

## BranchService Method Signatures (verified)

```typescript
// branch-service.ts (packages/pipeline-core/src/git/branch-service.ts)

async createBranch(
    repoRoot: string,
    branchName: string,
    checkout: boolean = true       // NOTE: internal default is true; pass explicitly from handler
): Promise<GitOperationResult>

async switchBranch(
    repoRoot: string,
    branchName: string,
    options?: { create?: boolean; force?: boolean }
): Promise<GitOperationResult>

async deleteBranch(
    repoRoot: string,
    branchName: string,
    force: boolean = false
): Promise<GitOperationResult>

async renameBranch(
    repoRoot: string,
    oldName: string,
    newName: string
): Promise<GitOperationResult>
```

## Error Handling Summary

| Condition | HTTP status | Response body |
|-----------|------------|---------------|
| Invalid JSON body | 400 | `{ error: 'Invalid JSON' }` (via `invalidJSON()`) |
| Required field missing | 400 | `{ error: '...' }` (via `missingFields(...)`) |
| Unknown workspace id | 404 | `{ error: 'Workspace not found' }` |
| Git operation fails | 200 | `{ success: false, error: '<git error message>' }` |
| Git operation succeeds | 200 | `{ success: true }` |

## Acceptance Criteria

- [x] `POST /api/workspaces/:id/git/branches` creates a new branch
- [x] `POST /api/workspaces/:id/git/branches/switch` switches to a branch
- [x] `DELETE /api/workspaces/:id/git/branches/:name` deletes a branch (supports slash-containing names)
- [x] `POST /api/workspaces/:id/git/branches/rename` renames a branch
- [x] Input validation: missing required fields return 400
- [x] `force` flag plumbed correctly for switch and delete
- [x] `checkout` flag plumbed correctly for create (HTTP default: `false`)
- [x] `GitOperationResult` returned correctly for both success and failure cases
- [x] All 20 test cases pass
- [x] `npm run test:run` in `packages/coc-server` passes
