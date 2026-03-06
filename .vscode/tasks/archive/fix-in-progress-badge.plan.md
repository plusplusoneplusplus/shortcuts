# Fix: In-Progress Badge Not Displaying on Enqueue

## Problem

When a task is enqueued via the AI Execution Dashboard, the "in progress" badges on task files and parent folders don't appear until the entire page is refreshed.

**Root cause:** `useQueueActivity` reads from top-level `queueState.queued`/`queueState.running`, but per-repo WebSocket `queue-updated` messages dispatch `REPO_QUEUE_UPDATED` which only writes to `queueState.repoQueueMap[repoId]` — leaving the top-level arrays stale.

| Event | Dispatch | Updates | Hook reads |
|---|---|---|---|
| WS `queue-updated` (per-repo) | `REPO_QUEUE_UPDATED` | `repoQueueMap[repoId]` | `state.queued`/`state.running` ❌ |
| Page refresh | `SEED_QUEUE` | `state.queued`/`state.running` | `state.queued`/`state.running` ✅ |

## Approach

Fix `useQueueActivity` to prefer per-repo data from `repoQueueMap` when available, falling back to the top-level arrays. This is the minimal, localized change — it doesn't alter the reducer or WebSocket handler, avoiding side effects elsewhere.

## Todos

1. **update-useQueueActivity** — In `useQueueActivity.ts`, change the `activeItems` construction (line 69) to first check `queueState.repoQueueMap[wsId]` for `queued`/`running` arrays. Fall back to top-level arrays if no repo entry exists. Update the `useMemo` dependency array to include `queueState.repoQueueMap`.

2. **add-test-useQueueActivity** — Add/update a test for `useQueueActivity` verifying that when `repoQueueMap[wsId]` contains active items but top-level `queued`/`running` are empty, the hook still returns the correct `fileMap` and `folderMap`.

3. **verify-no-regression** — Build and run existing tests to confirm no regressions.

## Files to Change

- `packages/coc/src/server/spa/client/react/hooks/useQueueActivity.ts` — primary fix
- Test file for useQueueActivity (create or update)

## Notes

- The `wsId` passed to `useQueueActivity` may differ from the `repoId` key in `repoQueueMap` due to SHA-256 aliasing (see `resolveWorkspaceIdForQueueMessage` in App.tsx). The WebSocket handler already dispatches to both the raw `repoId` and the resolved `workspaceId`, so looking up by `wsId` should work.
- An alternative approach would be to also update the top-level arrays in the `REPO_QUEUE_UPDATED` reducer case, but that risks breaking the Queue tab which may rely on the top-level arrays being a single consolidated view. The hook-level fix is safer.
