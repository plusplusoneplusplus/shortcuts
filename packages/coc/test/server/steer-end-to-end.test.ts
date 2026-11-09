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
            steerProcess: (id: string, message: string) => executor.steerProcess(id, message),
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
