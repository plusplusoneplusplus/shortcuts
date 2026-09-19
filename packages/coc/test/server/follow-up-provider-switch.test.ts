/**
 * Follow-up continuation modes end to end through the executor (AC-04).
 *
 * These cover the plumb the unit tests cannot: that the provider carried by an
 * accepted message actually reaches the SDK call, that a cross-provider
 * follow-up sends no session id, and that the stored binding only moves once
 * the target provider reports a session of its own.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIProcess } from '@plusplusoneplusplus/forge';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

const sdkMocks = createMockSDKService();
const { mockSendMessage, mockIsAvailable, mockSoftAbortSession } = sdkMocks;

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

describe('follow-up provider switching', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockSoftAbortSession.mockReset();
        mockSoftAbortSession.mockResolvedValue(true);
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    async function seedCopilotChat(processId: string): Promise<void> {
        const proc: AIProcess = {
            id: processId,
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            sdkSessionId: 'copilot-session-1',
            activeProviderSession: {
                provider: 'copilot',
                sessionId: 'copilot-session-1',
                segmentId: 'seg-copilot-1',
                firstTurnIndex: 0,
            },
            metadata: { type: 'chat', provider: 'copilot' },
            conversationTurns: [
                { role: 'user', content: 'Q1', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'A1', timestamp: new Date(), turnIndex: 1, timeline: [] },
                { role: 'user', content: 'Q2', timestamp: new Date(), turnIndex: 2, timeline: [] },
            ],
        };
        await store.addProcess(proc);
    }

    it('resumes the bound session when no provider is requested', async () => {
        await seedCopilotChat('proc-same-default');
        mockSendMessage.mockResolvedValueOnce({ success: true, response: 'A2', sessionId: 'copilot-session-1' });

        await new CLITaskExecutor(store).executeFollowUp('proc-same-default', 'Q2');

        expect(mockSendMessage.mock.calls[0][0].sessionId).toBe('copilot-session-1');
    });

    it('resumes the bound session when the same provider is requested', async () => {
        await seedCopilotChat('proc-same-explicit');
        mockSendMessage.mockResolvedValueOnce({ success: true, response: 'A2', sessionId: 'copilot-session-1' });

        await new CLITaskExecutor(store).executeFollowUp(
            'proc-same-explicit', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, { requestedProvider: 'copilot' },
        );

        expect(mockSendMessage.mock.calls[0][0].sessionId).toBe('copilot-session-1');
        expect(store.processes.get('proc-same-explicit')?.activeProviderSession?.segmentId).toBe('seg-copilot-1');
    });

    it('sends no session id to a different provider and rebinds after it reports one', async () => {
        await seedCopilotChat('proc-switch');
        mockSendMessage.mockImplementation(async (options: any) => {
            options?.onSessionCreated?.('codex-session-1');
            return { success: true, response: 'A2', sessionId: 'codex-session-1' };
        });

        await new CLITaskExecutor(store).executeFollowUp(
            'proc-switch', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, { requestedProvider: 'codex' },
        );

        // The Copilot session id must not travel to Codex.
        expect(mockSendMessage.mock.calls[0][0].sessionId).toBeUndefined();

        const binding = store.processes.get('proc-switch')?.activeProviderSession;
        expect(binding?.provider).toBe('codex');
        expect(binding?.sessionId).toBe('codex-session-1');
        expect(binding?.segmentId).not.toBe('seg-copilot-1');
        expect(store.processes.get('proc-switch')?.sdkSessionId).toBe('codex-session-1');
    });

    it('keeps the old binding usable when the target fails before creating a session', async () => {
        await seedCopilotChat('proc-switch-fail');
        mockSendMessage.mockResolvedValueOnce({ success: false, error: 'codex exploded' });

        await new CLITaskExecutor(store).executeFollowUp(
            'proc-switch-fail', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, { requestedProvider: 'codex' },
        );

        const binding = store.processes.get('proc-switch-fail')?.activeProviderSession;
        expect(binding?.provider).toBe('copilot');
        expect(binding?.sessionId).toBe('copilot-session-1');
    });

    it('does not treat a cross-provider continuation as a failed strict resume', async () => {
        // A stopped Copilot chat whose native session cannot be resumed is
        // still continuable through another provider, because that path
        // rebuilds from canonical history instead of the old session id.
        await seedCopilotChat('proc-stopped-switch');
        mockSendMessage.mockImplementation(async (options: any) => {
            options?.onSessionCreated?.('codex-session-2');
            return { success: true, response: 'A2', sessionId: 'codex-session-2' };
        });

        await new CLITaskExecutor(store).executeFollowUp(
            'proc-stopped-switch', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
            undefined, undefined, 'copilot-session-1', { requestedProvider: 'codex' },
        );

        const sent = mockSendMessage.mock.calls[0][0];
        expect(sent.sessionId).toBeUndefined();
        expect(sent.strictSessionResume).toBeUndefined();
        expect(store.processes.get('proc-stopped-switch')?.status).not.toBe('failed');
        expect(store.processes.get('proc-stopped-switch')?.activeProviderSession?.provider).toBe('codex');
    });

    describe('stop during an in-flight turn', () => {
        /** Executor whose provider resolution is observable. */
        function makeExecutor() {
            const resolveAiServiceForProvider = vi.fn(() => sdkMocks.service);
            const executor = new CLITaskExecutor(store, { runtime: { resolveAiServiceForProvider } as any });
            return { executor, resolveAiServiceForProvider };
        }

        it('aborts the target turn without touching the outgoing provider session', async () => {
            await seedCopilotChat('queue_stop-startup');
            const { executor, resolveAiServiceForProvider } = makeExecutor();
            let sentSignal: AbortSignal | undefined;
            mockSendMessage.mockImplementation(async (options: any) => {
                sentSignal = options?.signal;
                // Stop arrives while the target is still starting up: no
                // session id has been reported by Codex yet.
                await executor.cancelProcess('queue_stop-startup');
                return { success: false, error: 'aborted' };
            });

            await executor.executeFollowUp(
                'queue_stop-startup', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
                undefined, undefined, undefined, { requestedProvider: 'codex' },
            );

            expect(sentSignal?.aborted).toBe(true);
            // The persisted Copilot session belongs to the provider that is
            // *not* running this turn, so it must never be aborted.
            expect(mockSoftAbortSession).not.toHaveBeenCalled();
            expect(resolveAiServiceForProvider).not.toHaveBeenCalledWith('copilot');
        });

        it('soft-aborts the target session once the target reports one', async () => {
            await seedCopilotChat('queue_stop-after-create');
            const { executor, resolveAiServiceForProvider } = makeExecutor();
            mockSendMessage.mockImplementation(async (options: any) => {
                options?.onSessionCreated?.('codex-session-3');
                await executor.cancelProcess('queue_stop-after-create');
                return { success: false, error: 'aborted' };
            });

            await executor.executeFollowUp(
                'queue_stop-after-create', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
                undefined, undefined, undefined, { requestedProvider: 'codex' },
            );

            expect(mockSoftAbortSession).toHaveBeenCalledWith('codex-session-3');
            expect(resolveAiServiceForProvider).toHaveBeenCalledWith('codex');
        });

        it('soft-aborts the bound session for a same-provider turn', async () => {
            await seedCopilotChat('queue_stop-same');
            const { executor, resolveAiServiceForProvider } = makeExecutor();
            mockSendMessage.mockImplementation(async () => {
                await executor.cancelProcess('queue_stop-same');
                return { success: false, error: 'aborted' };
            });

            await executor.executeFollowUp('queue_stop-same', 'Q2');

            expect(mockSoftAbortSession).toHaveBeenCalledWith('copilot-session-1');
            expect(resolveAiServiceForProvider).toHaveBeenCalledWith('copilot');
        });
    });
});
