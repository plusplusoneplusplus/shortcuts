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
| Client: fetchApi | `packages/coc/src/server/spa/client/react/hooks/useApi.ts` L8-14 |
| Client: git tab | `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` |
| Server: git-info endpoint | `packages/coc-server/src/api-handler.ts` L288-320 |
| Server: stage/unstage endpoints | `packages/coc-server/src/api-handler.ts` L1108-1144 |
| Server: WebSocket infra | `packages/coc-server/src/websocket.ts` |
| Server: git cache | `packages/coc-server/src/git-cache.ts` |
| Server entry / wiring | `packages/coc/src/server/index.ts` L151-303 |
| pipeline-core: WorkingTreeService | `packages/pipeline-core/src/git/working-tree-service.ts` L143-252 |

### Architecture Notes

- `registerApiRoutes(routes, store, bridge?, dataDir?)` is called from `packages/coc/src/server/index.ts` L222
- The WebSocket server (`ProcessWebSocketServer`) is available to route handlers via a closure: `bridge.getWsServer()` returns the `wsServer` instance (L181)
- Existing broadcast pattern: `broadcastProcessEvent(message)` filters by `client.workspaceId` subscription
- `WorkingTreeService` currently only supports single-file `stageFile(repoRoot, filePath)` / `unstageFile(repoRoot, filePath)`
- `fetchApi` is defined in `useApi.ts` and is a simple `fetch()` wrapper with no abort support

## Approach — Two Complementary Improvements

### Strategy A: Batch API Endpoints (reduces round-trips)

Add server endpoints that accept multiple items in a single request.

### Strategy B: WebSocket Push for Git Changes (eliminates stale polling)

Leverage the existing `ProcessWebSocketServer` to push git-change notifications after mutating git operations, so the client doesn't need to manually refresh.

---

## Todos

### 1. `batch-git-info` — Add `POST /api/git-info/batch` endpoint

Add a new endpoint that accepts an array of workspace IDs and returns git-info for all of them in one response. The server runs git operations in parallel (bounded concurrency) rather than letting the client serialize them.

#### 1a. Server: Add batch endpoint in `api-handler.ts`

Insert after the existing `GET /api/workspaces/:id/git-info` handler (~L320):

```ts
// POST /api/git-info/batch — fetch git-info for multiple workspaces in one round-trip
routes.push({
    method: 'POST',
    pattern: '/api/git-info/batch',
    handler: async (req, res) => {
        let body: any = {};
        try { body = await parseBody(req); } catch { return handleAPIError(res, invalidJSON()); }
        const { workspaceIds } = body;
        if (!Array.isArray(workspaceIds)) {
            return handleAPIError(res, missingFields(['workspaceIds']));
        }

        const workspaces = await store.getWorkspaces();
        const wsMap = new Map(workspaces.map(w => [w.id, w]));

        // Bounded concurrency: process up to 4 workspaces in parallel
        const CONCURRENCY = 4;
        const results: Record<string, any> = {};
        for (let i = 0; i < workspaceIds.length; i += CONCURRENCY) {
            const batch = workspaceIds.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (wsId: string) => {
                const ws = wsMap.get(wsId);
                if (!ws) { results[wsId] = null; return; }

                try {
                    const dirty = getBranchService().hasUncommittedChanges(ws.rootPath);
                    const branchStatus = getBranchService().getBranchStatus(ws.rootPath, dirty);
                    if (!branchStatus) {
                        results[wsId] = { branch: null, dirty: false, isGitRepo: false, remoteUrl: null };
                        return;
                    }
                    const branch = getGitRangeService().getCurrentBranch(ws.rootPath);
                    const remoteUrl = detectRemoteUrl(ws.rootPath);
                    if (remoteUrl && remoteUrl !== ws.remoteUrl) {
                        await store.updateWorkspace(ws.id, { remoteUrl });
                    }
                    results[wsId] = {
                        branch, dirty,
                        ahead: branchStatus.ahead, behind: branchStatus.behind,
                        isGitRepo: true, remoteUrl: remoteUrl || null,
                    };
                } catch {
                    results[wsId] = null;
                }
            }));
        }

        sendJSON(res, 200, { results });
    },
});
```

