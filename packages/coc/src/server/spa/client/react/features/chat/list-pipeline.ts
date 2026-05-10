/**
 * list-pipeline — pure helpers shared by the Activity / Chats / Tasks variants
 * of `ChatListPane`.
 *
 * The previous implementation duplicated this logic across two large rendering
 * branches (`activeTab === 'chats'` and `!activeTab`). Centralising the data
 * pipeline here lets both branches drive their UI from the same building
 * blocks, and makes the rules independently unit-testable.
 *
 * No React, no DOM, no side effects.
 */

import { taskMatchesFilter, taskMatchesSearch } from './ChatListPane';
import { groupHistoryByPlanFile, type HistoryGroup, type HistoryEntry } from '../git/history-grouping';
import { groupByRalphSession, type RalphHistoryEntry, type RalphSession } from './ralph-session-grouping';

export type { HistoryGroup, HistoryEntry, RalphHistoryEntry, RalphSession };

/**
 * Predicate options for {@link filterTasks}.
 *
 * - `excludedTypes` — feeds {@link taskMatchesFilter}; type/category exclusions.
 * - `searchQuery` — feeds {@link taskMatchesSearch}; client-side text match.
 * - `scopePredicate` — additional gate (e.g. Activity tab's chat/auto/all scope).
 *
 * Pause-marker entries (`kind === 'pause-marker'`) in the queued list always
 * pass through unchanged so the Activity UI keeps its inline markers.
 */
export interface FilterTasksOptions {
    excludedTypes?: Set<string>;
    searchQuery?: string;
    scopePredicate?: (task: any) => boolean;
}

/**
 * Apply the shared filter stack to the three queue task lists.
 *
 * Mirrors the predicate composition that previously lived as three top-level
 * `useMemo`s plus a tab-aware re-filter inside `ChatListPane`.
 */
export function filterTasks<T extends { kind?: string } = any>(
    running: T[],
    queued: T[],
    history: T[],
    opts: FilterTasksOptions = {},
): { running: T[]; queued: T[]; history: T[] } {
    const excludedTypes = opts.excludedTypes ?? new Set<string>();
    const searchQuery = opts.searchQuery ?? '';
    const scope = opts.scopePredicate ?? (() => true);

    const passes = (t: T): boolean =>
        taskMatchesFilter(t as any, excludedTypes)
        && taskMatchesSearch(t as any, searchQuery)
        && scope(t);

    return {
        running: running.filter(passes),
        // Pause markers are structural and never participate in filtering.
        queued: queued.filter(t => t.kind === 'pause-marker' || passes(t)),
        history: history.filter(passes),
    };
}

/**
 * Bucket boundaries used by {@link bucketByDate}.
 *
 * Default values match the Activity / Chats branches: `today` = last 24h,
 * `week` = last 7 days, everything else is `older`. `now` defaults to
 * `Date.now()` so callers can inject a fixed clock in tests.
 */
export interface BucketByDateOptions {
    now?: number;
    todayHours?: number;
    weekHours?: number;
}

/**
 * Bucket a flat list of history entries into Today / This week / Older.
 *
 * Canonical timestamp resolution order (chosen during the 001 refactor to
 * unify `chatGroups` and `dateBucketedHistory`): for grouped entries (plan
 * groups or ralph sessions) use `latestTimestamp`; otherwise prefer
 * `lastActivityAt`, then `endTime`, `completedAt`, `startTime`, `startedAt`,
 * `createdAt`. Numeric values pass through; string values are parsed via
 * `new Date()`. Entries with no resolvable timestamp fall into `older`.
 *
 * Boundaries match the legacy implementation: `< 24h` → today,
 * `< 7d` → week, otherwise older.
 */
export function bucketByDate<T extends { kind?: string; latestTimestamp?: number } = any>(
    items: T[],
    opts: BucketByDateOptions = {},
): { today: T[]; week: T[]; older: T[] } {
    const now = opts.now ?? Date.now();
    const todayHours = opts.todayHours ?? 24;
    const weekHours = opts.weekHours ?? 24 * 7;
    const today: T[] = [];
    const week: T[] = [];
    const older: T[] = [];
    for (const entry of items) {
        const ts = resolveEntryTimestamp(entry);
        const ageH = ts > 0 ? (now - ts) / 3600000 : Infinity;
        if (ageH < todayHours) today.push(entry);
        else if (ageH < weekHours) week.push(entry);
        else older.push(entry);
    }
    return { today, week, older };
}

/**
 * Resolve the canonical timestamp for a history entry.
 * Exposed primarily so unit tests can verify the resolution order.
 */
export function resolveEntryTimestamp(entry: any): number {
    if (entry && (entry.kind === 'group' || entry.kind === 'ralph-session')) {
        const ts = entry.latestTimestamp;
        return typeof ts === 'number' ? ts : 0;
    }
    const raw = entry?.lastActivityAt
        ?? entry?.endTime
        ?? entry?.completedAt
        ?? entry?.startTime
        ?? entry?.startedAt
        ?? entry?.createdAt
        ?? 0;
    if (typeof raw === 'number') return raw;
    if (!raw) return 0;
    const parsed = +new Date(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Partition a flat history list into pinned / unpinned / archived buckets.
 *
 * Pinned entries are returned in the iteration order of `pinnedIds` (newest
 * pinned first, matching the existing UI contract). Unpinned entries keep
 * their incoming order. Archived entries are moved into their own bucket and
 * never appear in pinned/unpinned.
 */
export function partitionPinnedArchived<T extends { id: string } = any>(
    items: T[],
    pinnedIds?: ReadonlySet<string> | null,
    archivedIds?: ReadonlySet<string> | null,
): { pinned: T[]; unpinned: T[]; archived: T[] } {
    const pinned: T[] = [];
    const unpinned: T[] = [];
    const archived: T[] = [];

    if ((!pinnedIds || pinnedIds.size === 0) && (!archivedIds || archivedIds.size === 0)) {
        return { pinned, unpinned: [...items], archived };
    }

    const byId = new Map<string, T>();
    for (const item of items) {
        if (archivedIds?.has(item.id)) {
            archived.push(item);
            continue;
        }
        if (pinnedIds?.has(item.id)) {
            byId.set(item.id, item);
            continue;
        }
        unpinned.push(item);
    }

    if (pinnedIds) {
        for (const id of pinnedIds) {
            const item = byId.get(id);
            if (item) pinned.push(item);
        }
    }

    return { pinned, unpinned, archived };
}

/**
 * Group history entries by ralph session id. Non-ralph items pass through.
 * Wrapper around {@link groupByRalphSession} to provide a stable
 * pipeline-level entry point.
 */
export function applyRalphGrouping(items: any[], unseenIds?: Set<string>): RalphHistoryEntry[] {
    return groupByRalphSession(items, unseenIds);
}

/**
 * Group consecutive history entries that share a `planFilePath` into
 * `HistoryGroup` containers. Wrapper around {@link groupHistoryByPlanFile}.
 */
export function applyPlanGrouping(items: any[], unseenIds?: Set<string>): HistoryEntry[] {
    return groupHistoryByPlanFile(items, unseenIds);
}
