# Context: Queue/Chat Tab Separation

## Goal
Separate the CoC dashboard's Queue and Chat tabs into distinct, purpose-built views: Queue for background jobs only, Chat with a sidebar for browsable session history.

## Commit Sequence
1. Server — Add type filter to queue history API
2. Chat tab — Add sidebar with session history
3. Queue tab — Exclude chat-type tasks
4. Polish — Tab badges and real-time updates

## Key Decisions
- Chat sessions are still `type: 'chat'` queue tasks under the hood — no new data model
- Type filtering is added to existing `/api/queue` and `/api/queue/history` endpoints (backward compatible)
- Chat tab sidebar reuses the split-panel pattern from Queue tab (`RepoQueueTab`)
- Client-side filtering for Queue tab exclusion (simple `.filter()` on type)
- Badge counts derive from filtered data — `useRepoQueueStats` hook is the surgical point
- No new WebSocket event types — existing `queue-updated` events carry task type info

## Conventions
- SPA components in `packages/coc/src/server/spa/client/react/repos/`
- Server handlers in `packages/coc/src/server/queue-handler.ts` and `packages/coc-server/src/api-handler.ts`
- Hooks follow `useXxx` naming (e.g., `useChatSessions`)
- Tests use Vitest, colocated under corresponding `test/` directories
