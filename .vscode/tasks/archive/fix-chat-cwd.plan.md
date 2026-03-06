# Fix: CoC Chat Uses Wrong CWD When Repo Is Not Default Workspace

## Problem

When the user opens the **Chat** tab of a non-default repo (e.g. `shortcuts2` at
`D:\projects\shortcuts2`) and clicks **New Chat**, the AI assistant reports its
working directory as `D:/projects/shortcuts` (the VS Code workspace root / server
launch directory) instead of the selected repo's local path.

**Screenshot evidence:** User is on `shortcuts2` repo; chat replies "My current
working directory is D:/projects/shortcuts."

---

## Root Cause Analysis

### The full call chain

```
[UI] "New Chat" button click (useProjectRoot = false)
  └─► POST /api/queue  { type:'chat', workspaceId, prompt }
        ↑ workingDirectory is OMITTED because useProjectRoot=false

[Server] QueueExecutorBridge.getWorkingDirectory(task)
  └─► task.payload.workingDirectory  → undefined
      task.payload.folderPath        → undefined
      this.defaultWorkingDirectory   → undefined (never set at startup)
      ∴ returns undefined

[AI session] No cwd override → inherits server process CWD
  → D:/projects/shortcuts  (where `coc serve` was invoked)
```

### Key locations

| # | File | Lines | Issue |
|---|------|-------|-------|
| 1 | `packages/coc-server/src/spa/client/react/repos/RepoChatTab.tsx` | ~496-510 | `workingDirectory` only sent when `useProjectRoot=true`; default "New Chat" omits it |
| 2 | `packages/coc-server/src/spa/client/react/repos/RepoDetail.tsx` | ~409 | `workspacePath={ws.rootPath}` — value IS correct, just not forwarded |
| 3 | `packages/coc/src/server/queue-executor-bridge.ts` | ~149-152 | `defaultWorkingDirectory` never set; `getWorkingDirectory()` doesn't resolve from `workspaceId` |
| 4 | `packages/coc/src/server/index.ts` | ~165-173 | `MultiRepoQueueExecutorBridge` constructed without `workingDirectory` |

### Why "New Chat (Project Root)" works

Only the **third dropdown option** ("New Chat (Project Root)") passes
`useProjectRoot=true`, which adds `workingDirectory: workspacePath` to the payload.
The primary **"New Chat"** button always uses `useProjectRoot=false`.

---

## Proposed Fix (implement both)

### Fix A — Frontend: always forward repo path as `workingDirectory`

In `RepoChatTab.tsx`, unconditionally include `workingDirectory: workspacePath`
in the `/api/queue` payload. The Chat tab is already scoped to a specific repo,
so the repo's `rootPath` (correctly provided by `RepoDetail.tsx` as `ws.rootPath`)
should always be the working directory.

```typescript
// packages/coc-server/src/spa/client/react/repos/RepoChatTab.tsx
// Before
...(useProjectRoot ? { workingDirectory: workspacePath } : {}),

// After
workingDirectory: workspacePath,
```

This also makes "New Chat" and "New Chat (Project Root)" behave identically
w.r.t. CWD, so the confusing distinction can be cleaned up or kept as-is.

### Fix B — Backend: resolve `workingDirectory` from `workspaceId` as fallback

In `QueueExecutorBridge.getWorkingDirectory()`, extend the fallback chain so
that when no explicit `workingDirectory` or `folderPath` is in the payload but a
`workspaceId` is present, the workspace registry is queried for its `rootPath`.
This protects against any future client-side omission.

```typescript
// packages/coc/src/server/queue-executor-bridge.ts
private getWorkingDirectory(task: QueuedTask): string | undefined {
    if (isChatPayload(task.payload)) {
        return (
            task.payload.workingDirectory
            || task.payload.folderPath
            || this.registry.getWorkspace(task.payload.workspaceId)?.rootPath  // NEW
            || this.defaultWorkingDirectory
        );
    }
    // ...
}
```

Verify that `MultiRepoQueueExecutorBridge` (which wraps `QueueExecutorBridge`)
exposes or delegates `registry` so the lookup is accessible here. If the registry
is only on the multi-repo wrapper, apply the equivalent lookup there instead.

---

## Affected Files

- `packages/coc-server/src/spa/client/react/repos/RepoChatTab.tsx`
- `packages/coc/src/server/queue-executor-bridge.ts` *(Option B only)*

## Testing

1. Start CoC server from `D:\projects\shortcuts`.
2. Add a second repo `D:\projects\shortcuts2`.
3. Open the **Chat** tab of `shortcuts2` and click **New Chat**.
4. Ask "what's your current folder?" — should reply `D:\projects\shortcuts2`.
5. Verify `shortcuts` repo chat still uses `D:\projects\shortcuts`.
