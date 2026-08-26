/**
 * chat-folder-drag — the pure half of AC-07: drag payloads, drop-target
 * arithmetic, folder reordering and the auto-scroll ramp.
 */
import { describe, it, expect } from 'vitest';
import {
    CHAT_FOLDER_MOVE_MIME,
    CHAT_FOLDER_REORDER_MIME,
    CHAT_LIST_AUTO_SCROLL_EDGE_PX,
    computeDragAutoScrollDelta,
    createChatFolderMoveDragPayload,
    createChatFolderReorderDragPayload,
    dataTransferHasChatFolderMove,
    dataTransferHasChatFolderReorder,
    diffFolderSortIndexes,
    readChatFolderMoveDragPayload,
    readChatFolderReorderDragPayload,
    reorderChatFolders,
    resolveFolderDropMoveIds,
    resolveFolderDropTarget,
    writeChatFolderMoveDragData,
    writeChatFolderReorderDragData,
} from '../../../../src/server/spa/client/react/features/chat/chat-folder-drag';
import { QUEUE_DRAG_MIME } from '../../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop';
import { SESSION_CONTEXT_DRAG_MIME } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';

/** A DataTransfer stand-in that behaves like the real one for these helpers. */
function makeDataTransfer(): any {
    const store = new Map<string, string>();
    return {
        effectAllowed: 'uninitialized',
        dropEffect: 'none',
        get types() { return [...store.keys()]; },
        setData(format: string, data: string) { store.set(format, data); },
        getData(format: string) { return store.get(format) ?? ''; },
    };
}

function makeFolder(id: string, sortIndex: number, createdAt = '2026-08-26T00:00:00.000Z'): any {
    return { id, name: id, color: 'purple', sortIndex, createdAt, updatedAt: createdAt };
}

describe('chat-folder-drag — move payload', () => {
    it('round-trips through a DataTransfer', () => {
        const dt = makeDataTransfer();
        const payload = createChatFolderMoveDragPayload('ws-1', ['proc-a', 'proc-b'])!;
        writeChatFolderMoveDragData(dt, payload);

        expect(dataTransferHasChatFolderMove(dt)).toBe(true);
        expect(readChatFolderMoveDragPayload(dt)).toEqual(payload);
    });

    it('widens effectAllowed to copyMove so one gesture can copy OR move', () => {
        const dt = makeDataTransfer();
        writeChatFolderMoveDragData(dt, createChatFolderMoveDragPayload('ws-1', ['proc-a'])!);
        expect(dt.effectAllowed).toBe('copyMove');
    });

    it('leaves text/plain to the session-context writer', () => {
        const dt = makeDataTransfer();
        dt.setData('text/plain', 'session context text');
        writeChatFolderMoveDragData(dt, createChatFolderMoveDragPayload('ws-1', ['proc-a'])!);
        expect(dt.getData('text/plain')).toBe('session context text');
    });

    it('refuses a payload with no workspace or no ids, and de-duplicates', () => {
        expect(createChatFolderMoveDragPayload('', ['proc-a'])).toBeNull();
        expect(createChatFolderMoveDragPayload('ws-1', [])).toBeNull();
        expect(createChatFolderMoveDragPayload('ws-1', ['  '])).toBeNull();
        expect(createChatFolderMoveDragPayload('ws-1', ['a', 'a', 'b'])!.processIds).toEqual(['a', 'b']);
    });

    it('reads nothing from a drag that only carries other MIMEs', () => {
        const dt = makeDataTransfer();
        dt.setData(QUEUE_DRAG_MIME, 'task-1');
        dt.setData(SESSION_CONTEXT_DRAG_MIME, '{}');
        expect(dataTransferHasChatFolderMove(dt)).toBe(false);
        expect(readChatFolderMoveDragPayload(dt)).toBeNull();
    });

    it('rejects a malformed or foreign-kind payload rather than throwing', () => {
        const dt = makeDataTransfer();
        dt.setData(CHAT_FOLDER_MOVE_MIME, 'not json');
        expect(readChatFolderMoveDragPayload(dt)).toBeNull();
        dt.setData(CHAT_FOLDER_MOVE_MIME, JSON.stringify({ kind: 'something.else', version: 1 }));
        expect(readChatFolderMoveDragPayload(dt)).toBeNull();
    });
});

