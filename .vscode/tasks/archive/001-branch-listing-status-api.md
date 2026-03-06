---
status: done
commit: 1 of 5
feature: Branch Management
title: "Branch listing & status API endpoints + tests"
---

# Branch listing & status API endpoints + tests

## Motivation

This is the foundation commit that wires `BranchService` from `pipeline-core` into `coc-server` and exposes read-only HTTP endpoints for listing branches and querying branch status. All subsequent commits (CRUD operations, remote ops, UI) depend on these endpoints being present and stable.

## Dependencies

None — this is the first commit.

## Assumed Prior State

- `BranchService` already exists at `packages/pipeline-core/src/git/branch-service.ts` with the full set of methods.
- `coc-server` already handles workspaces and git (commits, git-info) via `api-handler.ts`.

---

## Files to Modify

### `packages/coc-server/src/api-handler.ts`

**1. Add import at the top** (alongside existing pipeline-core git imports):

```typescript
import { BranchService } from '@plusplusoneplusplus/pipeline-core/git';
```

**2. Inside `registerApiRoutes()`**, instantiate a singleton before the route registrations:

```typescript
const branchService = new BranchService();
```

**3. Add route: `GET /api/workspaces/:id/git/branches`**

Pattern: `/^\/api\/workspaces\/([^/]+)\/git\/branches$/`

Query params:
| Param    | Type                        | Default | Notes                        |
|----------|-----------------------------|---------|------------------------------|
| `type`   | `"local" \| "remote" \| "all"` | `"all"` | Which branches to return     |
| `limit`  | number                      | `100`   | Page size                    |
| `offset` | number                      | `0`     | Page offset                  |
| `search` | string (optional)           | —       | Passed as `searchPattern`    |

Resolution pattern (mirrors existing git handlers):
```typescript
const workspaceId = match[1];
const workspace = store.getWorkspaces().find(w => w.id === workspaceId);
if (!workspace) { sendJSON(res, 404, { error: 'Workspace not found' }); return; }
const repoRoot = workspace.rootPath;
```

Logic:
```typescript
const parsed = url.parse(req.url!, true).query;
const type   = (parsed.type as string) || 'all';
const limit  = Math.min(parseInt(parsed.limit as string) || 100, 500);
const offset = parseInt(parsed.offset as string) || 0;
const searchPattern = (parsed.search as string) || undefined;
const options = { limit, offset, searchPattern };

let result: { local?: PaginatedBranchResult; remote?: PaginatedBranchResult };
if (type === 'local') {
    result = { local: branchService.getLocalBranchesPaginated(repoRoot, options) };
} else if (type === 'remote') {
    result = { remote: branchService.getRemoteBranchesPaginated(repoRoot, options) };
} else {
    result = {
        local:  branchService.getLocalBranchesPaginated(repoRoot, options),
        remote: branchService.getRemoteBranchesPaginated(repoRoot, options),
    };
}
sendJSON(res, 200, result);
```

Wrap in try/catch → `handleAPIError(res, error)`.

**4. Add route: `GET /api/workspaces/:id/git/branch-status`**

Pattern: `/^\/api\/workspaces\/([^/]+)\/git\/branch-status$/`

Logic:
```typescript
const workspaceId = match[1];
const workspace = store.getWorkspaces().find(w => w.id === workspaceId);
if (!workspace) { sendJSON(res, 404, { error: 'Workspace not found' }); return; }
const repoRoot = workspace.rootPath;

const uncommitted = branchService.hasUncommittedChanges(repoRoot);
const status = branchService.getBranchStatus(repoRoot, uncommitted);
sendJSON(res, 200, status);
```

Wrap in try/catch → `handleAPIError(res, error)`.

---

## Files to Create

### `packages/coc-server/test/git-branches-api.test.ts`

Integration tests using the same pattern as `git-api.test.ts`.

