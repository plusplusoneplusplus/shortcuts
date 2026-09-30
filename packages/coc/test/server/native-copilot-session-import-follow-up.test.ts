/**
 * Follow-ups on an imported Copilot chat resume the native session (AC-02).
 *
 * The imported process is built by the real import builder and then driven
 * through the real follow-up executor, so the test pins that the binding the
 * import writes is the one the executor resumes — not a fresh session.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { buildImportedCopilotChatProcess } from '../../src/server/native-copilot-sessions/native-copilot-session-import';
import type { NativeCopilotSessionDetail } from '@plusplusoneplusplus/coc-client';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

const sdkMocks = createMockSDKService();
const { mockSendMessage, mockIsAvailable } = sdkMocks;

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

const NATIVE_ID = 'native-session-42';

function nativeSession(): NativeCopilotSessionDetail {
    return {
        id: NATIVE_ID,
        repository: 'someone/elsewhere',
        cwd: '/somewhere/else',
        hostType: 'cli',
        branch: 'main',
        summary: 'Fix the flaky login test',
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-09-01T10:05:00.000Z',
        turns: [],
        conversation: [
            { role: 'user', content: 'Please fix the login test', timestamp: '2026-09-01T10:00:00.000Z', turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Fixed it.', timestamp: '2026-09-01T10:01:00.000Z', turnIndex: 1, timeline: [] },
        ],
    } as NativeCopilotSessionDetail;
}

describe('imported Copilot chat follow-up', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('resumes the native Copilot session id instead of starting a fresh session', async () => {
        const proc = buildImportedCopilotChatProcess({
            workspaceId: 'ws-1',
            session: nativeSession(),
            processId: 'queue_imported-1',
        });
        await store.addProcess(proc);
        mockSendMessage.mockResolvedValueOnce({ success: true, response: 'We fixed the login test.', sessionId: NATIVE_ID });

        await new CLITaskExecutor(store).executeFollowUp('queue_imported-1', 'what did we do last?', undefined, 'ask');

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        expect(mockSendMessage.mock.calls[0][0].sessionId).toBe(NATIVE_ID);

        const after = store.processes.get('queue_imported-1');
        expect(after?.activeProviderSession?.provider).toBe('copilot');
        expect(after?.activeProviderSession?.sessionId).toBe(NATIVE_ID);
        expect(after?.activeProviderSession?.segmentId).toBe(`import-${NATIVE_ID}`);
        expect(after?.sdkSessionId).toBe(NATIVE_ID);
        const turns = after?.conversationTurns ?? [];
        expect(turns.slice(0, 2).map(t => t.content)).toEqual(['Please fix the login test', 'Fixed it.']);
        expect(turns[turns.length - 1].content).toContain('We fixed the login test.');
    });

    it('does not send the rebuilt transcript as a handoff on native resume', async () => {
        await store.addProcess(buildImportedCopilotChatProcess({
            workspaceId: 'ws-1',
            session: nativeSession(),
            processId: 'queue_imported-2',
        }));
        mockSendMessage.mockResolvedValueOnce({ success: true, response: 'ok', sessionId: NATIVE_ID });

        await new CLITaskExecutor(store).executeFollowUp('queue_imported-2', 'next step', undefined, 'ask');

        const prompt = String(mockSendMessage.mock.calls[0][0].prompt ?? '');
        expect(prompt).not.toContain('Please fix the login test');
    });
});
