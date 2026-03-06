# Chat Tab: Show Only Pending Badge

## Problem
The Chat tab currently displays three badges: **total** (blue), **running** (green), and **queued** (blue). The user wants to simplify this to **only show the pending (non-completed) count** — i.e., running + queued — and remove the total/completed badge.

## Current Behavior (from image)
- `Chat 6 1` — blue "6" = total sessions (including completed history), green "1" = active/running

## Desired Behavior
- `Chat 1` — a single badge showing only the pending count (running + queued). Hidden when 0.

## Approach
Remove the `chatTotal` badge and merge running + queued into a single "pending" count badge.

## Files to Change

### 1. `packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.ts`
- Remove `chatTotal` from the `RepoQueueStats` interface.
- Add `chatPending: number` = `chatRunning + chatQueued`.
- Stop computing `chatTotal` (drop history counting).

### 2. `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`
- Remove the `chatTotalCount` destructure; add `chatPending: chatPendingCount`.
- Remove all three chat badge `<span>` blocks (lines 134-142).
- Replace with a single badge showing `chatPendingCount` when > 0 (blue `#0078d4`).

### 3. `packages/coc/test/spa/react/useRepoQueueStats.test.tsx`
- Update expected return shapes: replace `chatTotal` with `chatPending`.
- Remove/update history-based `chatTotal` assertions.
- Add assertion that `chatPending = chatRunning + chatQueued`.

### 4. `packages/coc/test/spa/react/RepoDetail.test.ts`
- Remove tests for `chat-total-badge`, `chat-running-badge`, `chat-queued-badge`.
- Add tests for the new single `chat-pending-badge`.
- Update destructure assertion to expect `chatPending: chatPendingCount`.
- Update badge ordering test (now just one chat badge after queue badges).

## Todos
1. **update-hook** — Update `useRepoQueueStats` hook: remove `chatTotal`, add `chatPending`
2. **update-component** — Update `RepoDetail.tsx`: single pending badge replacing three chat badges
3. **update-tests** — Update both test files to match new interface and badge structure
4. **verify-build** — Run `npm run build` and package tests to verify no regressions
