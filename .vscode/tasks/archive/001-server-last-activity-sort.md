---
status: done
---

# 001: Server-side `lastActivityAt` enrichment and re-sort

## Summary
Add `lastActivityAt` to the `chatMeta` object computed during `enrichChatTasks`, then reorder the chat history endpoint to enrich BEFORE sorting so we can sort by `lastActivityAt` instead of `createdAt`.

## Motivation
Currently the chat sidebar sorts by `createdAt` descending (line 765-769 of queue-handler.ts). When a follow-up message is sent on an older conversation, it stays buried at its original position. By sorting on last activity instead, recently-active conversations surface to the top.

## Changes

### Files to Modify
- `packages/coc/src/server/queue-handler.ts`:
  1. In `enrichChatTasks` (lines 269-298): After computing `turnCount` and `firstMessage`, add a `lastActivityAt` field to `chatMeta`. Compute it as: the timestamp of the last turn in `process.conversationTurns` (the last element's timestamp), falling back to `task.completedAt`, then `task.createdAt`. The value should be a numeric epoch ms (matching the existing `createdAt` format used in sorting).
  2. In the `/api/queue/history` handler (lines 764-784): Move the `enrichChatTasks` call (currently at line 783-784) to BEFORE the sort (before line 765). Then change the sort comparator to use `(a.chatMeta as any)?.lastActivityAt ?? (a.createdAt as number) ?? 0` instead of `(a.createdAt as number) ?? 0`.

Here is the current code for enrichChatTasks (lines 269-298):
```typescript
async function enrichChatTasks(
    tasks: Record<string, unknown>[],
    store: ProcessStore | undefined
): Promise<void> {
    if (!store) return;
    for (const task of tasks) {
        if (task.type !== 'chat' && task.type !== 'readonly-chat' || !task.processId) continue;
        try {
            const process = await store.getProcess(task.processId as string);
            if (!process) continue;
            const turns = process.conversationTurns ?? [];
            const firstUserTurn = turns.find(t => t.role === 'user');
            task.chatMeta = {
                turnCount: turns.length,
                firstMessage: firstUserTurn
                    ? (firstUserTurn.content.length > 120
                        ? firstUserTurn.content.substring(0, 117) + '...'
                        : firstUserTurn.content)
                    : undefined,
            };
            if (process.status === 'running') {
                task.status = 'running';
            }
        } catch {
            // Non-fatal: process may not exist
        }
    }
}
```

And the current sort + enrich order (lines 764-785):
```typescript
                // Sort combined list by createdAt descending
                history.sort((a, b) => {
                    const ta = (a.createdAt as number) ?? 0;
                    const tb = (b.createdAt as number) ?? 0;
                    return tb - ta;
                });
            }

            const pipelineName = ...
            if (pipelineName) { ... }

            // Enrich chat tasks with conversation metadata when filtering by chat type
            if (typeFilter === 'chat') {
                await enrichChatTasks(history, store);
            }
```

## Implementation Notes
- `process.conversationTurns` is an array of turn objects. Each turn MAY have a `timestamp` field (ISO string). The last turn's timestamp represents the most recent activity.
- For turns without timestamps, fall back to `task.completedAt` (also numeric epoch ms on the serialized task), then `task.createdAt`.
- The `lastActivityAt` should be stored as numeric epoch ms in `chatMeta` to match the existing sort pattern.
- Moving enrichment before sort is safe because enrichment mutates tasks in place and the sort uses the enriched data.
- The `pipelineName` filter between sort and old enrich position is unaffected.

## Tests
- Add tests to `packages/coc/test/server/queue-handler.test.ts` for `enrichChatTasks` computing `lastActivityAt`:
  - Test: conversation with turns → `lastActivityAt` equals last turn's timestamp
  - Test: conversation with no turn timestamps → falls back to `completedAt` then `createdAt`
  - Test: conversation with no turns → falls back to `createdAt`
- Add integration test: verify `/api/queue/history?type=chat` returns sessions sorted by last activity, not creation time (create 2 chats, add a follow-up to the older one, verify it comes first)

## Acceptance Criteria
- [ ] `enrichChatTasks` adds `lastActivityAt` (numeric epoch ms) to `chatMeta`
- [ ] `/api/queue/history?type=chat` calls enrichment before sorting
- [ ] Sort uses `lastActivityAt` with fallback to `createdAt`
- [ ] Existing tests still pass
- [ ] New tests cover lastActivityAt computation and sort order

## Dependencies
- Depends on: None

## Assumed Prior State
None — this is the first commit.
