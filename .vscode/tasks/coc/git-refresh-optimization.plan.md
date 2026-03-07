# Git Refresh Optimization — Batch + Server Push

## Problem

The SPA dashboard fetches git info for each workspace individually via sequential HTTP requests. Each `GET /workspaces/:id/git-info` call runs 3–4 synchronous git CLI commands (~200–500ms each), and they're fired in a loop during `fetchRepos()` Phase 2. With N workspaces, this creates N serial round-trips that block the UI from showing updated git status.

Additionally, the `handleStageAll` / `handleUnstageAll` actions in `WorkingTree.tsx` stage files **one at a time** in a serial `for` loop (N files = N sequential POSTs), compounding the delay.

### Current Flow

```
Client (ReposView.tsx)                Server (api-handler.ts)
───────────────────────              ──────────────────────
fetchRepos() Phase 2:
  for each workspace:
    GET /workspaces/:id/git-info ──→ execGitSync x3 (~300ms)
                                 ←── {branch, dirty, ahead, behind}
    (next iteration)
```

### Key Files

| Area | File |
|------|------|
| Client: git-info loop | `packages/coc/src/server/spa/client/react/repos/ReposView.tsx` L115-127 |
| Client: stage-all loop | `packages/coc/src/server/spa/client/react/repos/WorkingTree.tsx` L378-420 |
| Client: fetchApi (no batching) | `packages/coc/src/server/spa/client/react/utils/fetchApi.ts` |
| Server: git-info endpoint | `packages/coc-server/src/api-handler.ts` L288-320 |
| Server: stage/unstage endpoints | `packages/coc-server/src/api-handler.ts` L1067-1100 |
| Server: WebSocket infra | `packages/coc-server/src/websocket.ts` |
| Server: git cache | `packages/coc-server/src/git-cache.ts` |

## Approach — Two Complementary Improvements

### Strategy A: Batch API Endpoints (reduces round-trips)

Add server endpoints that accept multiple items in a single request.

### Strategy B: WebSocket Push for Git Changes (eliminates stale polling)

Leverage the existing `ProcessWebSocketServer` to push git-change notifications after mutating git operations, so the client doesn't need to manually refresh.

---

## Todos

### 1. `batch-git-info` — Add `POST /api/git-info/batch` endpoint

Add a new endpoint that accepts an array of workspace IDs and returns git-info for all of them in one response. The server runs git operations in parallel (bounded concurrency) rather than letting the client serialize them.

**Server changes (`api-handler.ts`):**
```ts
// POST /api/git-info/batch
// Body: { workspaceIds: string[] }
// Response: { results: Record<string, GitInfo | null> }
```
- Accept array of workspace IDs
- Run `Promise.all` with concurrency limit (e.g., 4) to gather git-info per workspace
- Return a map of `workspaceId → gitInfo`

**Client changes (`ReposView.tsx` L115-127):**
- Replace the `for` loop with a single `POST /api/git-info/batch` call
- Update all repos state in one `setRepos` call

### 2. `batch-stage-unstage` — Add `POST /api/workspaces/:id/git/changes/stage-batch` and `unstage-batch`

**Server changes (`api-handler.ts`):**
```ts
// POST /api/workspaces/:id/git/changes/stage-batch
// Body: { filePaths: string[] }
// Response: { success: boolean, staged: number, errors: string[] }
```
- Accept array of file paths
- Call `git add -- file1 file2 ...` in a single git command (much faster than N calls)
- Same pattern for `unstage-batch` using `git reset HEAD -- file1 file2 ...`

**Client changes (`WorkingTree.tsx` L378-420):**
- Replace the serial `for` loop in `handleStageAll` / `handleUnstageAll` with a single batch POST

### 3. `ws-git-push` — Push git-change events via WebSocket

After any mutating git action (fetch, pull, push, stage, unstage, discard, branch switch, merge, stash), broadcast a `git-changed` event so all connected clients can refresh automatically.

**Server changes (`websocket.ts`):**
- Add `git-changed` to `ServerMessage` union type:
  ```ts
  | { type: 'git-changed'; workspaceId: string; trigger: string; timestamp: number }
  ```
- Add `broadcastGitEvent(workspaceId, trigger)` method

**Server changes (`api-handler.ts`):**
- After each mutating git handler (fetch, pull, push, stage, unstage, discard, branch switch, merge, stash), call `wsServer.broadcastGitEvent(workspaceId, 'pull')` etc.

**Client changes (`ReposView.tsx`):**
- In the existing WebSocket message handler, add a case for `git-changed`:
  - Re-fetch git-info for just that workspace (single GET, already have the pattern)
  - Throttle to avoid storm when multiple rapid mutations happen

**Client changes (`RepoGitTab.tsx`):**
- Listen for `git-changed` events matching the current workspace
- Trigger `refreshAll()` automatically (with debounce)

### 4. `client-abort` — Add AbortController to fetchApi for stale request cancellation

**Client changes (`fetchApi.ts` or at call sites):**
- When a new refresh is triggered, abort any in-flight stale requests using `AbortController`
- Prevents race conditions where slow old responses overwrite newer data

---

## Estimated Impact

| Scenario | Before | After |
|----------|--------|-------|
| Initial load (5 repos) | 5 serial HTTP requests | 1 batch request |
| Stage All (10 files) | 10 serial POSTs + 3 refreshes | 1 batch POST + auto WS refresh |
| After `git pull` | 3 manual refresh requests | Auto WS push → 1 targeted refresh |
| Stale request race | Possible | Aborted via AbortController |

## Out of Scope

- File-system watcher on `.git/` for external git changes (e.g., user runs `git commit` in terminal) — could be a follow-up
- Caching git-info responses on the client side
- SSE (Server-Sent Events) as an alternative to WebSocket — existing WS infra is sufficient
