/**
 * Read-only `list todos` reply: active items and recent Done items of one Sentinel chat's
 * ledger, as plain phone-readable lines. Reads through `SentinelTodoService.list`
 * (which proves the owner is a Sentinel chat of the workspace) and never
 * writes the ledger, enqueues a turn, changes the selection, or acknowledges
 * job results.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { SENTINEL_TODO_RECENT_LIMIT } from '@plusplusoneplusplus/coc-client';
import {
    SENTINEL_TODO_STATUS_LABELS,
    sentinelTodoDisplayStatus,
    sentinelTodoPriority,
    sentinelTodoRecentPage,
    sentinelTodoSections,
} from '../spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoStatusModel';
import { SentinelTodoError, type SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import type { SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';

/** Recent-list budget; active items are never capped. */
export const MAX_LISTED_TODOS = SENTINEL_TODO_RECENT_LIMIT;

export const TODOS_NO_TARGET_REPLY = '❌ No topic selected. Reply to a Sentinel chat message, or use `list topics`, then `select topic <n>`.';
export const TODOS_UNAVAILABLE_REPLY = 'To-do lists are unavailable on this server.';

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

/** Active normal and manual items first, then recent Done; archived items stay omitted. */
export function formatTodosReply(title: string, items: readonly SentinelTodoItem[], limit = MAX_LISTED_TODOS): string {
    const page = sentinelTodoRecentPage(items.filter(item => !item.archived), limit);
    const normal = sentinelTodoSections(page.items, 'normal');
    const manual = sentinelTodoSections(page.items, 'manual');
    const total = normal.active.length + manual.active.length;
    if (!page.total) return `📋 To-do · "${title}"\nNo unfinished items.`;
    const lines = [`📋 To-do · "${title}" — ${total} not done`];
    let n = 0;
    for (const item of normal.active) lines.push(itemLine(++n, item));
    if (manual.active.length) {
        lines.push('', 'Manual tracking (tracked only, never run):');
        for (const item of manual.active) lines.push(itemLine(++n, item));
    }
    if (normal.done.length) {
        lines.push('', 'Done:');
        for (const item of normal.done) lines.push(itemLine(++n, item));
    }
    if (manual.done.length) {
        lines.push('', 'Done · Manual tracking (tracked only, never run):');
        for (const item of manual.done) lines.push(itemLine(++n, item));
    }
    if (page.hasMore) lines.push('', `…${page.total - n} older Done items not shown. Open the chat's To-do tab in CoC for the full list.`);
    return lines.join('\n');
}

/** Reads `owner`'s ledger and returns the reply text. */
export async function listTodosReply(
    todos: MessagingTodoReader | undefined,
    store: Pick<ProcessStore, 'getProcess'>,
    owner: SentinelTodoOwner,
): Promise<string> {
    if (!todos) return TODOS_UNAVAILABLE_REPLY;
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