describe('chat-folder-drag — reorder payload', () => {
    it('round-trips and uses its own MIME', () => {
        const dt = makeDataTransfer();
        const payload = createChatFolderReorderDragPayload('ws-1', 'folder-a')!;
        writeChatFolderReorderDragData(dt, payload);

        expect(dataTransferHasChatFolderReorder(dt)).toBe(true);
        expect(dataTransferHasChatFolderMove(dt)).toBe(false);
        expect(readChatFolderReorderDragPayload(dt)).toEqual(payload);
        expect(dt.effectAllowed).toBe('move');
        expect(dt.types).toContain(CHAT_FOLDER_REORDER_MIME);
    });

    it('refuses an incomplete payload', () => {
        expect(createChatFolderReorderDragPayload('ws-1', '')).toBeNull();
        expect(createChatFolderReorderDragPayload(null, 'folder-a')).toBeNull();
    });
});

describe('chat-folder-drag — resolveFolderDropTarget', () => {
    const base = { folderId: 'folder-a', zone: 'row' as const, hasMove: false, hasReorder: false };

    it('accepts a chat move on a folder row and in its body', () => {
        expect(resolveFolderDropTarget({ ...base, hasMove: true })).toEqual({ folderId: 'folder-a', mode: 'into' });
        expect(resolveFolderDropTarget({ ...base, zone: 'body', hasMove: true })).toEqual({ folderId: 'folder-a', mode: 'into' });
    });

    it('is not a target for a drag carrying neither folder MIME (a queue reorder)', () => {
        expect(resolveFolderDropTarget(base)).toBeNull();
        expect(resolveFolderDropTarget({ ...base, zone: 'body' })).toBeNull();
    });

    it('splits a folder drag above/below on the row midpoint', () => {
        const rect = { top: 100, height: 24 };
        expect(resolveFolderDropTarget({ ...base, hasReorder: true, clientY: 105, rect }))
            .toEqual({ folderId: 'folder-a', mode: 'above' });
        expect(resolveFolderDropTarget({ ...base, hasReorder: true, clientY: 118, rect }))
            .toEqual({ folderId: 'folder-a', mode: 'below' });
    });

    it('refuses a folder dropped into a folder body — that would be nesting', () => {
        expect(resolveFolderDropTarget({ ...base, zone: 'body', hasReorder: true })).toBeNull();
    });

    it('refuses a folder dropped onto itself', () => {
        expect(resolveFolderDropTarget({ ...base, hasReorder: true, draggingFolderId: 'folder-a' })).toBeNull();
        expect(resolveFolderDropTarget({ ...base, hasReorder: true, draggingFolderId: 'folder-b' })).not.toBeNull();
    });

    it('offers nothing when every dragged row already lives in this folder', () => {
        expect(resolveFolderDropTarget({ ...base, hasMove: true, sourceFolderIds: new Set(['folder-a']) })).toBeNull();
        // A mixed selection still has something to file here.
        expect(resolveFolderDropTarget({ ...base, hasMove: true, sourceFolderIds: new Set(['folder-a', '']) }))
            .toEqual({ folderId: 'folder-a', mode: 'into' });
    });

    it('prefers the reorder reading when a drag somehow carries both MIMEs', () => {
        const both = { ...base, hasMove: true, hasReorder: true, clientY: 0, rect: { top: 0, height: 10 } };
        expect(resolveFolderDropTarget(both)?.mode).toBe('above');
    });
});

