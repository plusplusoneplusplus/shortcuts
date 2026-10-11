/**
 * Activity type/category exclusions (`myWorkExcludedTypes`), shared by the chat
 * list and the collapsed-rail pinned preview without importing `ChatListPane`.
 */

import { normalizeChatMode } from '../../repos/modeConfig';

/** Matches the Chats tab: chat processes, excluding work-item executions. */
export function isChatTask(task: any): boolean {
    if (task.type !== 'chat') return false;
    return !task.workItemId && !task.payload?.workItemId;
}

export function getSessionCategory(task: any): string | undefined {
    return (task.payload?.sessionCategory ?? task.sessionCategory) as string | undefined;
}

export function taskMatchesFilter(task: any, excludedTypes: Set<string>): boolean {
    if (excludedTypes.size === 0) return true;
    // Session category exclusion
    const cat = getSessionCategory(task);
    if (cat && excludedTypes.has(`cat:${cat}`)) return false;
    // Parent 'chat' exclusion hides all chat tasks (including those with modes)
    if (task.type === 'chat') {
        if (excludedTypes.has('chat')) return false;
        const mode = normalizeChatMode(task.payload?.mode ?? task.mode);
        if (mode) return !excludedTypes.has(mode);
        return true;
    }
    return !excludedTypes.has(task.type);
}
