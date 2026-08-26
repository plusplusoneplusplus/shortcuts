/**
 * Queue reorder vs. folder move — the central risk of AC-07.
 *
 * `ChatListPane` now hosts four drags: queue reorder, queue touch reorder,
 * session-context, and folder filing. A regression here is a broken queue,
 * which is worse than a missing feature — so these tests pin the isolation from
 * both directions:
 *
 *   1. the queue's reorder handlers ignore a drag carrying only folder MIMEs;
 *   2. a folder drop target is not a target for a queue reorder drag.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQueueDragDrop, QUEUE_DRAG_MIME } from '../../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop';
import {
    createChatFolderMoveDragPayload,
    createChatFolderReorderDragPayload,
    resolveFolderDropTarget,
    writeChatFolderMoveDragData,
    writeChatFolderReorderDragData,
    dataTransferHasChatFolderMove,
    dataTransferHasChatFolderReorder,
} from '../../../../src/server/spa/client/react/features/chat/chat-folder-drag';

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

/** A React.DragEvent stand-in with the surface both handler families touch. */
function makeDragEvent(dataTransfer: any, clientY = 50) {
    return {
        dataTransfer,
        clientY,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: {
            getBoundingClientRect: () => ({ top: 40, height: 24, bottom: 64, left: 0, right: 100, width: 100 }),
        },
    } as any;
}

describe('queue reorder ignores folder drags (AC-07 DoD 2)', () => {
    it('the reorder drop handler does not reorder on a folder-move payload', () => {
        const dt = makeDataTransfer();
        writeChatFolderMoveDragData(dt, createChatFolderMoveDragPayload('ws-1', ['proc-a'])!);

        const { result } = renderHook(() => useQueueDragDrop());
        const onReorder = vi.fn();
        act(() => { result.current.createDropHandler(2, onReorder)(makeDragEvent(dt)); });

        expect(onReorder).not.toHaveBeenCalled();
    });

    it('the reorder drop handler still reorders on a real queue payload', () => {
        const dt = makeDataTransfer();
        dt.setData(QUEUE_DRAG_MIME, 'task-1');

        const { result } = renderHook(() => useQueueDragDrop());
        const onReorder = vi.fn();
        act(() => { result.current.createDragStartHandler('task-1', 0)(makeDragEvent(dt)); });
        act(() => { result.current.createDropHandler(2, onReorder)(makeDragEvent(dt, 60)); });

        expect(onReorder).toHaveBeenCalledWith('task-1', 2);
    });

    it('a folder drag never lights up a queue row as a drop target', () => {
        const dt = makeDataTransfer();
        writeChatFolderReorderDragData(dt, createChatFolderReorderDragPayload('ws-1', 'folder-a')!);

        const { result } = renderHook(() => useQueueDragDrop());
        const event = makeDragEvent(dt);
        act(() => { result.current.createDragOverHandler(1)(event); });

        expect(event.dataTransfer.dropEffect).toBe('none');
        expect(result.current.dropTargetIndex).toBeNull();
    });
});

describe('folder targets ignore a queue reorder drag (AC-07 DoD 2)', () => {
    it('a queue drag advertises neither folder MIME, so no folder row highlights', () => {
        const dt = makeDataTransfer();
        dt.setData(QUEUE_DRAG_MIME, 'task-1');

        expect(dataTransferHasChatFolderMove(dt)).toBe(false);
        expect(dataTransferHasChatFolderReorder(dt)).toBe(false);
        expect(resolveFolderDropTarget({
            folderId: 'folder-a',
            zone: 'row',
            hasMove: dataTransferHasChatFolderMove(dt),
            hasReorder: dataTransferHasChatFolderReorder(dt),
        })).toBeNull();
    });
});