#### 1b. Client: Replace serial loop in `ReposView.tsx` L115-127

**Before** (current code):
```tsx
// Phase 2: Fetch git-info per workspace progressively
for (const repoData of enriched) {
    const wsId = repoData.workspace.id;
    fetchApi(`/workspaces/${encodeURIComponent(wsId)}/git-info`)
        .catch(() => null)
        .then((gitInfo: any) => {
            setRepos(prev => prev.map(r =>
                r.workspace.id === wsId
                    ? { ...r, gitInfo: gitInfo || undefined, gitInfoLoading: false }
                    : r
            ));
        });
}
```

**After:**
```tsx
// Phase 2: Fetch git-info for all workspaces in a single batch request
const wsIds = enriched.map(r => r.workspace.id);
fetchApi('/git-info/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceIds: wsIds }),
}).then((data: any) => {
    const results = data?.results || {};
    setRepos(prev => prev.map(r => ({
        ...r,
        gitInfo: results[r.workspace.id] || undefined,
        gitInfoLoading: false,
    })));
}).catch(() => {
    // Clear loading state on failure
    setRepos(prev => prev.map(r => ({ ...r, gitInfoLoading: false })));
});
```

---

### 2. `batch-stage-unstage` — Add batch stage/unstage endpoints

#### 2a. pipeline-core: Add `stageFiles` / `unstageFiles` to `WorkingTreeService`

**File:** `packages/pipeline-core/src/git/working-tree-service.ts`

Insert after `stageFile` (after L178) and after `unstageFile` (after L199):

```ts
// Insert after stageFile (~L178)
async stageFiles(repoRoot: string, filePaths: string[]): Promise<{ success: boolean; staged: number; errors: string[] }> {
    if (filePaths.length === 0) return { success: true, staged: 0, errors: [] };
    const errors: string[] = [];
    try {
        // Stage all files in one git command
        const escaped = filePaths.map(f => `"${f}"`).join(' ');
        await execGitAsync(`git -C "${repoRoot}" add -- ${escaped}`, { cwd: repoRoot });
    } catch (error) {
        // Fallback: stage individually, collecting errors
        for (const filePath of filePaths) {
            try {
                await execGitAsync(`git -C "${repoRoot}" add -- "${filePath}"`, { cwd: repoRoot });
            } catch (e) {
                errors.push(`${filePath}: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
        }
    }
    return { success: errors.length === 0, staged: filePaths.length - errors.length, errors };
}

// Insert after unstageFile (~L199)
async unstageFiles(repoRoot: string, filePaths: string[]): Promise<{ success: boolean; unstaged: number; errors: string[] }> {
    if (filePaths.length === 0) return { success: true, unstaged: 0, errors: [] };
    const errors: string[] = [];
    try {
        const escaped = filePaths.map(f => `"${f}"`).join(' ');
        await execGitAsync(`git -C "${repoRoot}" reset HEAD -- ${escaped}`, { cwd: repoRoot });
    } catch {
        // Fallback: unstage individually (handles no-commits-yet edge case)
        for (const filePath of filePaths) {
            try {
                await execGitAsync(`git -C "${repoRoot}" reset HEAD -- "${filePath}"`, { cwd: repoRoot });
            } catch {
                try {
                    await execGitAsync(`git -C "${repoRoot}" rm --cached -- "${filePath}"`, { cwd: repoRoot });
                } catch (e) {
                    errors.push(`${filePath}: ${e instanceof Error ? e.message : 'Unknown error'}`);
                }
            }
        }
    }
    return { success: errors.length === 0, unstaged: filePaths.length - errors.length, errors };
}
```

**Export:** Ensure `stageFiles` and `unstageFiles` are accessible — they're instance methods on the class, so no additional export needed.

#### 2b. Server: Add batch endpoints in `api-handler.ts`

Insert after existing `stage` / `unstage` routes (~L1144):

```ts
// POST /api/workspaces/:id/git/changes/stage-batch — Stage multiple files at once
routes.push({
    method: 'POST',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/stage-batch$/,
    handler: async (req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) return handleAPIError(res, notFound('Workspace'));

        let body: any = {};
        try { body = await parseBody(req); } catch { return handleAPIError(res, invalidJSON()); }
        if (!Array.isArray(body.filePaths)) return handleAPIError(res, missingFields(['filePaths']));

        const result = await workingTreeService.stageFiles(ws.rootPath, body.filePaths);
        sendJSON(res, 200, result);
    },
});

