/**
 * pin-order-pending — keeps a drag-reordered Pinned section from flashing back
 * to the old order.
 *
 * A reorder restamps `pinnedAt` optimistically. A history or group-pin fetch
 * that started before the save can land after it with the old stamps, so every
 * fetch result is passed through these helpers: while a pending order exists,
 * still-pinned entries get the pending stamp. Once a fetch already carries the
 * pending stamps (the server caught up), that half of the pending order is
 * settled and can be dropped.
 */

import type { PinOrderEntry, ProcessGroupPin } from '@plusplusoneplusplus/coc-client';
import { getGroupPinKey } from './group-pinning';

export interface PendingPinOrder {
    workspaceId: string;
    /** processId -> pinnedAt */
    chats: Map<string, string>;
    /** group pin key -> pinnedAt */
    groups: Map<string, string>;
    /** True once the server accepted the order; only then can a fetch settle it. */
    confirmed: boolean;
}

/** Entry `i` gets `now - i ms`, the same scheme the server uses. */
export function stampPinOrder(workspaceId: string, entries: readonly PinOrderEntry[], now: number): PendingPinOrder {
    const pending: PendingPinOrder = { workspaceId, chats: new Map(), groups: new Map(), confirmed: false };
    entries.forEach((entry, i) => {
        const pinnedAt = new Date(now - i).toISOString();
        if (entry.kind === 'chat') pending.chats.set(entry.id, pinnedAt);
        else pending.groups.set(getGroupPinKey(entry.type, entry.groupId), pinnedAt);
    });
    return pending;
}

/**
 * Re-apply pending chat stamps to still-pinned items. `settled` is true when no
 * item needed a change, i.e. the data already reflects the pending order.
 */
export function applyPendingChatStamps<T extends { id: string; pinnedAt?: string }>(
    items: T[],
    stamps: ReadonlyMap<string, string>,
): { items: T[]; settled: boolean } {
    let settled = true;
    const next = items.map(item => {
        const pinnedAt = stamps.get(item.id);
        if (!pinnedAt || !item.pinnedAt || item.pinnedAt === pinnedAt) return item;
        settled = false;
        return { ...item, pinnedAt };
    });
    return { items: settled ? items : next, settled };
}

export function applyPendingGroupStamps(
    pins: ProcessGroupPin[],
    stamps: ReadonlyMap<string, string>,
): { pins: ProcessGroupPin[]; settled: boolean } {
    let settled = true;
    const next = pins.map(pin => {
        const pinnedAt = stamps.get(getGroupPinKey(pin.type, pin.groupId));
        if (!pinnedAt || pin.pinnedAt === pinnedAt) return pin;
        settled = false;
        return { ...pin, pinnedAt };
    });
    return { pins: settled ? pins : next, settled };
}
