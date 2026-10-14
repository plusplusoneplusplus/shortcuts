import { SENTINEL_TODO_RECENT_LIMIT } from '@plusplusoneplusplus/coc-client';
import { z } from 'zod';
import { MAX_TODO_ITEMS, SentinelTodoError } from './sentinel-todo-store';
import type { SentinelTodoLedgerView } from './sentinel-todo-service';
import { sentinelTodoRecentPage } from '../spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoStatusModel';

const listSchema = z.object({
    limit: z.number().int().min(1).max(MAX_TODO_ITEMS).default(SENTINEL_TODO_RECENT_LIMIT),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    itemId: z.string().min(1).max(200).optional(),
    includeArchived: z.boolean().default(true),
});

/** Presentation only: the full ledger remains available to correctness-sensitive callers. */
export function sentinelTodoRecentList(ledger: SentinelTodoLedgerView, input: unknown = {}) {
    const parsed = listSchema.safeParse(input);
    if (!parsed.success) {
        throw new SentinelTodoError('invalid', 'Invalid to-do list limit, offset, itemId or includeArchived');
    }
    const { limit, offset, itemId, includeArchived } = parsed.data;
    const eligible = ledger.items.filter(item => (!itemId || item.id === itemId) && (includeArchived || !item.archived));
    if (itemId && !eligible.length) {
        throw new SentinelTodoError('not_found', 'To-do item not found');
    }
    return {
        revision: ledger.revision,
        ...(ledger.tagLibrary ? { tagLibrary: ledger.tagLibrary } : {}),
        ...sentinelTodoRecentPage(eligible, limit, itemId ? 0 : offset),
    };
}