// POST /api/workspaces/:id/git/changes/unstage-batch — Unstage multiple files at once
routes.push({
    method: 'POST',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/unstage-batch$/,
    handler: async (req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) return handleAPIError(res, notFound('Workspace'));

        let body: any = {};
        try { body = await parseBody(req); } catch { return handleAPIError(res, invalidJSON()); }
        if (!Array.isArray(body.filePaths)) return handleAPIError(res, missingFields(['filePaths']));

        const result = await workingTreeService.unstageFiles(ws.rootPath, body.filePaths);
        sendJSON(res, 200, result);
    },
});
```

#### 2c. Client: Replace serial loops in `WorkingTree.tsx`

**`handleStageAll` — Before** (L378-398):
```tsx
const handleStageAll = useCallback(async (files: WorkingTreeChange[]) => {
    setStagingAll(true);
    setActionError(null);
    try {
        const base = `/workspaces/${encodeURIComponent(workspaceId)}/git/changes`;
        for (const f of files) {
            const result = await fetchApi(`${base}/stage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: f.filePath }),
            });
            if (result.success === false) throw new Error(result.error || 'Stage failed');
        }
        await fetchChanges();
        onRefresh?.();
    } catch (err: any) {
        setActionError(err.message || 'Stage all failed');
    } finally {
        setStagingAll(false);
    }
}, [workspaceId, fetchChanges, onRefresh]);
```

**`handleStageAll` — After:**
```tsx
const handleStageAll = useCallback(async (files: WorkingTreeChange[]) => {
    setStagingAll(true);
    setActionError(null);
    try {
        const base = `/workspaces/${encodeURIComponent(workspaceId)}/git/changes`;
        const result = await fetchApi(`${base}/stage-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePaths: files.map(f => f.filePath) }),
        });
        if (result.success === false) {
            throw new Error(result.errors?.join(', ') || 'Stage failed');
        }
        await fetchChanges();
        onRefresh?.();
    } catch (err: any) {
        setActionError(err.message || 'Stage all failed');
    } finally {
        setStagingAll(false);
    }
}, [workspaceId, fetchChanges, onRefresh]);
```

**`handleUnstageAll` — Before** (L400-420):
```tsx
const handleUnstageAll = useCallback(async (files: WorkingTreeChange[]) => {
    setStagingAll(true);
    setActionError(null);
    try {
        const base = `/workspaces/${encodeURIComponent(workspaceId)}/git/changes`;
        for (const f of files) {
            const result = await fetchApi(`${base}/unstage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: f.filePath }),
            });
            if (result.success === false) throw new Error(result.error || 'Unstage failed');
        }
        await fetchChanges();
        onRefresh?.();
    } catch (err: any) {
        setActionError(err.message || 'Unstage all failed');
    } finally {
        setStagingAll(false);
    }
}, [workspaceId, fetchChanges, onRefresh]);
```

**`handleUnstageAll` — After:**
```tsx
const handleUnstageAll = useCallback(async (files: WorkingTreeChange[]) => {
    setStagingAll(true);
    setActionError(null);
    try {
        const base = `/workspaces/${encodeURIComponent(workspaceId)}/git/changes`;
        const result = await fetchApi(`${base}/unstage-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePaths: files.map(f => f.filePath) }),
        });
        if (result.success === false) {
            throw new Error(result.errors?.join(', ') || 'Unstage failed');
        }
        await fetchChanges();
        onRefresh?.();
    } catch (err: any) {
        setActionError(err.message || 'Unstage all failed');
    } finally {
        setStagingAll(false);
    }
}, [workspaceId, fetchChanges, onRefresh]);
```

---

### 3. `ws-git-push` — Push git-change events via WebSocket

After any mutating git action, broadcast a `git-changed` event so all connected clients can refresh automatically.

#### 3a. Server: Extend `ServerMessage` union in `websocket.ts`

**File:** `packages/coc-server/src/websocket.ts` (L106-136)

Add to the `ServerMessage` union type (after the `schedule-run-complete` variant):
```ts
    | { type: 'git-changed'; workspaceId: string; trigger: string; timestamp: number };
