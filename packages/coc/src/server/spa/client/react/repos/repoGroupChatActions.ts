import type { RepoGroupChatSource } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor, getSpaCocClientErrorMessage } from '../api/cocClient';
import type { RepoGroupChatRow } from './repoGroupChatFeed';

export type RepoGroupChatAction = 'pin' | 'unpin' | 'archive' | 'unarchive' | 'delete' | 'cancel';
export interface RepoGroupChatActionResult {
    succeeded: string[];
    succeededByOwner?: Record<string, number>;
    failed: Array<{ key: string; ownerWorkspaceId: string; error: string }>;
}

export function groupChatActionAllowed(row: RepoGroupChatRow, action: RepoGroupChatAction, sources: RepoGroupChatSource[]): boolean {
    const source = sources.find(source => source.workspaceId === row.ownerWorkspaceId);
    if (!source?.available || source.stale) return false;
    const active = row.section !== 'history';
    if (action === 'cancel') return active;
    if (action === 'delete') return !active;
    if (action === 'archive') return !active && !row.item.pinnedAt;
    if (action === 'unarchive') return !active && !!row.item.archived;
    if (action === 'pin') return !active && !row.item.pinnedAt;
    return !active && !!row.item.pinnedAt;
}

export async function applyRepoGroupQueueControl(
    source: RepoGroupChatSource, action: 'pause' | 'resume' | 'delay',
    serverKey: string, baseUrl?: string, minutes = 0,
): Promise<void> {
    if (!source.available || source.stale || serverKey !== 'local' && !baseUrl) throw new Error('The owning queue is unavailable.');
    const client = getCocClientFor(baseUrl);
    const scope = { workspace: source.workspaceId };
    if (action === 'delay') await client.queue.setTaskDelay({ scope: 'all', delayMinutes: minutes }, scope);
    else if (action === 'pause') await client.queue.pause(scope);
    else await client.queue.resume(scope);
}

/** Each mutation resolves the immutable row owner, never the navigation group or active clone alias. */
export async function applyRepoGroupChatAction(
    rows: RepoGroupChatRow[],
    action: RepoGroupChatAction,
    sources: RepoGroupChatSource[],
    baseUrl?: string,
): Promise<RepoGroupChatActionResult> {
    const succeededByOwner: Record<string, number> = {};
    const result: RepoGroupChatActionResult = { succeeded: [], failed: [], succeededByOwner };
    for (const row of rows) {
        try {
            if (row.serverKey !== 'local' && !baseUrl) throw new Error('The owning server is unavailable.');
            if (!groupChatActionAllowed(row, action, sources)) throw new Error('This action is unavailable for the selected chat.');
            const client = getCocClientFor(baseUrl);
            const owner = { workspace: row.ownerWorkspaceId };
            if (action === 'cancel') {
                if (row.section === 'queued' && row.queueTaskId) await client.queue.cancel(row.queueTaskId);
                else await client.processes.cancel(row.canonicalId, owner);
            } else if (action === 'delete') await client.processes.delete(row.canonicalId, owner);
            else await client.request(`/processes/${encodeURIComponent(row.canonicalId)}/${action === 'pin' || action === 'unpin' ? 'pin' : 'archive'}`, {
                method: 'PATCH', query: owner,
                body: action === 'pin' || action === 'unpin' ? { pinned: action === 'pin' } : { archived: action === 'archive' },
            });
            result.succeeded.push(row.key);
            succeededByOwner[row.ownerWorkspaceId] = (succeededByOwner[row.ownerWorkspaceId] ?? 0) + 1;
        } catch (error) {
            result.failed.push({ key: row.key, ownerWorkspaceId: row.ownerWorkspaceId,
                error: getSpaCocClientErrorMessage(error, 'The owning server refused the action.') });
        }
    }
    return result;
}
