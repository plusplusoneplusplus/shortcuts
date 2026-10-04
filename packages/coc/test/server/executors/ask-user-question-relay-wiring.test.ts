/**
 * ask_user → WhatsApp/Teams question relay wiring.
 *
 * The relay is a late-bound runtime capability looked up when questions are
 * emitted. Only Ask and sentinel turns that carry a relay request id hand questions to it;
 * autopilot turns, dashboard follow-ups and approval prompts stay
 * dashboard-only. Registration of `ask_user` is untouched (see
 * mode-invariant-tool-block.test.ts).
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

    it('never relays an autopilot first turn', async () => {
        await new AutopilotExecutor(createMockProcessStore(), makeOptions()).execute(chatTask('autopilot', 't3', 'req-3'), 'Hello');
        expect(relayed).toEqual([]);
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

    it('clears relayed questions when the turn ends', async () => {
        const onCancel = vi.fn();
        relay.relay = request => { request.control.onCancelAll(onCancel); relayed.push(request); return true; };
        await new ChatExecutor(createMockProcessStore(), makeOptions()).execute(chatTask('ask', 't5', 'req-5'), 'Hello');
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(relayed[0].control.isPending(relayed[0].questions[0].questionId)).toBe(false);
    });
});
