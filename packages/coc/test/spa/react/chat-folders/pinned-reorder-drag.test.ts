/**
 * pinned-reorder-drag — payload round-trip, drop position and order arithmetic
 * for drag-reordering the Pinned section.
 */
import { describe, it, expect } from 'vitest';
import type { PinOrderEntry } from '@plusplusoneplusplus/coc-client';
import {
    PINNED_REORDER_MIME,
    PINNED_REORDER_DRAG_KIND,
    buildPinnedFullOrder,
    dataTransferHasPinnedReorder,
    pinOrderEntryKey,
    readPinnedReorderDragPayload,
    reorderPinnedEntries,
    resolvePinnedDropPosition,
    writePinnedReorderDragData,
} from '../../../../src/server/spa/client/react/features/chat/pinned-reorder-drag';

function makeDataTransfer(): any {
    const store = new Map<string, string>();
    return {
        effectAllowed: 'uninitialized',
        dropEffect: 'none',
        setData: (format: string, data: string) => { store.set(format, data); },
        getData: (format: string) => store.get(format) ?? '',
        get types() { return Array.from(store.keys()); },
    };
}

const chat = (id: string): PinOrderEntry => ({ kind: 'chat', id });
const group = (groupId: string): PinOrderEntry => ({ kind: 'group', type: 'ralph-session', groupId });
const keys = (order: PinOrderEntry[] | null) => order?.map(pinOrderEntryKey) ?? null;

describe('pinned reorder payload', () => {
    it('round-trips and advertises its MIME', () => {
        const dt = makeDataTransfer();
        writePinnedReorderDragData(dt, { kind: PINNED_REORDER_DRAG_KIND, workspaceId: 'ws1', key: 'c1' });
        expect(dataTransferHasPinnedReorder(dt)).toBe(true);
        expect(dt.effectAllowed).toBe('move');
        expect(readPinnedReorderDragPayload(dt)).toEqual({ kind: PINNED_REORDER_DRAG_KIND, workspaceId: 'ws1', key: 'c1' });
    });

    it('widens a copy-only drag to copyMove and keeps copyMove', () => {
        const dt = makeDataTransfer();
        dt.effectAllowed = 'copy';
        writePinnedReorderDragData(dt, { kind: PINNED_REORDER_DRAG_KIND, workspaceId: 'ws1', key: 'c1' });
        expect(dt.effectAllowed).toBe('copyMove');
        writePinnedReorderDragData(dt, { kind: PINNED_REORDER_DRAG_KIND, workspaceId: 'ws1', key: 'c1' });
        expect(dt.effectAllowed).toBe('copyMove');
    });

    it.each([
        ['not JSON', 'nope'],
        ['wrong kind', JSON.stringify({ kind: 'coc.chat-folder-move', workspaceId: 'ws1', key: 'c1' })],
        ['missing workspace', JSON.stringify({ kind: PINNED_REORDER_DRAG_KIND, key: 'c1' })],
        ['missing key', JSON.stringify({ kind: PINNED_REORDER_DRAG_KIND, workspaceId: 'ws1' })],
    ])('returns null for %s', (_label, raw) => {
        const dt = makeDataTransfer();
        dt.setData(PINNED_REORDER_MIME, raw);
        expect(readPinnedReorderDragPayload(dt)).toBeNull();
    });

    it('returns null without the MIME', () => {
        expect(readPinnedReorderDragPayload(makeDataTransfer())).toBeNull();
        expect(dataTransferHasPinnedReorder(null)).toBe(false);
    });
});

describe('resolvePinnedDropPosition', () => {
    it('splits at the midpoint', () => {
        const rect = { top: 100, height: 20 };
        expect(resolvePinnedDropPosition(105, rect)).toBe('above');
        expect(resolvePinnedDropPosition(110, rect)).toBe('below');
        expect(resolvePinnedDropPosition(119, rect)).toBe('below');
    });
});

describe('reorderPinnedEntries', () => {
    const order = [chat('a'), chat('b'), group('g'), chat('c')];

    it('moves an entry up', () => {
        expect(keys(reorderPinnedEntries(order, 'c', 'a', 'above'))).toEqual(['c', 'a', 'b', 'ralph-session:g']);
    });

    it('moves an entry down', () => {
        expect(keys(reorderPinnedEntries(order, 'a', 'c', 'below'))).toEqual(['b', 'ralph-session:g', 'c', 'a']);
    });

    it('moves across kinds', () => {
        expect(keys(reorderPinnedEntries(order, 'ralph-session:g', 'a', 'above'))).toEqual(['ralph-session:g', 'a', 'b', 'c']);
        expect(keys(reorderPinnedEntries(order, 'a', 'ralph-session:g', 'below'))).toEqual(['b', 'ralph-session:g', 'a', 'c']);
    });

    it('keeps hidden entries in place relative to each other', () => {
        // `b` is hidden by a filter: dragging c above g must not move b.
        expect(keys(reorderPinnedEntries(order, 'c', 'ralph-session:g', 'above'))).toEqual(['a', 'b', 'c', 'ralph-session:g']);
    });

    it('returns null for no-ops', () => {
        expect(reorderPinnedEntries(order, 'a', 'a', 'above')).toBeNull();
        expect(reorderPinnedEntries(order, 'a', 'b', 'above')).toBeNull();
        expect(reorderPinnedEntries(order, 'b', 'a', 'below')).toBeNull();
        expect(reorderPinnedEntries(order, 'missing', 'a', 'above')).toBeNull();
        expect(reorderPinnedEntries(order, 'a', 'missing', 'above')).toBeNull();
    });
});

describe('buildPinnedFullOrder', () => {
    it('interleaves chats and group pins newest first', () => {
        const order = buildPinnedFullOrder(
            ['a', 'b', 'running'],
            new Map([['a', '2026-01-01T00:00:00.000Z'], ['b', '2026-01-03T00:00:00.000Z']]),
            [{ type: 'ralph-session', groupId: 'g', pinnedAt: '2026-01-02T00:00:00.000Z' }],
        );
        expect(keys(order)).toEqual(['b', 'ralph-session:g', 'a', 'running']);
    });
});
