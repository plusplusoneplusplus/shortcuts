/**
 * Steer vs queue, end to end on the server: the real delivery service, the
 * real CLITaskExecutor turn tracking and pending drain, and a mock Copilot SDK.
 *
 * - Steer (immediate) while a turn runs joins that turn, even before the
 *   session id is persisted; its reply comes back in the same assistant turn.
 * - Queue (enqueue) while a turn runs waits and only runs after it finishes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return { ...actual, existsSync: vi.fn(actual.existsSync), readFileSync: vi.fn(actual.readFileSync), mkdirSync: vi.fn() };
});

import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { ProcessMessageDeliveryService, type FollowUpMessageInput } from '../../src/server/processes/process-message-delivery-service';
import type { QueueExecutorBridge } from '../../src/server/core/api-handler';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createProcessFixture } from '../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual, sdkServiceRegistry: { getOrThrow: () => sdkMocks.service } };
});

vi.mock('../../src/ai-invoker', () => ({ createCLIAIInvoker: vi.fn().mockReturnValue(vi.fn()) }));

function input(content: string, deliveryMode: 'immediate' | 'enqueue'): FollowUpMessageInput {
    return { content, displayContent: content, deliveryMode, pasteExternalized: false, provider: 'copilot' };
}

describe('steer end to end (mock Copilot)', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let executor: CLITaskExecutor;
    let enqueued: QueuedTask[];

    beforeEach(() => {
        vi.clearAllMocks();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        store = createMockProcessStore();
        executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        enqueued = [];
        const tasks = new Map<string, QueuedTask>();
        executor.setQueueManager({
            enqueue: vi.fn((task: QueuedTask) => { enqueued.push(task); tasks.set(task.id, task); return task.id; }),
            getTask: vi.fn((id: string) => tasks.get(id)),
            updateTask: vi.fn(), reActivate: vi.fn(), returnToHistory: vi.fn(), markCompleted: vi.fn(),
            requeueFromHistory: vi.fn().mockReturnValue(true),
            getAll: vi.fn(() => []), getTasks: vi.fn(() => []), getHistory: vi.fn(() => []), on: vi.fn(), off: vi.fn(),
        } as any);
    });

    it.each([true, false])('keeps dispatch-time boundaries through streaming, multiple steers and settlement (success=%s)', async success => {
        const id = 'proc-boundaries';
        await store.addProcess(createProcessFixture({ id, status: 'running', conversationTurns: [
            { role: 'user', content: 'first', timestamp: new Date(), turnIndex: 0, timeline: [] },
        ] }));
        const task = { id: 'boundary-task', type: 'chat', priority: 'normal', status: 'running',
            createdAt: Date.now(), processId: id,
            payload: { kind: 'chat', processId: id, prompt: 'first' }, config: {},
        } as unknown as QueuedTask;
        let options: any;
        let finish!: () => void;
        const started = new Promise<void>(resolve => {
            sdkMocks.mockSendMessage.mockImplementation(async opts => {
                options = opts;
                opts.onSessionCreated!('boundary-session');
                opts.onStreamingChunk!('before');
                opts.onToolEvent!({ type: 'tool-start', toolCallId: 'tool-1', toolName: 'view', parameters: {} });
                resolve();
                await new Promise<void>(done => { finish = done; });
                return { success, response: 'beforeduringafter', sessionId: 'boundary-session',
                    ...(success ? {} : { error: 'provider failed' }) };
            });
        });
        const running = executor.execute(task);
        await started;
        const service = new ProcessMessageDeliveryService({ store, bridge: {
            enqueue: vi.fn(), findTaskByProcessId: () => task,
            steerProcess: (pid, message, steeringId) => executor.steerProcess(pid, message, steeringId),
        } as unknown as QueueExecutorBridge });

        sdkMocks.mockSteerSession.mockImplementation(async () => {
            options.onStreamingChunk('during');
            options.onToolEvent({ type: 'tool-complete', toolCallId: 'tool-1', toolName: 'view', result: 'ok' });
            return true;
        });
        const first = await service.deliver((await store.getProcess(id))!, {
            ...input('change one', 'immediate'), optimisticId: 'steer-one',
        });
        expect(first.events.find(event => event.kind === 'message-steering')).toMatchObject({
            boundary: { steeringId: 'steer-one', contentOffset: 6, timelineIndex: 2, eventOffset: 1 },
            userTurn: { content: 'change one', optimisticId: 'steer-one', steered: true },
        });
        const streamed = (await store.getProcess(id))!.conversationTurns!.find(turn => turn.streaming)!;
        expect(streamed.timeline.map(item => item.type)).toEqual(['content', 'tool-start', 'steering', 'content', 'tool-complete']);

        let acknowledge!: (accepted: boolean) => void;
        const dispatched = new Promise<void>(resolve => {
            sdkMocks.mockSteerSession.mockImplementation(async () => {
                options.onStreamingChunk('after');
                resolve();
                return new Promise<boolean>(done => { acknowledge = done; });
            });
        });
        const second = service.deliver((await store.getProcess(id))!, {
            ...input('change two', 'immediate'), optimisticId: 'steer-two',
        });
        await dispatched;
        finish();
        await new Promise(resolve => setImmediate(resolve));
        expect(store.completions.has(id)).toBe(false);
        // A reconnect while the provider acknowledgement is pending cannot see a successful marker.
        await (executor as any).executors.followUpExecutor.flushConversationTurn(id, true);
        const pending = (await store.getProcess(id))!.conversationTurns!.find(turn => turn.streaming)!;
        expect(pending.timeline.filter(item => item.type === 'steering')).toHaveLength(1);
        acknowledge(true);
        expect(await second).toMatchObject({ path: 'steered',
            boundary: { contentOffset: 12, timelineIndex: 5, eventOffset: 2 } });
        await running;

        const done = (await store.getProcess(id))!;
        const assistants = done.conversationTurns!.filter(turn => turn.role === 'assistant');
        expect(assistants).toHaveLength(1);
        expect(assistants[0].timeline.filter(item => item.type === 'steering').map(item =>
            [item.steeringId, item.contentOffset])).toEqual([['steer-one', 6], ['steer-two', 12]]);
        expect(assistants[0].timeline.filter(item => item.type === 'content').map(item => item.content))
            .toEqual(['before', 'during', 'after']);
        expect(assistants[0].timeline.filter(item => item.toolCall?.id === 'tool-1')).toHaveLength(2);
        expect(done.status).toBe(success ? 'completed' : 'failed');
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        expect(enqueued).toHaveLength(0);
    });

    it.each([false, 'throw'])('does not retain a rendering split when steering fails (%s)', async outcome => {
        const id = 'proc-refused';
        await store.addProcess(createProcessFixture({ id, status: 'running', conversationTurns: [
            { role: 'user', content: 'first', timestamp: new Date(), turnIndex: 0, timeline: [] },
        ] }));
        const task = { id: 'refused-task', type: 'chat', priority: 'normal', status: 'running',
            createdAt: Date.now(), processId: id,
            payload: { kind: 'chat', processId: id, prompt: 'first' }, config: {},
        } as unknown as QueuedTask;
        let finish!: () => void;
        const started = new Promise<void>(resolve => {
            sdkMocks.mockSendMessage.mockImplementation(async opts => {
                opts.onSessionCreated!('refused-session');
                opts.onStreamingChunk!('before');
                sdkMocks.mockSteerSession.mockImplementation(async () => {
                    opts.onStreamingChunk!('after');
                    if (outcome === 'throw') throw new Error('not accepted');
                    return false;
                });
                resolve();
                await new Promise<void>(done => { finish = done; });
                return { success: true, response: 'beforeafter', sessionId: 'refused-session' };
            });
        });
        const running = executor.execute(task);
        await started;
        const service = new ProcessMessageDeliveryService({ store, bridge: {
            enqueue: vi.fn(), findTaskByProcessId: () => task,
            steerProcess: (pid, message, steeringId) => executor.steerProcess(pid, message, steeringId),
        } as unknown as QueueExecutorBridge });
        const result = await service.deliver((await store.getProcess(id))!, input('not steered', 'immediate'));
        expect(result.path).toBe('buffered');
        expect(result.events.some(event => event.kind === 'message-steering')).toBe(false);
        finish();
        await running;
        const assistant = (await store.getProcess(id))!.conversationTurns!.find(turn => turn.role === 'assistant')!;
        expect(assistant.timeline.map(item => [item.type, item.content])).toEqual([['content', 'beforeafter']]);
    });

    it('records steering in the initial chat executor rather than the bridge session', async () => {
        const id = 'queue_initial-steer';
        const task = { id: 'initial-steer', type: 'chat', priority: 'normal', status: 'running',
            createdAt: Date.now(), payload: { kind: 'chat', prompt: 'first', mode: 'ask' }, config: {},
        } as unknown as QueuedTask;
        let finish!: () => void;
        const started = new Promise<void>(resolve => {
            sdkMocks.mockSendMessage.mockImplementation(async opts => {
                opts.onSessionCreated!('initial-session');
                opts.onStreamingChunk!('one');
                sdkMocks.mockSteerSession.mockImplementation(async () => {
                    opts.onStreamingChunk!('two');
                    return true;
                });
                resolve();
                await new Promise<void>(done => { finish = done; });
                return { success: true, response: 'onetwo', sessionId: 'initial-session' };
            });
        });
        const running = executor.execute(task);
        await started;
        const result = await executor.steerProcess(id, 'change', 'initial-marker');
        expect(result).toMatchObject({ contentOffset: 3, timelineIndex: 1 });
        finish();
        await running;
        const turns = (await store.getProcess(id))!.conversationTurns!;
        const assistant = turns.find(turn => turn.role === 'assistant')!;
        expect(assistant.timeline.map(item => [item.type, item.content ?? item.steeringId]))
            .toEqual([['content', 'one'], ['steering', 'initial-marker'], ['content', 'two']]);
    });

    it('steers into the running turn and runs the queued message only after it ends', async () => {
        const proc = createProcessFixture({ id: 'proc-e2e', status: 'running', conversationTurns: [
            { role: 'user', content: 'first', timestamp: new Date(), turnIndex: 0, timeline: [] },
        ] });
        await store.addProcess(proc);
        const task = {
            id: 'task-e2e', type: 'chat', priority: 'normal', status: 'running', createdAt: Date.now(),
            processId: 'proc-e2e', payload: { kind: 'chat', processId: 'proc-e2e', prompt: 'first' }, config: {}, displayName: 'first',
        } as unknown as QueuedTask;

        const steered: string[] = [];
        let finishTurn!: () => void;
        const turnStarted = new Promise<void>(started => {
            sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onSessionCreated('live-session');
                sdkMocks.mockSteerSession.mockImplementation(async (sessionId: string, prompt: string) => {
                    expect(sessionId).toBe('live-session');
                    steered.push(prompt);
                    return true;
                });
                started();
                await new Promise<void>(release => { finishTurn = release; });
                const response = ['part one', ...steered.map(p => `reply to ${p}`)].join('\n\n');
                return { success: true, response, sessionId: 'live-session', toolCalls: [] };
            });
        });

        const running = executor.execute(task);
        await turnStarted;

        const bridge = {
            enqueue: vi.fn(),
            findTaskByProcessId: () => task,
            steerProcess: (id: string, message: string, steeringId?: string) => executor.steerProcess(id, message, steeringId),
        } as unknown as QueueExecutorBridge;
        const delivery = new ProcessMessageDeliveryService({ store, bridge });

        const steer = await delivery.deliver((await store.getProcess('proc-e2e'))!, input('steer this', 'immediate'));
        expect(steer.path).toBe('steered');
        expect(steered).toEqual(['steer this']);

        const queued = await delivery.deliver((await store.getProcess('proc-e2e'))!, input('queue this', 'enqueue'));
        expect(queued.path).toBe('buffered');
        expect(enqueued).toHaveLength(0);

        finishTurn();
        await running;

        const done = (await store.getProcess('proc-e2e'))!;
        const turns = done.conversationTurns!.map(t => [t.role, t.content]);
        expect(turns.slice(0, 3)).toEqual([
            ['user', 'first'],
            ['user', 'steer this'],
            ['assistant', 'part one\n\nreply to steer this'],
        ]);
        // The queued message runs as the next turn, only after the first ended.
        expect(enqueued.map(t => (t.payload as any).prompt)).toEqual(['queue this']);
        expect(done.pendingMessages ?? []).toHaveLength(0);
    });
});
