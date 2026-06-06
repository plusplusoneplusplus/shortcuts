/**
 * group-pinning — pure helpers for parent-row chat list pins.
 *
 * Group pins identify rendered parent rows by group type + group id and never
 * imply child process pin state.
 */

import type { ProcessGroupPin, ProcessGroupPinType } from '@plusplusoneplusplus/coc-client';
import type { ForEachRunGroup } from './for-each-run-grouping';
import type { RalphSession } from './ralph-session-grouping';

export type GroupPinnableEntry = RalphSession | ForEachRunGroup;

export type PinnedGroupEntry<T extends GroupPinnableEntry = GroupPinnableEntry> = T & {
    groupPinnedAt: string;
};

export type PinnedListEntry<TChat = any> = TChat | PinnedGroupEntry;

export interface PartitionPinnedGroupsResult<T extends GroupPinnableEntry> {
    pinnedGroups: Array<PinnedGroupEntry<T>>;
    unpinnedGroups: T[];
}

export function getGroupPinKey(type: ProcessGroupPinType, groupId: string): string {
    return `${type}:${groupId}`;
}

export function getGroupPinTarget(entry: GroupPinnableEntry): { type: ProcessGroupPinType; groupId: string } {
    if (entry.kind === 'ralph-session') {
        return { type: 'ralph-session', groupId: entry.sessionId };
    }
    return { type: 'for-each-run', groupId: entry.runId };
}

export function getGroupPinKeyForEntry(entry: GroupPinnableEntry): string {
    const target = getGroupPinTarget(entry);
    return getGroupPinKey(target.type, target.groupId);
}

export function isPinnedGroupEntry(value: unknown): value is PinnedGroupEntry {
    return !!value
        && typeof value === 'object'
        && typeof (value as { groupPinnedAt?: unknown }).groupPinnedAt === 'string'
        && ((value as { kind?: unknown }).kind === 'ralph-session' || (value as { kind?: unknown }).kind === 'for-each-run');
}

export function partitionPinnedGroups<T extends GroupPinnableEntry>(
    groups: readonly T[],
    groupPins: readonly ProcessGroupPin[],
): PartitionPinnedGroupsResult<T> {
    if (groups.length === 0) {
        return { pinnedGroups: [], unpinnedGroups: [] };
    }

    const pinsByKey = new Map(groupPins.map(pin => [getGroupPinKey(pin.type, pin.groupId), pin]));
    const pinnedGroups: Array<PinnedGroupEntry<T>> = [];
    const unpinnedGroups: T[] = [];

    for (const group of groups) {
        const pin = pinsByKey.get(getGroupPinKeyForEntry(group));
        if (pin) {
            pinnedGroups.push({ ...group, groupPinnedAt: pin.pinnedAt } as PinnedGroupEntry<T>);
        } else {
            unpinnedGroups.push(group);
        }
    }

    pinnedGroups.sort((a, b) => comparePinTimes(b.groupPinnedAt, a.groupPinnedAt));
    return { pinnedGroups, unpinnedGroups };
}

export function mergePinnedEntries<TChat extends { pinnedAt?: unknown }>(
    pinnedChats: readonly TChat[],
    pinnedGroups: readonly PinnedGroupEntry[],
): Array<PinnedListEntry<TChat>> {
    return [
        ...pinnedChats.map((entry, index) => ({ entry, index })),
        ...pinnedGroups.map((entry, index) => ({ entry, index: pinnedChats.length + index })),
    ]
        .sort((a, b) => {
            const timeDiff = getPinnedTime(b.entry) - getPinnedTime(a.entry);
            if (timeDiff !== 0) return timeDiff;
            return a.index - b.index;
        })
        .map(item => item.entry);
}

function getPinnedTime(entry: { pinnedAt?: unknown } | PinnedGroupEntry): number {
    const raw = isPinnedGroupEntry(entry) ? entry.groupPinnedAt : entry.pinnedAt;
    if (typeof raw !== 'string' || raw.trim().length === 0) return Number.NEGATIVE_INFINITY;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function comparePinTimes(a: string, b: string): number {
    return getPinnedTime({ pinnedAt: a }) - getPinnedTime({ pinnedAt: b });
}
