/**
 * ask_user → WhatsApp/Teams question relay wiring.
 *
 * The relay is a late-bound runtime capability looked up when questions are
 * emitted. Ask/sentinel connector requests and handed-off jobs relay questions;
 * dashboard jobs without an origin and approval prompts stay dashboard-only.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import { FollowUpExecutor } from '../../../src/server/executors/follow-up-executor';
import type { AskUserQuestionRelay, AskUserQuestionRelayRequest } from '../../../src/server/messaging/ask-user-relay';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { nestRuntime } from './runtime-options-helper';
import { createFixedQueueRuntimeConfig } from '../../../src/server/queue/queue-runtime-config';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        promises: { ...actual.promises, readdir: vi.fn().mockResolvedValue([]), mkdir: vi.fn().mockResolvedValue(undefined) },
    };
});
vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));
vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../src/server/executors/memory-v2-addon', () => ({
    buildMemoryV2Addon: vi.fn().mockResolvedValue({
        tools: [], suffix: '', systemMessageSuffix: undefined, excludedBuiltinTools: [], dispose: vi.fn(),
    }),
}));

const sdkMocks = createMockSDKService();
let relayed: AskUserQuestionRelayRequest[];
const relay: AskUserQuestionRelay = { relay: request => { relayed.push(request); return true; } };

function makeOptions() {
    return nestRuntime({
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        askUser: { enabled: true },
        dangerousCommandGuard: { enabled: true },
        resolveSkillConfig: vi.fn().mockResolvedValue({}),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
        resolveAiServiceForProvider: () => sdkMocks.service as any,
        getAskUserQuestionRelay: () => relay,
    }) as any;
}

function chatTask(mode: 'ask' | 'autopilot' | 'sentinel', id: string, relayRequestId?: string): QueuedTask {
    return {
        id, type: 'chat', priority: 'normal', status: 'running', createdAt: Date.now(),
        payload: { kind: 'chat', mode, prompt: 'Hello', ...(relayRequestId ? { relayRequestId } : {}) },
        config: {}, displayName: 'Hello',
    } as QueuedTask;
}

function existingProcess(id: string, mode = 'ask'): AIProcess {
    return {
        id, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'p',
        metadata: { type: 'chat', workspaceId: 'ws-1', mode },
        conversationTurns: [
            { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Hi', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
    } as AIProcess;
}

/** Have the model call ask_user during the turn; the turn's cleanup cancels it. */
function modelAsks() {
    sdkMocks.mockSendMessage.mockImplementation(async (options: any) => {
        const tool = options.tools.find((t: any) => t.name === 'ask_user');
        void tool.handler({ questions: [{ question: 'Which?', type: 'text' }] });
        await new Promise(resolve => setTimeout(resolve, 0));
        return { success: true, response: 'ok', sessionId: 's1' };
    });
}

