---
status: pending
commit: 3 of 5
title: "Remote, merge & stash API endpoints + tests"
feature: Branch Management
depends_on: ["001-branch-listing-status-api", "002-branch-crud-api"]
---

# Commit 3: Remote, Merge & Stash API Endpoints + Tests

## Motivation

Adds the "collaboration" half of the branch management API: push, pull, fetch, merge, and stash operations. Separated from CRUD (commit 2) because remote operations have distinct failure modes — network timeouts, authentication errors, merge conflicts — that deserve focused review.

## Prior State (assumed from commits 1–2)

- `BranchService` is instantiated once as a local variable inside `registerApiRoutes` in `packages/coc-server/src/api-handler.ts`.
- Branch list, paginated list, switch, create, delete, and rename endpoints exist.
- `packages/coc-server/test/git-branches-api.test.ts` exists with tests for commits 1–2.

---

## Files to Modify

### 1. `packages/coc-server/src/api-handler.ts`

Add six new route objects to the `routes` array inside `registerApiRoutes`, following the existing POST handler pattern (see Implementation Details).

#### Route 1 — Push

```
POST /api/workspaces/:id/git/push
Body: { setUpstream?: boolean }
```

```typescript
{
    method: 'POST',
    pattern: '/api/workspaces/:id/git/push',
    handler: async (req, res) => {
        // resolve repoRoot from workspace id (same pattern as commit-2 routes)
        let body: any = {};
        try { body = await parseBody(req); } catch { return handleAPIError(res, invalidJSON()); }
        const setUpstream = body.setUpstream === true;
        const result = await branchService.push(repoRoot, setUpstream);
        sendJSON(res, 200, result);
    },
}
```

- `setUpstream` defaults to `false` if absent or not strictly `true`.
- `push(repoRoot, setUpstream)` signature: `async push(repoRoot: string, setUpstream: boolean = false): Promise<GitOperationResult>`

#### Route 2 — Pull

```
POST /api/workspaces/:id/git/pull
Body: { rebase?: boolean }
```

- `rebase` defaults to `false`.
- `pull(repoRoot, rebase)` signature: `async pull(repoRoot: string, rebase: boolean = false): Promise<GitOperationResult>`

#### Route 3 — Fetch

```
POST /api/workspaces/:id/git/fetch
Body: { remote?: string }
```

- `remote` is passed as-is (undefined if absent). BranchService runs `git fetch --all` when `remote` is undefined, `git fetch "<remote>"` otherwise.
- `fetch(repoRoot, remote?)` signature: `async fetch(repoRoot: string, remote?: string): Promise<GitOperationResult>`

#### Route 4 — Merge

```
POST /api/workspaces/:id/git/merge
Body: { branch: string }   ← REQUIRED
```

- **Return 400** if `body.branch` is missing or not a non-empty string.
- `mergeBranch(repoRoot, branchName)` signature: `async mergeBranch(repoRoot: string, branchName: string): Promise<GitOperationResult>`
- Merge conflicts surface as `{ success: false, error: "..." }` — pass through to client with HTTP 200.

```typescript
if (!body.branch || typeof body.branch !== 'string') {
    return handleAPIError(res, missingFields(['branch']));
}
const result = await branchService.mergeBranch(repoRoot, body.branch);
sendJSON(res, 200, result);
```

#### Route 5 — Stash

```
POST /api/workspaces/:id/git/stash
Body: { message?: string }
```

- `message` is passed as-is (undefined if absent).
- `stashChanges(repoRoot, message?)` signature: `async stashChanges(repoRoot: string, message?: string): Promise<GitOperationResult>`

#### Route 6 — Pop Stash

```
POST /api/workspaces/:id/git/stash/pop
Body: (none required)
```

- No body fields needed; call `branchService.popStash(repoRoot)` directly.
- `popStash(repoRoot)` signature: `async popStash(repoRoot: string): Promise<GitOperationResult>`
- "No stash to pop" surfaces as `{ success: false, error: "..." }` — pass through with HTTP 200.

---

### 2. `packages/coc-server/test/git-branches-api.test.ts`

