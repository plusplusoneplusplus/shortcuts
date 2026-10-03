/**
 * compactProcess — the compaction service shared by the compact route and the
 * Teams/WhatsApp `compact` command.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { CompactUnsupportedError } from '@plusplusoneplusplus/forge';
import { APIError } from '../../../src/server/errors';
import { compactGuardError, compactProcess } from '../../../src/server/processes/compact-process';

const compactSession = vi.fn();

vi.mock('@plusplusoneplusplus/forge', async () => {
    const actual = await vi.importActual('@plusplusoneplusplus/forge');
    return {
        ...actual as object,
        sdkServiceRegistry: { getOrThrow: () => ({ compactSession }) },
    };
});

function makeProcess(patch: Partial<AIProcess> = {}): AIProcess {
    return {
        id: 'proc-1', type: 'chat', status: 'completed', promptPreview: 'hi', fullPrompt: 'hi',
        startTime: new Date(), sdkSessionId: 'sess-1', currentTokens: 82_000,
        metadata: { type: 'chat', workspaceId: 'ws-1' }, ...patch,
    } as AIProcess;
}

function makeStore() {
    return {
        updateProcess: vi.fn().mockResolvedValue(undefined),
        emitProcessEvent: vi.fn(),
        appendConversationTurn: vi.fn().mockResolvedValue(undefined),
    };
}

async function expectAPIError(promise: Promise<unknown>, statusCode: number, code: string) {
    const error = await promise.then(() => undefined, (err: unknown) => err);
    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ statusCode, code });
}

describe('compactProcess', () => {
    let store: ReturnType<typeof makeStore>;

    beforeEach(() => {
        compactSession.mockReset();
        store = makeStore();
    });

    it('rejects a process without an SDK session with 400 and touches nothing', async () => {
        await expectAPIError(compactProcess(store, makeProcess({ sdkSessionId: undefined })), 400, 'BAD_REQUEST');
        expect(store.updateProcess).not.toHaveBeenCalled();
        expect(compactSession).not.toHaveBeenCalled();
    });

    it.each([
        ['running', {}],
        ['queued', {}],
        ['completed', { pendingMessages: [{ id: 'm1' }] }],
    ])('rejects a non-idle (%s) conversation with 409 CONVERSATION_NOT_IDLE', async (status, patch) => {
        const proc = makeProcess({ status: status as AIProcess['status'], ...patch } as Partial<AIProcess>);
        expect(compactGuardError(proc)?.code).toBe('CONVERSATION_NOT_IDLE');
        await expectAPIError(compactProcess(store, proc), 409, 'CONVERSATION_NOT_IDLE');
        expect(compactSession).not.toHaveBeenCalled();
    });

    it('maps an unsupported provider to 422 and restores the prior status', async () => {
        compactSession.mockRejectedValue(new CompactUnsupportedError('codex'));
        await expectAPIError(compactProcess(store, makeProcess()), 422, 'COMPACT_UNSUPPORTED');
        expect(store.updateProcess).toHaveBeenLastCalledWith('proc-1', expect.objectContaining({
            status: 'completed',
            metadata: expect.objectContaining({ compaction: expect.objectContaining({ state: 'failed' }) }),
        }));
    });

    it('maps other provider failures to 500', async () => {
        compactSession.mockRejectedValue(new Error('boom'));
        await expectAPIError(compactProcess(store, makeProcess()), 500, 'INTERNAL_ERROR');
    });

    it('compacts, persists usage and a display-only turn, and reports tokens before → after', async () => {
        const result = { success: true, messagesRemoved: 4, tokensRemoved: 68_000 };
        compactSession.mockResolvedValue(result);
        const outcome = await compactProcess(store, makeProcess(), '  focus on relay  ');
        expect(compactSession).toHaveBeenCalledWith('sess-1', '  focus on relay  ');
        expect(outcome).toEqual({ result, tokensBefore: 82_000, tokensAfter: 14_000 });
        expect(store.updateProcess).toHaveBeenNthCalledWith(1, 'proc-1', expect.objectContaining({ status: 'running' }));
        expect(store.updateProcess).toHaveBeenLastCalledWith('proc-1', expect.objectContaining({
            status: 'completed', currentTokens: 14_000,
            metadata: expect.objectContaining({ workspaceId: 'ws-1', compaction: expect.objectContaining({ state: 'completed' }) }),
        }));
        const build = store.appendConversationTurn.mock.calls[0][1];
        expect(build(3)).toMatchObject({ role: 'assistant', displayOnly: true, turnIndex: 3 });
    });

    it('treats blank instructions as none and omits tokens when usage is unknown', async () => {
        compactSession.mockResolvedValue({ success: true });
        const outcome = await compactProcess(store, makeProcess({ currentTokens: undefined }), '   ');
        expect(compactSession).toHaveBeenCalledWith('sess-1', undefined);
        expect(outcome.tokensBefore).toBeUndefined();
        expect(outcome.tokensAfter).toBeUndefined();
    });
});
