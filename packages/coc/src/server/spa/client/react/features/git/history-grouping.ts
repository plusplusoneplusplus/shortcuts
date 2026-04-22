/**
 * history-grouping — groups completed tasks by shared planFilePath.
 *
 * Pure utility: no React, no side effects. Takes a flat list of
 * ProcessHistoryItem and returns a mixed array of HistoryGroup and
 * standalone items, sorted by latest timestamp descending.
 */

import type { ProcessHistoryItem } from '../../types/dashboard';

export interface HistoryGroup {
    kind: 'group';
    planFilePath: string;
    label: string;
    children: ProcessHistoryItem[];
    latestTimestamp: number;
    hasUnseen: boolean;
    aggregateStatus: 'completed' | 'failed' | 'cancelled';
}

export type HistoryEntry = HistoryGroup | (ProcessHistoryItem & { kind?: undefined });

/** Normalize a plan file path for grouping key comparison. */
function normalizePlanPath(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
}

/** Extract basename from a file path. */
function basename(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash >= 0 ? normalized.substring(lastSlash + 1) : normalized;
}

/** Get the effective timestamp for an item (for sorting). */
function getItemTimestamp(item: ProcessHistoryItem): number {
    return item.lastActivityAt ?? item.endTime ?? item.startTime;
}

/** Compute the aggregate status across children (failed > cancelled > completed). */
function computeAggregateStatus(
    children: ProcessHistoryItem[],
): 'completed' | 'failed' | 'cancelled' {
    let hasFailed = false;
    let hasCancelled = false;
    for (const child of children) {
        if (child.status === 'failed') hasFailed = true;
        else if (child.status === 'cancelled') hasCancelled = true;
    }
    if (hasFailed) return 'failed';
    if (hasCancelled) return 'cancelled';
    return 'completed';
}

/**
 * Group a flat history list by shared `planFilePath`.
 *
 * - Items without planFilePath → standalone
 * - Groups with only 1 item → standalone (no singleton groups)
 * - Groups with 2+ items → HistoryGroup
 * - Result sorted by latest timestamp descending
 */
export function groupHistoryByPlanFile(
    items: ProcessHistoryItem[],
    unseenIds?: Set<string>,
): HistoryEntry[] {
    // Partition items by normalized planFilePath
    const byPlan = new Map<string, ProcessHistoryItem[]>();
    const standalone: ProcessHistoryItem[] = [];

    for (const item of items) {
        if (!item.planFilePath) {
            standalone.push(item);
            continue;
        }
        const key = normalizePlanPath(item.planFilePath);
        const group = byPlan.get(key);
        if (group) {
            group.push(item);
        } else {
            byPlan.set(key, [item]);
        }
    }

    const entries: HistoryEntry[] = [];

    // Build groups (2+ items) or demote singletons to standalone
    for (const [, groupItems] of byPlan) {
        if (groupItems.length === 1) {
            standalone.push(groupItems[0]);
            continue;
        }
        // Sort children within group by startTime ascending (plan first)
        groupItems.sort((a, b) => a.startTime - b.startTime);

        const latestTimestamp = Math.max(...groupItems.map(getItemTimestamp));
        const hasUnseen = unseenIds
            ? groupItems.some(c => unseenIds.has(c.id))
            : false;

        entries.push({
            kind: 'group',
            planFilePath: groupItems[0].planFilePath!,
            label: basename(groupItems[0].planFilePath!),
            children: groupItems,
            latestTimestamp,
            hasUnseen,
            aggregateStatus: computeAggregateStatus(groupItems),
        });
    }

    // Add standalone items
    for (const item of standalone) {
        entries.push(item);
    }

    // Sort all entries by latest timestamp descending
    entries.sort((a, b) => {
        const tsA = a.kind === 'group' ? a.latestTimestamp : getItemTimestamp(a);
        const tsB = b.kind === 'group' ? b.latestTimestamp : getItemTimestamp(b);
        return tsB - tsA;
    });

    return entries;
}
