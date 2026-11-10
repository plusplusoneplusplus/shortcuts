import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import { CanvasExtensionHostRegistry } from '../../../src/server/canvas-extensions/host-registry';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { buildMemoryV2Addon } from '../../../src/server/executors/memory-v2-addon';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import type { DiscoveredCanvasExtension } from '../../../src/server/canvas-extensions/discovery';

vi.mock('../../../src/server/executors/memory-v2-addon', () => ({ buildMemoryV2Addon: vi.fn() }));

const owner = { workspaceId: 'workspace-a', processId: 'chat-a' };
const sibling = { workspaceId: 'workspace-b', processId: 'chat-b' };
const instance = { canvasId: 'scripts', instanceId: 'instance-1' };

describe('CoC toolScripts v1 through the real SDK extension host and owner runtime', () => {
    let root: string;
    let store: SqliteProcessStore;
    let router: MultiRepoQueueRouter;
    let hosts: CanvasExtensionHostRegistry;
    let extension: DiscoveredCanvasExtension;
    let enabled: boolean;
    let releaseSibling: () => void;
    const sdk = createMockSDKService();
    const calls = vi.fn();
    const dispose = vi.fn();

    beforeEach(async () => {
        vi.clearAllMocks();
        sdk.resetAll();
        enabled = true;
        root = await mkdtemp(join(tmpdir(), 'coc-extension-script-'));
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        for (const target of [owner, sibling]) {
            const repo = join(root, target.workspaceId);
            await mkdir(repo);
            await store.registerWorkspace({ id: target.workspaceId, name: target.workspaceId, rootPath: repo });
            await store.addProcess({ id: target.processId, type: 'chat', status: 'completed', startTime: new Date(),
                promptPreview: 'Scripts', workingDirectory: repo,
                metadata: { workspaceId: target.workspaceId, mode: 'ask', provider: 'copilot' } });
            writeRepoPreferences(root, target.workspaceId, { disabledLlmTools: [] });
        }
        // A registered read-only handler fixture; Kusto SDK behavior is tested in the Kusto suites.
        vi.mocked(buildMemoryV2Addon).mockImplementation(async (_dir, workspaceId) => ({
            tools: [defineTool('execute_kusto_query', { handler: async (args, context) => {
                calls(workspaceId, args, context.signal);
                if (args.wait === 'manual') await new Promise<void>(resolve => { releaseSibling = resolve; });
                else if (args.wait) await new Promise<void>(resolve => context.signal?.addEventListener('abort', () => resolve(), { once: true }));
                return JSON.stringify({ workspaceId });
            } })], suffix: '', excludedBuiltinTools: [], dispose,
        }));
        router = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, { dataDir: root, autoStart: false, aiService: sdk.service });
        const folder = join(root, 'extension');
        await mkdir(folder);
        const extensionPath = join(folder, 'extension.mjs');
        await copyFile(resolve('test/fixtures/canvas-extensions/tool-scripts/extension.mjs'), extensionPath);
        extension = { extensionKey: 'global:scripts', ownerWorkspaceId: 'global', name: 'scripts',
            extensionPath, cwd: folder, contentHash: 'fixture' };
        hosts = new CanvasExtensionHostRegistry({
            config: () => ({ canvasExtensions: { enabled } }), store, dataDir: root, log: vi.fn(),
            getOwnerScriptRunner: () => router.runOwnerScript,
        });
        await hosts.open(owner, extension, instance);
    });

    afterEach(async () => {
        await hosts.dispose();
        router.dispose();
        store.close();
        await rm(root, { recursive: true, force: true });
    });

    const code = 'console.log("hello"); return { value: await tools.execute_kusto_query({}), state };';
    function run(script = code, target = owner, extra = {}) {
        return hosts.invoke(target, extension, { instanceId: instance.instanceId, actionName: 'run', input: { code: script, state: null, ...extra } });
    }
    function raw(action: string, params: Record<string, unknown>) {
        return hosts.invoke(owner, extension, { instanceId: instance.instanceId, actionName: 'raw',
            input: { method: `coc.toolScripts.v1.${action}`, params: { sessionId: owner.processId, ...params } } });
    }

    it('executes a declared read-only tool without optional flags, provider calls, queue work or transcript writes', async () => {
        const before = await store.getProcess(owner.processId, owner.workspaceId);
        expect(await run(code, owner, { state: { count: 1 } })).toEqual({
            ok: true, result: { value: { workspaceId: owner.workspaceId }, state: { count: 1 } }, logs: ['hello'], callCount: 1,
        });
        expect(calls).toHaveBeenCalledTimes(1);
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(sdk.service.sendMessage).not.toHaveBeenCalled();
        expect(router.createAggregateQueueFacade().getAll()).toEqual([]);
        expect(await store.getProcess(owner.processId, owner.workspaceId)).toEqual(before);
    });

    it('rejects forged ownership fields and conversation IDs before runner dispatch', async () => {
        for (const identity of [{ sessionId: sibling.processId }, { workspaceId: sibling.workspaceId },
            { processId: sibling.processId }, { extensionId: 'global:other' }, { allowTools: ['execute_kusto_command'] }]) {
            expect(await raw('run', { requestId: 'forged', code, ...identity })).toMatchObject({ rpcError: -32602 });
        }
        expect(calls).not.toHaveBeenCalled();
    });

    it('validates declarations on the server and prevents later self-grants', async () => {
        for (const tools of [['execute_kusto_command'], ['run_tool_script'], ['unknown'], ['save_memory'], ['execute_kusto_query', 'execute_kusto_query']]) {
            expect(await raw('register', { tools })).toMatchObject({ rpcError: -32602 });
        }
        await run();
        expect(await raw('register', { tools: ['execute_kusto_query'] })).toMatchObject({ rpcError: -32602 });
        expect(calls).toHaveBeenCalledTimes(1);
    });

    it.each(['save_memory', 'execute_kusto_command', 'run_tool_script', 'mcp_call', 'mcp_list_tools'])(
        'keeps undeclared or privileged tool %s out of the script', async tool => {
            expect(await run(`const alias = tools[${JSON.stringify(tool)}]; return await alias({ approval: true });`))
                .toMatchObject({ ok: false, code: 'script-error', callCount: tool === 'run_tool_script' ? 1 : 0 });
            expect(calls).not.toHaveBeenCalled();
        },
    );

    it.each(['disabled', 'approval-required'])('honors owner %s tools without an approval prompt', async policy => {
        writeRepoPreferences(root, owner.workspaceId, { disabledLlmTools: policy === 'disabled' ? ['execute_kusto_query'] : [],
            approvalRequiredLlmTools: policy === 'approval-required' ? ['execute_kusto_query'] : [] });
        expect(await run()).toMatchObject({ ok: false, code: 'script-error' });
        expect(calls).not.toHaveBeenCalled();
        expect((await store.getProcess(owner.processId))?.pendingAskUser).toBeUndefined();
    });

    it('isolates two workspaces and cancels only the requesting owner', async () => {
        await hosts.open(sibling, extension, instance);
        const pending = run('return await tools.execute_kusto_query({ wait: true });', owner, { cancelAfterMs: 150 });
        await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
        const siblingRun = run('return await tools.execute_kusto_query({ wait: "manual" });', sibling);
        await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(2));
        expect(await pending).toMatchObject({ ok: false, code: 'aborted' });
        expect(calls.mock.calls[0][2].aborted).toBe(true);
        expect(calls.mock.calls[1][2].aborted).toBe(false);
        releaseSibling();
        expect(await siblingRun).toMatchObject({ ok: true, result: { workspaceId: sibling.workspaceId } });
        expect(await run()).toMatchObject({ ok: true });
    });

    it.each(['close', 'disable', 'owner-removed', 'dispose'])(
        'aborts outstanding work on %s without waiting for the action queue', async operation => {
            const pending = run('return await tools.execute_kusto_query({ wait: true });').catch(error => ({ rejected: error.message }));
            await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
            if (operation === 'close') await hosts.close(owner, extension, instance.instanceId);
            else if (operation === 'disable') { enabled = false; await hosts.syncConfig(); }
            else if (operation === 'owner-removed') await hosts.stopConversation(owner, true);
            else await hosts.dispose();
            expect(await pending).toBeDefined();
            expect(calls.mock.calls[0][2].aborted).toBe(true);
        },
    );
});
