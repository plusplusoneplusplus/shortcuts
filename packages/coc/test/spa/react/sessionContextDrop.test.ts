import { describe, expect, it } from 'vitest';
import type { AttachedContextItem } from '../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import {
    dataTransferHasSessionContext,
    MAX_SESSION_CONTEXT_ATTACHMENTS,
    readSessionContextDragPayload,
    validateSessionContextDrop,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import {
    SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_MIME,
    type SessionContextDragPayload,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrag';

function makePayload(overrides: Partial<SessionContextDragPayload> = {}): SessionContextDragPayload {
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

function makeDataTransfer(payload: unknown) {
    return {
        types: [SESSION_CONTEXT_DRAG_MIME],
        getData: (format: string) => format === SESSION_CONTEXT_DRAG_MIME ? JSON.stringify(payload) : '',
    } as DataTransfer;
}

function validate(payload: SessionContextDragPayload | null, overrides: Partial<Parameters<typeof validateSessionContextDrop>[0]> = {}) {
    return validateSessionContextDrop({
        payload,
        featureEnabled: true,
        activeWorkspaceId: 'ws-1',
        currentProcessId: null,
        existingItems: [],
        canRetrieveConversations: true,
        ...overrides,
    });
}

describe('sessionContextDrop', () => {
    it('reads a valid custom drag payload', () => {
        const dataTransfer = makeDataTransfer(makePayload());

        expect(dataTransferHasSessionContext(dataTransfer)).toBe(true);
        expect(readSessionContextDragPayload(dataTransfer)).toEqual(makePayload());
    });

    it('normalizes timestamps and strips local paths from display titles', () => {
        const payload = readSessionContextDragPayload(makeDataTransfer(makePayload({
            title: 'Debug /home/example/repo/src/app.ts and C:\\Users\\example\\secret.txt',
            lastActivityAt: '2026-01-01T00:00:00Z',
        })));

        expect(payload?.lastActivityAt).toBe('2026-01-01T00:00:00.000Z');
        expect(payload?.title).toBe('Debug [path] and [path]');
        expect(JSON.stringify(payload)).not.toContain('/home/example');
        expect(JSON.stringify(payload)).not.toContain('C:\\Users');
    });

    it('rejects cross-workspace drops', () => {
        const result = validate(makePayload({ sourceWorkspaceId: 'ws-other' }));
        expect(result).toEqual({ ok: false, error: 'Only sessions from the active workspace can be attached as context.' });
    });

    it('rejects duplicate source sessions', () => {
        const existingItems: AttachedContextItem[] = [{
            kind: 'session',
            id: 'ctx-1',
            sourceWorkspaceId: 'ws-1',
            sourceProcessId: 'source-proc',
            title: 'Source session',
            status: 'completed',
            lastActivityAt: '2026-01-01T00:00:00.000Z',
            preview: 'Source session',
        }];

        const result = validate(makePayload(), { existingItems });
        expect(result).toEqual({ ok: false, error: 'This session is already attached to the message.' });
    });

    it('rejects self-attachment for follow-up sessions', () => {
        const result = validate(makePayload(), { currentProcessId: 'source-proc' });
        expect(result).toEqual({ ok: false, error: 'A follow-up cannot attach its own current session as context.' });
    });

    it('enforces the three-session cap', () => {
        const existingItems: AttachedContextItem[] = Array.from({ length: MAX_SESSION_CONTEXT_ATTACHMENTS }, (_, index) => ({
            kind: 'session',
            id: `ctx-${index}`,
            sourceWorkspaceId: 'ws-1',
            sourceProcessId: `source-${index}`,
            title: `Source ${index}`,
            status: 'completed',
            lastActivityAt: '2026-01-01T00:00:00.000Z',
            preview: `Source ${index}`,
        }));

        const result = validate(makePayload({ sourceProcessId: 'source-extra' }), { existingItems });
        expect(result).toEqual({ ok: false, error: 'You can attach up to 3 sessions as context.' });
    });

    it('rejects drops when conversation retrieval is unavailable', () => {
        const result = validate(makePayload(), { canRetrieveConversations: false });
        expect(result).toEqual({ ok: false, error: 'Conversation retrieval is not available for this chat.' });
    });
});
