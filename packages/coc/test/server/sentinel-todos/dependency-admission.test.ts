import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteProcessStore, TaskQueueManager, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelDependencyStore } from '../../../src/server/sentinel-todos/sentinel-dependency-store';
import { SentinelDependencyActions } from '../../../src/server/sentinel-todos/sentinel-dependency-actions';
import { ProcessMessageDeliveryService } from '../../../src/server/processes/process-message-delivery-service';
import { createSentinelTodoTracking } from '../../../src/server/llm-tools/sentinel-todos-tool';
import type { QueueExecutorBridge } from '../../../src/server/core/api-handler';
import { ProcessLifecycleRunner } from '../../../src/server/executors/process-lifecycle-runner';
import { artifactVersion } from '../../../src/server/sentinel-todos/sentinel-todo-evidence';
import { createSendToConversationTool } from '../../../src/server/llm-tools/send-to-conversation-tool';

const owner = { workspaceId: 'ws-parent', processId: 'queue_parent' };
const saved = {
    mode: 'ask', provider: 'copilot', model: 'gpt-5.4', targetWorkspaceId: 'ws-child',
};

describe('native dependency readiness and durable admission', () => {
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
    const record = () => receipts.records(owner).find(row => row.itemId === itemId)?.record;

    function wire(onChange?: () => void) {
        todos = new SentinelTodoStore(processes.getDatabase());
        service = new SentinelTodoService({ todos, store: processes, getDependenciesEnabled: () => enabled,
            fetchPr, resolveWorkspaceRoot: async () => directory });
        receipts = new SentinelDependencyStore(processes.getDatabase(), todos);
        actions = new SentinelDependencyActions({
            receipts, service, delivery: new ProcessMessageDeliveryService({ store: processes, bridge }),
            validateProvider,
            validateTarget: async target => {
                if (!targetAvailable || target !== saved.targetWorkspaceId) throw new Error('Saved target unavailable');
            },
            validateCurrent: () => {
                if (!targetAvailable || !providerAvailable || !enabled) throw new Error('Current target/provider unavailable');
            },
            hasTask: id => !!queue.getTask(id),
            coexistingTransport: () => coexisting ? { triggerId: 'existing-owner-rule', state: coexisting } : undefined,
            onChange,
        });
        service.dependencyActions = actions;
    }

    beforeEach(async () => {
        directory = fs.mkdtempSync(path.join(process.cwd(), '.dependency-admission-'));
        enabled = targetAvailable = providerAvailable = true;
        coexisting = undefined;
        processes = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        await processes.registerWorkspace({ id: owner.workspaceId, name: 'Parent', rootPath: directory });
        await processes.registerWorkspace({ id: saved.targetWorkspaceId, name: 'Child', rootPath: directory });
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

    async function input(mode = 'ask'): Promise<CreateTaskInput> {
        return { type: 'chat', priority: 'normal', config: { model: saved.model }, payload: {
            kind: 'chat', mode, workspaceId: saved.targetWorkspaceId, provider: saved.provider,
            prompt: 'User-authorized review', context: {
                spawnedFromProcessId: owner.processId, sentinelTodoTracking: await actions.context(owner, itemId),
                ...(mode === 'ralph' ? { ralph: { sessionId: 'ralph-session', currentIteration: 1, phase: 'executing' } } : {}),
            },
        } };
    }
    async function restart() {
        processes.close();
        processes = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        wire();
    }

    it.each(['ask', 'autopilot', 'ralph'])('admits normally authorized %s without an approval snapshot or prior poll', async mode => {
        const tracking = createSentinelTodoTracking({ service, owner });
        expect(await tracking.check(itemId)).toBeUndefined();
        expect(await tracking.prepare!(itemId, { content: 'User-authorized review' })).toMatchObject({ dependencyBound: true });
        const task = await input(mode);
        await actions.guard(task, 'enqueue');
        expect(task.id).toBeTruthy();
        expect(current().jobs).toHaveLength(1);
        expect(current().jobs[0].workspaceId).toBe('ws-child');
        expect((await service.list(owner)).items.find(item => item.id === itemId)).not.toHaveProperty('dependencyAction');
        await service.evaluateDependencies(owner, itemId);
        expect(actions.project(owner, current()).dependencyReadiness?.state).toBe('ready');
        await actions.guard(task, 'check');
        expect(record()?.started).not.toBe(true);
        await actions.guard(task, 'start');
        expect(record()?.started).toBe(true);
        await expect(actions.guard(task, 'start')).rejects.toThrow('already started');
    });

    it('send_to_conversation dispatches ready normally authorized work without a saved action', async () => {
        const enqueueChat = vi.fn(async (task: CreateTaskInput) => {
            await actions.guard(task, 'enqueue');
            return queue.enqueue(task);
        });
        const { tool } = createSendToConversationTool({
            store: processes, workspaceId: owner.workspaceId, parentProcessId: owner.processId,
            enqueueChat, todoTracking: createSentinelTodoTracking({ service, owner }),
        });
        const result = await tool.handler({ content: 'Please review the output as authorized in chat', mode: 'ask',
            provider: 'copilot', model: saved.model, workspaceId: saved.targetWorkspaceId, todoItemId: itemId },
        { sessionId: 'owner-session', toolCallId: 'ready-dispatch', toolName: 'send_to_conversation', arguments: {} });
        expect(result).not.toHaveProperty('error');
        expect(enqueueChat).toHaveBeenCalledTimes(1);
        expect(record()?.taskId).toBeTruthy();
        expect(current().jobs).toHaveLength(1);
    });

    it('admits Auto and provider/model defaults through ordinary resolution', async () => {
        const task = await input();
        delete task.payload.provider;
        delete task.config!.model;
        (task.payload.context as any).autoProviderRouting = { requested: true };
        await actions.guard(task, 'enqueue');
        await actions.guard(task, 'check');
        task.payload.provider = 'copilot';
        await actions.guard(task, 'start');
        expect(record()?.started).toBe(true);
    });

    it('blocks unsatisfied conjunctive prerequisites without reserving a launch', async () => {
        const other = todos.create(owner, { title: 'Not ready' }, { actor: 'user' }).item;
        todos.setDependencies(owner, itemId, current().revision, [
            { itemId: sourceId, condition: { kind: 'done' } }, { itemId: other.id, condition: { kind: 'done' } },
        ], 'user');
        await expect(actions.guard(await input(), 'enqueue')).rejects.toThrow('not ready');
        expect(record()).toBeUndefined();
        expect(current().jobs).toHaveLength(0);
    });

    it('manual items stay tracking-only even with satisfied prerequisites', async () => {
        const manual = todos.create(owner, { title: 'Manual', type: 'manual' }, { actor: 'user' }).item;
        todos.setDependencies(owner, manual.id, manual.revision, [{ itemId: sourceId, condition: { kind: 'done' } }], 'user');
        expect((await service.evaluateDependencies(owner, manual.id)).state).toBe('ready');
        await expect(actions.context(owner, manual.id)).rejects.toThrow('Manual');
        expect(await createSentinelTodoTracking({ service, owner }).check(manual.id)).toContain('manual');
        await actions.poll(owner);
        expect(receipts.wakes(owner, manual.id)).toHaveLength(0);
    });

    it.each(['workspace', 'parent', 'target', 'archived', 'done'])('rejects invalid %s ownership/eligibility', async change => {
        const task = await input();
        if (change === 'workspace') (task.payload.context as any).sentinelTodoTracking.owner.workspaceId = 'foreign';
        if (change === 'parent') (task.payload.context as any).spawnedFromProcessId = 'foreign';
        if (change === 'target') task.payload.workspaceId = 'foreign';
        if (change === 'archived') todos.update(owner, itemId, current().revision, { archived: true }, 'user');
        if (change === 'done') todos.update(owner, itemId, current().revision, { status: 'done' }, 'user');
        await expect(actions.guard(task, 'enqueue')).rejects.toThrow();
        expect(record()).toBeUndefined();
    });

    it('serializes concurrent dispatch and preserves duplicate guards across restart and edge removal', async () => {
        const task = await input();
        const results = await Promise.allSettled([actions.guard(task, 'enqueue'), actions.guard(structuredClone(task), 'enqueue')]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        await restart();
        todos.setDependencies(owner, itemId, current().revision, [], 'user');
        await expect(actions.guard(await input(), 'enqueue')).rejects.toThrow('durable launch');
        expect(current().jobs).toHaveLength(1);
    });

    it.each(['queued', 'started'])('invalidates %s work without cancelling or changing fulfillment', async state => {
        const task = await input();
        await actions.guard(task, 'enqueue');
        if (state === 'started') await actions.guard(task, 'start');
        const status = current().status;
        todos.update(owner, sourceId, current(sourceId).revision, { status: 'todo' }, 'user');
        todos.update(owner, sourceId, current(sourceId).revision, { status: 'done' }, 'user');
        await restart();
        expect(record()?.error).toBeTruthy();
        expect(record()?.requiresReview).toBe(state === 'started' ? true : undefined);
        expect(current().status).toBe(status);
        expect(bridge.enqueue).not.toHaveBeenCalled();
        await expect(actions.guard(task, 'start')).rejects.toThrow();
    });

    it.each(['queued', 'started'])('invalidates %s ancestor artifact evidence independently of intermediate Done', async state => {
        fs.writeFileSync(path.join(directory, 'ancestor.txt'), 'Accepted design');
        const upstream = todos.create(owner, { title: 'Ancestor', status: 'done' }, { actor: 'user' }).item;
        const version = artifactVersion(directory, 'ancestor.txt');
        await service.acceptArtifact(owner, upstream.id, { expectedRevision: upstream.revision,
            phase: 'design', reference: 'ancestor.txt', version }, 'user');
        todos.setDependencies(owner, sourceId, current(sourceId).revision, [{ itemId: upstream.id,
            condition: { kind: 'accepted_artifact', phase: 'design', reference: 'ancestor.txt', version } }], 'user');
        await service.evaluateDependencies(owner, sourceId);
        const task = await input();
        await actions.guard(task, 'enqueue');
        if (state === 'started') await actions.guard(task, 'start');
        fs.writeFileSync(path.join(directory, 'ancestor.txt'), 'Changed design');
        if (state === 'queued') await expect(actions.guard(task, 'start')).rejects.toThrow();
        else await actions.poll(owner);
        expect(record()?.error).toContain('Upstream');
        expect(current(sourceId).status).toBe('done');
        expect(record()?.requiresReview).toBe(state === 'started' ? true : undefined);
    });

    it('a rejected duplicate failure cannot block the accepted job', async () => {
        const task = await input();
        await actions.guard(task, 'enqueue');
        actions.block(owner, itemId, new Error('Duplicate rejected'), 'other-task');
        expect(record()?.error).toBeUndefined();
        await actions.guard(task, 'start');
    });

    it('migrates wake guidance and reuses existing graph receipts without duplicate delivery', async () => {
        await actions.poll(owner);
        const wake = receipts.wakes(owner)[0];
        processes.getDatabase().prepare('UPDATE sentinel_dependency_wakes SET generation = ?, receipt = ? WHERE id = ?')
            .run('prior-generation', JSON.stringify({ ...wake, generation: 'prior-generation', prompt: 'Read saved dependencyAction approval' }), wake.id);
        await restart();
        await actions.poll(owner);
        expect(receipts.wakes(owner)).toHaveLength(1);
        expect(receipts.wakes(owner)[0]).toMatchObject({ id: wake.id, evidence: wake.evidence });
        expect(receipts.wakes(owner)[0].prompt).not.toContain('dependencyAction');
        expect(bridge.enqueue).toHaveBeenCalledTimes(1);
    });

    it('rechecks readiness between preparation and SDK handoff', async () => {
        const task = await input();
        await actions.guard(task, 'enqueue');
        const taskId = queue.enqueue(task);
        const executeByTypeFn = vi.fn();
        const runner = new ProcessLifecycleRunner(processes, directory, vi.fn(), 'copilot', {
            getSentinelDependencyAdmission: () => actions,
        });
        const result = await runner.run(queue.getTask(taskId)!, {
            cancelledTasks: new Set(), executeByTypeFn, executeFollowUpFn: vi.fn(),
            getWorkingDirectoryFn: () => {
                todos.update(owner, sourceId, current(sourceId).revision, { status: 'todo' }, 'user');
                return directory;
            },
        } as never);
        expect(result.success).toBe(false);
        expect(executeByTypeFn).not.toHaveBeenCalled();
        expect(record()?.started).not.toBe(true);
    });

    it('recovers omitted tracking from native receipts rather than allowing replay', async () => {
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
    });

    it('blocks uncertain admission after restart without retrying or minting another identity', async () => {
        const task = await input();
        await actions.guard(task, 'enqueue');
        await restart();
        await actions.poll(owner);
        expect(record()?.error).toContain('unknown');
        expect(record()?.taskId).toBe(task.id);
        await expect(actions.guard(task, 'start')).rejects.toThrow('blocked');
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('keeps queue failures durably blocked without retrying work', async () => {
        const task = await input();
        await actions.guard(task, 'enqueue');
        actions.block(owner, itemId, new Error('Queue admission outcome unknown'), task.id);
        await restart();
        await actions.poll(owner);
        await expect(actions.guard(task, 'start')).rejects.toThrow('blocked');
        await expect(actions.guard(await input(), 'enqueue')).rejects.toThrow('durable launch');
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('wakes once with ordinary authorization guidance and never launches work', async () => {
        await actions.poll(owner);
        await actions.poll(owner);
        expect(receipts.wakes(owner)).toHaveLength(1);
        const prompt = receipts.wakes(owner)[0].prompt;
        expect(prompt).toContain('authorized by the user');
        expect(prompt).not.toMatch(/dependencyAction|saved prompt|needs approval/i);
        expect(record()).toBeUndefined();
        expect(current().jobs).toHaveLength(0);
        expect(bridge.enqueue).toHaveBeenCalledTimes(1); // Owner wake only.
    });

    it('invalidates undelivered wakes and leaves their durable evidence intact', async () => {
        coexisting = 'waiting';
        await actions.poll(owner);
        const wake = receipts.wakes(owner)[0];
        todos.update(owner, sourceId, current(sourceId).revision, { status: 'todo' }, 'user');
        await actions.poll(owner);
        expect(receipts.wakes(owner)[0]).toMatchObject({ id: wake.id, evidence: wake.evidence, invalidatedReason: expect.any(String) });
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('continues started Ralph sessions after invalidation but durably rejects step replay', async () => {
        const task = await input('ralph');
        await actions.guard(task, 'enqueue');
        await actions.guard(task, 'start');
        todos.update(owner, sourceId, current(sourceId).revision, { status: 'todo' }, 'user');
        enabled = false;
        const next = structuredClone(task);
        next.id = 'step-2'; next.continuationOfSessionId = 'ralph-session';
        (next.payload.context as any).ralph.currentIteration = 2;
        await actions.guard(next, 'start');
        await restart();
        next.id = 'step-2-replay';
        await expect(actions.guard(next, 'start')).rejects.toThrow('already started');
        expect(record()?.requiresReview).toBe(true);
        expect(SentinelDependencyStore.ralphTracking(processes.getDatabase(), 'ralph-session')).toEqual({ owner, itemId });
    });

    it('migrates admitted identities while removing unused approvals without resetting the ledger', async () => {
        const db = processes.getDatabase();
        db.exec('CREATE TABLE sentinel_dependency_actions (record TEXT)');
        db.prepare('INSERT INTO sentinel_dependency_actions VALUES (?)').run(JSON.stringify({ state: 'authorized' }));
        db.prepare('INSERT INTO sentinel_dependency_admissions VALUES (?, ?, ?, ?, ?)').run('prior-task', owner.workspaceId,
            owner.processId, itemId, JSON.stringify({ action: { taskId: 'prior-task', mode: 'ralph', state: 'consumed',
                revision: 1, targetWorkspaceId: saved.targetWorkspaceId, prompt: 'discard', scope: 'discard' }, itemRevision: current().revision,
                dependencies: JSON.stringify(current().dependsOn), started: true }));
        await restart();
        expect(record()).toMatchObject({ taskId: 'prior-task', started: true, sessionId: 'ralph-approved-prior-task' });
        expect(record()).not.toHaveProperty('action');
        expect(processes.getDatabase().prepare("SELECT 1 FROM sqlite_master WHERE name = 'sentinel_dependency_actions'").get()).toBeUndefined();
        expect(current().title).toBe('Dependent');
        await expect(actions.guard(await input(), 'enqueue')).rejects.toThrow('durable launch');
    });
});
