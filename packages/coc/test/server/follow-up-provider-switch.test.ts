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

    describe('assistant turn attribution (AC-06)', () => {
        /** The assistant turn the executor appended, if any. */
        function lastAssistantTurn(processId: string) {
            const turns = store.processes.get(processId)?.conversationTurns ?? [];
            return [...turns].reverse().find(t => t.role === 'assistant');
        }

        it('records the bound provider and segment on a same-provider turn', async () => {
            await seedCopilotChat('proc-attr-same');
            mockSendMessage.mockResolvedValueOnce({ success: true, response: 'A2', sessionId: 'copilot-session-1' });

            await new CLITaskExecutor(store).executeFollowUp('proc-attr-same', 'Q2');

            expect(lastAssistantTurn('proc-attr-same')).toMatchObject({
                provider: 'copilot',
                segmentId: 'seg-copilot-1',
            });
        });

        it('records the target provider and its new segment on a cross-provider turn', async () => {
            await seedCopilotChat('proc-attr-switch');
            mockSendMessage.mockImplementation(async (options: any) => {
                options?.onSessionCreated?.('codex-session-1');
                return { success: true, response: 'A2', sessionId: 'codex-session-1' };
            });

            await new CLITaskExecutor(store).executeFollowUp(
                'proc-attr-switch', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
                undefined, undefined, undefined, { requestedProvider: 'codex' },
            );

            const binding = store.processes.get('proc-attr-switch')?.activeProviderSession;
            expect(lastAssistantTurn('proc-attr-switch')).toMatchObject({
                provider: 'codex',
                segmentId: binding?.segmentId,
            });
            // The boundary is only provable if the new segment differs from the
            // one the earlier Copilot turns ran in.
            expect(binding?.segmentId).not.toBe('seg-copilot-1');
        });

        it('attributes an interrupted turn to the provider that was running it', async () => {
            await seedCopilotChat('proc-attr-failed');
            mockSendMessage.mockResolvedValueOnce({ success: false, error: 'codex exploded' });

            await new CLITaskExecutor(store).executeFollowUp(
                'proc-attr-failed', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
                undefined, undefined, undefined, { requestedProvider: 'codex' },
            );

            const turn = lastAssistantTurn('proc-attr-failed');
            expect(turn?.provider).toBe('codex');
            // No session was ever created, so there is no segment to claim —
            // and certainly not the outgoing Copilot one.
            expect(turn?.segmentId).toBeUndefined();
        });
    });

    describe('bounded context handoff (AC-05)', () => {
        /** System message the cross-provider call carried, if any. */
        function sentSystemMessage(): string {
            return String(mockSendMessage.mock.calls[0][0].systemMessage?.content ?? '');
        }

        it('hands the target provider a bounded handoff instead of an unbounded replay', async () => {
            await seedCopilotChat('proc-handoff');
            mockSendMessage.mockResolvedValueOnce({ success: true, response: 'A2', sessionId: 'codex-session-1' });

            await new CLITaskExecutor(store).executeFollowUp(
                'proc-handoff', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
                undefined, undefined, undefined, { requestedProvider: 'codex', historyCutoffTurnIndex: 2 },
            );

            const system = sentSystemMessage();
            expect(system).toContain('<conversation_handoff>');
            expect(system).toContain('[User]: Q1');
            expect(system).toContain('[Assistant]: A1');
        });

        it('sends the current user message exactly once — as the prompt, not as history', async () => {
            await seedCopilotChat('proc-handoff-once');
            mockSendMessage.mockResolvedValueOnce({ success: true, response: 'A2', sessionId: 'codex-session-1' });

            await new CLITaskExecutor(store).executeFollowUp(
                'proc-handoff-once', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
                undefined, undefined, undefined, { requestedProvider: 'codex', historyCutoffTurnIndex: 2 },
            );

            const options = mockSendMessage.mock.calls[0][0];
            expect(options.prompt ?? options.message).toContain('Q2');
            expect(sentSystemMessage()).not.toContain('[User]: Q2');
        });

        it('drops the trailing user turn when the caller supplies no cutoff', async () => {
            await seedCopilotChat('proc-handoff-no-cutoff');
            mockSendMessage.mockResolvedValueOnce({ success: true, response: 'A2', sessionId: 'codex-session-1' });

            await new CLITaskExecutor(store).executeFollowUp(
                'proc-handoff-no-cutoff', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
                undefined, undefined, undefined, { requestedProvider: 'codex' },
            );

            expect(sentSystemMessage()).not.toContain('[User]: Q2');
        });

        it('sends no handoff at all when the session is resumed natively', async () => {
            await seedCopilotChat('proc-handoff-native');
            mockSendMessage.mockResolvedValueOnce({ success: true, response: 'A2', sessionId: 'copilot-session-1' });

            await new CLITaskExecutor(store).executeFollowUp(
                'proc-handoff-native', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
                undefined, undefined, undefined, { requestedProvider: 'copilot', historyCutoffTurnIndex: 2 },
            );

            expect(sentSystemMessage()).not.toContain('<conversation_handoff>');
        });

        it('builds the handoff without invoking another model', async () => {
            await seedCopilotChat('proc-handoff-no-extra-call');
            mockSendMessage.mockResolvedValueOnce({ success: true, response: 'A2', sessionId: 'codex-session-1' });

            await new CLITaskExecutor(store).executeFollowUp(
                'proc-handoff-no-extra-call', 'Q2', undefined, 'ask', undefined, undefined, undefined, undefined,
                undefined, undefined, undefined, { requestedProvider: 'codex', historyCutoffTurnIndex: 2 },
            );

            expect(mockSendMessage).toHaveBeenCalledTimes(1);
        });
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
