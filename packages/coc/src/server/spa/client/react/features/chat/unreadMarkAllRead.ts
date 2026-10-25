import type { CocClient, SeenStateEntry } from '@plusplusoneplusplus/coc-client';
import { patchSeenState } from '../../hooks/preferences/seenStateApi';
import { getRepoGroupChats } from '../../repos/repoGroupService';
import { buildRepoGroupChatFeedModel } from '../../repos/repoGroupChatFeed';
import { isUnseenGroupChat } from '../../repos/repoGroupChatRowLabels';
import { getTaskCompletedAtIso } from './hooks/useUnseenChat';
import { isChatTask, taskMatchesFilter } from './task-type-filter';
import type { RailPinnedTab } from './rail-pinned-jobs';

export function unreadRailTaskVisible(task: any, tab: RailPinnedTab, excluded: Set<string>, archived?: ReadonlySet<string>): boolean {
    return !task.archived && !archived?.has(task.id) && taskMatchesFilter(task, excluded)
        && (tab === 'activity' || (tab === 'chats' ? isChatTask(task) : !isChatTask(task)));
}

/** Collect the full native scope before using the same completion-stamped batch API as the list. */
export async function markNativeUnreadRead({ client, workspaceId, tab, excluded, archived, signal }: {
    client: CocClient; workspaceId: string; tab: RailPinnedTab; excluded: Set<string>;
    archived?: ReadonlySet<string>; signal: AbortSignal;
}): Promise<void> {
    const baseUrl = client.options?.baseUrl;
    const entries = new Map<string, SeenStateEntry>();
    let offset = 0;
    for (;;) {
        signal.throwIfAborted();
        const page = await client.workspaces.history(workspaceId, { limit: 100, offset });
        signal.throwIfAborted();
        if (!Array.isArray(page.history) || (page.offset !== undefined && page.offset !== offset)
            || (page.hasMore && !page.history.length)) throw new Error('Could not read the full conversation list.');
        for (const task of page.history) {
            if (task.workspaceId && task.workspaceId !== workspaceId) throw new Error('Unexpected conversation owner.');
            const seenAt = getTaskCompletedAtIso(task);
            if (seenAt && unreadRailTaskVisible(task, tab, excluded, archived)) entries.set(task.id, { processId: task.id, seenAt });
        }
        if (!page.hasMore) break;
        offset += page.history.length;
    }
    signal.throwIfAborted();
    if (entries.size) await patchSeenState(workspaceId, [...entries.values()], { baseUrl });
}

/** The group unread badge spans the group and every member, independent of list filters. */
export async function markGroupUnreadRead({ groupId, baseUrl, serverKey, membershipKey, signal }: {
    groupId: string; baseUrl?: string; serverKey: string; membershipKey: string;
    signal: AbortSignal;
}): Promise<void> {
    if (serverKey !== 'local' && !baseUrl) throw new Error('The owning server is unavailable.');
    const byOwner = new Map<string, Map<string, SeenStateEntry>>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let unreadCount = 0;
    do {
        signal.throwIfAborted();
        const page = await getRepoGroupChats(groupId, { limit: 200, cursor }, baseUrl, signal);
        signal.throwIfAborted();
        if (page.groupId !== groupId || page.membershipKey !== membershipKey) throw new Error('Group membership changed. Try again.');
        if (page.counts.partial || page.counts.unread === undefined || page.sources.some(source => !source.available || source.stale)) {
            throw new Error('Some repositories are unavailable. Unread conversations were not changed.');
        }
        unreadCount = page.counts.unread;
        for (const row of buildRepoGroupChatFeedModel(page, serverKey).history.filter(isUnseenGroupChat)) {
            if (!page.sources.some(source => source.workspaceId === row.ownerWorkspaceId)) throw new Error('Unexpected conversation owner.');
            const entries = byOwner.get(row.ownerWorkspaceId) ?? new Map<string, SeenStateEntry>();
            entries.set(row.canonicalId, { processId: row.canonicalId, seenAt: getTaskCompletedAtIso(row.item)! });
            byOwner.set(row.ownerWorkspaceId, entries);
        }
        if (!page.hasMore) break;
        if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error('Could not read the full conversation list.');
        cursor = page.nextCursor;
        cursors.add(cursor);
    } while (true);
    if ([...byOwner.values()].reduce((sum, entries) => sum + entries.size, 0) < unreadCount) throw new Error('The unread list is incomplete. Try again.');
    signal.throwIfAborted();
    const results = await Promise.allSettled([...byOwner].map(async ([owner, entries]) => {
        signal.throwIfAborted();
        await patchSeenState(owner, [...entries.values()], { baseUrl });
    }));
    if (results.some(result => result.status === 'rejected')) throw new Error('Could not mark all conversations read. Some repositories failed; unread conversations remain.');
}
