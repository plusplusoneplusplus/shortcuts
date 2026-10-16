import type { DashboardChatSearchResult, DashboardWorkspaceTarget } from '@plusplusoneplusplus/coc-client';

type Conversations = DashboardChatSearchResult['conversations'];
const prefix = 'coc-dashboard-chat-cache:';
const memory = new Map<string, string>();
const keyFor = (target: DashboardWorkspaceTarget) => prefix + JSON.stringify([target.serverIdentity, target.workspaceId]);

/** Complete title-only inventories; durable identity is independent of aliases and ports. */
export function saveDashboardChatCache(target: DashboardWorkspaceTarget, conversations: Conversations): void {
    const key = keyFor(target);
    const raw = JSON.stringify({ version: 1, target, total: conversations.length, conversations });
    memory.set(key, raw);
    try { localStorage.setItem(key, raw); } catch { /* Session cache survives unavailable storage. */ }
}

export function loadDashboardChatCache(target: DashboardWorkspaceTarget): Conversations | undefined {
    const key = keyFor(target);
    let raw = memory.get(key);
    if (!raw) {
        try { raw = localStorage.getItem(key) ?? undefined; } catch { return undefined; }
    }
    if (!raw) return undefined;
    try {
        const entry = JSON.parse(raw);
        if (!entry || Object.keys(entry).sort().join(',') !== 'conversations,target,total,version'
            || entry.version !== 1 || !entry.target
            || Object.keys(entry.target).sort().join(',') !== 'serverIdentity,workspaceId'
            || entry.target.serverIdentity !== target.serverIdentity || entry.target.workspaceId !== target.workspaceId
            || !Array.isArray(entry.conversations) || !Number.isSafeInteger(entry.total)
            || entry.total !== entry.conversations.length) return undefined;
        const ids = new Set<string>();
        const conversations: Conversations = [];
        for (const row of entry.conversations) {
            if (!row || Object.keys(row).sort().join(',') !== 'processId,title'
                || typeof row.processId !== 'string' || !row.processId.trim() || row.processId.length > 512
                || ids.has(row.processId) || typeof row.title !== 'string' || row.title.length > 4096) return undefined;
            ids.add(row.processId);
            conversations.push({ processId: row.processId, title: row.title });
        }
        memory.set(key, raw);
        return conversations;
    } catch { return undefined; }
}

/** Drop only the session mirror to exercise persisted/reloaded entries. @internal */
export function _resetDashboardChatCacheMemory(): void { memory.clear(); }
