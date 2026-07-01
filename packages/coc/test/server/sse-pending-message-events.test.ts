/**
 * SSE Handler — pending-message-added Event Tests
 *
 * Verifies that emitPendingMessageAdded correctly emits
 * ProcessOutputEvents through the store.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi } from 'vitest';
import { emitPendingMessageAdded } from '../../src/server/streaming/sse-handler';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

function createMockStore(): Pick<ProcessStore, 'emitProcessEvent'> {
    return {
        emitProcessEvent: vi.fn(),
    };
}

describe('emitPendingMessageAdded', () => {
    it('emits pending-message-added event with full payload', () => {
        const store = createMockStore();
        emitPendingMessageAdded(store as any, 'proc-1', {
            id: 'msg-abc',
            content: 'Fix the bug',
            mode: 'ask',
            createdAt: '2026-04-10T00:00:00.000Z',
        });

        expect(store.emitProcessEvent).toHaveBeenCalledTimes(1);
        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-1', {
            type: 'pending-message-added',
            pendingMessage: {
                id: 'msg-abc',
                content: 'Fix the bug',
                mode: 'ask',
                createdAt: '2026-04-10T00:00:00.000Z',
            },
        });
    });

    it('emits event without mode when not provided', () => {
        const store = createMockStore();
        emitPendingMessageAdded(store as any, 'proc-2', {
            id: 'msg-xyz',
            content: 'Hello world',
            createdAt: '2026-04-10T01:00:00.000Z',
        });

        const emitted = (store.emitProcessEvent as any).mock.calls[0][1];
        expect(emitted.type).toBe('pending-message-added');
        expect(emitted.pendingMessage.id).toBe('msg-xyz');
        expect(emitted.pendingMessage.content).toBe('Hello world');
        expect(emitted.pendingMessage.mode).toBeUndefined();
    });

    it('routes to the correct process ID', () => {
        const store = createMockStore();
        emitPendingMessageAdded(store as any, 'proc-unique', {
            id: 'msg-1',
            content: 'test',
            createdAt: '2026-04-10T02:00:00.000Z',
        });

        expect(store.emitProcessEvent).toHaveBeenCalledWith(
            'proc-unique',
            expect.objectContaining({ type: 'pending-message-added' }),
        );
    });

    it('includes images in the emitted payload when present', () => {
        const store = createMockStore();
        const images = ['data:image/png;base64,AAA', 'data:image/jpeg;base64,BBB'];
        emitPendingMessageAdded(store as any, 'proc-img', {
            id: 'msg-img',
            content: 'look at this',
            createdAt: '2026-04-10T03:00:00.000Z',
            images,
        });

        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-img', {
            type: 'pending-message-added',
            pendingMessage: {
                id: 'msg-img',
                content: 'look at this',
                mode: undefined,
                createdAt: '2026-04-10T03:00:00.000Z',
                images,
            },
        });
    });

    it('omits images from the emitted payload when absent or empty', () => {
        const store = createMockStore();
        emitPendingMessageAdded(store as any, 'proc-noimg', {
            id: 'msg-noimg',
            content: 'text only',
            createdAt: '2026-04-10T04:00:00.000Z',
            images: [],
        });

        const emitted = (store.emitProcessEvent as any).mock.calls[0][1];
        expect(emitted.pendingMessage).not.toHaveProperty('images');
    });
});
