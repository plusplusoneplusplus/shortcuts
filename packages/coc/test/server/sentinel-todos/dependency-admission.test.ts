import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepoDataPath, SqliteProcessStore, TaskQueueManager, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelDependencyStore } from '../../../src/server/sentinel-todos/sentinel-dependency-store';
import { SentinelDependencyActions } from '../../../src/server/sentinel-todos/sentinel-dependency-actions';
import { ProcessMessageDeliveryService } from '../../../src/server/processes/process-message-delivery-service';
import { createSentinelTodoTracking, createSentinelTodosTool } from '../../../src/server/llm-tools/sentinel-todos-tool';
import type { QueueExecutorBridge } from '../../../src/server/core/api-handler';
import type { SentinelTodoDependencyActionSettings } from '@plusplusoneplusplus/coc-client';
import { ProcessLifecycleRunner } from '../../../src/server/executors/process-lifecycle-runner';
import { validateAndParseTask } from '../../../src/server/routes/queue-shared';
import { prepareTaskForEnqueue } from '../../../src/server/routes/queue-enqueue';
import { launchRalphSession } from '../../../src/server/ralph/ralph-launch-service';
import { artifactVersion } from '../../../src/server/sentinel-todos/sentinel-todo-evidence';
import { buildRalphIterationTask } from '../../../src/server/ralph/enqueue-iteration';

const owner = { workspaceId: 'ws-parent', processId: 'queue_parent' };
const saved: SentinelTodoDependencyActionSettings = {
    mode: 'ask', provider: 'copilot', model: 'gpt-5.4', targetWorkspaceId: 'ws-child',
    prompt: 'Review the explicitly approved output', scope: 'Read-only design review',
};

