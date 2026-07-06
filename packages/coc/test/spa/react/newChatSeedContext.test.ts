import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    drainNewChatSeedContext,
    peekNewChatSeedContext,
    pushNewChatSeedContext,
    resetNewChatSeedContext,
    subscribeNewChatSeedContext,
} from '../../../src/server/spa/client/react/features/chat/newChatSeedContext';
import { readSessionContextDropPayloads } from '../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import {
    GIT_COMMIT_CONTEXT_DRAG_KIND,
    POINTER_CONTEXT_DRAG_MIME,
    SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_MIME,
    type GitCommitContextDragPayload,
    type SessionContextAttachmentDragPayload,
    type SessionContextDragPayload,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrag';

function makeSessionPayload(overrides: Partial<SessionContextDragPayload> = {}): SessionContextDragPayload {
    return {
        kind: SESSION_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: 'ws-1',
        sourceProcessId: 'source-proc',
        title: 'Source session',
        status: 'completed',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function makeCommitPayload(overrides: Partial<GitCommitContextDragPayload> = {}): GitCommitContextDragPayload {
    return {
        kind: GIT_COMMIT_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: 'ws-1',
        commitHash: 'abcdef1234567890',
        shortHash: 'abcdef1',
        label: 'Commit abcdef1',
        subject: 'Add context drag',
        title: 'Add context drag',
        ...overrides,
    };
}

function makeDataTransfer(payload: unknown, mime = SESSION_CONTEXT_DRAG_MIME) {
    return {
        types: [mime],
        getData: (format: string) => (format === mime ? JSON.stringify(payload) : ''),
    } as unknown as DataTransfer;
}

afterEach(() => {
    resetNewChatSeedContext();
});

describe('newChatSeedContext store', () => {
    it('buffers pushed payloads and drains them once', () => {
        const payload = makeCommitPayload();
        pushNewChatSeedContext([payload]);

        expect(peekNewChatSeedContext()).toEqual([payload]);
        expect(drainNewChatSeedContext()).toEqual([payload]);
        // Draining clears the buffer.
        expect(peekNewChatSeedContext()).toEqual([]);
        expect(drainNewChatSeedContext()).toEqual([]);
    });

    it('appends across multiple pushes (append-keep)', () => {
        const a = makeCommitPayload({ commitHash: 'aaaa1111', shortHash: 'aaaa111' });
        const b = makeSessionPayload({ sourceProcessId: 'proc-b' });
        pushNewChatSeedContext([a]);
        pushNewChatSeedContext([b]);

        expect(drainNewChatSeedContext()).toEqual([a, b]);
    });

    it('ignores empty pushes and does not notify', () => {
        const listener = vi.fn();
        subscribeNewChatSeedContext(listener);
        pushNewChatSeedContext([]);

        expect(listener).not.toHaveBeenCalled();
        expect(peekNewChatSeedContext()).toEqual([]);
    });

    it('notifies subscribers synchronously on push and stops after unsubscribe', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeNewChatSeedContext(listener);

        pushNewChatSeedContext([makeCommitPayload()]);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        pushNewChatSeedContext([makeSessionPayload()]);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps notifying remaining listeners when one throws', () => {
        const bad = vi.fn(() => { throw new Error('boom'); });
        const good = vi.fn();
        subscribeNewChatSeedContext(bad);
        subscribeNewChatSeedContext(good);

        expect(() => pushNewChatSeedContext([makeCommitPayload()])).not.toThrow();
        expect(good).toHaveBeenCalledTimes(1);
    });
});

describe('readSessionContextDropPayloads', () => {
    it('returns a single session payload as a one-item array', () => {
        const dataTransfer = makeDataTransfer(makeSessionPayload());
        const payloads: SessionContextAttachmentDragPayload[] = readSessionContextDropPayloads(dataTransfer);
        expect(payloads).toEqual([makeSessionPayload()]);
    });

    it('returns a single pointer (commit) payload as a one-item array', () => {
        const dataTransfer = makeDataTransfer(makeCommitPayload(), POINTER_CONTEXT_DRAG_MIME);
        expect(readSessionContextDropPayloads(dataTransfer)).toEqual([makeCommitPayload()]);
    });

    it('returns an empty array when the drop carries no supported context', () => {
        const dataTransfer = {
            types: ['text/plain'],
            getData: () => 'not coc context',
        } as unknown as DataTransfer;
        expect(readSessionContextDropPayloads(dataTransfer)).toEqual([]);
    });
});
