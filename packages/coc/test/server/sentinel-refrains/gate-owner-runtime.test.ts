import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { defineTool, type ToolInvocation } from '@plusplusoneplusplus/coc-agent-sdk';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { buildMemoryV2Addon } from '../../../src/server/executors/memory-v2-addon';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

vi.mock('../../../src/server/executors/memory-v2-addon', () => ({ buildMemoryV2Addon: vi.fn() }));

const owner = { workspaceId: 'workspace-a', processId: 'sentinel-a' };

describe('production job gate owner runtime', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    let router: MultiRepoQueueRouter;
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
        dataDir = mkdtempSync(join(tmpdir(), 'gate-production-'));
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
            runtime: { getSentinelTodos: () => service },
        });
    });

    afterEach(() => {
        router.dispose();
        store.close();
        rmSync(dataDir, { recursive: true, force: true });
    });

    function run(code: string, state: unknown = null, signal?: AbortSignal, target = owner) {
        return router.runRefrainGate({ ...target, code, state, signal });
    }

    it('runs through router, bridge, executor and worker with the supplied state and no provider turn', async () => {
        const ledger = todos.get(owner);
        await expect(run('return { previous: state, now: await tools.owner_tool({}) };', { items: [1] }))
            .resolves.toEqual({ previous: { items: [1] }, now: { value: 1 } });
        expect(router.createAggregateQueueFacade().getAll()).toHaveLength(0);
        expect(todos.get(owner)).toEqual(ledger);
        expect(buildMemoryV2Addon).toHaveBeenCalledWith(dataDir, owner.workspaceId, undefined, owner.processId);
        expect(sdk.service.sendMessage).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('includes the owner-bound Sentinel tool rather than a fixed scriptable subset', async () => {
        const result = await run('return await tools.sentinel_todos({ action: "list" });');
        expect(JSON.stringify(result)).toContain(itemId);
        expect(sdk.service.sendMessage).not.toHaveBeenCalled();
    });

    it('denies gated handlers without approval requests, including after preferences change', async () => {
        await expect(run('return await tools.save_memory({});')).resolves.toEqual({ value: 1 });
        writeRepoPreferences(dataDir, owner.workspaceId, { disabledLlmTools: [], approvalRequiredLlmTools: ['save_memory'] });
        await expect(run('return await tools.save_memory({});')).rejects.toThrow(/Approval-required/);
        expect(handler).toHaveBeenCalledOnce();
        expect((await store.getProcess(owner.processId))?.pendingAskUser).toBeUndefined();
        expect(router.createAggregateQueueFacade().getAll()).toHaveLength(0);
    });

    it.each(['ask_user', 'bash', 'create_pull_request', 'sentinel_jobs'])('does not grant unavailable %s authority', async name => {
        await expect(run(`try { await tools.${name}({}); } catch (e) { return e.name; } return "unexpected";`))
            .resolves.toBe('ToolCallError');
        expect((await store.getProcess(owner.processId))?.pendingAskUser).toBeUndefined();
        expect(sdk.service.sendMessage).not.toHaveBeenCalled();
    });

    it('resolves provider changes per run and retains the Codex nested-script exclusion', async () => {
        const code = 'return await tools.run_tool_script({ code: "return 1;" });';
        await expect(run(code)).resolves.toMatchObject({ result: 1 });
        await store.updateProcess(owner.processId, {
            activeProviderSession: { provider: 'codex', sessionId: 'synthetic-session', segmentId: 'segment-b', firstTurnIndex: 0 },
        });
        await expect(run(code)).rejects.toThrow(/denied/);
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
        await expect(run('return await tools.save_memory({});', null, undefined, other)).resolves.toEqual({ value: 1 });
        expect(buildMemoryV2Addon).toHaveBeenLastCalledWith(dataDir, other.workspaceId, undefined, other.processId);
        expect(router.registry.getAllQueues().size).toBe(1);
    });

    it.each([
        ['a non-Sentinel owner', { metadata: { workspaceId: owner.workspaceId, mode: 'ask' } }],
        ['a cancelled owner', { status: 'cancelled' as const }],
    ])('rejects %s before assembling tools', async (_label, update) => {
        await store.updateProcess(owner.processId, update);
        await expect(run('return 1;')).rejects.toThrow('Gate script owner is unavailable');
        expect(buildMemoryV2Addon).not.toHaveBeenCalled();
    });

    it('rejects an owner whose workspace does not match the request', async () => {
        await expect(run('return 1;', null, undefined, { ...owner, workspaceId: 'workspace-b' }))
            .rejects.toThrow('Gate script owner workspace is unavailable');
        expect(buildMemoryV2Addon).not.toHaveBeenCalled();
    });

    it('terminates a running worker immediately on abort', async () => {
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        let workerSignal: AbortSignal | undefined;
        handler.mockImplementationOnce(async (_args, invocation) => {
            workerSignal = invocation.signal;
            entered();
            return new Promise<string>(() => {});
        });
        const controller = new AbortController();
        const pending = run('return await tools.owner_tool({});', null, controller.signal);
        const rejection = expect(pending).rejects.toBeDefined();
        await started;
        controller.abort(new Error('Job edited'));
        expect(workerSignal?.aborted).toBe(true);
        await rejection;
        expect(dispose).toHaveBeenCalledOnce();
        expect(router.createAggregateQueueFacade().getAll()).toHaveLength(0);
    });

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
        const controller = new AbortController();
        const pending = run('return await tools.owner_tool({});', null, controller.signal);
        const rejection = expect(pending).rejects.toBeDefined();
        await started;
        controller.abort(new Error('Server shutting down'));
        release();
        await rejection;
        expect(handler).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledOnce();
    });
});