describe('chat-folder-drag — resolveFolderDropMoveIds', () => {
    const payload = createChatFolderMoveDragPayload('ws-1', ['proc-a', 'proc-b'])!;

    it('drops rows already filed in the target', () => {
        const map = new Map([['proc-a', 'folder-a']]);
        expect(resolveFolderDropMoveIds(payload, map, 'folder-a')).toEqual(['proc-b']);
    });

    it('returns nothing when the drop is onto the folder every row is in', () => {
        const map = new Map([['proc-a', 'folder-a'], ['proc-b', 'folder-a']]);
        expect(resolveFolderDropMoveIds(payload, map, 'folder-a')).toEqual([]);
    });

    it('unfiling skips rows that are already unfiled', () => {
        const map = new Map([['proc-a', 'folder-a']]);
        expect(resolveFolderDropMoveIds(payload, map, null)).toEqual(['proc-a']);
    });
});

describe('chat-folder-drag — reorderChatFolders', () => {
    const folders = [makeFolder('a', 0), makeFolder('b', 1), makeFolder('c', 2)];

    it('moves a folder above another and renumbers contiguously', () => {
        const next = reorderChatFolders(folders, 'c', 'a', 'above')!;
        expect(next.map(f => f.id)).toEqual(['c', 'a', 'b']);
        expect(next.map(f => f.sortIndex)).toEqual([0, 1, 2]);
    });

    it('moves a folder below another', () => {
        const next = reorderChatFolders(folders, 'a', 'c', 'below')!;
        expect(next.map(f => f.id)).toEqual(['b', 'c', 'a']);
    });

    it('accounts for the target shifting left when dragging downwards', () => {
        const next = reorderChatFolders(folders, 'a', 'b', 'below')!;
        expect(next.map(f => f.id)).toEqual(['b', 'a', 'c']);
    });

    it('returns null for a drop that would not change the order', () => {
        expect(reorderChatFolders(folders, 'a', 'a', 'above')).toBeNull();
        expect(reorderChatFolders(folders, 'a', 'b', 'above')).toBeNull();
        expect(reorderChatFolders(folders, 'b', 'a', 'below')).toBeNull();
        expect(reorderChatFolders(folders, 'a', 'missing', 'above')).toBeNull();
    });

    it('reads the current order from sortIndex, not array position', () => {
        const shuffled = [makeFolder('c', 2), makeFolder('a', 0), makeFolder('b', 1)];
        expect(reorderChatFolders(shuffled, 'c', 'a', 'above')!.map(f => f.id)).toEqual(['c', 'a', 'b']);
    });

    it('only reports the folders whose sortIndex actually moved', () => {
        const next = reorderChatFolders(folders, 'b', 'a', 'above')!;
        expect(diffFolderSortIndexes(folders, next)).toEqual([
            { id: 'b', sortIndex: 0 },
            { id: 'a', sortIndex: 1 },
        ]);
    });
});

describe('chat-folder-drag — computeDragAutoScrollDelta', () => {
    const rect = { top: 100, bottom: 500 };

    it('is idle in the middle of the list', () => {
        expect(computeDragAutoScrollDelta(300, rect)).toBe(0);
    });

    it('scrolls up near the top edge and down near the bottom edge', () => {
        expect(computeDragAutoScrollDelta(rect.top + 1, rect)).toBeLessThan(0);
        expect(computeDragAutoScrollDelta(rect.bottom - 1, rect)).toBeGreaterThan(0);
    });

    it('ramps: deeper into the edge band scrolls faster', () => {
        const atEdge = Math.abs(computeDragAutoScrollDelta(rect.top + 2, rect));
        const nearBand = Math.abs(computeDragAutoScrollDelta(rect.top + CHAT_LIST_AUTO_SCROLL_EDGE_PX - 2, rect));
        expect(atEdge).toBeGreaterThan(nearBand);
    });

    it('stops entirely once the pointer leaves the box', () => {
        expect(computeDragAutoScrollDelta(rect.top - 1, rect)).toBe(0);
        expect(computeDragAutoScrollDelta(rect.bottom + 1, rect)).toBe(0);
        expect(computeDragAutoScrollDelta(Number.NaN, rect)).toBe(0);
    });
});
