/**
 * Read-only `list todos` reply: the not-done items of one Sentinel chat's
 * ledger, as plain phone-readable lines. Reads through `SentinelTodoService.list`
 * (which proves the owner is a Sentinel chat of the workspace) and never
 * writes the ledger, enqueues a turn, changes the selection, or acknowledges
 * job results.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import {
    SENTINEL_TODO_STATUS_LABELS,
    sentinelTodoDisplayStatus,
    sentinelTodoPriority,
    sentinelTodoSections,
} from '../spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoStatusModel';
import { SentinelTodoError, type SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import type { SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';

/** Items listed per reply; the rest are counted, never silently dropped. */
export const MAX_LISTED_TODOS = 100;

export const TODOS_NO_TARGET_REPLY = '❌ No topic selected. Reply to a Sentinel chat message, or use `list topics`, then `select topic <n>`.';
export const TODOS_DISABLED_REPLY = 'To-do lists are turned off on this server.';

export type MessagingTodoReader = Pick<SentinelTodoService, 'list'>;

function itemLine(n: number, item: SentinelTodoItem): string {
    const status = SENTINEL_TODO_STATUS_LABELS[sentinelTodoDisplayStatus(item)];
    const jobs = item.jobs.map(job => job.execution.state);
    const job = jobs.includes('running') ? ' · job running' : jobs.includes('queued') ? ' · job queued' : '';
    const priority = sentinelTodoPriority(item) === 'high' ? ' · High' : '';
    const reason = item.status === 'needs_attention' && item.statusReason
        ? `\n   ↳ ${item.statusReason.length > 160 ? `${item.statusReason.slice(0, 159)}…` : item.statusReason}` : '';
    return `${n}. [${status}${job}${priority}] ${item.title}${reason}`;
}

/** Plain-text list of non-Done, non-archived items, normal first, then Manual tracking. */
export function formatTodosReply(title: string, items: readonly SentinelTodoItem[], limit = MAX_LISTED_TODOS): string {
    const normal = sentinelTodoSections(items, 'normal').active;
    const manual = sentinelTodoSections(items, 'manual').active;
    const total = normal.length + manual.length;
    if (!total) return `📋 To-do · "${title}"\nNo unfinished items.`;
    const lines = [`📋 To-do · "${title}" — ${total} not done`];
    let n = 0;
    for (const item of normal) if (n < limit) lines.push(itemLine(++n, item));
    const shownManual = manual.slice(0, Math.max(0, limit - n));
    if (shownManual.length) {
        lines.push('', 'Manual tracking (tracked only, never run):');
        for (const item of shownManual) lines.push(itemLine(++n, item));
    }
    if (n < total) lines.push('', `…${total - n} more not shown. Open the chat's To-do tab in CoC for the full list.`);
    return lines.join('\n');
}

/** Reads `owner`'s ledger and returns the reply text. */
export async function listTodosReply(
    todos: MessagingTodoReader | undefined,
    store: Pick<ProcessStore, 'getProcess'>,
    owner: SentinelTodoOwner,
): Promise<string> {
    if (!todos) return TODOS_DISABLED_REPLY;
    try {
        const ledger = await todos.list(owner);
        const process = await store.getProcess(owner.processId, owner.workspaceId).catch(() => undefined);
        return formatTodosReply(process?.title ?? process?.customTitle ?? owner.processId, ledger.items);
    } catch (error) {
        if (error instanceof SentinelTodoError && error.code === 'not_found') {
            return '❌ This chat is not a Sentinel chat, so it has no to-do list. Reply to a Sentinel chat message or select a Sentinel topic.';
        }
        console.error('[messaging] To-do list failed:', error);
        return 'Could not read the to-do list. Please try again later.';
    }
}
