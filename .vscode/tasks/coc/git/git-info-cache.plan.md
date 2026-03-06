---
status: future
---
# Cache Workspace Git Info

## Problem

`GET /api/workspaces/:id/git-info` runs multiple synchronous `execSync` git calls on **every request** with zero caching:
- `git status --porcelain` (expensive on large repos)
- `git rev-parse HEAD`
- `git rev-list --count HEAD..@{u}` / `@{u}..HEAD` (ahead/behind)
- `git remote get-url origin`

On large repositories this makes the page-load/refresh noticeably slow.

## Proposed Approach

Add a **TTL-based in-memory cache** for git-info results, keyed by workspace ID. Reuse the existing `gitCache` infrastructure in `packages/coc-server/src/git-cache.ts` or extend `GitLogService`'s pattern. Support `?refresh=true` to bust the cache on demand (consistent with how `git/commits` and `git/branch-range` work today).

Cache lifetime: **30 seconds** (short enough to stay reasonably fresh, long enough to amortize cost across rapid page reloads).

## Acceptance Criteria

- [ ] `GET /api/workspaces/:id/git-info` returns a cached result on repeated calls within the TTL window (no extra git processes spawned)
- [ ] Cache TTL is 30 seconds by default
- [ ] `?refresh=true` busts the cache and fetches fresh data
- [ ] Cache is invalidated when any mutable git operation is performed (push, pull, fetch, stage, discard, etc.) — consistent with `gitCache.invalidateMutable()`
- [ ] Behavior is identical to today when the cache is cold (first call or after invalidation)
- [ ] Unit tests cover: cache hit, cache miss, TTL expiry, `?refresh=true`, and post-mutation invalidation

## Subtasks

### 1. Extend `GitCacheService` to support TTL entries
- File: `packages/coc-server/src/git-cache.ts`
- Add a `setWithTTL(key, value, ttlMs)` / `getIfFresh(key)` method (or use a separate `Map<string, { value, expiresAt }>`)
- Keep backward-compat with existing immutable/mutable cache keys

### 2. Cache `git-info` in `api-handler.ts`
- File: `packages/coc-server/src/api-handler.ts`
- Cache key: `{wsId}:git-info`
- On hit (and not expired, and no `?refresh=true`): return cached value immediately
- On miss / forced refresh: run existing git calls, store result with TTL, return
- Call `gitCache.invalidateMutable(wsId)` on all existing mutation endpoints (already done for some; verify completeness for `push`, `pull`, `fetch`, `stage`, `discard`, stash, merge)

### 3. Add tests
- File: `packages/coc-server/src/` test directory
- Test the cache hit/miss/TTL/refresh/invalidation scenarios using mocked git calls

## Notes

- **TTL constant** — define as `GIT_INFO_CACHE_TTL_MS = 30_000` at the top of `api-handler.ts` or in `git-cache.ts` so it's easy to tune.
- **Mutation invalidation audit** — check every `POST`/`PUT` route in `api-handler.ts` that modifies git state. Most already call `gitCache.invalidateMutable(wsId)` for the commits list; make sure the new `git-info` TTL entry is also cleared (or just make `invalidateMutable` clear TTL entries too).
- **`GitLogService` has a 3-min branch TTL cache** but `api-handler.ts` never uses it — do not refactor that path as part of this task.
- **No persistent storage needed** — in-memory is sufficient; restarting the server is an acceptable way to force a cold cache.
- **Do not add server-side polling** — the TTL approach is sufficient for now.
