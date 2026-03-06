---
status: pending
---

# 004: Polish — Tab Badges and Real-Time Updates

## Summary

Wire tab badges and WebSocket-driven real-time updates to respect the Queue/Chat split so each tab shows only its own item counts and reacts instantly to lifecycle events.

## Motivation

After commits 1-3 separate the data and UI, the badges on the repo-detail tab bar and the real-time WebSocket pipeline still operate on unfiltered queue arrays. Without this commit a new chat session would bump the Queue badge, and completing a background job would not update the Chat sidebar — breaking the mental model of two distinct surfaces.

## Changes

### Files to Create

- (none expected)

### Files to Modify

- **`packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`**
  — Filter `repoQueue.running` and `repoQueue.queued` by `task.type !== 'chat'` before computing `queueRunningCount` / `queueQueuedCount` (lines ~44-46). Add a Chat badge that counts `repoQueue.running.filter(t => t.type === 'chat').length + repoQueue.history.filter(t => t.type === 'chat' && isRecent(t)).length` (or active chat sessions). Render the Chat badge on the `chat` tab key alongside existing Tasks/Queue badge blocks (lines ~101-109).

- **`packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.ts`**
  — Extend the returned `RepoQueueStats` with `chatRunning` and `chatQueued` counts. Apply `task.type !== 'chat'` filter when computing `running` and `queued` so callers get queue-only numbers by default.

- **`packages/coc/src/server/spa/client/react/context/QueueContext.tsx`**
  — In `QUEUE_UPDATED` and `REPO_QUEUE_UPDATED` reducers, no structural change needed; the existing arrays already carry `task.type`. Add a convenience selector / derived field `chatCount` (number of running + recently-completed chat tasks) to the state if badge logic becomes complex enough to warrant it; otherwise keep filtering in the view layer.

- **`packages/coc/src/server/spa/client/react/App.tsx`** (WebSocket handler, lines ~147-177)
  — On `queue-updated`, after dispatching `QUEUE_UPDATED` / `REPO_QUEUE_UPDATED`, emit a synthetic DOM custom event `chat-queue-updated` (or dispatch a new `CHAT_UPDATED` action to QueueContext) when any item in the payload has `type === 'chat'`. This lets the Chat sidebar react without polling. Alternatively, the Chat sidebar can simply subscribe to the existing `REPO_QUEUE_UPDATED` and filter internally — prefer this simpler approach unless latency is noticeable.

- **`packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`** (or the Chat sidebar component from commit 2)
  — Subscribe to `queueState.repoQueueMap[wsId]` (already available via `useQueue()`). When the map updates, re-derive the chat session list by filtering items with `type === 'chat'`. This ensures that when a chat completes or a new one is enqueued, the sidebar refreshes in real time without a manual fetch.

- **`packages/coc/src/server/spa/client/react/repos/components/ProcessesSidebar.tsx`** (if shared with Chat)
  — Ensure `filterQueueTask()` (lines ~15-33) respects an optional `typeFilter` param so the Queue sidebar can pass `excludeTypes: ['chat']` and the Chat sidebar can pass `includeTypes: ['chat']`. This avoids duplicating filter logic.

### Files to Delete

- (none expected)

## Implementation Notes

- **Badge filtering is view-level, not API-level.** The `queue-updated` WebSocket payload already includes `task.type` on every item (mapped at `index.ts` lines 324-334). No server changes are needed — all filtering is done in React.
- **`useRepoQueueStats` is the single source of truth** for badge numbers in `RepoDetail`. Changing the hook automatically fixes the badges without touching the JSX.
- **Chat badge design choice:** Show a small green dot (or count) for active chat sessions (`type === 'chat'` with `status === 'running'`). Avoid showing historical chat count — it would grow unbounded and lose meaning. An alternative is an "unread" dot if any chat completed since the user last opened the Chat tab; this requires a `lastSeenTimestamp` stored in local state or `localStorage`.
- **Workspace ID aliasing** (the `repoIdAliasRef` dance in App.tsx) already ensures both the SHA256 repo ID and the workspace ID get dispatched. No extra work needed for the Chat tab to receive per-repo updates.
- **No new WebSocket event type required.** The existing `queue-updated` event carries all the data; the Chat sidebar filters by `type === 'chat'` client-side. A dedicated `chat-updated` event is only warranted if chat sessions have extra metadata (e.g., turn count, title) not present on standard queue items — defer this to a follow-up.
- **`repoQueueMap` already stores `history`** — use `repoQueueMap[wsId].history.filter(t => t.type === 'chat')` for the Chat sidebar's session list, avoiding a separate API call.

## Tests

- **Unit: `useRepoQueueStats` returns filtered counts** — Given a `repoQueueMap` entry with mixed `type` values, assert `running`/`queued` exclude `'chat'` items and `chatRunning` includes only `'chat'` items.
- **Unit: RepoDetail badge rendering** — Render `RepoDetail` with mock queue state containing chat + non-chat tasks. Assert Queue badges reflect non-chat counts and Chat badge reflects chat counts.
- **Unit: ProcessesSidebar `filterQueueTask` with `typeFilter`** — Assert that passing `excludeTypes: ['chat']` filters out chat items and `includeTypes: ['chat']` returns only chat items.
- **Unit: Chat sidebar real-time update** — Dispatch a `REPO_QUEUE_UPDATED` action with a newly-completed chat task. Assert the Chat sidebar re-renders with the updated session.
- **Integration: concurrent chat + background job** — Enqueue a `type: 'chat'` and a `type: 'run-pipeline'` task for the same repo. Simulate `queue-updated` WebSocket events as each progresses. Assert Queue badge increments only for the pipeline task and Chat badge increments only for the chat task. On completion, assert each tab's sidebar shows the correct finished item.

## Acceptance Criteria

- [ ] Queue tab badge counts only non-chat tasks (`type !== 'chat'`) for running and queued states
- [ ] Chat tab shows a badge indicating active chat sessions (running `type === 'chat'` count)
- [ ] WebSocket `queue-updated` events update both Queue and Chat tabs in real time
- [ ] Creating a new chat via the Chat tab does NOT increment the Queue tab badge
- [ ] Completing a chat session updates the Chat sidebar immediately (no manual refresh)
- [ ] Completing a background pipeline task does NOT cause a Chat sidebar update
- [ ] Concurrent chat + background job shows correct independent badge counts
- [ ] `useRepoQueueStats` hook returns separated queue-only and chat-only counts
- [ ] No new WebSocket event types or server-side changes required

## Dependencies

- Depends on: 002, 003

## Assumed Prior State

- Commit 1-3 applied
- Chat tab has sidebar with session history (commit 2)
- Queue tab excludes chat-type tasks from its list (commit 3)
- Queue items carry `type` field including `'chat'` value
- `repoQueueMap` per-repo state already populated via WebSocket
- Need to wire up badges and real-time updates to match the separation
