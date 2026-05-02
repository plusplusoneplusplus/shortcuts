/**
 * SSE Handler — message-queued / message-steering Event Tests
 *
 * Verifies that emitMessageQueued and emitMessageSteering correctly
 * emit ProcessOutputEvents through the store.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi } from 'vitest';
import { emitMessageQueued, emitMessageSteering } from '../../src/server/streaming/sse-handler';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

function createMockStore(): Pick<ProcessStore, 'emitProcessEvent'> {
    return {
        emitProcessEvent: vi.fn(),
    };
}

describe('emitMessageQueued', () => {
    it('emits message-queued event with correct payload for enqueue', () => {
        const store = createMockStore();
        emitMessageQueued(store as any, 'proc-1', {
            turnIndex: 3,
            deliveryMode: 'enqueue',
            queuePosition: 2,
        });

        expect(store.emitProcessEvent).toHaveBeenCalledTimes(1);
        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-1', {
            type: 'message-queued',
            turnIndex: 3,
            deliveryMode: 'enqueue',
            queuePosition: 2,
        });
    });

    it('emits message-queued event with queuePosition 0 for immediate', () => {
        const store = createMockStore();
        emitMessageQueued(store as any, 'proc-2', {
            turnIndex: 0,
            deliveryMode: 'immediate',
            queuePosition: 0,
        });

        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-2', {
            type: 'message-queued',
            turnIndex: 0,
            deliveryMode: 'immediate',
            queuePosition: 0,
        });
    });

    it('echoes optimisticId when provided', () => {
        const store = createMockStore();
        emitMessageQueued(store as any, 'proc-4', {
            turnIndex: 1,
            deliveryMode: 'enqueue',
            queuePosition: 1,
            optimisticId: 'opt-abc-123',
        });

        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-4', {
            type: 'message-queued',
            turnIndex: 1,
            deliveryMode: 'enqueue',
            queuePosition: 1,
            optimisticId: 'opt-abc-123',
        });
    });

    it('omits optimisticId when not provided', () => {
        const store = createMockStore();
        emitMessageQueued(store as any, 'proc-5', {
            turnIndex: 2,
            deliveryMode: 'enqueue',
            queuePosition: 1,
        });

        const emitted = (store.emitProcessEvent as any).mock.calls[0][1];
        expect(emitted).not.toHaveProperty('optimisticId');
    });
});

describe('emitMessageSteering', () => {
    it('emits message-steering event with turnIndex', () => {
        const store = createMockStore();
        emitMessageSteering(store as any, 'proc-3', { turnIndex: 5 });

        expect(store.emitProcessEvent).toHaveBeenCalledTimes(1);
        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-3', {
            type: 'message-steering',
            turnIndex: 5,
        });
    });
});
