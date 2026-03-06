---
status: pending
---

# Fix: WebSocket broadcast strips payload, breaking "in progress" bubbles

## Problem

Tasks queued from the SPA Tasks tab don't show "in progress" blue bubbles, even though they are actively in the queue. The folder-level "N in progress" badge is also broken.

## Root Cause

The WebSocket `queue-updated` broadcast in `packages/coc/src/server/index.ts` uses `mapQueued()` (line ~324) which **strips the `payload` field**, only hoisting `workingDirectory`:

```ts
const mapQueued = (t: any) => ({
    id: t.id, repoId: t.repoId, type: t.type, priority: t.priority,
    status: t.status, displayName: t.displayName, createdAt: t.createdAt,
    workingDirectory: (t.payload as any)?.workingDirectory,
    // payload.planFilePath is LOST
});
```

The client-side `useQueueActivity` hook (`packages/coc/src/server/spa/client/react/hooks/useQueueActivity.ts`) needs `item.payload.planFilePath` to map queue items back to task file paths. Since WS items lack `payload`, `extractTaskPath()` returns `null` for every item → `fileMap` is always `{}` → no bubbles.

### Why some tasks DO show "in progress"

The SPA has **two independent** status renderers in `TaskTreeItem.tsx`:
1. **Frontmatter status** → emoji icon (🔄 for `status: in-progress` in YAML) — this is what "fix-task..." and "quick-acce..." show
2. **Queue activity** → blue animated pill (`queueRunning > 0`) — this is what's broken

### Data flow

```
POST /api/queue/tasks → payload.planFilePath ✅
  ↓
Server WS broadcast → mapQueued() strips payload ❌
  ↓
SPA REPO_QUEUE_UPDATED → repoQueueMap[wsId] has stripped items
  ↓
useQueueActivity → item.payload undefined → extractTaskPath returns null
  ↓
fileMap = {} → queueRunning = 0 → no blue bubble
```

## Fix

### Task 1: Include payload paths in WS broadcast

**File:** `packages/coc/src/server/index.ts` (~line 324)

Add `payload` (or selectively `planFilePath`) to `mapQueued`:

```ts
const mapQueued = (t: any) => ({
    id: t.id, repoId: t.repoId, type: t.type, priority: t.priority,
    status: t.status, displayName: t.displayName, createdAt: t.createdAt,
    workingDirectory: (t.payload as any)?.workingDirectory,
    payload: {
        planFilePath: (t.payload as any)?.planFilePath,
        filePath: (t.payload as any)?.filePath,
        workingDirectory: (t.payload as any)?.workingDirectory,
        data: (t.payload as any)?.data ? {
            originalTaskPath: (t.payload as any)?.data?.originalTaskPath,
        } : undefined,
    },
});
```

Selectively hoist only the path fields `extractTaskPath` needs, rather than broadcasting the entire payload (which may contain large prompt content).

### Task 2: Add tests for mapQueued payload passthrough

**File:** New test or existing test in `packages/coc/src/server/` test suite

Verify that `mapQueued` output includes `payload.planFilePath` so the client can map queue items to task files.

### Task 3: Add tests for useQueueActivity with WS-shaped items

**File:** Existing tests for `useQueueActivity`

Add a test case where queue items have the WS broadcast shape (nested `payload.planFilePath` rather than full task objects) to ensure `extractTaskPath` works with both REST and WS item shapes.

## Files to modify

- `packages/coc/src/server/index.ts` — `mapQueued` function
- Test files for the above

## Notes

- The REST API (`GET /api/queue`) returns full payloads via `serializeTask()` — that path is fine
- The initial page load works momentarily (uses REST data), but as soon as the first WS update arrives, `repoQueueMap` overwrites with stripped items and bubbles disappear
- This fix is backward-compatible: adding fields to WS messages doesn't break existing consumers
