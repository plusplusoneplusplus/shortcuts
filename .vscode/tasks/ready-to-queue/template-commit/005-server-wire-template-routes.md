---
status: pending
commit: "005"
title: "coc server: wire template routes and watcher in index.ts"
depends_on: ["003", "004"]
files:
  - packages/coc/src/server/index.ts
---

# 005 — Wire Template Routes and Watcher in `index.ts`

Small wiring commit. Three integration points in `packages/coc/src/server/index.ts`, each following the existing pipeline/task pattern exactly.

## Prerequisites

These files must already exist from commits 003 and 004:
- `packages/coc/src/server/templates-handler.ts` → exports `registerTemplateRoutes`, `registerTemplateWriteRoutes`
- `packages/coc/src/server/template-watcher.ts` → exports `TemplateWatcher`
- `packages/coc/src/server/replicate-apply-handler.ts` → exports `registerReplicateApplyRoutes`

---

## Changes to `packages/coc/src/server/index.ts`

### 1. Imports (top of file, ~line 20–50)

Add after the existing `PipelineWatcher` import (line 20):

```typescript
import { registerTemplateRoutes, registerTemplateWriteRoutes } from './templates-handler';
import { registerReplicateApplyRoutes } from './replicate-apply-handler';
import { TemplateWatcher } from './template-watcher';
```

Place alongside the other handler/watcher imports (`registerPipelineRoutes`, `PipelineWatcher`, `registerTaskRoutes`, `TaskWatcher`).

### 2. Route Registration (~line 240, after `registerScheduleRoutes`)

Insert immediately after `registerScheduleRoutes(routes, scheduleManager);` (line 240) and before wiki/memory routes:

```typescript
// Template read routes
registerTemplateRoutes(routes, store);
// Template write routes with WebSocket broadcast
registerTemplateWriteRoutes(routes, store, (workspaceId) => {
    wsServer.broadcastProcessEvent({
        type: 'templates-changed',
        workspaceId,
        timestamp: Date.now(),
    });
});
// Replicate-apply routes
registerReplicateApplyRoutes(routes, store);
```

**Pattern match:** mirrors `registerPipelineWriteRoutes` (line 227–233) which also takes a broadcast callback.

### 3. Watcher Instantiation (~line 444, after `pipelineWatcher`)

Insert immediately after the `pipelineWatcher` block (line 438–444):

```typescript
// Bridge template file changes to WebSocket
const templateWatcher = new TemplateWatcher((workspaceId) => {
    wsServer.broadcastProcessEvent({
        type: 'templates-changed',
        workspaceId,
        timestamp: Date.now(),
    });
});
```

### 4. Watch Existing Workspaces (~line 448–449)

In the loop over `existingWorkspaces`, add after `pipelineWatcher.watchWorkspace(ws.id, ws.rootPath);` (line 449):

```typescript
templateWatcher.watchWorkspace(ws.id, ws.rootPath);
```

### 5. Intercept Workspace Registration (~line 461–462)

Inside `store.registerWorkspace`, add after `pipelineWatcher.watchWorkspace(...)` (line 462):

```typescript
templateWatcher.watchWorkspace(workspace.id, workspace.rootPath);
```

### 6. Intercept Workspace Removal (~line 467–468)

Inside `store.removeWorkspace`, add after `pipelineWatcher.unwatchWorkspace(id);` (line 468):

```typescript
templateWatcher.unwatchWorkspace(id);
```

### 7. Shutdown / `close()` (~line 506)

Add after `pipelineWatcher.closeAll();` (line 506):

```typescript
// Close template file watchers
templateWatcher.closeAll();
```

---

## Summary Checklist

| # | Location | What to add | Anchor (add after) |
|---|----------|-------------|---------------------|
| 1 | Imports | 3 import lines | `PipelineWatcher` import |
| 2 | Route registration | `registerTemplateRoutes`, `registerTemplateWriteRoutes`, `registerReplicateApplyRoutes` | `registerScheduleRoutes` call |
| 3 | Watcher instantiation | `new TemplateWatcher(...)` | `pipelineWatcher` block |
| 4 | Existing workspace loop | `templateWatcher.watchWorkspace(...)` | `pipelineWatcher.watchWorkspace(...)` |
| 5 | `store.registerWorkspace` | `templateWatcher.watchWorkspace(...)` | `pipelineWatcher.watchWorkspace(...)` |
| 6 | `store.removeWorkspace` | `templateWatcher.unwatchWorkspace(...)` | `pipelineWatcher.unwatchWorkspace(...)` |
| 7 | `close()` | `templateWatcher.closeAll()` | `pipelineWatcher.closeAll()` |

No new files. No new dependencies. Pure wiring — every addition mirrors an existing pipeline or task watcher line.
