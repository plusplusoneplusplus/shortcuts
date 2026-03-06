# Show Queue Status in Repo Card (Left Sidebar)

## Problem

The repo cards in the left sidebar show process stats (✓success ✗failed ⏗running) but don't show **queue status** — the number of queued/running AI tasks for that repo. Users must click into a repo and open the Queue tab to see if tasks are running or waiting.

## Proposed Approach

Add a compact queue status indicator to each `RepoCard` in the sidebar, sourced from the per-repo `repoQueueMap` in `QueueContext`. The indicator shows running and queued task counts inline, with a visual spinner or icon for active tasks.

### Mockup

Current card stats row:
```
main · 6 tasks   Pipelines: 1       ✓0 ✗0 ⏗0
```

Proposed card stats row (when queue has items):
```
main · 6 tasks   Pipelines: 1   ⏳1 ⏸2   ✓0 ✗0 ⏗0
```
Where `⏳1` = 1 running task, `⏸2` = 2 queued tasks. Hidden when both are 0.

## Todos

### 1. Create `useRepoQueueStats` hook ✅
- **File:** `packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.ts`
- New hook that takes a `workspaceId` and returns `{ running: number, queued: number }` from `QueueContext.state.repoQueueMap[workspaceId]`
- Falls back to `{ running: 0, queued: 0 }` when no data exists
- Memoized to avoid unnecessary re-renders

### 2. Update `RepoCard` to show queue status ✅
- **File:** `packages/coc/src/server/spa/client/react/repos/RepoCard.tsx`
- Add `workspaceId` prop (or use `repo.workspace.id`)
- Call `useRepoQueueStats(workspaceId)` to get running/queued counts
- Render a compact queue badge in the stats row, only when running > 0 or queued > 0
- Style: small pill/badge with icon, consistent with existing stat counts
- Running indicator: spinning or pulsing icon + count
- Queued indicator: waiting icon + count

### 3. Ensure per-repo queue data is populated on load ✅
- **File:** `packages/coc/src/server/spa/client/react/repos/ReposGrid.tsx` (or `ReposView.tsx`)
- On initial load, fetch `/api/queue?repoId=<id>` for each registered repo to seed `repoQueueMap`
- OR: fetch `/api/queue/repos` if it returns per-repo stats in a single call (preferred)
- WebSocket updates already dispatch `REPO_QUEUE_UPDATED` actions, so live updates are handled

### 4. Add tests ✅
- Unit test for `useRepoQueueStats` hook — correct extraction from context
- Unit test for `RepoCard` — renders queue badge when counts > 0, hides when 0
- Verify existing RepoCard tests still pass

## Notes

- The `repoQueueMap` in QueueContext already stores per-repo queue data including stats with `queued` and `running` counts — no backend changes needed.
- WebSocket already broadcasts `REPO_QUEUE_UPDATED` with `repoId`, so live updates will work automatically.
- The `/api/queue/repos` endpoint already exists and can provide initial data for all repos in one call.
- Keep the badge small and unobtrusive — it should not clutter cards for repos with no queue activity.