Append test cases (using the same mock/stub pattern established in commits 1–2).

#### Push tests

| Scenario | Mock setup | Assertion |
|---|---|---|
| Default push (no body) | `branchService.push.mockResolvedValue({ success: true })` | `push` called with `(repoRoot, false)`; response 200 `{ success: true }` |
| `setUpstream: true` | same | `push` called with `(repoRoot, true)` |
| Push fails (no remote) | `push.mockResolvedValue({ success: false, error: 'no remote' })` | response 200 `{ success: false, error: 'no remote' }` |

#### Pull tests

| Scenario | Mock setup | Assertion |
|---|---|---|
| Default pull | `pull.mockResolvedValue({ success: true })` | `pull` called with `(repoRoot, false)` |
| `rebase: true` | same | `pull` called with `(repoRoot, true)` |

#### Fetch tests

| Scenario | Mock setup | Assertion |
|---|---|---|
| Default fetch (no remote) | `fetch.mockResolvedValue({ success: true })` | `fetch` called with `(repoRoot, undefined)` |
| `remote: 'upstream'` | same | `fetch` called with `(repoRoot, 'upstream')` |

#### Merge tests

| Scenario | Mock setup | Assertion |
|---|---|---|
| Valid branch | `mergeBranch.mockResolvedValue({ success: true })` | `mergeBranch` called with `(repoRoot, 'feature-x')`; 200 |
| Missing branch | — | Response 400 |
| Conflict | `mergeBranch.mockResolvedValue({ success: false, error: 'CONFLICT' })` | Response 200 `{ success: false, error: 'CONFLICT' }` |

#### Stash tests

| Scenario | Mock setup | Assertion |
|---|---|---|
| With message | `stashChanges.mockResolvedValue({ success: true })` | `stashChanges` called with `(repoRoot, 'WIP: my message')` |
| Without message | same | `stashChanges` called with `(repoRoot, undefined)` |

#### Pop stash tests

| Scenario | Mock setup | Assertion |
|---|---|---|
| Success | `popStash.mockResolvedValue({ success: true })` | Response 200 `{ success: true }` |
| No stash | `popStash.mockResolvedValue({ success: false, error: 'No stash entries found.' })` | Response 200 `{ success: false, error: ... }` |

---

## Implementation Details

### Body parsing pattern (from existing handlers)

```typescript
let body: any = {};
try {
    body = await parseBody(req);
} catch {
    return handleAPIError(res, invalidJSON());
}
```

For optional boolean fields:
```typescript
const setUpstream = body.setUpstream === true;  // false if absent/non-boolean
```

For optional string fields:
```typescript
const remote: string | undefined = typeof body.remote === 'string' ? body.remote : undefined;
```

For required string fields:
```typescript
if (!body.branch || typeof body.branch !== 'string') {
    return handleAPIError(res, missingFields(['branch']));
}
```

### GitOperationResult shape (from `pipeline-core/src/git/types.ts`)

```typescript
interface GitOperationResult {
    success: boolean;
    error?: string;
}
```

All six methods return `Promise<GitOperationResult>`. HTTP status is always **200** — the `success` field signals operation outcome. Only missing/invalid *request* fields produce 4xx errors.

### Timeout note

All six methods use `execGitAsync` with `timeout: 60000` (60 s). The old `execGitSync` 10 s limit does **not** apply here.

---

## Acceptance Criteria

- [ ] `POST /api/workspaces/:id/git/push` works; `setUpstream` passed correctly
- [ ] `POST /api/workspaces/:id/git/pull` works; `rebase` passed correctly
- [ ] `POST /api/workspaces/:id/git/fetch` works; `remote` passed correctly (undefined → fetch all)
- [ ] `POST /api/workspaces/:id/git/merge` works; returns 400 when `branch` is missing
- [ ] `POST /api/workspaces/:id/git/stash` works; `message` passed correctly
- [ ] `POST /api/workspaces/:id/git/stash/pop` works
- [ ] Merge conflict and pop-with-no-stash both return HTTP 200 with `{ success: false, error: "..." }`
- [ ] All 13 new test cases pass
- [ ] `npm run test` passes (no regressions)
