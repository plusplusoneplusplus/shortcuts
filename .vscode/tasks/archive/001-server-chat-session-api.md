---
status: pending
---

# 001: Server — Add Type Filter to Queue History API

## Summary

Add a `type` query parameter to `GET /api/queue/history` and `GET /api/queue` so the SPA can query chat sessions separately from other background tasks, and enrich chat-type history entries with conversation metadata (first message preview, turn count) from the linked AIProcess in the process store.

## Motivation

The Queue/Chat Tab Separation feature needs the dashboard SPA to display chat sessions in a dedicated tab, distinct from pipelines, code reviews, and other tasks. The server must support filtering by task type so the SPA can request only chat sessions (or exclude them) without client-side filtering of potentially hundreds of history entries. This is the foundational data layer that all subsequent UI commits depend on.

## Changes

### Files to Create
- (none)

### Files to Modify
- `packages/coc/src/server/queue-handler.ts` — Add `type` query param parsing and filtering to both `GET /api/queue` and `GET /api/queue/history`; add chat metadata enrichment helper
- `packages/coc/test/server/queue-handler.test.ts` — Add tests for type filtering and chat enrichment

### Files to Delete
- (none)

## Implementation Notes

### 1. Type query parameter parsing (both endpoints)

In both `GET /api/queue` and `GET /api/queue/history` handlers, parse a `type` query param from the URL:

```typescript
const typeFilter = typeof parsed.query.type === 'string' && parsed.query.type
    ? parsed.query.type
    : undefined;
```

Validate against `VALID_TASK_TYPES`. If the value is present but invalid, return 400. If absent, return all types (backward compatible).

### 2. Filtering logic

After collecting tasks from the queue manager(s), apply a `.filter()` before sending the response:

```typescript
if (typeFilter) {
    history = history.filter(t => t.type === typeFilter);
}
```

For `GET /api/queue`, apply the same filter to both `queued` and `running` arrays. Stats should remain unfiltered (they reflect the true queue state).

### 3. Chat metadata enrichment

For history entries where `task.type === 'chat'` and `task.processId` is set, look up the linked AIProcess from the `store` (ProcessStore) to extract conversation metadata. Add a helper function:

```typescript
async function enrichChatTasks(
    tasks: Record<string, unknown>[],
    store: ProcessStore | undefined
): Promise<void> {
    if (!store) return;
    for (const task of tasks) {
        if (task.type !== 'chat' || !task.processId) continue;
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
        } catch {
            // Non-fatal: process may not exist
        }
    }
}
```

Call `enrichChatTasks` on the filtered history array before sending the response. Only enrich when a `type=chat` filter is active (avoid N+1 queries when listing all types).

### 4. Key decisions

- **Filter after serialize**: Apply the type filter to the already-serialized `Record<string, unknown>[]` array. This keeps the change minimal and avoids touching `TaskQueueManager` internals.
- **Stats remain global**: The `stats` object in `GET /api/queue` reflects the true queue state, not the filtered view. This avoids confusing badge counts.
- **Enrichment is opt-in**: `chatMeta` is only added when `type=chat` is requested. General history listing doesn't pay the cost of process store lookups.
- **`store` is already available**: `registerQueueRoutes` already receives an optional `ProcessStore` parameter (used by force-fail). The enrichment reuses this.
- **`chat` is already a valid TaskType**: The queue handler's `VALID_TASK_TYPES` set already includes `'chat'`, though pipeline-core's `TaskType` union does not. No type changes needed in pipeline-core for this commit; `chat` tasks are created via the REST API with runtime validation.

## Tests

- `GET /api/queue/history?type=chat` returns only chat-type tasks from history
- `GET /api/queue/history?type=follow-prompt` returns only follow-prompt tasks
- `GET /api/queue/history` (no type param) returns all types (backward compat)
- `GET /api/queue/history?type=invalid` returns 400 error
- `GET /api/queue?type=chat` filters queued and running arrays by type, stats remain unfiltered
- Chat metadata enrichment adds `chatMeta.turnCount` and `chatMeta.firstMessage` when process store has conversation data
- Chat metadata enrichment is resilient when processId has no matching process

## Acceptance Criteria
- [ ] `GET /api/queue/history?type=chat` returns only chat-type history entries
- [ ] `GET /api/queue/history` with no `type` param returns all types (backward compatible)
- [ ] `GET /api/queue?type=chat` filters `queued` and `running` arrays; `stats` remains unfiltered
- [ ] Invalid `type` value returns HTTP 400 with a descriptive error message
- [ ] Chat history entries include `chatMeta` with `turnCount` and `firstMessage` when process store has data
- [ ] Enrichment is non-fatal: missing process or missing conversationTurns does not break the response
- [ ] All existing queue-handler tests continue to pass unchanged

## Dependencies
- Depends on: None

## Assumed Prior State
None — this is the first commit.
