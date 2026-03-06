# Plan: Server-Side Git Cache for CoC SPA

## Problem
Every request to git endpoints re-runs `git` via `execGitSync` (a blocking child process with a 5s timeout), making the SPA feel slow. There is no caching at all today.

## Approach
Add an in-memory `GitCacheService` in `packages/coc-server/src/`. Cached data is only invalidated when the client explicitly signals a refresh (via `?refresh=true` on the API call). The frontend's **Refresh button** (and `R` key shortcut) passes this flag; normal navigation hits the cache.

Commit-specific data (files list, diff) is **immutable by hash** and cached forever. Mutable data (commits list, branch-range) is cached until an explicit refresh wipes it.

---

## Scope

### What gets cached
| Endpoint | Cache key | Invalidation |
|---|---|---|
| `GET /git/commits?limit=&skip=` | `{wsId}:commits:{limit}:{skip}` | Manual refresh |
| `GET /git/branch-range` | `{wsId}:branch-range` | Manual refresh |
| `GET /git/commits/:hash/files` | `{wsId}:commit-files:{hash}` | Never (hash is immutable) |
| `GET /git/commits/:hash/diff` | `{wsId}:commit-diff:{hash}` | Never (hash is immutable) |

`git-info` and branch operations (push/pull/switch/etc.) are **not cached** — they are either fast or already mutating state.

### What is NOT in scope
- TTL-based expiry (cache lives until explicit refresh)
- Persistence across server restarts (in-memory only)
- Caching `branch-range/files`, `branch-range/diff`, `git-info`, or branch management endpoints

---

## Changes

### 1. `packages/coc-server/src/git-cache.ts` (new file)
A `GitCacheService` singleton:
```ts
class GitCacheService {
    private cache = new Map<string, unknown>();

    get<T>(key: string): T | undefined
    set(key: string, value: unknown): void
    invalidateWorkspace(workspaceId: string): void  // deletes all keys starting with `${workspaceId}:`
}
export const gitCache = new GitCacheService();
```

### 2. `packages/coc-server/src/api-handler.ts`
- Import `gitCache`.
- For each cached endpoint:
  1. Parse `?refresh=true` from the query string.
  2. If `refresh=true`, call `gitCache.invalidateWorkspace(id)` before doing anything.
  3. Check the cache; on hit return immediately.
  4. On miss, run existing `execGitSync` logic, then store result in cache.
- For mutable endpoints (commits, branch-range): only the **specific** workspace cache is wiped on refresh — not other workspaces.

### 3. `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`
- `fetchCommits()` and `fetchBranchRange()` currently build their URL without any extra query param.
- When called from `refreshAll()`, append `?refresh=true` to both URLs.
- Normal calls (initial load, pagination) do **not** pass the flag.

---

## Key design decisions
- **Single invalidation point**: `?refresh=true` on any request for a workspace wipes all mutable cache for that workspace. This avoids partial-stale states.
- **Immutable-by-hash entries are never wiped** — they use a different key prefix that `invalidateWorkspace` ignores. (`commit-files:` and `commit-diff:` are per-hash, not per-workspace; but we still namespace them under workspace id for correctness.)
  - Actually `invalidateWorkspace` _can_ wipe them on refresh — it's fine and safe since git will return the same data. Alternatively, skip wiping hash-keyed entries to preserve that fast path. **Decision: skip wiping hash entries** to maximise cache hits on re-navigation.
- **No TTL**: the cache is purely refresh-driven as requested. If the server is long-lived and users never click refresh, the commits list could drift. This is acceptable per requirements.

---

## Files to change
1. `packages/coc-server/src/git-cache.ts` — **create**
2. `packages/coc-server/src/api-handler.ts` — **edit** (4 endpoints)
3. `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` — **edit** (`refreshAll` passes `?refresh=true`)

---

## Tests to add
- Unit tests in `packages/coc-server/` for `GitCacheService` (get/set/invalidate)
- Integration-style tests for the two cached endpoints verifying:
  - Second call without refresh returns cached data (git not re-invoked)
  - Call with `?refresh=true` re-invokes git and updates cache
