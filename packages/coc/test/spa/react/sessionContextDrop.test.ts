import { describe, expect, it } from 'vitest';
import type { AttachedContextItem } from '../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import {
    dataTransferHasSessionContext,
    MAX_SESSION_CONTEXT_ATTACHMENTS,
    readRalphSessionContextDragPayload,
    readSessionContextDragPayload,
    readSessionContextDropPayload,
    validateSessionContextAttachmentsForSend,
    validateSessionContextDrop,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import {
    RALPH_SESSION_CONTEXT_DRAG_KIND,
    RALPH_SESSION_CONTEXT_DRAG_MIME,
    SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_MIME,
    type RalphSessionContextDragPayload,
    type SessionContextAttachmentDragPayload,
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

function makeRalphPayload(overrides: Partial<RalphSessionContextDragPayload> = {}): RalphSessionContextDragPayload {
    return {
        kind: RALPH_SESSION_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: 'ws-1',
        sourceRalphSessionId: 'ralph-session-0001',
        title: 'Ralph source',
        displayLabel: 'Ralph source - 2 iter',
        phase: 'executing',
        status: 'running',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        childProcessIds: ['grill-proc', 'iter-1', 'iter-2'],
        processCount: 3,
        iterationCount: 2,
        ...overrides,
    };
}

function makeDataTransfer(payload: unknown, mime = SESSION_CONTEXT_DRAG_MIME) {
    return {
        types: [mime],
        getData: (format: string) => format === mime ? JSON.stringify(payload) : '',
    } as DataTransfer;
}

function validate(payload: SessionContextAttachmentDragPayload | null, overrides: Partial<Parameters<typeof validateSessionContextDrop>[0]> = {}) {
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

function makeSessionItem(overrides: Partial<Extract<AttachedContextItem, { kind: 'session' }>> = {}): Extract<AttachedContextItem, { kind: 'session' }> {
    return {
        kind: 'session',
        id: 'ctx-session',
        sourceWorkspaceId: 'ws-1',
        sourceProcessId: 'source-proc',
        title: 'Source session',
        status: 'completed',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        preview: 'Source session',
        ...overrides,
    };
}

function makeRalphItem(overrides: Partial<Extract<AttachedContextItem, { kind: 'ralph-session' }>> = {}): Extract<AttachedContextItem, { kind: 'ralph-session' }> {
    return {
        kind: 'ralph-session',
        id: 'ctx-ralph',
        sourceWorkspaceId: 'ws-1',
        sourceRalphSessionId: 'ralph-session-0001',
        title: 'Ralph source',
        displayLabel: 'Ralph source - 2 iter',
        phase: 'executing',
        status: 'running',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        childProcessIds: ['grill-proc', 'iter-1', 'iter-2'],
        processCount: 3,
        iterationCount: 2,
        preview: 'Ralph source',
        ...overrides,
    };
}

function validateForSend(overrides: Partial<Parameters<typeof validateSessionContextAttachmentsForSend>[0]> = {}) {
    return validateSessionContextAttachmentsForSend({
        featureEnabled: true,
        activeWorkspaceId: 'ws-1',
        currentProcessId: null,
        items: [makeSessionItem()],
        canRetrieveConversations: true,
        ...overrides,
    });
}

describe('sessionContextDrop', () => {
    it('reads a valid custom drag payload', () => {
        const dataTransfer = makeDataTransfer(makePayload());

        expect(dataTransferHasSessionContext(dataTransfer)).toBe(true);
        expect(readSessionContextDragPayload(dataTransfer)).toEqual(makePayload());
        expect(readSessionContextDropPayload(dataTransfer)).toEqual(makePayload());
    });

    it('reads a valid Ralph session group drag payload', () => {
        const dataTransfer = makeDataTransfer(makeRalphPayload(), RALPH_SESSION_CONTEXT_DRAG_MIME);

        expect(dataTransferHasSessionContext(dataTransfer)).toBe(true);
        expect(readRalphSessionContextDragPayload(dataTransfer)).toEqual(makeRalphPayload());
        expect(readSessionContextDropPayload(dataTransfer)).toEqual(makeRalphPayload());
        expect(readSessionContextDragPayload(dataTransfer)).toBeNull();
    });

    it('reads valid failed Ralph session group drag payloads', () => {
        const payload = makeRalphPayload({ phase: 'failed', status: 'failed' });
        const dataTransfer = makeDataTransfer(payload, RALPH_SESSION_CONTEXT_DRAG_MIME);

        expect(readSessionContextDropPayload(dataTransfer)).toEqual(payload);
    });

    it('rejects malformed Ralph session group drag payloads', () => {
        expect(readSessionContextDropPayload(makeDataTransfer({
            ...makeRalphPayload(),
            processCount: 99,
        }, RALPH_SESSION_CONTEXT_DRAG_MIME))).toBeNull();
        expect(readSessionContextDropPayload(makeDataTransfer({
            ...makeRalphPayload(),
            childProcessIds: ['grill-proc', '/home/example/iter'],
            processCount: 2,
        }, RALPH_SESSION_CONTEXT_DRAG_MIME))).toBeNull();
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

    it('normalizes timestamps and strips local paths from Ralph display fields', () => {
        const payload = readSessionContextDropPayload(makeDataTransfer(makeRalphPayload({
            title: 'Ralph /home/example/repo/progress.md',
            displayLabel: 'Ralph C:\\Users\\example\\secret.txt - 2 iter',
            lastActivityAt: '2026-01-01T00:00:00Z',
        }), RALPH_SESSION_CONTEXT_DRAG_MIME));

        expect(payload).toMatchObject({
            title: 'Ralph [path]',
            displayLabel: 'Ralph [path] - 2 iter',
            lastActivityAt: '2026-01-01T00:00:00.000Z',
        });
        expect(JSON.stringify(payload)).not.toContain('/home/example');
        expect(JSON.stringify(payload)).not.toContain('C:\\Users');
    });

    it('rejects cross-workspace drops', () => {
        const result = validate(makePayload({ sourceWorkspaceId: 'ws-other' }));
        expect(result).toEqual({ ok: false, error: 'Only sessions from the active workspace can be attached as context.' });
    });

    it('rejects cross-workspace Ralph group drops', () => {
        const result = validate(makeRalphPayload({ sourceWorkspaceId: 'ws-other' }));
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

    it('rejects duplicate Ralph session groups', () => {
        const result = validate(makeRalphPayload(), { existingItems: [makeRalphItem()] });
        expect(result).toEqual({ ok: false, error: 'This Ralph session is already attached to the message.' });
    });

    it('rejects self-attachment for follow-up sessions', () => {
        const result = validate(makePayload(), { currentProcessId: 'source-proc' });
        expect(result).toEqual({ ok: false, error: 'A follow-up cannot attach its own current session as context.' });
    });

    it('rejects follow-up Ralph groups containing the current process', () => {
        const result = validate(makeRalphPayload(), { currentProcessId: 'iter-1' });
        expect(result).toEqual({ ok: false, error: 'A follow-up cannot attach a Ralph session that includes the current chat.' });
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

    it('counts Ralph groups as one logical attachment for the three-session cap', () => {
        const existingItems: AttachedContextItem[] = [
            makeSessionItem({ id: 'ctx-1', sourceProcessId: 'source-1' }),
            makeRalphItem({ id: 'ctx-2', sourceRalphSessionId: 'ralph-session-2' }),
            makeSessionItem({ id: 'ctx-3', sourceProcessId: 'source-3' }),
        ];

        const result = validate(makeRalphPayload({ sourceRalphSessionId: 'ralph-session-extra' }), { existingItems });
        expect(result).toEqual({ ok: false, error: 'You can attach up to 3 sessions as context.' });
    });

    it('rejects Ralph drops while the feature is disabled', () => {
        const result = validate(makeRalphPayload(), { featureEnabled: false });
        expect(result).toEqual({ ok: false, error: 'Session context attachments are disabled.' });
    });

    it('rejects drops when conversation retrieval is unavailable', () => {
        const result = validate(makePayload(), { canRetrieveConversations: false });
        expect(result).toEqual({ ok: false, error: 'Conversation retrieval is not available for this chat.' });
    });

    it('allows send-time validation for valid attached session context items', () => {
        expect(validateForSend()).toBeNull();
    });

    it('allows send-time validation for valid attached Ralph group context items', () => {
        expect(validateForSend({ items: [makeRalphItem()] })).toBeNull();
    });

    it('blocks send-time validation for duplicate Ralph groups', () => {
        expect(validateForSend({
            items: [
                makeRalphItem({ id: 'ctx-1' }),
                makeRalphItem({ id: 'ctx-2' }),
            ],
        })).toBe('This Ralph session is already attached to the message.');
    });

    it('blocks send-time validation when a Ralph group contains the current process', () => {
        expect(validateForSend({
            items: [makeRalphItem()],
            currentProcessId: 'iter-2',
        })).toBe('A follow-up cannot attach a Ralph session that includes the current chat.');
    });

    it('blocks send-time validation when retrieval capability is missing', () => {
        expect(validateForSend({ canRetrieveConversations: false })).toBe(
            'Conversation retrieval is not available for this chat.',
        );
    });

    it('blocks send-time validation while retrieval capability is still loading', () => {
        expect(validateForSend({ canRetrieveConversations: null })).toBe(
            'Checking conversation retrieval capability. Try again shortly.',
        );
    });

    it('ignores non-session attached context items during send-time validation', () => {
        const result = validateForSend({
            featureEnabled: false,
            activeWorkspaceId: null,
            items: [{ kind: 'turn', id: 'ctx-turn', turnIndex: 2, role: 'assistant', snippet: 'hello', preview: 'hello' }],
            canRetrieveConversations: false,
        });

        expect(result).toBeNull();
    });
});
