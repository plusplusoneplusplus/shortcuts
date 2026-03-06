# Bug: Queue Deep-Link Doesn't Navigate to Specific Process

## Problem

When opening `http://localhost:4000/#repos/ws-kss6a7/queue/1772291319089-04d5vgf` directly, the app does **not** navigate to the specific process detail. Instead, it shows the queue list with no task selected.

## Root Cause

**Race condition between deep-link parsing and data fetching in `RepoQueueTab.tsx`.**

The sequence of events:

1. **Router** (`Router.tsx:169-170`) parses the hash → dispatches `SELECT_QUEUE_TASK` with the process ID → `selectedTaskId` is set in `QueueContext`.
2. **`RepoQueueTab`** mounts with `running=[]`, `queued=[]`, `history=[]` (HTTP fetch hasn't returned yet, `loading=true`).
3. **Guard effect** (`RepoQueueTab.tsx:125-136`) fires immediately:
   ```ts
   useEffect(() => {
       if (!selectedTaskId) return;
       const allTasks = [...running, ...queued, ...history];
       if (!allTasks.find(t => t.id === selectedTaskId)) {
           queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null }); // ← CLEARS deep-link!
           // Also resets the URL hash back to base queue path
       }
   }, [selectedTaskId, running, queued, history, ...]);
   ```
4. Since all task arrays are empty (fetch in-flight), the task is not found → **selection is cleared to `null`**.
5. When `fetchQueue()` completes and populates the lists, `selectedTaskId` is already `null` → detail panel shows "Select a task".

## Fix

Add a `loading` guard to the clear-selection effect so it only runs after initial data has loaded:

**File:** `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` (lines 125-136)

```diff
     // Clear selection if the selected task is no longer in any list
     useEffect(() => {
-        if (!selectedTaskId) return;
+        if (!selectedTaskId || loading) return;
         const allTasks = [...running, ...queued, ...history];
         if (!allTasks.find(t => t.id === selectedTaskId)) {
             queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
             // Reset URL to base queue path when auto-clearing
             const queueBase = '#repos/' + encodeURIComponent(workspaceId) + '/queue';
             if (location.hash.startsWith(queueBase + '/')) {
                 location.hash = queueBase;
             }
         }
-    }, [selectedTaskId, running, queued, history, queueDispatch, workspaceId]);
+    }, [selectedTaskId, running, queued, history, loading, queueDispatch, workspaceId]);
```

This is safe because:
- `loading` starts as `true` and only becomes `false` after `fetchQueue()` completes or `repoQueue` WS update arrives.
- Once `loading` is `false`, the guard works exactly as before — clearing stale selections for tasks that no longer exist.
- The `loading` dependency ensures the effect re-runs when data arrives.

## Tasks

1. **fix-guard** — Add `loading` guard to the clear-selection `useEffect` in `RepoQueueTab.tsx`
2. **add-test** — Add a test in `test/spa/react/repo-queue-tab.test.tsx` that verifies deep-link `selectedTaskId` is preserved through the loading phase
3. **verify** — Run `npm run test:run` in `packages/coc/` to confirm no regressions

## Affected Files

- `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` — the fix
- `packages/coc/test/spa/react/repo-queue-tab.test.tsx` — new test case
