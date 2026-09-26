/**
 * pinned-reorder-drag — drag payload and order arithmetic for reordering the
 * Pinned section by drag.
 *
 * Pin time is the sort key, so a reorder is just "restamp every pinned entry in
 * the new order" (`PUT /workspaces/:id/pin-order`). The gesture reuses the chat
 * and group row drags: a pinned row writes one more MIME, and only rows in the
 * Pinned section answer it. Folder, composer and queue targets never read it.
 *
 * Everything here is pure: no React, no DOM lookups, no network.
 */

import type { PinOrderEntry, ProcessGroupPin } from '@plusplusoneplusplus/coc-client';
import { getGroupPinKey, getGroupPinKeyForEntry, isPinnedGroupEntry, type PinnedListEntry } from './group-pinning';
import type { ChatFolderDataTransfer } from './chat-folder-drag';

export const PINNED_REORDER_MIME = 'application/vnd.coc.pinned-reorder+json';
export const PINNED_REORDER_DRAG_KIND = 'coc.pinned-reorder';

export interface PinnedReorderDragPayload {
    kind: typeof PINNED_REORDER_DRAG_KIND;
    /** Pins are per-workspace; a drop from another workspace is refused. */
    workspaceId: string;
    key: string;
}

export type PinnedDropPosition = 'above' | 'below';

function typeList(dataTransfer: Pick<ChatFolderDataTransfer, 'types'> | null | undefined): string[] {
    const types = dataTransfer?.types;
    return types ? Array.from(types as Iterable<string>) : [];
}

/**
 * Add the pinned-reorder flavour to a drag. Written after any session-context
 * or folder-move data; `effectAllowed` is only widened so a copy-only drag can
 * still end as a move here.
 */
export function writePinnedReorderDragData(
    dataTransfer: ChatFolderDataTransfer,
    payload: PinnedReorderDragPayload,
): void {
    dataTransfer.setData(PINNED_REORDER_MIME, JSON.stringify(payload));
    const current = dataTransfer.effectAllowed;
    if (current === 'copy' || current === 'copyMove') {
        dataTransfer.effectAllowed = 'copyMove';
    } else if (current !== 'all' && current !== 'move' && current !== 'linkMove') {
        dataTransfer.effectAllowed = 'move';
    }
}

export function dataTransferHasPinnedReorder(
    dataTransfer: Pick<ChatFolderDataTransfer, 'types'> | null | undefined,
): boolean {
    return typeList(dataTransfer).includes(PINNED_REORDER_MIME);
}

export function readPinnedReorderDragPayload(
    dataTransfer: Pick<ChatFolderDataTransfer, 'getData' | 'types'> | null | undefined,
): PinnedReorderDragPayload | null {
    if (!dataTransfer || !dataTransferHasPinnedReorder(dataTransfer)) return null;
    let raw = '';
    try {
        raw = dataTransfer.getData(PINNED_REORDER_MIME);
    } catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as Partial<PinnedReorderDragPayload>;
        if (parsed?.kind !== PINNED_REORDER_DRAG_KIND) return null;
        if (typeof parsed.workspaceId !== 'string' || parsed.workspaceId.length === 0) return null;
        if (typeof parsed.key !== 'string' || parsed.key.length === 0) return null;
        return { kind: PINNED_REORDER_DRAG_KIND, workspaceId: parsed.workspaceId, key: parsed.key };
    } catch {
        return null;
    }
}

/** Upper half of the row drops above it, lower half below. */
export function resolvePinnedDropPosition(clientY: number, rect: { top: number; height: number }): PinnedDropPosition {
    return clientY < rect.top + rect.height / 2 ? 'above' : 'below';
}

/** Key of a pinned row as rendered: the group pin key for groups, the task id for chats. */
export function pinnedEntryKey(entry: PinnedListEntry): string {
    return isPinnedGroupEntry(entry) ? getGroupPinKeyForEntry(entry) : String((entry as { id: string }).id);
}

export function pinOrderEntryKey(entry: PinOrderEntry): string {
    return entry.kind === 'group' ? getGroupPinKey(entry.type, entry.groupId) : entry.id;
}

function pinTime(raw: unknown): number {
    // Same rule as `mergePinnedEntries`, so this order matches what renders.
    if (typeof raw !== 'string' || raw.length === 0) return Number.NEGATIVE_INFINITY;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/**
 * Every pinned entry in the workspace, newest pin first — independent of the
 * All/Running/Failed filter and of which rows are loaded, so entries hidden
 * from view keep their slots relative to each other when the order is saved.
 */
export function buildPinnedFullOrder(
    pinnedChatIds: Iterable<string>,
    pinnedAtById: ReadonlyMap<string, string | undefined>,
    groupPins: readonly ProcessGroupPin[],
): PinOrderEntry[] {
    const items: Array<{ entry: PinOrderEntry; time: number; index: number }> = [];
    for (const id of pinnedChatIds) {
        items.push({ entry: { kind: 'chat', id }, time: pinTime(pinnedAtById.get(id)), index: items.length });
    }
    for (const pin of groupPins) {
        items.push({
            entry: { kind: 'group', type: pin.type, groupId: pin.groupId },
            time: pinTime(pin.pinnedAt),
            index: items.length,
        });
    }
    return items
        .sort((a, b) => (b.time === a.time ? a.index - b.index : b.time > a.time ? 1 : -1))
        .map(item => item.entry);
}

/**
 * Move `draggedKey` above or below `targetKey` within `fullOrder`. Returns
 * `null` when nothing would change (dropped on itself, on the edge next to its
 * own slot, or either key is unknown).
 */
export function reorderPinnedEntries(
    fullOrder: readonly PinOrderEntry[],
    draggedKey: string,
    targetKey: string,
    position: PinnedDropPosition,
): PinOrderEntry[] | null {
    if (draggedKey === targetKey) return null;
    const from = fullOrder.findIndex(entry => pinOrderEntryKey(entry) === draggedKey);
    if (from < 0 || !fullOrder.some(entry => pinOrderEntryKey(entry) === targetKey)) return null;
    const rest = fullOrder.filter((_, i) => i !== from);
    const targetIndex = rest.findIndex(entry => pinOrderEntryKey(entry) === targetKey);
    const insertAt = position === 'above' ? targetIndex : targetIndex + 1;
    if (insertAt === from) return null;
    return [...rest.slice(0, insertAt), fullOrder[from], ...rest.slice(insertAt)];
}