describe('native dependency authority and durable activation', () => {
    let directory: string;
    let processes: SqliteProcessStore;
    let queue: TaskQueueManager;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let receipts: SentinelDependencyStore;
    let actions: SentinelDependencyActions;
    let sourceId: string;
    let itemId: string;
    let enabled: boolean;
    let targetAvailable: boolean;
    let providerAvailable: boolean;
    let bridge: QueueExecutorBridge;
    let validateProvider: ReturnType<typeof vi.fn>;
    let coexisting: 'waiting' | 'delivered' | undefined;
    let fetchPr: ReturnType<typeof vi.fn>;
    const current = (id = itemId) => todos.get(owner).items.find(item => item.id === id)!;
    const record = () => receipts.action(owner, itemId)!;

    function wire() {
        todos = new SentinelTodoStore(processes.getDatabase());
        service = new SentinelTodoService({ todos, store: processes, getDependenciesEnabled: () => enabled,
            fetchPr, resolveWorkspaceRoot: async () => directory });
        receipts = new SentinelDependencyStore(processes.getDatabase(), todos);
        actions = new SentinelDependencyActions({
            receipts, service, dataDir: directory, delivery: new ProcessMessageDeliveryService({ store: processes, bridge }),
            validateProvider,
            validateTarget: async target => {
                if (!targetAvailable || target !== saved.targetWorkspaceId) throw new Error('Saved target unavailable');
            },
            validateCurrent: () => {
                if (!targetAvailable || !providerAvailable || !enabled) throw new Error('Current target/provider unavailable');
            },
            hasTask: id => !!queue.getTask(id),
            coexistingTransport: () => coexisting ? { triggerId: 'existing-owner-rule', state: coexisting } : undefined,
        });
        service.dependencyActions = actions;
    }

    beforeEach(async () => {
        directory = fs.mkdtempSync(path.join(process.cwd(), '.dependency-admission-'));
        enabled = targetAvailable = providerAvailable = true;
        coexisting = undefined;
        processes = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        queue = new TaskQueueManager();
        bridge = {
            enqueue: vi.fn(async (input: CreateTaskInput) => queue.enqueue(input)),
            getTask: id => queue.getTask(id),
            findTaskByProcessId: id => queue.getAll().find(task => task.processId === id && ['running', 'queued'].includes(task.status)),
            steerProcess: vi.fn(), executeFollowUp: vi.fn(),
        } as unknown as QueueExecutorBridge;
        validateProvider = vi.fn(async () => { if (!providerAvailable) throw new Error('Saved provider unavailable'); });
        fetchPr = vi.fn(async () => ({ status: 'merged', url: 'https://github.com/example/project/pull/42', title: 'Output' }));
        await processes.addProcess({ id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Owner', metadata: { ...owner, mode: 'sentinel', provider: 'copilot' } });
        wire();
        sourceId = todos.create(owner, { title: 'Prerequisite', status: 'done' }, { actor: 'user' }).item.id;
        itemId = todos.create(owner, { title: 'Dependent' }, { actor: 'user' }).item.id;
        todos.setDependencies(owner, itemId, 1, [{ itemId: sourceId, condition: { kind: 'done' } }], 'user');
    });
    afterEach(() => { processes.close(); fs.rmSync(directory, { recursive: true, force: true }); });

    async function authorize(action = saved) {
        return actions.authorize(owner, itemId, { expectedRevision: current().revision, confirmed: true, action }, 'user');
    }
    async function input(mode = saved.mode): Promise<CreateTaskInput> {
        return { id: record().action.taskId, type: 'chat', priority: 'normal',
            config: { model: saved.model }, payload: {
                kind: 'chat', mode, workspaceId: saved.targetWorkspaceId, provider: saved.provider,
                prompt: mode === 'ralph' ? buildRalphIterationTask({ workspaceId: saved.targetWorkspaceId,
                    sessionId: `ralph-approved-${record().action.taskId}`, originalGoal: saved.prompt,
                    iteration: 1, maxIterations: 1, dataDir: directory }).payload.prompt : saved.prompt, context: {
                    spawnedFromProcessId: owner.processId, sentinelTodoTracking: await actions.context(owner, itemId),
                    ...(mode === 'ralph' ? { ralph: { originalGoal: saved.prompt, currentIteration: 1,
                        phase: 'executing', maxIterations: 1, sessionId: `ralph-approved-${record().action.taskId}` } } : {}),
                },
            } };
    }
    async function restart() {
        processes.close();
        processes = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        wire();
    }

    it('commits immutable readiness and one fixed wake before transport, without granting authority or fulfillment', async () => {
        const original = bridge.enqueue!;
        bridge.enqueue = async task => {
            expect(receipts.wakes(owner)).toHaveLength(1);
            expect(receipts.wakes(owner)[0].evidence.state).toBe('ready');
            return original(task);
        };
        await actions.poll(owner);
        expect(current().status).toBe('todo');
        expect(receipts.action(owner, itemId)).toBeUndefined();
        expect((await service.list(owner)).items.find(item => item.id === itemId)?.dependencyReadiness?.state).toBe('needs_approval');
        expect(queue.getAll()).toHaveLength(1);
        expect(queue.getAll()[0].config).toMatchObject({ respectQueueBarriers: true });
        expect(queue.getAll()[0].payload.context).toMatchObject({ source: 'trigger', deliveryId: receipts.wakes(owner)[0].id });
    });

    it('concurrent duplicate polls and restart recover exactly one delivered wake', async () => {
        await Promise.all([actions.poll(owner), actions.poll(owner), actions.poll(owner)]);
        const wake = receipts.wakes(owner)[0];
        await restart();
        await Promise.all([actions.poll(owner), actions.poll(owner)]);
        expect(receipts.wakes(owner)).toEqual([wake]);
        expect(queue.getAll()).toHaveLength(1);
        expect((await processes.getProcess(owner.processId))?.conversationTurns).toHaveLength(1);
    });

    it('recovers a crash before delivery using the already committed receipt', async () => {
        bridge.enqueue = vi.fn(async () => { throw new Error('Crash before queue acceptance'); });
        await actions.poll(owner);
        expect(receipts.wakes(owner)[0]).toMatchObject({ delivery: 'pending', error: expect.stringContaining('enqueue') });
        const id = receipts.wakes(owner)[0].id;
        bridge.enqueue = async task => queue.enqueue(task);
        await restart();
        await actions.poll(owner);
        expect(receipts.wakes(owner)[0]).toMatchObject({ id, delivery: 'delivered' });
        expect(queue.getAll()).toHaveLength(1);
    });

    it('recovers transport failure after acceptance without a duplicate task or turn', async () => {
        bridge.enqueue = async task => { queue.enqueue(task); throw new Error('Observer failed after acceptance'); };
        await actions.poll(owner);
        await restart();
        bridge.enqueue = async task => queue.enqueue(task);
        await actions.poll(owner);
        expect(queue.getAll()).toHaveLength(1);
        expect((await processes.getProcess(owner.processId))?.conversationTurns).toHaveLength(1);
    });

    it('recovers a crash after delivery but before the wake acknowledgement without replaying transport', async () => {
        vi.spyOn(receipts, 'delivery').mockImplementationOnce(() => { throw new Error('Wake acknowledgement interrupted'); });
        await actions.poll(owner);
        expect(receipts.wakes(owner)[0].delivery).toBe('pending');
        await restart();
        await actions.poll(owner);
        expect(receipts.wakes(owner)[0].delivery).toBe('delivered');
        expect(queue.getAll()).toHaveLength(1);
        expect((await processes.getProcess(owner.processId))?.conversationTurns).toHaveLength(1);
    });

    it('coalesces transport with an existing merge rule without firing, editing or consuming it', async () => {
        coexisting = 'waiting';
        await actions.poll(owner);
        expect(queue.getAll()).toHaveLength(0);
        expect(receipts.wakes(owner)[0]).toMatchObject({ delivery: 'pending', transportTriggerId: 'existing-owner-rule' });
        coexisting = 'delivered';
        await restart();
        await actions.poll(owner);
        expect(receipts.wakes(owner)[0].delivery).toBe('delivered');
        expect(queue.getAll()).toHaveLength(0);
        expect(current().status).toBe('todo');
    });

    it('continues an already running Ralph session/final check after revocation, graph edits and fresh authorization', async () => {
        await authorize({ ...saved, mode: 'ralph' });
        await actions.poll(owner);
        const task = await input('ralph');
        const sessionId = `ralph-approved-${task.id}`;
        (task.payload.context as any).ralph.sessionId = sessionId;
        await actions.guard(task, 'enqueue');
        await actions.guard(task, 'start');
        await actions.revoke(owner, itemId, { expectedRevision: current().revision }, 'user');
        await authorize({ ...saved, mode: 'ask' });
        const next = structuredClone(task);
        next.id = 'next-native-iteration';
        next.continuationOfSessionId = sessionId;
        (next.payload.context as any).ralph.currentIteration = 2;
        await actions.guard(next, 'start');
        const finalCheck = structuredClone(next);
        finalCheck.id = 'native-final-check';
        (finalCheck.payload.context as any).ralph.currentIteration = 1;
        (finalCheck.payload.context as any).ralph.finalCheck = { kind: 'goal-gap-check', checkIndex: 1 };
        await actions.guard(finalCheck, 'start');
        expect(record().action).toMatchObject({ state: 'authorized', mode: 'ask' });
        (next.payload.context as any).ralph.sessionId = 'foreign-session';
        await expect(actions.guard(next, 'start')).rejects.toThrow('continuation');
    });

    it('does not silently resolve launch defaults even when current defaults happen to match', async () => {
        await authorize();
        await actions.poll(owner);
        const tracking = createSentinelTodoTracking({ service, owner });
        await expect(tracking.prepare!(itemId, { content: saved.prompt, todoItemId: itemId })).rejects.toThrow('defaults/Auto');
        expect(record().action.state).toBe('blocked');
    });

    it('keeps native running Ralph admission available after authoring is disabled, but blocks fresh starts', async () => {
        await authorize({ ...saved, mode: 'ralph' });
        await actions.poll(owner);
        const task = await input('ralph');
        await actions.guard(task, 'enqueue');
        await actions.guard(task, 'start');
        const next = structuredClone(task);
        next.id = 'continued-after-disable';
        next.continuationOfSessionId = `ralph-approved-${task.id}`;
        (next.payload.context as any).ralph.currentIteration = 2;
        delete (next.payload.context as any).sentinelTodoTracking;
        delete (next.payload.context as any).spawnedFromProcessId;
        enabled = false;
        const runner = new ProcessLifecycleRunner(processes, directory, vi.fn(), 'copilot', {
            getSentinelTodos: () => undefined, getSentinelDependencyAdmission: () => actions,
        });
        const executeByTypeFn = vi.fn(async () => ({ success: true }));
        const nextId = queue.enqueue(next);
        const result = await runner.run(queue.getTask(nextId)!, {
            cancelledTasks: new Set(), executeByTypeFn, getWorkingDirectoryFn: () => directory,
            executeFollowUpFn: vi.fn(),
        });
        expect(result.success).toBe(true);
        expect(executeByTypeFn).toHaveBeenCalledTimes(1);
        await expect(actions.guard(task, 'enqueue')).rejects.toThrow();
    });

    it('restores native local admission when queued execution loses both owner and tracking context', async () => {
        await authorize();
        await actions.poll(owner);
        const task = await input();
        await actions.guard(task, 'enqueue');
        delete task.payload.context;
        todos.update(owner, sourceId, current(sourceId).revision, { status: 'todo' }, 'user');
        const executeByTypeFn = vi.fn();
        const runner = new ProcessLifecycleRunner(processes, directory, vi.fn(), 'copilot', {
            getSentinelDependencyAdmission: () => actions,
        });
        const taskId = queue.enqueue(task);
        const result = await runner.run(queue.getTask(taskId)!, { cancelledTasks: new Set(), executeByTypeFn } as never);
        expect(result.success).toBe(false);
        expect(executeByTypeFn).not.toHaveBeenCalled();
        expect(record().action.state).toBe('blocked');
    });

    it.each(['executor-mode', 'session', 'phase'] as const)('rejects incompatible native Ralph %s before consuming saved work', async field => {
        await authorize({ ...saved, mode: 'ralph' });
        await actions.poll(owner);
        const task = await input('ralph');
        if (field === 'executor-mode') task.payload.mode = 'autopilot';
        if (field === 'session') (task.payload.context as any).ralph.sessionId = 'foreign-session';
        if (field === 'phase') (task.payload.context as any).ralph.phase = 'grilling';
        await expect(actions.guard(task, 'enqueue')).rejects.toThrow('parameters');
        expect(record().action.state).toBe('blocked');
    });

    it('blocks uncertain native Ralph admission receipts without reattempting work', async () => {
        await authorize({ ...saved, mode: 'ralph' });
        await actions.poll(owner);
        const launch = {
            requestId: record().action.taskId, goalSpec: saved.prompt, workspaceId: saved.targetWorkspaceId,
            aiSelection: { provider: saved.provider, config: { model: saved.model } },
            spawnedFromProcessId: owner.processId, sentinelTodoTracking: await actions.context(owner, itemId),
        };
        const sessionId = `ralph-approved-${launch.requestId}`;
        const file = getRepoDataPath(directory, launch.workspaceId, `ralph-sessions/${sessionId}/admission.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ goalSpec: launch.goalSpec, status: 'admitting',
            trackedFingerprint: JSON.stringify({ tracking: launch.sentinelTodoTracking, workspaceId: launch.workspaceId,
                aiSelection: launch.aiSelection, parent: launch.spawnedFromProcessId }) }));
        const enqueue = vi.fn();
        const result = await launchRalphSession(launch, {
            dataDir: directory, store: processes, bridge: { getTask: () => undefined, enqueue } as never,
            getRalphEnabled: () => true, guardTrackedLaunch: input => actions.preflightRalph(input),
            onTrackedLaunchFailure: (input, error) => {
                const token = input.sentinelTodoTracking!;
                actions.block(token.owner, token.itemId, token.actionRevision, error);
            },
        });
        expect(result).toMatchObject({ ok: false, error: expect.stringContaining('uncertain') });
        expect(enqueue).not.toHaveBeenCalled();
        expect(record().action).toMatchObject({ state: 'blocked', error: expect.stringContaining('uncertain') });
    });

    it('rejects a forged Ralph execution prompt even when its declared goal matches saved authority', async () => {
        await authorize({ ...saved, mode: 'ralph' });
        await actions.poll(owner);
        const task = await input('ralph');
        task.payload.prompt = 'Execute an unrelated instruction';
        await expect(actions.guard(task, 'enqueue')).rejects.toThrow('canonical saved goal');
        expect(record().action.state).toBe('blocked');
    });

    it('durably prevents Ralph iteration replay after crashes, including a fresh task ID', async () => {
        await authorize({ ...saved, mode: 'ralph' });
        await actions.poll(owner);
        const task = await input('ralph');
        await actions.guard(task, 'enqueue');
        await actions.guard(task, 'start');
        const next = structuredClone(task);
        next.id = 'next-step';
        next.continuationOfSessionId = `ralph-approved-${task.id}`;
        await expect(actions.guard(next, 'start')).rejects.toThrow('already started');
        (next.payload.context as any).ralph.currentIteration = 2;
        await actions.guard(next, 'start');
        await restart();
        next.id = 'retry-same-step';
        await expect(actions.guard(next, 'start')).rejects.toThrow('fresh explicit authority');
    });

    it('deduplicates busy parent buffering across restart', async () => {
        await processes.updateProcess(owner.processId, { status: 'running' });
        await Promise.all([actions.poll(owner), actions.poll(owner)]);
        expect((await processes.getProcess(owner.processId))?.pendingMessages).toHaveLength(1);
        expect(queue.getAll()).toHaveLength(0);
        await restart();
        await actions.poll(owner);
        expect((await processes.getProcess(owner.processId))?.pendingMessages).toHaveLength(1);
        expect(bridge.steerProcess).not.toHaveBeenCalled();
    });

    it('requires explicit user approval and rejects actor/unknown field/default substitution', async () => {
        await expect(actions.authorize(owner, itemId, { expectedRevision: current().revision, confirmed: true, action: saved }, 'sentinel' as never)).rejects.toThrow('owner-user');
        for (const action of [{ ...saved, provider: 'auto' }, { ...saved, model: '' }, { ...saved, scope: '' }, { ...saved, provider: 'claude' }, { ...saved, targetWorkspaceId: 'remote:server:ws' }]) {
            await expect(authorize(action as never)).rejects.toThrow();
        }
        await expect(actions.authorize(owner, itemId, { expectedRevision: current().revision, action: saved }, 'user')).rejects.toThrow();
        expect(receipts.action(owner, itemId)).toBeUndefined();
    });

    it.each(['ask', 'autopilot', 'ralph'] as const)('snapshots %s without changing provider/model/target, and consumes once', async mode => {
        await authorize({ ...saved, mode });
        await actions.poll(owner);
        const task = await input(mode);
        const results = await Promise.allSettled([actions.guard(task, 'enqueue'), actions.guard(structuredClone(task), 'enqueue')]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(record().action).toMatchObject({ ...saved, mode, state: 'consumed' });
        queue.enqueue(task);
        await actions.guard(task, 'start');
        expect(task.payload.prompt).toContain(saved.scope);
        await expect(actions.guard(task, 'start')).rejects.toThrow('already started');
        expect(current().jobs).toHaveLength(1);
    });

    it('reconciles accepted durable identity after crash and refuses automatic work replay', async () => {
        await authorize();
        await actions.poll(owner);
        const task = await input();
        await actions.guard(task, 'enqueue');
        queue.enqueue(task);
        await restart();
        await actions.poll(owner);
        expect(record().action.state).toBe('consumed');
        await expect(actions.guard(task, 'enqueue')).rejects.toThrow('consumed');
        await actions.guard(task, 'start');
        expect(record().started).toBe(true);
    });

    it('blocks an uncertain consumed admission after crash before queue delivery; only fresh authority rearms it', async () => {
        await authorize();
        await actions.poll(owner);
        const task = await input();
        await actions.guard(task, 'enqueue');
        await restart();
        await actions.poll(owner);
        expect(record().action).toMatchObject({ state: 'blocked', error: expect.stringContaining('unknown') });
        await expect(actions.guard(task, 'enqueue')).rejects.toThrow('fresh');
        const previousId = record().action.taskId;
        await authorize();
        expect(record().action.taskId).not.toBe(previousId);
        expect(record().action.revision).toBe(2);
    });

    it.each(['mode', 'provider', 'model', 'target', 'prompt', 'parent', 'routing', 'folder', 'repo', 'retries'] as const)('blocks incompatible %s rather than replacing captured settings', async field => {
        await authorize();
        await actions.poll(owner);
        const task = await input();
        if (field === 'mode') task.payload.mode = 'autopilot';
        if (field === 'provider') task.payload.provider = 'claude';
        if (field === 'model') task.config.model = 'gpt-5.5';
        if (field === 'target') task.payload.workspaceId = 'ws-other';
        if (field === 'prompt') task.payload.prompt = 'Implement instead';
        if (field === 'parent') (task.payload.context as any).spawnedFromProcessId = 'other';
        if (field === 'routing') (task.payload.context as any).autoProviderRouting = { requested: true };
        if (field === 'folder') task.folderPath = 'other-folder';
        if (field === 'repo') task.repoId = 'ws-other';
        if (field === 'retries') task.config.retryOnFailure = true;
        await expect(actions.guard(task, 'enqueue')).rejects.toThrow();
        expect(record().action).toMatchObject({ ...saved, state: 'blocked', error: expect.any(String) });
        expect(current().jobs).toHaveLength(0);
    });

    it.each(['source', 'graph', 'action', 'provider', 'target'] as const)('rechecks stale %s at first execution and never rearms consumed authority', async change => {
        await authorize();
        await actions.poll(owner);
        const task = await input();
        await actions.guard(task, 'enqueue');
        if (change === 'source') todos.update(owner, sourceId, current(sourceId).revision, { status: 'todo' }, 'user');
        if (change === 'graph') todos.setDependencies(owner, itemId, current().revision, [], 'user');
        if (change === 'action') await actions.revoke(owner, itemId, { expectedRevision: current().revision }, 'user');
        if (change === 'provider') providerAvailable = false;
        if (change === 'target') targetAvailable = false;
        await expect(actions.guard(task, 'start')).rejects.toThrow();
        expect(record().started).not.toBe(true);
        expect(['blocked', 'revoked']).toContain(record().action.state);
    });

    it('rejects missing/revoked authority without letting artifact/readiness acceptance authorize work', async () => {
        await actions.poll(owner);
        const task: CreateTaskInput = { type: 'chat', priority: 'normal', config: { model: saved.model },
            payload: { kind: 'chat', ...saved, workspaceId: saved.targetWorkspaceId,
                context: { spawnedFromProcessId: owner.processId, sentinelTodoTracking: await actions.context(owner, itemId) } } };
        await expect(actions.guard(task, 'enqueue')).rejects.toThrow('Needs approval');
        await authorize();
        const approved = await input();
        await actions.revoke(owner, itemId, { expectedRevision: current().revision }, 'user');
        await actions.poll(owner);
        await expect(actions.guard(approved, 'enqueue')).rejects.toThrow('revoked');
        expect(actions.project(owner, current()).dependencyReadiness?.state).toBe('needs_approval');
    });

    it('requires fresh authority after source generations change even if Done is restored', async () => {
        await authorize();
        await actions.poll(owner);
        todos.update(owner, sourceId, current(sourceId).revision, { status: 'todo' }, 'user');
        todos.update(owner, sourceId, current(sourceId).revision, { status: 'done' }, 'user');
        await actions.poll(owner);
        expect(receipts.wakes(owner)).toHaveLength(1);
        await expect(actions.guard(await input(), 'enqueue')).rejects.toThrow('stale');
        expect(record().action.state).toBe('blocked');
    });

    it('does not cancel already running work on revocation or changed prerequisites', async () => {
        await authorize();
        await actions.poll(owner);
        const task = await input();
        await actions.guard(task, 'enqueue');
        queue.enqueue(task);
        await actions.guard(task, 'start');
        queue.markStarted(task.id!);
        await actions.revoke(owner, itemId, { expectedRevision: current().revision }, 'user');
        todos.update(owner, sourceId, current(sourceId).revision, { status: 'todo' }, 'user');
        await actions.poll(owner);
        expect(queue.getTask(task.id!)?.status).toBe('running');
    });

    it('keeps manual dependents tracking-only and does not expose approval through tools', async () => {
        const manual = todos.create(owner, { type: 'manual', title: 'Human task' }, { actor: 'user' }).item;
        todos.setDependencies(owner, manual.id, 1, [{ itemId: sourceId, condition: { kind: 'done' } }], 'user');
        await expect(actions.authorize(owner, manual.id, { expectedRevision: 2, confirmed: true, action: saved }, 'user')).rejects.toThrow('normal');
        await expect(actions.context(owner, manual.id)).rejects.toThrow('Manual');
        const tool = createSentinelTodosTool({ service, owner }).tool;
        expect(JSON.stringify(tool.parameters)).not.toContain('authorize_dependency');
        const tracking = createSentinelTodoTracking({ service, owner });
        expect(await tracking.check(manual.id)).toContain('Manual');
    });

    it('accepts a manual prerequisite verdict without granting it job authority', async () => {
        const manual = todos.create(owner, { type: 'manual', title: 'Human sign-off', status: 'done' }, { actor: 'user' }).item;
        todos.setDependencies(owner, itemId, current().revision, [{ itemId: manual.id, condition: { kind: 'done' } }], 'user');
        await authorize();
        await actions.poll(owner);
        await actions.guard(await input(), 'enqueue');
        expect(current(manual.id).jobs).toHaveLength(0);
        expect(record().action.state).toBe('consumed');
    });

    it('rejects disabled/unavailable/foreign owner access without changing receipts', async () => {
        await authorize();
        enabled = false;
        await expect(actions.context(owner, itemId)).rejects.toThrow('disabled');
        enabled = true;
        await expect(actions.context({ ...owner, workspaceId: 'foreign' }, itemId)).rejects.toThrow();
        await processes.updateProcess(owner.processId, { metadata: { workspaceId: owner.workspaceId, mode: 'ask' } });
        await expect(actions.poll(owner)).rejects.toThrow();
        expect(receipts.wakes(owner)).toHaveLength(0);
    });

    it('validates Ralph intent before native session side effects and rejects grilling escalation', async () => {
        await authorize({ ...saved, mode: 'ralph' });
        const launch = { requestId: record().action.taskId, goalSpec: saved.prompt, workspaceId: saved.targetWorkspaceId,
            spawnedFromProcessId: owner.processId, sentinelTodoTracking: await actions.context(owner, itemId),
            aiSelection: { provider: saved.provider, config: { model: saved.model } } };
        await actions.preflightRalph(launch);
        await expect(actions.preflightRalph({ ...launch, entryPoint: 'grill' })).rejects.toThrow('saved action');
        expect(record().action.state).toBe('blocked');
    });

    it('reconciles the native Ralph request identity and rejects replay with different settings or removed tracking proof', async () => {
        await authorize({ ...saved, mode: 'ralph' });
        await actions.poll(owner);
        const launch = { requestId: record().action.taskId, goalSpec: saved.prompt, workspaceId: saved.targetWorkspaceId,
            spawnedFromProcessId: owner.processId, sentinelTodoTracking: await actions.context(owner, itemId),
            aiSelection: { provider: saved.provider, config: { model: saved.model } } };
        const guardTrackedLaunch = vi.fn(request => actions.preflightRalph(request));
        const deps = { dataDir: directory, getRalphEnabled: () => true,
            store: { getWorkspaces: async () => [{ id: saved.targetWorkspaceId, rootPath: directory }] } as never,
            bridge: { getTask: (id: string) => queue.getTask(id), enqueue: async (task: CreateTaskInput) => {
                await actions.guard(task, 'enqueue');
                return queue.enqueue(task);
            } } as never, guardTrackedLaunch };
        const first = await launchRalphSession(launch, deps);
        expect(first.ok).toBe(true);
        expect(await launchRalphSession(launch, deps)).toEqual(first);
        expect(guardTrackedLaunch).toHaveBeenCalledTimes(1);
        expect((await launchRalphSession({ ...launch, aiSelection: { provider: 'claude', config: { model: saved.model } } }, deps)).ok).toBe(false);
        expect((await launchRalphSession({ ...launch, sentinelTodoTracking: undefined }, deps)).ok).toBe(false);
        expect(queue.getAll().filter(task => task.payload.mode === 'ralph')).toHaveLength(1);
        expect(record().action.state).toBe('consumed');
    });

    it('blocks tool post-mode retries/escalation of native children and token-stripped Ralph resumes', async () => {
        await authorize({ ...saved, mode: 'ralph' });
        await actions.poll(owner);
        const task = await input('ralph');
        const sessionId = `ralph-approved-${task.id}`;
        (task.payload.context as any).ralph.sessionId = sessionId;
        await actions.guard(task, 'enqueue');
        await actions.guard(task, 'start');
        expect(() => actions.assertToolPostAllowed(`queue_${task.id}`)).toThrow('post mode');
        expect(() => actions.assertToolPostAllowed('another-iteration', sessionId)).toThrow('post mode');
        expect(() => actions.assertToolPostAllowed('unrelated-chat')).not.toThrow();
        const resumed = structuredClone(task);
        resumed.id = 'resumed-without-native-context';
        delete (resumed.payload.context as any).sentinelTodoTracking;
        delete (resumed.payload.context as any).spawnedFromProcessId;
        const resumedId = queue.enqueue(resumed);
        const executeByTypeFn = vi.fn();
        const runner = new ProcessLifecycleRunner(processes, directory, vi.fn(), 'copilot', { getSentinelTodos: () => service });
        expect((await runner.run(queue.getTask(resumedId)!, { cancelledTasks: new Set(), executeByTypeFn } as never)).success).toBe(false);
        expect(executeByTypeFn).not.toHaveBeenCalled();
    });

    it('never upgrades a started Ask receipt into a forged Ralph continuation', async () => {
        await authorize();
        await actions.poll(owner);
        const task = await input();
        await actions.guard(task, 'enqueue');
        await actions.guard(task, 'start');
        const forged = structuredClone(task);
        const sessionId = `ralph-approved-${task.id}`;
        forged.continuationOfSessionId = sessionId;
        forged.payload.mode = 'ralph';
        (forged.payload.context as any).ralph = { sessionId, currentIteration: 2, originalGoal: saved.prompt, phase: 'executing' };
        await expect(actions.guard(forged, 'start')).rejects.toThrow('continuation');
        expect(record().action.mode).toBe('ask');
    });

    it('rejects source changes during authoritative PR I/O under the admission writer transaction', async () => {
        todos.setDependencies(owner, itemId, current().revision, [{ itemId: sourceId, condition: { kind: 'pr_merge', outputSlot: 'code' } }], 'user');
        await service.bindPrOutput(owner, sourceId, { expectedRevision: current(sourceId).revision, outputSlot: 'code',
            prUrl: 'https://github.com/example/project/pull/42', provenance: { kind: 'owner_selection', reason: 'Reviewed exact produced output' } }, 'user');
        await authorize();
        await actions.poll(owner);
        fetchPr.mockImplementationOnce(async () => {
            todos.update(owner, sourceId, current(sourceId).revision, { notes: 'Changed while checking PR evidence' }, 'user');
            return { status: 'merged', url: 'https://github.com/example/project/pull/42', title: 'Output' };
        });
        await expect(actions.guard(await input(), 'enqueue')).rejects.toThrow('sources changed');
        expect(record().action.state).toBe('blocked');
        expect(current().jobs).toHaveLength(0);
    });

    it('rejects replaced accepted artifact bytes without treating acceptance as renewed authority', async () => {
        fs.writeFileSync(path.join(directory, 'design.md'), 'Approved exact design');
        const version = artifactVersion(directory, 'design.md');
        await service.acceptArtifact(owner, sourceId, { expectedRevision: current(sourceId).revision,
            phase: 'design', reference: 'design.md', version }, 'user');
        todos.setDependencies(owner, itemId, current().revision, [{ itemId: sourceId,
            condition: { kind: 'accepted_artifact', phase: 'design', reference: 'design.md', version } }], 'user');
        await authorize();
        await actions.poll(owner);
        fs.writeFileSync(path.join(directory, 'design.md'), 'Different unaccepted content');
        await expect(actions.guard(await input(), 'enqueue')).rejects.toThrow('not ready');
        expect(record().action.state).toBe('blocked');
        expect(current().jobs).toHaveLength(0);
    });

    it('does not consume fresh authority when an older admission races an explicit replacement', async () => {
        await authorize();
        await actions.poll(owner);
        const oldTask = await input();
        validateProvider.mockImplementationOnce(async () => { await authorize({ ...saved, mode: 'autopilot' }); });
        await expect(actions.guard(oldTask, 'enqueue')).rejects.toThrow('revision changed');
        expect(record().action).toMatchObject({ state: 'authorized', revision: 2, mode: 'autopilot' });
        expect(current().jobs).toHaveLength(0);
    });

    it('guards a stale queued first execution and a direct token-free dispatch before SDK/process creation', async () => {
        await authorize();
        await actions.poll(owner);
        const task = await input();
        await actions.guard(task, 'enqueue');
        const taskId = queue.enqueue(task);
        todos.update(owner, sourceId, current(sourceId).revision, { status: 'todo' }, 'user');
        const executeByType = vi.fn();
        const runner = new ProcessLifecycleRunner(processes, directory, vi.fn(), 'copilot', { getSentinelTodos: () => service });
        const result = await runner.run(queue.getTask(taskId)!, { cancelledTasks: new Set(), executeByType } as never);
        expect(result.success).toBe(false);
        expect(executeByType).not.toHaveBeenCalled();
        expect(await processes.getProcess(`queue_${taskId}`)).toBeUndefined();
        const direct = structuredClone(task);
        direct.id = 'untracked-native-launch';
        delete (direct.payload.context as any).sentinelTodoTracking;
        const directId = queue.enqueue(direct);
        expect((await runner.run(queue.getTask(directId)!, { cancelledTasks: new Set(), executeByType } as never)).success).toBe(false);
        expect(executeByType).not.toHaveBeenCalled();
    });

    it('rejects incompatible or omitted tracked queue parameters before canonical default/coercion machinery', async () => {
        await authorize();
        const task = await input();
        for (const field of ['provider', 'model', 'mode']) {
            const raw = structuredClone(task);
            if (field === 'model') delete raw.config.model;
            else delete raw.payload[field];
            expect(validateAndParseTask(raw).valid).toBe(false);
        }
        const wrong = structuredClone(task);
        wrong.payload.provider = 'claude';
        expect(validateAndParseTask(wrong).valid).toBe(false);
        await expect(prepareTaskForEnqueue(wrong, { getDefaultProvider: () => 'copilot' })).rejects.toThrow('no fallback');
        const omitted = structuredClone(task);
        delete omitted.payload.provider;
        await expect(prepareTaskForEnqueue(omitted, { getDefaultProvider: () => 'copilot' })).rejects.toThrow('explicit');
        expect(record().action).toMatchObject({ ...saved, state: 'authorized' });
    });
});