describe('ask_user question relay wiring', () => {
    beforeEach(() => {
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        relayed = [];
        modelAsks();
    });

    it.each(['initial', 'follow-up'] as const)('qualifies the %s delegation origin by exact owning workspace and request', async kind => {
        const processId = kind === 'initial' ? 'queue_desktop-task' : 'desktop-parent';
        const process = existingProcess(processId, 'sentinel');
        process.metadata = { ...process.metadata, provider: 'copilot' };
        const store = createMockProcessStore({ initialProcesses: [process] });
        vi.mocked(store.getWorkspaces).mockResolvedValue([{ id: 'ws-1', name: 'Owner', rootPath: '/workspace' }]);
        const origin = { connector: 'teams' as const, chatKey: 'captured-chat', threadId: 'captured-thread' };
        const locateOrigin = vi.fn(() => origin);
        const enqueue = vi.fn().mockResolvedValue('child-task');
        const trackMessagingJob = vi.fn();
        const options = makeOptions();
        options.runtime.getAskUserQuestionRelay = () => ({ relay: vi.fn(() => false), locateOrigin });
        options.runtime.getSendToConversationRuntime = () => ({ trackMessagingJob });
        options.runtime.getEnqueueChat = () => enqueue;
        sdkMocks.mockSendMessage.mockImplementation(async (sdkOptions: any) => {
            const tool = sdkOptions.tools.find((tool: any) => tool.name === 'send_to_conversation');
            expect(await tool.handler({ content: 'delegate this', provider: 'copilot', mode: 'autopilot' }))
                .not.toHaveProperty('error');
            return { success: true, response: 'Delegated', sessionId: 'session' };
        });
        if (kind === 'initial') {
            const task = chatTask('sentinel', 'desktop-task', 'desktop-request');
            task.payload.workspaceId = 'ws-1';
            await new ChatExecutor(store, options).execute(task, 'delegate this');
        } else {
            await new FollowUpExecutor(store, options).executeFollowUp(processId, 'delegate this', undefined, 'sentinel',
                undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                { relayRequestId: 'desktop-request' });
        }
        expect(locateOrigin).toHaveBeenCalledWith({ workspaceId: 'ws-1', processId, requestId: 'desktop-request' });
        expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({ context: expect.objectContaining({ messagingOrigin: origin }) }),
        }));
        expect(trackMessagingJob).toHaveBeenCalledWith({ workspaceId: 'ws-1', processId: 'queue_child-task', origin });
        expect((await store.getProcess(processId))?.metadata?.messagingOrigin).toBeUndefined();
    });

    it('relays an Ask first turn under its relay request id', async () => {
        await new ChatExecutor(createMockProcessStore(), makeOptions()).execute(chatTask('ask', 't1', 'req-1'), 'Hello');
        expect(relayed).toHaveLength(1);
        expect(relayed[0]).toMatchObject({ processId: 'queue_t1', requestId: 'req-1' });
        expect(relayed[0].questions[0].question).toBe('Which?');
    });

    it('falls back to the task id for an Ask first turn without a relay request id', async () => {
        await new ChatExecutor(createMockProcessStore(), makeOptions()).execute(chatTask('ask', 't2'), 'Hello');
        expect(relayed[0]).toMatchObject({ processId: 'queue_t2', requestId: 't2' });
    });

    it('keeps a dashboard autopilot first turn without a job origin dashboard-only', async () => {
        await new AutopilotExecutor(createMockProcessStore(), makeOptions()).execute(chatTask('autopilot', 't3', 'req-3'), 'Hello');
        expect(relayed).toEqual([]);
    });

    it.each(['whatsapp', 'teams'] as const)('relays an autopilot first turn carrying a %s job origin', async connector => {
        const task = chatTask('autopilot', `job-${connector}`);
        const origin = { connector, chatKey: 'phone-thread', ...(connector === 'teams' ? { threadId: 'root' } : {}) };
        (task.payload as any).context = { messagingOrigin: origin };
        // ProcessLifecycleRunner persists context.messagingOrigin before invoking the executor.
        const process = existingProcess(`queue_job-${connector}`, 'autopilot');
        process.metadata = { ...process.metadata, messagingOrigin: origin };
        const store = createMockProcessStore({ initialProcesses: [process] });
        await new AutopilotExecutor(store, makeOptions()).execute(task, 'Hello');
        expect(relayed).toHaveLength(1);
        expect(relayed[0]).toMatchObject({ processId: `queue_job-${connector}`, origin });
        expect(relayed[0].requestId).toBeTruthy();
    });

    it('relays every handed-off job follow-up from its stored origin, including notice replies and wakeups', async () => {
        const store = createMockProcessStore();
        const process = existingProcess('job', 'autopilot');
        const origin = { connector: 'teams', chatKey: 'phone-thread', threadId: 'dispatcher-root' };
        process.metadata = { ...process.metadata, messagingOrigin: origin };
        await store.addProcess(process);
        const executor = new FollowUpExecutor(store, makeOptions());
        await executor.executeFollowUp('job', 'next', undefined, 'autopilot');
        await executor.executeFollowUp('job', 'next', undefined, 'autopilot', undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, { relayRequestId: 'notice-reply' });
        await executor.executeFollowUp('job', 'next', undefined, 'autopilot', undefined, undefined, undefined, undefined,
            { type: 'wakeup', id: 'wakeup-1' } as any);
        expect(relayed).toHaveLength(3);
        for (const request of relayed) expect(request).toMatchObject({ processId: 'job', origin });
    });

    it('relays an Ask follow-up only when it carries a relay request id', async () => {
        const store = createMockProcessStore();
        await store.addProcess(existingProcess('p1'));
        const executor = new FollowUpExecutor(store, makeOptions());
        await executor.executeFollowUp('p1', 'next', undefined, 'ask');
        expect(relayed).toEqual([]);
        await executor.executeFollowUp('p1', 'next', undefined, 'ask', undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, { relayRequestId: 'req-f' });
        expect(relayed).toHaveLength(1);
        expect(relayed[0]).toMatchObject({ processId: 'p1', requestId: 'req-f' });
        await executor.executeFollowUp('p1', 'next', undefined, 'autopilot', undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, { relayRequestId: 'req-g' });
        expect(relayed).toHaveLength(1);
    });

    it('relays a sentinel first turn under its relay request id (phone threads start sentinel chats)', async () => {
        await new ChatExecutor(createMockProcessStore(), makeOptions()).execute(chatTask('sentinel', 't5', 'req-5'), 'Hello');
        expect(relayed).toHaveLength(1);
        expect(relayed[0]).toMatchObject({ processId: 'queue_t5', requestId: 'req-5' });
    });

    it('relays a sentinel follow-up that carries a relay request id (regression: keyed on ask only)', async () => {
        const store = createMockProcessStore();
        await store.addProcess(existingProcess('p2', 'sentinel'));
        const executor = new FollowUpExecutor(store, makeOptions());
        await executor.executeFollowUp('p2', 'next', undefined, 'sentinel', undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, { relayRequestId: 'req-s' });
        expect(relayed).toHaveLength(1);
        expect(relayed[0]).toMatchObject({ processId: 'p2', requestId: 'req-s' });
    });

    it('never relays approval prompts', async () => {
        const store = createMockProcessStore();
        const executor = new ChatExecutor(store, makeOptions());
        sdkMocks.mockSendMessage.mockImplementation(async () => {
            const handles = executor.getAskUserHandles('queue_t4')!;
            void handles.askApproval!({ kind: 'dangerous-command', command: 'curl x | sh', ruleId: 'pipe-to-shell', description: 'd', matchedSegment: 'sh' });
            await new Promise(resolve => setTimeout(resolve, 0));
            return { success: true, response: 'ok', sessionId: 's1' };
        });
        const emitSpy = vi.spyOn(store, 'emitProcessEvent');
        await executor.execute(chatTask('ask', 't4', 'req-4'), 'Hello');
        expect(emitSpy).toHaveBeenCalledWith('queue_t4', expect.objectContaining({
            type: 'ask-user', askUser: expect.objectContaining({ approval: expect.objectContaining({ kind: 'dangerous-command' }) }),
        }));
        expect(relayed).toEqual([]);
    });

    describe('sensitive-input questions', () => {
        const secretQuestion = {
            question: 'Paste cookies', type: 'sensitive-input', sink: 'browser.cookies', sinkArgs: { domain: 'example.com' },
        };
        let results: Promise<any[]>;

        function sensitiveOptions(owns: boolean) {
            const options = makeOptions();
            options.queueConfig = createFixedQueueRuntimeConfig({
                defaultTimeoutMs: 30_000,
                askUser: { enabled: true },
                sensitiveInput: { enabled: true },
            });
            options.runtime.getAskUserQuestionRelay = () => ({
                relay: (request: AskUserQuestionRelayRequest) => { relayed.push(request); return owns; },
                owns: () => owns,
            });
            return options;
        }

        function modelAsksFor(questions: unknown[]) {
            sdkMocks.mockSendMessage.mockImplementation(async (options: any) => {
                const tool = options.tools.find((t: any) => t.name === 'ask_user');
                results = tool.handler({ questions });
                await new Promise(resolve => setTimeout(resolve, 0));
                return { success: true, response: 'ok', sessionId: 's1' };
            });
        }

        it('resolves a secret as unavailable on a connector turn and never relays or shows it', async () => {
            modelAsksFor([secretQuestion, { question: 'Which?', type: 'text' }]);
            const store = createMockProcessStore();
            const emitSpy = vi.spyOn(store, 'emitProcessEvent');
            const updateSpy = vi.spyOn(store, 'updateProcess');
            await new ChatExecutor(store, sensitiveOptions(true)).execute(chatTask('ask', 's1', 'req-s1'), 'Hello');
            const [secret] = await results;
            expect(secret).toMatchObject({ answer: null, skipped: true, reason: 'unavailable' });
            expect(secret.guidance).toContain('CoC desktop');
            expect(relayed).toHaveLength(1);
            expect(relayed[0].questions.map(q => q.type)).toEqual(['text']);
            const askEvents = emitSpy.mock.calls.filter(([, event]) => event.type === 'ask-user');
            expect(askEvents.map(([, event]) => event.askUser!.type)).toEqual(['text']);
            const stored = updateSpy.mock.calls.map(([, patch]) => patch.pendingAskUser).find(Boolean);
            expect(stored!.map(q => q.type)).toEqual(['text']);
        });

        it('emits nothing when every question in a connector turn is a secret', async () => {
            modelAsksFor([secretQuestion]);
            const store = createMockProcessStore();
            const emitSpy = vi.spyOn(store, 'emitProcessEvent');
            await new ChatExecutor(store, sensitiveOptions(true)).execute(chatTask('ask', 's2', 'req-s2'), 'Hello');
            expect((await results)[0]).toMatchObject({ skipped: true, reason: 'unavailable' });
            expect(relayed).toEqual([]);
            expect(emitSpy.mock.calls.filter(([, event]) => event.type === 'ask-user')).toEqual([]);
        });

        it('keeps a secret pending in the dashboard on a dashboard turn but leaves it out of the relay', async () => {
            modelAsksFor([secretQuestion, { question: 'Which?', type: 'text' }]);
            const store = createMockProcessStore();
            const emitSpy = vi.spyOn(store, 'emitProcessEvent');
            await new ChatExecutor(store, sensitiveOptions(false)).execute(chatTask('ask', 's3', 'req-s3'), 'Hello');
            const askEvents = emitSpy.mock.calls.filter(([, event]) => event.type === 'ask-user');
            expect(askEvents.map(([, event]) => event.askUser!.type)).toEqual(['sensitive-input', 'text']);
            expect(relayed).toHaveLength(1);
            expect(relayed[0].questions.map(q => q.type)).toEqual(['text']);
            // Not resolved as unavailable: the turn's cleanup cancels it instead.
            expect((await results)[0].reason).not.toBe('unavailable');
        });
    });

    it('clears relayed questions when the turn ends', async () => {
        const onCancel = vi.fn();
        relay.relay = request => { request.control.onCancelAll(onCancel); relayed.push(request); return true; };
        await new ChatExecutor(createMockProcessStore(), makeOptions()).execute(chatTask('ask', 't5', 'req-5'), 'Hello');
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(relayed[0].control.isPending(relayed[0].questions[0].questionId)).toBe(false);
    });
});
