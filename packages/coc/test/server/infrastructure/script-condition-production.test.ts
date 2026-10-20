import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RepoQueueRegistry, SqliteProcessStore, type AIProcess } from '@plusplusoneplusplus/forge';
import { defineTool, type ToolInvocation } from '@plusplusoneplusplus/coc-agent-sdk';
import { createTriggerInfrastructure, type TriggerInfrastructure } from '../../../src/server/infrastructure/trigger-infrastructure';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { buildMemoryV2Addon } from '../../../src/server/executors/memory-v2-addon';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import type { Trigger } from '../../../src/server/triggers/trigger-types';

vi.mock('../../../src/server/executors/memory-v2-addon', () => ({ buildMemoryV2Addon: vi.fn() }));

const owner = { workspaceId: 'workspace-a', processId: 'sentinel-a' };

describe('production script-condition owner runtime', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    let router: MultiRepoQueueRouter;
    let infra: TriggerInfrastructure;
    let todos: SentinelTodoStore;
    let itemId: string;
    let value: number;
    const sdk = createMockSDKService();
    const dispose = vi.fn();
    const handler = vi.fn(async (_args: unknown, _invocation: ToolInvocation) => JSON.stringify({ value }));

    beforeEach(async () => {
        vi.clearAllMocks();
        sdk.resetAll();
        value = 1;
        dataDir = mkdtempSync(join(tmpdir(), 'script-production-'));
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        await store.registerWorkspace({ id: owner.workspaceId, name: 'Owner', rootPath: dataDir });
        await store.addProcess({
            id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Sentinel', metadata: { workspaceId: owner.workspaceId, mode: 'sentinel', provider: 'copilot' },
        });
        writeRepoPreferences(dataDir, owner.workspaceId, { disabledLlmTools: [] });
        todos = new SentinelTodoStore(store.getDatabase());
        const service = new SentinelTodoService({ store, todos });
        itemId = todos.create(owner, { title: 'Track readiness', completionCondition: 'Ready' }, { actor: 'user' }).item.id;
        vi.mocked(buildMemoryV2Addon).mockImplementation(async () => ({
            tools: [defineTool('owner_tool', { handler }), defineTool('save_memory', { handler })],
            suffix: '', excludedBuiltinTools: [], dispose,
        }));
        router = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            dataDir, autoStart: false, aiService: sdk.service,
            runtime: {
                getSentinelTodos: () => service,
                getTriggerInfra: () => infra ? { manager: infra.triggerManager, sentinelTodoTriggers: infra.sentinelTodoTriggers } : undefined,
            },
        });
        infra = await createTriggerInfrastructure({
            dataDir, store, queueFacade: router.createAggregateQueueFacade(), deliveryBridge: router,
            emit: vi.fn(), ciChecksFetcher: vi.fn(), getScriptConditionsEnabled: () => true,
            runScriptCondition: (trigger, state, signal) => router.runScriptCondition(trigger, state, signal),
        });
        store.onProcessChange = infra.onProcessChange;
    });

    afterEach(() => {
        infra.dispose();
        router.dispose();
        store.close();
        rmSync(dataDir, { recursive: true, force: true });
    });

    function create(script = 'return await tools.owner_tool({});') {
        return infra.sentinelTodoTriggers.create(owner, {
            itemId, event: { type: 'script-condition', script, intervalMs: 300_000 },
        }, 'sentinel');
    }

    function current(id: string): Trigger {
        const rule = infra.triggerStore.getById(id);
        if (!rule) throw new Error('Missing test rule');
        return rule;
    }

    function runNow(id: string) {
        return infra.sentinelTodoTriggers.runNow(owner, id, {
            expectedRevision: current(id).revision, confirmed: true,
        });
    }

    it('runs through router, bridge, executor and worker, with silent baseline and one changed wake', async () => {
        const ledger = todos.get(owner);
        const rule = await create();
        await runNow(rule.id);
        expect(current(rule.id).event).toMatchObject({ lastResult: '{"value":1}', consecutiveFailures: 0 });
        expect(router.createAggregateQueueFacade().getAll()).toHaveLength(0);
        await runNow(rule.id);
        value = 2;
        await runNow(rule.id);
        expect(router.createAggregateQueueFacade().getAll()).toHaveLength(1);
        expect(current(rule.id)).toMatchObject({
            status: 'active', event: { lastResult: '{"value":2}' }, delivery: { state: 'delivered', reason: 'script-changed' },
        });
        expect(todos.get(owner)).toEqual(ledger);
        expect(buildMemoryV2Addon).toHaveBeenCalledWith(dataDir, owner.workspaceId, undefined, owner.processId);
        expect(sdk.service.sendMessage).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledTimes(3);
    });

    it('includes the owner-bound Sentinel tool rather than a fixed scriptable subset', async () => {
        const rule = await create('const ledger = await tools.sentinel_todos({ action: "list" }); return ledger;');
        await runNow(rule.id);
        const event = current(rule.id).event;
        expect(event).toMatchObject({ consecutiveFailures: 0 });
        expect(event.type === 'script-condition' && event.lastResult).toContain(itemId);
        expect(sdk.service.sendMessage).not.toHaveBeenCalled();
    });

    it('denies gated handlers without approval requests, including after preferences change', async () => {
        const rule = await create('return await tools.save_memory({});');
        await runNow(rule.id);
        writeRepoPreferences(dataDir, owner.workspaceId, { disabledLlmTools: [], approvalRequiredLlmTools: ['save_memory'] });
        await runNow(rule.id);
        expect(handler).toHaveBeenCalledOnce();
        expect(current(rule.id).event).toMatchObject({
            lastResult: '{"value":1}', consecutiveFailures: 1, lastError: { message: expect.stringContaining('Approval-required') },
        });
        expect((await store.getProcess(owner.processId))?.pendingAskUser).toBeUndefined();
        expect(router.createAggregateQueueFacade().getAll()).toHaveLength(0);
    });

    it.each(['ask_user', 'bash', 'create_pull_request', 'sentinel_jobs'])('does not grant unavailable %s authority', async name => {
        const rule = await create(`try { await tools.${name}({}); } catch (e) { return e.name; } return "unexpected";`);
        await runNow(rule.id);
        expect(current(rule.id).event).toMatchObject({ lastResult: '"ToolCallError"', consecutiveFailures: 0 });
        expect((await store.getProcess(owner.processId))?.pendingAskUser).toBeUndefined();
        expect(sdk.service.sendMessage).not.toHaveBeenCalled();
    });

    it('resolves provider changes per run and retains the Codex nested-script exclusion', async () => {
        const rule = await create('return await tools.run_tool_script({ code: "return 1;" });');
        await runNow(rule.id);
        expect(current(rule.id).event).toMatchObject({ consecutiveFailures: 0 });
        await store.updateProcess(owner.processId, {
            activeProviderSession: { provider: 'codex', sessionId: 'synthetic-session', segmentId: 'segment-b', firstTurnIndex: 0 },
        });
        await runNow(rule.id);
        expect(current(rule.id).event).toMatchObject({ consecutiveFailures: 1, lastError: { message: expect.stringContaining('denied') } });
    });

    it('uses isolated owner preferences and memory contexts in a second workspace', async () => {
        const other = { workspaceId: 'workspace-b', processId: 'sentinel-b' };
        await store.registerWorkspace({ id: other.workspaceId, name: 'Other', rootPath: join(dataDir, 'other') });
        await store.addProcess({
            id: other.processId, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: '',
            metadata: { workspaceId: other.workspaceId, mode: 'sentinel' },
        });
        writeRepoPreferences(dataDir, owner.workspaceId, { disabledLlmTools: ['save_memory'] });
        writeRepoPreferences(dataDir, other.workspaceId, { disabledLlmTools: [] });
        const otherItem = todos.create(other, { title: 'Other item', completionCondition: 'Ready' }, { actor: 'user' }).item;
        const rule = await infra.sentinelTodoTriggers.create(other, {
            itemId: otherItem.id, event: { type: 'script-condition', script: 'return await tools.save_memory({});' },
        }, 'sentinel');
        await infra.sentinelTodoTriggers.runNow(other, rule.id, { expectedRevision: rule.revision, confirmed: true });
        expect(current(rule.id).event).toMatchObject({ lastResult: '{"value":1}', consecutiveFailures: 0 });
        expect(buildMemoryV2Addon).toHaveBeenLastCalledWith(dataDir, other.workspaceId, undefined, other.processId);
        expect(router.registry.getAllQueues().size).toBe(1);
    });

    it.each(['cancelled', 'cancelling', 'mode', 'workspace', 'type', 'remove', 'clear'] as const)(
        'terminates a running worker immediately on owner %s without advancing failure state',
        async change => {
            let entered!: () => void;
            const started = new Promise<void>(resolve => { entered = resolve; });
            let workerSignal: AbortSignal | undefined;
            handler.mockImplementationOnce(async (_args, invocation) => {
                workerSignal = invocation.signal;
                entered();
                return new Promise<string>(() => {});
            });
            const rule = await create();
            const pending = runNow(rule.id);
            const rejection = expect(pending).rejects.toMatchObject({ statusCode: 409 });
            await started;
            if (change === 'remove') await store.removeProcess(owner.processId);
            else if (change === 'clear') await store.clearProcesses();
            else {
                const updates: Partial<AIProcess> = change === 'mode' ? { metadata: { workspaceId: owner.workspaceId, mode: 'ask' } }
                    : change === 'workspace' ? { metadata: { workspaceId: 'workspace-b', mode: 'sentinel' } }
                    : change === 'type' ? { type: 'clarification' } : { status: change };
                await store.updateProcess(owner.processId, updates);
            }
            expect(workerSignal?.aborted).toBe(true);
            await rejection;
            expect(current(rule.id)).toMatchObject({ event: { consecutiveFailures: 0 } });
            expect(current(rule.id).lastTickAt).toBeNull();
            expect(current(rule.id).event).not.toHaveProperty('lastResult');
            expect(router.createAggregateQueueFacade().getAll()).toHaveLength(0);
            expect(dispose).toHaveBeenCalledOnce();
        },
    );

    it('cancels pending owner-tool assembly and disposes late resources without starting a worker', async () => {
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        let release!: () => void;
        const assembly = new Promise<void>(resolve => { release = resolve; });
        vi.mocked(buildMemoryV2Addon).mockImplementationOnce(async () => {
            entered();
            await assembly;
            return { tools: [defineTool('owner_tool', { handler })], suffix: '', excludedBuiltinTools: [], dispose };
        });
        const rule = await create();
        const pending = runNow(rule.id);
        const rejection = expect(pending).rejects.toMatchObject({ statusCode: 409 });
        await started;
        await store.updateProcess(owner.processId, { status: 'cancelled' });
        release();
        await rejection;
        expect(handler).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledOnce();
        expect(current(rule.id).event).toMatchObject({ consecutiveFailures: 0 });
    });

    it('does not cancel a worker for unrelated owners or ordinary owner updates', async () => {
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        let release!: (value: string) => void;
        const result = new Promise<string>(resolve => { release = resolve; });
        handler.mockImplementationOnce(async () => { entered(); return result; });
        const rule = await create();
        const pending = runNow(rule.id);
        await started;
        await store.addProcess({ id: 'other', type: 'chat', status: 'cancelled', startTime: new Date(), promptPreview: '' });
        await store.updateProcess(owner.processId, { status: 'running', title: 'Updated title' });
        store.onProcessChange?.({ type: 'process-updated' });
        release('{"ready":true}');
        await pending;
        expect(current(rule.id).event).toMatchObject({ lastResult: '{"ready":true}', consecutiveFailures: 0 });
    });
});
