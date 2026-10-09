/**
 * latestSentinelChat — pure helpers behind the collapsed-rail Sentinel shortcut.
 *
 * Kept free of `ChatListPane` imports so the chat list and the rail share one
 * recency rule and one row-title rule without a module cycle.
 */

import { isRalphTask } from '../../../../../tasks/task-types';
import { normalizeChatMode } from '../../repos/modeConfig';
import { isQueueProcessId, toQueueProcessId } from '../../utils/queue-process-id';

/** Chats-tab recency: newest `completedAt || startedAt || createdAt` first. */
export function compareChatRecency(a: any, b: any): number {
    const timeA = a.completedAt || a.startedAt || a.createdAt || 0;
    const timeB = b.completedAt || b.startedAt || b.createdAt || 0;
    return new Date(timeB).getTime() - new Date(timeA).getTime();
}

/** Sidebar row title: custom title → AI title → latest message → prompt. */
export function getChatRowTitle(task: any): string {
    const promptText = (task.prompt || task.promptPreview || task.payload?.promptContent || task.payload?.prompt || '') as string;
    const promptFallback = promptText && !/^Use the \S+ skill\.$/.test(promptText)
        ? (promptText.length > 50 ? promptText.substring(0, 47) + '…' : promptText)
        : (task.type === 'chat' ? 'Chat' : (task.type || 'Task'));
    return (task.customTitle as string | undefined)
        || (task.title as string | undefined)
        || (task.lastMessagePreview as string | undefined)
        || promptFallback;
}

/** A Chats-tab chat (not a work-item execution) in Sentinel mode. */
export function isSentinelChat(task: any): boolean {
    if (!task || task.type !== 'chat') return false;
    if (task.workItemId || task.payload?.workItemId) return false;
    if (isRalphTask(task)) return false;
    return normalizeChatMode(task.payload?.mode ?? task.mode) === 'sentinel';
}

/** The process id `selectTask` files a selection under. */
export function getChatSelectionId(task: any): string {
    const id = String(task.id);
    return isQueueProcessId(id) ? id : (task.processId ?? toQueueProcessId(id));
}

/**
 * The most recent non-archived Sentinel chat among this list's running and
 * completed chats, or null. Running rows win a processId tie, as in the list.
 */
export function selectLatestSentinelChat(
    running: readonly any[],
    history: readonly any[],
    archivedChatIds?: ReadonlySet<string>,
): any | null {
    const seen = new Set<string>();
    let latest: any | null = null;
    for (const task of [...running, ...history]) {
        if (!isSentinelChat(task)) continue;
        const key = task.processId || task.payload?.processId || task.id;
        if (seen.has(key)) continue;
        seen.add(key);
        if (archivedChatIds?.has(task.id)) continue;
        if (!latest || compareChatRecency(task, latest) < 0) latest = task;
    }
    return latest;
}
