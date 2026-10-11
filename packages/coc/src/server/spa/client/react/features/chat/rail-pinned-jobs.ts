/**
 * rail-pinned-jobs — the collapsed-rail pinned preview's rows. The workspace's
 * full pinned set (`GET /workspaces/:id/pinned`, independent of history paging)
 * is overlaid with the chat list's live pin/archive state and loaded rows, so
 * sidebar pins, unpins, archives and deletes apply before the next refetch.
 */

import type { WorkspacePinnedEntry } from '@plusplusoneplusplus/coc-client';
import { getChatSelectionId } from './latestSentinelChat';
import { isChatTask, taskMatchesFilter } from './task-type-filter';

export type RailPinnedTab = 'activity' | 'chats' | 'tasks';

export interface PinnedSnapshot {
    entries: readonly WorkspacePinnedEntry[];
}

export interface RailPinnedInput {
    snapshot: PinnedSnapshot | null;
    running: readonly any[];
    history: readonly any[];
    /**
     * Sidebar pin order (`ChatPrefsState.pinnedIds`), authoritative for loaded
     * history rows; null until the sidebar's pin state has loaded.
     */
    pinnedIds: readonly string[] | null;
    archivedIds: ReadonlySet<string>;
    excludedTypes: Set<string>;
    tab: RailPinnedTab;
}

export const pinnedJobKey = (task: any): string => getChatSelectionId(task);

/** Every loaded row's key; a change triggers a pinned-set refetch. */
export function loadedPinKeys(running: readonly any[], history: readonly any[]): string[] {
    return [...running, ...history].map(pinnedJobKey);
}

const pinTime = (value: unknown): number => (typeof value === 'string' ? Date.parse(value) || 0 : 0);

/** Visible pinned rows, newest pin first; optimistic pins without a stamp lead, as in the sidebar. */
export function selectRailPinnedJobs({ snapshot, running, history, pinnedIds, archivedIds, excludedTypes, tab }: RailPinnedInput): any[] {
    const loadedHistory = new Map(history.map(task => [pinnedJobKey(task), task]));
    const loadedRunning = new Map(running.map(task => [pinnedJobKey(task), task]));
    const local = (key: string) => loadedRunning.get(key) ?? loadedHistory.get(key);
    const pinned = new Set((pinnedIds ?? []).map(id => pinnedJobKey({ id })));
    const rows = new Map<string, any>();
    for (const entry of snapshot?.entries ?? []) {
        const key = pinnedJobKey(entry);
        const row = local(key);
        if (pinnedIds && loadedHistory.has(key) && !loadedRunning.has(key) && !pinned.has(key)) continue;
        if (!row && entry.archived) continue;
        rows.set(key, row
            ? { ...row, pinnedAt: pinTime(row.pinnedAt) > pinTime(entry.pinnedAt) ? row.pinnedAt : entry.pinnedAt }
            : entry);
    }
    for (const key of pinned) {
        const row = local(key);
        if (row && !rows.has(key)) rows.set(key, row);
    }
    return [...rows.entries()]
        .filter(([key, row]) => {
            if (archivedIds.has(key) || archivedIds.has(row.id) || !taskMatchesFilter(row, excludedTypes)) return false;
            if (tab === 'chats') return isChatTask(row);
            if (tab === 'tasks') return !isChatTask(row);
            return true;
        })
        .map(([, row]) => row)
        .sort((a, b) => {
            const timeA = pinTime(a.pinnedAt) || Infinity;
            const timeB = pinTime(b.pinnedAt) || Infinity;
            return timeA === timeB ? 0 : timeB - timeA;
        });
}