```

#### 3b. Server: Add `broadcastGitChanged` method to `ProcessWebSocketServer`

**File:** `packages/coc-server/src/websocket.ts`

Insert after `broadcastProcessEvent` method (~L255):

```ts
broadcastGitChanged(workspaceId: string, trigger: string): void {
    const message: ServerMessage = {
        type: 'git-changed',
        workspaceId,
        trigger,
        timestamp: Date.now(),
    };
    // Reuse workspace-scoped broadcasting logic from broadcastProcessEvent
    const data = JSON.stringify(message);
    for (const client of this.clients) {
        if (!client.workspaceId || client.workspaceId === workspaceId) {
            client.send(data);
        }
    }
}
```

Also update `getMessageWorkspaceId` to handle the new type (add before the final `return undefined`):
```ts
if (message.type === 'git-changed') {
    return message.workspaceId;
}
```

#### 3c. Server: Broadcast after mutating git handlers in `api-handler.ts`

The `registerApiRoutes` function doesn't currently receive the WebSocket server. Two options:

**Option A (preferred):** Add an optional `wsServer` parameter to `registerApiRoutes`:

```ts
// Update function signature
export function registerApiRoutes(
    routes: Route[],
    store: ProcessStore,
    bridge?: QueueExecutorBridge,
    dataDir?: string,
    wsServer?: ProcessWebSocketServer,   // ← new parameter
): void {
```

**Update call site** in `packages/coc/src/server/index.ts` L222:
```ts
registerApiRoutes(routes, store, bridge, dataDir, wsServer);
```

**Note:** `wsServer` is already in scope at L222 via hoisting/closure since it's declared later at L301 with `let`. If the variable ordering is an issue, move the `wsServer` creation before `registerApiRoutes`, or pass a getter `() => wsServer`.

**Option B (closure-based):** Since `bridge` already has `getWsServer: () => wsServer`, extract the WS server from the bridge inside route handlers:
```ts
const ws = bridge?.getWsServer?.();
ws?.broadcastGitChanged(id, 'stage');
```

**Using Option A,** add a broadcast call after each mutating git handler's success response. Insert one line before the `sendJSON` call in each handler:

| Endpoint (line) | Trigger string | Insert after |
|------|------|------|
| `POST .../git/branches/switch` (L866) | `'branch-switch'` | successful `sendJSON` |
| `POST .../git/push` (L942) | `'push'` | successful `sendJSON` |
| `POST .../git/pull` (L967) | `'pull'` | successful `sendJSON` |
| `POST .../git/fetch` (L992) | `'fetch'` | successful `sendJSON` |
| `POST .../git/merge` (L1017) | `'merge'` | successful `sendJSON` |
| `POST .../git/stash` (L1045) | `'stash'` | successful `sendJSON` |
| `POST .../git/stash/pop` (L1070) | `'stash-pop'` | successful `sendJSON` |
| `POST .../git/changes/stage` (L1108) | `'stage'` | successful `sendJSON` |
| `POST .../git/changes/unstage` (L1127) | `'unstage'` | successful `sendJSON` |
| `POST .../git/changes/discard` (L1146) | `'discard'` | successful `sendJSON` |
| `POST .../git/changes/stage-batch` (new) | `'stage-batch'` | successful `sendJSON` |
| `POST .../git/changes/unstage-batch` (new) | `'unstage-batch'` | successful `sendJSON` |

**Example** (stage handler at ~L1124):
```ts
const result = await workingTreeService.stageFile(ws.rootPath, body.filePath);
wsServer?.broadcastGitChanged(id, 'stage');   // ← add this line
sendJSON(res, 200, result);
```

#### 3d. Client: Handle `git-changed` in `ReposView.tsx` WebSocket handler

**File:** `packages/coc/src/server/spa/client/react/repos/ReposView.tsx` L172-187

Add a helper to refresh git-info for a single workspace (insert near `fetchRepos`):
```tsx
const refreshGitInfoForWorkspace = useCallback((wsId: string) => {
    fetchApi(`/workspaces/${encodeURIComponent(wsId)}/git-info`)
        .catch(() => null)
        .then((gitInfo: any) => {
            setRepos(prev => prev.map(r =>
                r.workspace.id === wsId
                    ? { ...r, gitInfo: gitInfo || undefined, gitInfoLoading: false }
                    : r
            ));
        });
}, []);
```

Update the WebSocket `onMessage` handler (L173-186):
```tsx
const { connect, disconnect } = useWebSocket({
    onMessage: useCallback((msg: any) => {
        if (msg.type === 'workflows-changed' && msg.workspaceId) {
            refreshPipelinesForWorkspace(msg.workspaceId);
        }
        // NEW: Handle git-changed events — targeted refresh for affected workspace
        if (msg.type === 'git-changed' && msg.workspaceId) {
            refreshGitInfoForWorkspace(msg.workspaceId);
        }
        // Throttle process events: at most one fetchRepos per 10 seconds
        if (msg.type === 'process-added' || msg.type === 'process-updated' || msg.type === 'process-removed') {
            if (!processThrottleRef.current) {
                processThrottleRef.current = setTimeout(() => {
                    processThrottleRef.current = null;
                    fetchRepos();
                }, 10_000);
            }
        }
    }, [refreshPipelinesForWorkspace, refreshGitInfoForWorkspace, fetchRepos]),
});
```

#### 3e. Client: Handle `git-changed` in `RepoGitTab.tsx`

**File:** `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`

The component currently has no WebSocket listener. Add one using the existing `useWebSocket` hook:

```tsx
// Add import (if not present)
import { useWebSocket } from '../hooks/useWebSocket';

// Inside the component, add WebSocket listener with debounced refresh
const gitChangedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useWebSocket({
    onMessage: useCallback((msg: any) => {
        if (msg.type === 'git-changed' && msg.workspaceId === workspaceId) {
            // Debounce: collapse rapid events (e.g., stage-batch) into one refresh
            if (gitChangedDebounceRef.current) clearTimeout(gitChangedDebounceRef.current);
            gitChangedDebounceRef.current = setTimeout(() => {
                gitChangedDebounceRef.current = null;
                refreshAll();
            }, 500);
        }
    }, [workspaceId, refreshAll]),
});
```

Where `workspaceId` is the prop identifying the current workspace, and `refreshAll()` is the existing function at L152-182 that re-fetches commits and branch range.

---

### 4. `client-abort` — Add AbortController to fetchApi for stale request cancellation

#### 4a. Extend `fetchApi` in `useApi.ts`

**File:** `packages/coc/src/server/spa/client/react/hooks/useApi.ts` L8-14

**Before:**
```ts
export async function fetchApi(path: string, options?: RequestInit): Promise<any> {
    const url = getApiBase() + path;
    const res = options ? await fetch(url, options) : await fetch(url);
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}
```

**After:**
```ts
export async function fetchApi(path: string, options?: RequestInit): Promise<any> {
    const url = getApiBase() + path;
    const res = await fetch(url, options ?? {});
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}
```

The `fetchApi` function already accepts `RequestInit` which includes `signal`. The change above simplifies the conditional (no behavior change). The key change is at **call sites**.

#### 4b. Add abort controller at the `fetchRepos` call site in `ReposView.tsx`

Add an `AbortController` ref and wire it into the batch git-info call:

```tsx
// Add ref near other refs (e.g., near processThrottleRef)
const gitInfoAbortRef = useRef<AbortController | null>(null);

// Inside fetchRepos, Phase 2 (the batch call):
// Abort any previous in-flight git-info request
gitInfoAbortRef.current?.abort();
const abortController = new AbortController();
gitInfoAbortRef.current = abortController;

fetchApi('/git-info/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceIds: wsIds }),
    signal: abortController.signal,                    // ← wire abort signal
}).then((data: any) => {
    if (abortController.signal.aborted) return;        // ← guard stale response
    const results = data?.results || {};
    setRepos(prev => prev.map(r => ({
        ...r,
        gitInfo: results[r.workspace.id] || undefined,
        gitInfoLoading: false,
    })));
}).catch((err) => {
    if (err.name === 'AbortError') return;             // ← ignore aborted requests
    setRepos(prev => prev.map(r => ({ ...r, gitInfoLoading: false })));
});
```

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
