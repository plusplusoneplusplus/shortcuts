# Chat Tab: Show Running Chat Count Badge

## Problem

The Chat tab in the CoC SPA dashboard doesn't show the number of active chat sessions at a glance. The Queue tab shows green (running) and blue (queued) badges, and the Tasks tab shows a blue total-count badge ("22"). The Chat tab should follow the same pattern so users can see how many chats are running without switching to the tab.

## Current State

- **`RepoDetail.tsx` (lines 134–136):** Already renders a green badge for `chatRunningCount` when > 0 — this works correctly when chats are in the `running` queue state.
- **`useRepoQueueStats.ts`:** Computes `chatRunning` and `chatQueued` from the queue context's `repoQueueMap[wsId].running/queued` arrays by filtering `type === 'chat'`. However, `chatQueued` is never displayed.
- **Missing:** There is no total chat session count badge (analogous to the Tasks "22" badge). The `history` array in `repoQueueMap` is available but not used for chat counting.

## Proposed Approach

Add a **total chat session count** (blue badge) to the Chat tab, matching the Tasks badge style, and also display the **queued chat count** (blue badge) when chats are waiting.

### Changes

#### 1. Extend `useRepoQueueStats` to include `chatTotal`

**File:** `packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.ts`

- Add `chatTotal: number` to `RepoQueueStats` interface.
- Compute `chatTotal` by counting `type === 'chat'` entries across `running`, `queued`, and `history` arrays in `repoQueueMap[wsId]`.

#### 2. Display badges on the Chat tab

**File:** `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

- Destructure `chatQueued` and `chatTotal` from `useRepoQueueStats`.
- Add a **blue badge** for `chatTotal` (total sessions, same style as Tasks badge).
- Add a **green badge** for `chatRunning` (already exists, keep as-is).
- Add a **blue badge** for `chatQueued` (waiting chats, same style as Queue queued badge).
- Badge ordering on the Chat tab: total (blue) → running (green) → queued (blue).
  - Alternative: show only running (green) + queued (blue), omitting total. Decide based on user preference.

#### 3. Update tests

**File:** `packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.test.ts` (or nearest test file)

- Add test case for `chatTotal` computation (running + queued + history).
- Verify `chatTotal` is 0 when no chat tasks exist.

**File:** `packages/coc/src/server/spa/client/react/repos/RepoDetail.test.tsx` (or nearest test file)

- Add test verifying the chat total badge renders when `chatTotal > 0`.
- Add test verifying the chat queued badge renders when `chatQueued > 0`.

## Key Files

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.ts` | Add `chatTotal` field |
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Render `chatTotal` and `chatQueued` badges |
| Test files for the above | Add coverage for new badge logic |

## Open Questions

- Should the total count badge include completed/failed sessions, or only active (running + queued)?
- Should the badge style match Tasks (blue pill) or Queue (green running + blue queued)?