**Server setup** (beforeEach / afterEach):
```typescript
vi.mock('@plusplusoneplusplus/pipeline-core/git', () => ({
    BranchService: vi.fn().mockImplementation(() => ({
        getLocalBranchesPaginated:  mockGetLocalBranchesPaginated,
        getRemoteBranchesPaginated: mockGetRemoteBranchesPaginated,
        getBranchStatus:            mockGetBranchStatus,
        hasUncommittedChanges:      mockHasUncommittedChanges,
    })),
}));
```

Spin up real HTTP server on port 0:
```typescript
const store = createMockProcessStore();
const routes: Route[] = [];
registerApiRoutes(routes, store);
const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
server = http.createServer(handleRequest);
await new Promise(resolve => server.listen(0, resolve));
const port = (server.address() as net.AddressInfo).port;
```

**Test cases:**

| # | Name | Setup | Assert |
|---|------|-------|--------|
| 1 | List local branches | mock returns `PaginatedBranchResult` | `type=local` → response has `local`, no `remote` |
| 2 | List remote branches | mock returns remote result | `type=remote` → response has `remote`, no `local` |
| 3 | List all branches (default) | both mocks return results | response has both `local` and `remote` |
| 4 | Pagination params forwarded | spy on mock | verify `limit` and `offset` passed to service |
| 5 | Search param forwarded | spy on mock | verify `searchPattern` passed to service |
| 6 | Branch status | mock returns `BranchStatus` | verify full `BranchStatus` shape in response |
| 7 | Workspace not found | store has no matching id | `404` with `{ error: 'Workspace not found' }` |
| 8 | Git error on branches | mock throws `Error('not a git repo')` | `500` with error message |
| 9 | Git error on branch-status | mock throws | `500` with error message |

---

## Implementation Notes

### Workspace resolution
The existing pattern in `api-handler.ts` uses `store.getWorkspaces()` to find a workspace by id, then uses `workspace.rootPath` as the git working directory. Confirm this matches how `git-info` and `git/commits` resolve their directories before implementing.

### BranchService constructor
`new BranchService()` takes no arguments.

### Key method signatures (from `branch-service.ts`)
```typescript
getLocalBranchesPaginated(
    repoRoot: string,
    options: BranchListOptions   // { limit?, offset?, searchPattern? }
): PaginatedBranchResult         // { branches: GitBranch[], totalCount: number, hasMore: boolean }

getRemoteBranchesPaginated(
    repoRoot: string,
    options: BranchListOptions
): PaginatedBranchResult

getBranchStatus(
    repoRoot: string,
    hasUncommittedChanges: boolean
): BranchStatus | null           // BranchStatus: { name, isDetached, detachedHash?, ahead, behind, trackingBranch?, hasUncommittedChanges }

hasUncommittedChanges(repoRoot: string): boolean
```

### Route pattern convention
Existing git routes use regex, e.g.:
```typescript
/^\/api\/workspaces\/([^/]+)\/git\/commits$/
```
Use the same style for the new routes.

### Response helpers
- Success: `sendJSON(res, 200, data)`
- Not found: `sendJSON(res, 404, { error: 'Workspace not found' })`
- All other errors: `handleAPIError(res, error)`

### Import path
Verify the exact subpath used for pipeline-core git exports — check how `execGitSync` or similar is currently imported in `api-handler.ts` and mirror that pattern for `BranchService`.

---

## Acceptance Criteria

- [x] `BranchService` imported from `pipeline-core` and instantiated as a singleton inside `registerApiRoutes()`
- [x] `GET /api/workspaces/:id/git/branches` returns `{ local?, remote? }` with `PaginatedBranchResult` shape
- [x] `GET /api/workspaces/:id/git/branch-status` returns `BranchStatus | null`
- [x] Query params `type`, `limit`, `offset`, `search` correctly forwarded to `BranchService` methods
- [x] Unknown workspace ID returns `404`
- [x] Git errors return `500` with an error message
- [x] All new tests pass (`npm run test:run` in `packages/coc-server`)
