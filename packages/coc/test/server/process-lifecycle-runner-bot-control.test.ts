import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner, type LifecycleRunnerOptions } from '../../src/server/executors/process-lifecycle-runner';
import { createBotControlMetadata } from '../../src/server/messaging/bot-control-metadata';
import { releaseBotControlledConversation } from '../../src/server/messaging/bot-control-admission';
import { processOperationAdmission } from '../../src/server/processes/process-operation-admission';
import { rehydrateImagesIfNeeded } from '../../src/server/executors/image-store';
import { TaskQueueManager } from '@plusplusoneplusplus/forge';
import { createMockProcessStore } from './helpers/mock-process-store';

vi.mock('../../src/server/executors/image-store', () => ({
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
    cleanupTempDir: vi.fn(),
}));
vi.mock('../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

function makeTask(overrides: Partial<QueuedTask> = {}): QueuedTask {
    return {
        id: 'initial', type: 'chat', repoId: 'ws-a', priority: 'normal',
        status: 'running', createdAt: Date.now(), config: {},
        payload: { kind: 'chat', prompt: 'request', workspaceId: 'ws-a', provider: 'codex' },
        ...overrides,
    };
}

function makeOptions(): LifecycleRunnerOptions {
    return {
        cancelledTasks: new Set(),
        executeByTypeFn: vi.fn().mockResolvedValue({ response: 'answer' }),
        executeFollowUpFn: vi.fn().mockResolvedValue(undefined),
        getWorkingDirectoryFn: () => undefined,
    };
}

afterEach(() => vi.clearAllMocks());

describe('trusted queued bot control at process creation', () => {
    it.each(['teams', 'whatsapp'] as const)('does not register a stale %s claim released during prompt preparation', async source => {
        const store = createMockProcessStore();
        const queue = new TaskQueueManager();
        const input = makeTask({ botControl: createBotControlMetadata(source), processId: 'queue_initial' });
        queue.enqueue(input);
        queue.markStarted('initial');
        const task = queue.getTask('initial')!;
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        let finish!: () => void;
        const preparation = new Promise<void>(resolve => { finish = resolve; });
        vi.mocked(rehydrateImagesIfNeeded).mockImplementationOnce(async () => { entered(); await preparation; });
        const options = makeOptions();
        options.executeByTypeFn = vi.fn(async () => {
            expect((await store.getProcess('queue_initial'))?.metadata).not.toHaveProperty('botControl');
            return { response: 'answer' };
        });
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined);
        const running = runner.run(task, options);
        await started;
        await releaseBotControlledConversation(store, queue, 'ws-a', 'queue_initial', source, 'initial', async () => {});
        finish();
        expect((await running).success).toBe(true);
        expect((await store.getProcess('queue_initial'))?.metadata).not.toHaveProperty('botControl');
    });

    it('serializes release after process registration and does not resurrect control on completion', async () => {
        const store = createMockProcessStore();
        const queue = new TaskQueueManager();
        queue.enqueue(makeTask({ botControl: createBotControlMetadata('teams'), processId: 'queue_initial' }));
        queue.markStarted('initial');
        const task = queue.getTask('initial')!;
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        let finish!: () => void;
        const execution = new Promise<void>(resolve => { finish = resolve; });
        const options = makeOptions();
        options.executeByTypeFn = vi.fn(async () => { entered(); await execution; return { response: 'answer' }; });
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined);
        const running = runner.run(task, options);
        await started;
        await releaseBotControlledConversation(store, queue, 'ws-a', 'queue_initial', 'teams', 'initial', async () => {});
        finish();
        expect((await running).success).toBe(true);
        expect((await store.getProcess('queue_initial'))?.metadata).not.toHaveProperty('botControl');
    });

    it('rechecks queued ownership after waiting for mutation admission', async () => {
        const store = createMockProcessStore();
        const queue = new TaskQueueManager();
        queue.enqueue(makeTask({ botControl: createBotControlMetadata('whatsapp'), processId: 'queue_initial' }));
        queue.markStarted('initial');
        const task = queue.getTask('initial')!;
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        let finish!: () => void;
        const blocker = new Promise<void>(resolve => { finish = resolve; });
        const held = processOperationAdmission.runExclusive('queue_initial', async () => { entered(); await blocker; });
        await started;
        const releasing = releaseBotControlledConversation(store, queue, 'ws-a', 'queue_initial', 'whatsapp', 'initial', async () => {});
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined);
        const running = runner.run(task, makeOptions());
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(store.addProcess).not.toHaveBeenCalled();
        finish();
        await held;
        await releasing;
        expect((await running).success).toBe(true);
        expect((await store.getProcess('queue_initial'))?.metadata).not.toHaveProperty('botControl');
    });

    it.each(['teams', 'whatsapp'] as const)('persists %s control before provider execution and across store restart', async source => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-process-'));
        const dbPath = path.join(directory, 'processes.db');
        const store = new SqliteProcessStore({ dbPath });
        const botControl = createBotControlMetadata(source);
        const task = makeTask({ botControl });
        const options = makeOptions();
        options.executeByTypeFn = vi.fn(async () => {
            const process = await store.getProcess('queue_initial');
            expect(process?.metadata).toMatchObject({ botControl, workspaceId: 'ws-a', provider: 'codex' });
            expect(task.processId).toBe('queue_initial');
            return { response: 'answer' };
        });
        try {
            const runner = new ProcessLifecycleRunner(store, undefined, () => undefined);
            expect((await runner.run(task, options)).success).toBe(true);
            expect(options.executeByTypeFn).toHaveBeenCalledOnce();
            expect((await store.getProcess('queue_initial'))?.metadata?.botControl).toEqual(botControl);
        } finally {
            store.close();
        }
        const restoredStore = new SqliteProcessStore({ dbPath });
        try {
            expect((await restoredStore.getProcess('queue_initial'))?.metadata)
                .toMatchObject({ botControl, workspaceId: 'ws-a', provider: 'codex' });
            expect(await restoredStore.getAllProcesses({ workspaceId: 'ws-b' })).toEqual([]);
        } finally {
            restoredStore.close();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('does not infer control from prompts, payloads, context, provider, or automation', async () => {
        const store = createMockProcessStore();
        const botControl = createBotControlMetadata('teams');
        const task = makeTask({
            payload: { kind: 'chat', prompt: 'Bot-managed Teams', workspaceId: 'ws-a', provider: 'codex',
                botControl, context: { botControl, source: 'cron' } },
        });
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined);
        expect((await runner.run(task, makeOptions())).success).toBe(true);
        expect((await store.getProcess('queue_initial'))?.metadata).not.toHaveProperty('botControl');
    });

    it.each([
        { controllerKey: 'unknown' },
        { state: 'inactive' },
        { source: 'unknown' },
        { externalThreadUrl: 'https://teams.microsoft.com/thread' },
        { routingId: 'opaque-private-value' },
    ])('rejects malformed or unauthorized queued provenance before registration (%j)', async changes => {
        const store = createMockProcessStore();
        const options = makeOptions();
        const task = makeTask();
        Object.assign(task, { botControl: { ...createBotControlMetadata('teams'), ...changes } });
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined);
        await expect(runner.run(task, options)).rejects.toThrow(/bot control/i);
        expect(store.addProcess).not.toHaveBeenCalled();
        expect(options.executeByTypeFn).not.toHaveBeenCalled();
        expect(task.processId).toBeUndefined();
    });

    it.each([
        { repoId: undefined },
        { repoId: 'ws-other' },
        { payload: { kind: 'chat', prompt: 'request' } },
        { payload: { kind: 'run-script', script: 'echo request', workspaceId: 'ws-a' } },
    ])('rejects missing or contradictory workspace authority (%j)', async changes => {
        const store = createMockProcessStore();
        const options = makeOptions();
        const task = makeTask({ botControl: createBotControlMetadata('teams'), ...changes });
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined);
        await expect(runner.run(task, options)).rejects.toThrow('matching chat workspace');
        expect(store.addProcess).not.toHaveBeenCalled();
        expect(options.executeByTypeFn).not.toHaveBeenCalled();
    });

    it('propagates failed process persistence without execution or success, then permits retry', async () => {
        const store = createMockProcessStore();
        const options = makeOptions();
        const task = makeTask({ botControl: createBotControlMetadata('whatsapp') });
        const error = new Error('process persistence rejected');
        vi.mocked(store.addProcess).mockRejectedValueOnce(error);
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined);
        await expect(runner.run(task, options)).rejects.toBe(error);
        expect(options.executeByTypeFn).not.toHaveBeenCalled();
        expect(task.processId).toBeUndefined();
        expect(await store.getProcess('queue_initial')).toBeUndefined();
        expect((await runner.run(task, options)).success).toBe(true);
        expect((await store.getProcess('queue_initial'))?.metadata?.botControl).toEqual(task.botControl);
    });

    it.each((['teams', 'whatsapp'] as const).flatMap(controller =>
        [false, true].flatMap(released =>
            (['human', 'cron', 'wakeup', 'trigger'] as const).map(source => ({ controller, released, source })),
        ),
    ))('preserves $controller lifecycle control for $source follow-ups (released: $released)', async ({ controller, released, source }) => {
        const store = createMockProcessStore();
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined);
        const initial = makeTask({ botControl: createBotControlMetadata(controller) });
        await runner.run(initial, makeOptions());
        if (released) {
            await releaseBotControlledConversation(store, new TaskQueueManager(), 'ws-a', 'queue_initial',
                controller, 'initial', async () => {});
        }
        const followUp = makeTask({
            id: 'follow-up', botControl: createBotControlMetadata(controller === 'teams' ? 'whatsapp' : 'teams'),
            payload: {
                kind: 'chat', processId: 'queue_initial', prompt: 'follow-up', workspaceId: 'ws-a',
                ...(source === 'human' ? {} : { context: { source } }),
            },
        });
        const options = makeOptions();
        expect((await runner.run(followUp, options)).success).toBe(true);
        expect(options.executeFollowUpFn).toHaveBeenCalledOnce();
        expect((await store.getProcess('queue_initial'))?.metadata?.botControl)
            .toEqual(released ? undefined : initial.botControl);
        expect((await store.getProcess('queue_initial'))?.metadata).toMatchObject({ workspaceId: 'ws-a', provider: 'codex' });
        expect(await store.getProcess('queue_follow-up')).toBeUndefined();
    });
});
