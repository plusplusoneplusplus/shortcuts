import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { createRepoGroup } from '../../../src/server/workspaces/repo-group-workspace';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { createCanvasUpdateNotifier } from '../../../src/server/canvas/canvas-update-notifier';
import { CanvasExtensionHost } from '../../../src/server/canvas-extensions/extension-host';
import { CanvasExtensionHostRegistry } from '../../../src/server/canvas-extensions/host-registry';
import { loadCanvasExtensionInstances, readCanvasExtensionInstance } from '../../../src/server/canvas-extensions/instance-records';
import { createCanvasExtensionTools } from '../../../src/server/llm-tools/canvas-extension-tools';

vi.mock('os', async importOriginal => {
    const actual = await importOriginal<typeof import('os')>();
    return { ...actual, homedir: vi.fn(actual.homedir) };
});
const owner = { workspaceId: 'workspace-1', processId: 'conversation-1' };
const qualifiedId = 'workspace-1:counter/counter';

describe('canvas extension tool factories and persistence', () => {
    let root: string, repo: string, enabled: boolean, singleton: boolean | undefined;
    let canvasStore: CanvasStore, processStore: ProcessStore, hosts: CanvasExtensionHostRegistry;
    let emitProcessEvent: ReturnType<typeof vi.fn>, broadcastProcessEvent: ReturnType<typeof vi.fn>, startHost: ReturnType<typeof vi.fn>;
    const config = () => ({ canvasExtensions: { enabled, singletonPerSession: singleton } });
    function registry() {
        return new CanvasExtensionHostRegistry({
            config, dataDir: root, store: processStore, log: vi.fn(), startHost,
            loadInstances: (scope, key) => loadCanvasExtensionInstances(canvasStore, scope, key),
        });
    }
    function tools(scope = owner) {
        return createCanvasExtensionTools({
            ...scope, config, dataDir: root, processStore, hosts, canvasStore,
            notifier: createCanvasUpdateNotifier({ processStore, getWsServer: () => ({ broadcastProcessEvent }) as any }),
        });
    }
    async function call(name: string, args: unknown = {}, scope = owner): Promise<any> {
        const result = await tools(scope).find(tool => tool.name === name)!.handler(args) as any;
        if (result.resultType === 'failure') return JSON.parse(result.textResultForLlm);
        return result;
    }
    async function open(count = 5, instanceId = 'instance-1') {
        const result = await call('manage_canvas', { action: 'open', canvasId: qualifiedId, instanceId, input: { count } });
        expect(result.success).toBe(true);
        return result;
    }
    beforeEach(() => {
        enabled = true; singleton = undefined;
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc canvas tools '));
        repo = path.join(root, 'repo');
        const folder = path.join(repo, '.github', 'extensions', 'counter');
        fs.mkdirSync(folder, { recursive: true });
        fs.copyFileSync(path.resolve('test/fixtures/canvas-extensions/minimal/extension.mjs'), path.join(folder, 'extension.mjs'));
        vi.mocked(os.homedir).mockReturnValue(path.join(root, 'home'));
        canvasStore = new CanvasStore(root);
        emitProcessEvent = vi.fn(); broadcastProcessEvent = vi.fn();
        processStore = {
            getWorkspaces: vi.fn(async () => [{ id: owner.workspaceId, rootPath: repo }]),
            getProcess: vi.fn(async (id, workspaceId) => ({ id, metadata: { workspaceId } })), emitProcessEvent,
        } as unknown as ProcessStore;
        startHost = vi.fn(CanvasExtensionHost.start);
        hosts = registry();
    });
    afterEach(async () => {
        await hosts.dispose(); vi.restoreAllMocks();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('exposes four lazy fixed tools and lists real SDK declarations with qualified IDs', async () => {
        expect(tools().map(tool => tool.name)).toEqual(['extension_canvas', 'list_canvas_capabilities', 'manage_canvas', 'invoke_canvas_action']);
        expect(startHost).not.toHaveBeenCalled();
        expect(await call('list_canvas_capabilities')).toMatchObject({ success: true, canvases: [{
            id: qualifiedId, extensionKey: 'workspace-1:counter', displayName: 'Counter',
            actions: expect.arrayContaining([expect.objectContaining({ name: 'increment' })]),
        }] });
        expect(startHost).toHaveBeenCalledTimes(1);
        expect(canvasStore.listCanvases(owner.workspaceId)).toEqual([]);
    });
    it('lists cached real SDK declarations across conversations and refreshes them after a file edit', async () => {
        const first = await call('list_canvas_capabilities');
        const sibling = { ...owner, processId: 'conversation-2' };
        expect(await call('list_canvas_capabilities', {}, sibling)).toEqual(first);
        expect(startHost).toHaveBeenCalledTimes(1);
        const entryPath = path.join(repo, '.github', 'extensions', 'counter', 'extension.mjs');
        fs.writeFileSync(entryPath, fs.readFileSync(entryPath, 'utf8').replace("displayName: 'Counter'", "displayName: 'Changed counter'"));
        const refreshed = await call('list_canvas_capabilities');
        expect(refreshed).toMatchObject({ success: true, canvases: [{ displayName: 'Changed counter' }] });
        expect(startHost).toHaveBeenCalledTimes(2);
        expect(await call('list_canvas_capabilities', {}, sibling)).toEqual(refreshed);
        expect(startHost).toHaveBeenCalledTimes(2);
        await open();
        await call('manage_canvas', { action: 'open', canvasId: qualifiedId, instanceId: 'sibling-instance' }, sibling);
        expect(startHost).toHaveBeenCalledTimes(3);
        expect(startHost.mock.calls.map(([options]) => options.processId)).toEqual([
            owner.processId, owner.processId, sibling.processId,
        ]);
    });
    it('persists owner, input and title without URLs and emits both update channels', async () => {
        const opened = await open();
        const canvas = canvasStore.getCanvas(owner.workspaceId, opened.canvasId)!;
        expect(canvas).toMatchObject({ ...owner, type: 'copilot-extension', title: 'Counter', revision: 1 });
        expect(JSON.parse(canvas.content)).toEqual({ extensionKey: 'workspace-1:counter', canvasId: 'counter',
            instanceId: 'instance-1', input: { count: 5 }, title: 'Counter' });
        expect(await (await fetch(opened.url)).json()).toEqual({ count: 5 });
        expect(broadcastProcessEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...owner, type: 'canvas-updated', canvasId: canvas.id }));
        expect(emitProcessEvent).toHaveBeenCalledExactlyOnceWith(owner.processId, expect.objectContaining({
            type: 'canvas-updated', canvasUpdate: expect.objectContaining({ canvasId: canvas.id, canvasType: 'copilot-extension' }),
        }));
        expect(new CanvasStore(root).getCanvas(owner.workspaceId, canvas.id)).toEqual(canvas);
    });
    it('reloads local imports with unchanged entry bytes and notifies every open instance once', async () => {
        singleton = false;
        const folder = path.join(repo, '.github', 'extensions', 'counter');
        const entry = path.join(folder, 'extension.mjs');
        fs.writeFileSync(path.join(folder, 'offset.mjs'), 'export const offset = 0;');
        const source = "import { offset } from './offset.mjs';\n" + fs.readFileSync(entry, 'utf8')
            .replace('ctx.input?.count ?? 0', '(ctx.input?.count ?? 0) + offset');
        fs.writeFileSync(entry, source);
        const first = await open(5, 'one');
        const second = await open(10, 'two');
        const closed = await open(20, 'closed');
        await call('manage_canvas', { action: 'close', instanceId: 'closed' });
        await call('invoke_canvas_action', { instanceId: 'one', actionName: 'workspace-write', input: { value: 'kept' } });
        fs.writeFileSync(path.join(folder, 'offset.mjs'), 'export const offset = 30;');
        expect(fs.readFileSync(entry, 'utf8')).toBe(source);
        emitProcessEvent.mockClear(); broadcastProcessEvent.mockClear();
        const result = await call('manage_canvas', { action: 'reload', instanceId: 'one' });
        expect(result).toMatchObject({ success: true, canvasId: first.canvasId, instanceId: 'one', reused: true });
        expect(result.refreshedCanvasIds.sort()).toEqual([first.canvasId, second.canvasId].sort());
        expect(await (await fetch(result.url)).json()).toEqual({ count: 35 });
        await expect(fetch(first.url)).rejects.toThrow();
        await expect(fetch(second.url)).rejects.toThrow();
        const a = readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, first.canvasId)!);
        const b = readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, second.canvasId)!);
        expect(a.runtimeReload).toEqual({ id: expect.any(String) });
        expect(b.runtimeReload).toEqual(a.runtimeReload);
        expect(a.input).toEqual({ count: 5 }); expect(b.input).toEqual({ count: 10 });
        expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, closed.canvasId)!).runtimeReload).toBeUndefined();
        expect(emitProcessEvent).toHaveBeenCalledTimes(2);
        expect(broadcastProcessEvent).toHaveBeenCalledTimes(2);
        expect(startHost).toHaveBeenCalledTimes(2);
        const reopened = await call('manage_canvas', { action: 'open', canvasId: qualifiedId, instanceId: 'two' });
        expect(await (await fetch(reopened.url)).json()).toEqual({ count: 40 });
        expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, second.canvasId)!).runtimeReload).toEqual(a.runtimeReload);
        expect(await call('invoke_canvas_action', { instanceId: 'one', actionName: 'workspace-read' })).toEqual({ success: true, result: 'kept' });
    });

    it('publishes reload errors for affected views and recovers without changing saved identity/input', async () => {
        const opened = await open();
        const entry = path.join(repo, '.github', 'extensions', 'counter', 'extension.mjs');
        const source = fs.readFileSync(entry, 'utf8');
        fs.writeFileSync(entry, 'invalid javascript !!!');
        const failed = await call('manage_canvas', { action: 'reload', instanceId: opened.instanceId });
        expect(failed).toMatchObject({ success: false, error: { message: expect.any(String) } });
        const record = readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, opened.canvasId)!);
        expect(record).toMatchObject({ input: { count: 5 }, instanceId: opened.instanceId,
            runtimeReload: { id: expect.any(String), error: failed.error.message } });
        fs.writeFileSync(entry, source);
        const recovered = await call('manage_canvas', { action: 'reload', instanceId: opened.instanceId });
        expect(recovered.success).toBe(true);
        const latest = readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, opened.canvasId)!);
        expect(latest.runtimeReload).toEqual({ id: expect.any(String) });
        expect(latest.runtimeReload!.id).not.toBe(record.runtimeReload!.id);
        expect(await (await fetch(recovered.url)).json()).toEqual({ count: 5 });
        expect(canvasStore.listCanvases(owner.workspaceId)).toHaveLength(1);
    });

    it('does not reset or notify other conversations, workspaces or extensions', async () => {
        const a = await open();
        const sibling = { ...owner, processId: 'sibling' };
        const b = await call('manage_canvas', { action: 'open', canvasId: qualifiedId, instanceId: 'other' }, sibling);
        const foreign = { ...owner, workspaceId: 'foreign' };
        vi.mocked(processStore.getWorkspaces).mockResolvedValue([
            { id: owner.workspaceId, rootPath: repo }, { id: foreign.workspaceId, rootPath: repo },
        ] as any);
        const c = await call('manage_canvas', { action: 'open', canvasId: 'foreign:counter/counter', instanceId: 'foreign' }, foreign);
        const folder = path.join(repo, '.github', 'extensions', 'other');
        fs.mkdirSync(folder); fs.copyFileSync(path.join(repo, '.github', 'extensions', 'counter', 'extension.mjs'), path.join(folder, 'extension.mjs'));
        const d = await call('manage_canvas', { action: 'open', canvasId: 'workspace-1:other/counter', instanceId: 'other-ext' });
        emitProcessEvent.mockClear();
        expect((await call('manage_canvas', { action: 'reload', instanceId: a.instanceId })).success).toBe(true);
        for (const other of [b, c, d]) {
            expect(other.success).toBe(true);
            expect((await fetch(other.url)).ok).toBe(true);
        }
        expect(emitProcessEvent).toHaveBeenCalledExactlyOnceWith(owner.processId,
            expect.objectContaining({ canvasUpdate: expect.objectContaining({ canvasId: a.canvasId }) }));
    });

    it('validates reload before resetting and rejects unknown, foreign and closed instances', async () => {
        const reset = vi.spyOn(hosts, 'reset');
        const opened = await open();
        for (const args of [
            { instanceId: '' }, { instanceId: 'missing' },
            { instanceId: opened.instanceId, input: {} }, { instanceId: opened.instanceId, canvasId: qualifiedId },
        ]) expect(await call('manage_canvas', { action: 'reload', ...args })).toMatchObject({ success: false });
        expect(await call('manage_canvas', { action: 'reload', instanceId: opened.instanceId }, { ...owner, processId: 'foreign' }))
            .toMatchObject({ success: false });
        await call('manage_canvas', { action: 'close', instanceId: opened.instanceId });
        expect(await call('manage_canvas', { action: 'reload', instanceId: opened.instanceId }))
            .toMatchObject({ success: false, error: { message: expect.stringContaining('closed') } });
        expect(reset).not.toHaveBeenCalled();
    });

    it('waits for running actions before reload and never replays them', async () => {
        const opened = await open();
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const original = hosts.invoke.bind(hosts);
        const invoking = vi.spyOn(hosts, 'invoke').mockImplementationOnce(async (...args) => {
            await held; return original(...args);
        });
        const reset = vi.spyOn(hosts, 'reset');
        const action = call('invoke_canvas_action', { instanceId: opened.instanceId, actionName: 'increment' });
        await vi.waitFor(() => expect(invoking).toHaveBeenCalledOnce());
        const reload = call('manage_canvas', { action: 'reload', instanceId: opened.instanceId });
        try {
            expect(reset).not.toHaveBeenCalled();
            release();
            expect(await action).toEqual({ success: true, result: 6 });
            expect((await reload).success).toBe(true);
            expect(invoking).toHaveBeenCalledOnce();
        } finally { release(); await Promise.all([action, reload]); }
    });

    it.each(['disabled', 'archived'] as const)('does not publish late results after the owner is %s', async state => {
        const opened = await open();
        const before = canvasStore.getCanvas(owner.workspaceId, opened.canvasId);
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const original = hosts.open.bind(hosts);
        const opening = vi.spyOn(hosts, 'open').mockImplementationOnce(async (...args) => {
            const value = await original(...args); await held; return value;
        });
        const request = call('manage_canvas', { action: 'reload', instanceId: opened.instanceId });
        try {
            await vi.waitFor(() => expect(opening).toHaveBeenCalledOnce());
            if (state === 'disabled') { enabled = false; await hosts.syncConfig(); }
            else vi.mocked(processStore.getProcess).mockResolvedValue({ archived: true, metadata: { workspaceId: owner.workspaceId } } as any);
            release();
            expect(await request).toMatchObject({ success: false });
            expect(canvasStore.getCanvas(owner.workspaceId, opened.canvasId)).toEqual(before);
        } finally { release(); await request; }
    });

    it('reports persistence conflicts without overwriting concurrent input or retrying reload', async () => {
        const opened = await open();
        const original = hosts.open.bind(hosts);
        vi.spyOn(hosts, 'open').mockImplementationOnce(async (...args) => {
            const value = await original(...args);
            const canvas = canvasStore.getCanvas(owner.workspaceId, opened.canvasId)!;
            const instance = readCanvasExtensionInstance(canvas);
            canvasStore.updateCanvas(owner.workspaceId, canvas.id, {
                content: JSON.stringify({ ...instance, input: { count: 99 } }), editor: 'user',
            });
            return value;
        });
        const reset = vi.spyOn(hosts, 'reset');
        emitProcessEvent.mockClear();
        expect(await call('manage_canvas', { action: 'reload', instanceId: opened.instanceId }))
            .toMatchObject({ success: false, error: { message: expect.stringContaining('revision-conflict') } });
        expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, opened.canvasId)!).input).toEqual({ count: 99 });
        expect(reset).toHaveBeenCalledOnce();
        expect(emitProcessEvent).not.toHaveBeenCalled();
    });

    it('honors tool cancellation and does not publish late reload results', async () => {
        const opened = await open();
        const before = canvasStore.getCanvas(owner.workspaceId, opened.canvasId);
        const original = hosts.open.bind(hosts);
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const opening = vi.spyOn(hosts, 'open').mockImplementationOnce(async (...args) => {
            const value = await original(...args); await held; return value;
        });
        const controller = new AbortController();
        const tool = tools().find(tool => tool.name === 'manage_canvas')!;
        const request = tool.handler!({ action: 'reload', instanceId: opened.instanceId }, { signal: controller.signal } as any);
        try {
            await vi.waitFor(() => expect(opening).toHaveBeenCalledOnce());
            controller.abort(new Error('Canceled reload')); release();
            expect(await request).toMatchObject({ resultType: 'failure' });
            expect(canvasStore.getCanvas(owner.workspaceId, opened.canvasId)).toEqual(before);
        } finally { release(); await request; }
    });

    it('invokes real actions and returns structured CanvasError details', async () => {
        const opened = await open();
        expect(await call('invoke_canvas_action', { instanceId: opened.instanceId, actionName: 'increment' })).toEqual({ success: true, result: 6 });
        expect(await (await fetch(opened.url)).json()).toEqual({ count: 6 });
        expect(await call('invoke_canvas_action', { instanceId: opened.instanceId, actionName: 'error' }))
            .toEqual({ success: false, error: { code: 'counter_error', message: 'Counter failed' } });
        expect(emitProcessEvent).toHaveBeenCalledTimes(1);
    });
    it('closes the server idempotently and reopens the saved record with its original input', async () => {
        const opened = await open();
        expect(await call('manage_canvas', { action: 'close', instanceId: opened.instanceId })).toEqual({ success: true, instanceId: opened.instanceId });
        expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, opened.canvasId)!).closed).toBe(true);
        await expect(fetch(opened.url)).rejects.toThrow();
        expect(await call('invoke_canvas_action', { instanceId: opened.instanceId, actionName: 'increment' }))
            .toMatchObject({ success: false, error: { message: expect.stringContaining('closed') } });
        await call('manage_canvas', { action: 'close', instanceId: opened.instanceId });
        expect(emitProcessEvent).toHaveBeenCalledTimes(2);
        const reopened = await call('manage_canvas', { action: 'open', canvasId: qualifiedId, instanceId: opened.instanceId });
        expect(reopened).toMatchObject({ success: true, canvasId: opened.canvasId, instanceId: opened.instanceId });
        expect(await (await fetch(reopened.url)).json()).toEqual({ count: 5 });
        expect(canvasStore.listCanvases(owner.workspaceId)).toHaveLength(1);
    });
    it('restores all saved open instances after registry restart before an action', async () => {
        singleton = false;
        await open(5, 'one'); await open(10, 'two');
        await call('invoke_canvas_action', { instanceId: 'one', actionName: 'increment' });
        await hosts.dispose(); canvasStore = new CanvasStore(root); hosts = registry();
        expect(await call('invoke_canvas_action', { instanceId: 'two', actionName: 'increment' })).toEqual({ success: true, result: 11 });
        expect(await call('invoke_canvas_action', { instanceId: 'one', actionName: 'increment' })).toEqual({ success: true, result: 6 });
        expect(startHost).toHaveBeenCalledTimes(2);
        expect(canvasStore.listCanvases(owner.workspaceId)).toHaveLength(2);
    });
    it('rejects corrupt persisted identity before starting a replacement runtime', async () => {
        const opened = await open();
        await hosts.dispose();
        canvasStore.updateCanvas(owner.workspaceId, opened.canvasId, { content: '{}', editor: 'user' });
        hosts = registry();
        const result = await call('list_canvas_capabilities');
        expect(result).toMatchObject({ success: false, error: { message: expect.stringContaining('Invalid canvas extension record') } });
        expect(startHost).toHaveBeenCalledTimes(1);
        expect(canvasStore.getCanvas(owner.workspaceId, opened.canvasId)?.content).toBe('{}');
    });
    it('does not restore closed instances after restart', async () => {
        const opened = await open(); await call('manage_canvas', { action: 'close', instanceId: opened.instanceId });
        await hosts.dispose(); hosts = registry();
        expect(loadCanvasExtensionInstances(canvasStore, owner, 'workspace-1:counter')).toEqual([]);
        await call('manage_canvas', { action: 'close', instanceId: opened.instanceId });
        expect(startHost).toHaveBeenCalledTimes(1);
    });
    it('serializes concurrent opens across factories into one record and generates IDs when omitted', async () => {
        singleton = false;
        const args = { canvasId: qualifiedId, instanceId: 'same', input: { count: 3 } };
        const results = await Promise.all([call('manage_canvas', { action: 'open', ...args }), call('manage_canvas', { action: 'open', ...args })]);
        expect(results.every(result => result.success)).toBe(true);
        expect(results[0].canvasId).toBe(results[1].canvasId);
        expect(canvasStore.listCanvases(owner.workspaceId)).toHaveLength(1);
        const a = await call('manage_canvas', { action: 'open', canvasId: qualifiedId });
        const b = await call('manage_canvas', { action: 'open', canvasId: qualifiedId });
        expect(a.success && b.success).toBe(true); expect(a.instanceId).not.toBe(b.instanceId);
        expect(startHost).toHaveBeenCalledTimes(1);
    });
    it('isolates instance records and runtimes by conversation and workspace', async () => {
        await open();
        const sibling = { ...owner, processId: 'sibling' };
        expect(await call('invoke_canvas_action', { instanceId: 'instance-1', actionName: 'increment' }, sibling)).toMatchObject({ success: false });
        expect(await call('manage_canvas', { action: 'close', instanceId: 'instance-1' }, { ...owner, workspaceId: 'foreign' })).toMatchObject({ success: false });
        expect(loadCanvasExtensionInstances(canvasStore, sibling, 'workspace-1:counter')).toEqual([]);
        const second = await call('manage_canvas', { action: 'open', canvasId: qualifiedId, instanceId: 'instance-1', input: { count: 9 } }, sibling);
        expect(second.success).toBe(true); expect(await (await fetch(second.url)).json()).toEqual({ count: 9 });
        expect(startHost.mock.calls.map(([opts]) => opts.processId)).toEqual([owner.processId, sibling.processId]);
    });
    it('supports globals with extension-folder cwd and rejects cross-extension instance reuse', async () => {
        const folder = path.join(root, 'home', '.copilot', 'extensions', 'global-counter');
        fs.mkdirSync(folder, { recursive: true });
        fs.copyFileSync(path.join(repo, '.github', 'extensions', 'counter', 'extension.mjs'), path.join(folder, 'extension.mjs'));
        const result = await call('manage_canvas', { action: 'open', canvasId: 'global:global-counter/counter', instanceId: 'global' });
        expect(result.success).toBe(true); expect(startHost.mock.calls[0][0].extension.cwd).toBe(folder);
        expect(canvasStore.getCanvas(owner.workspaceId, result.canvasId)?.processId).toBe(owner.processId);
        expect(await call('manage_canvas', { action: 'open', canvasId: qualifiedId, instanceId: 'global' }))
            .toMatchObject({ success: false, error: { message: expect.stringContaining('another canvas') } });
    });
    it('opens member extensions in group conversations while preserving member cwd and group storage', async () => {
        const secondRepo = path.join(root, 'second-repo');
        const folder = path.join(secondRepo, '.github', 'extensions', 'counter');
        fs.mkdirSync(folder, { recursive: true });
        fs.copyFileSync(path.join(repo, '.github', 'extensions', 'counter', 'extension.mjs'), path.join(folder, 'extension.mjs'));
        vi.mocked(processStore.getWorkspaces).mockResolvedValue([
            { id: owner.workspaceId, name: 'One', rootPath: repo }, { id: 'workspace-2', name: 'Two', rootPath: secondRepo },
        ]);
        processStore.registerWorkspace = vi.fn();
        const group = await createRepoGroup(root, processStore, { name: 'Both', members: [owner.workspaceId, 'workspace-2'] });
        const members = await processStore.getWorkspaces();
        vi.mocked(processStore.getWorkspaces).mockResolvedValue([...members, group]);
        const scope = { ...owner, workspaceId: group.id };
        const result = await call('list_canvas_capabilities', {}, scope);
        expect(result.canvases.map((canvas: any) => canvas.id)).toEqual([qualifiedId, 'workspace-2:counter/counter']);
        const opened = await call('manage_canvas', { action: 'open', canvasId: 'workspace-2:counter/counter', instanceId: 'member' }, scope);
        expect(opened.success).toBe(true);
        expect(canvasStore.getCanvas(group.id, opened.canvasId)).toMatchObject({ ...scope, type: 'copilot-extension' });
        expect(canvasStore.listCanvases('workspace-2')).toEqual([]);
        const reloaded = await call('manage_canvas', { action: 'reload', instanceId: 'member' }, scope);
        expect(reloaded).toMatchObject({ success: true, canvasId: opened.canvasId, refreshedCanvasIds: [opened.canvasId] });
        expect(readCanvasExtensionInstance(canvasStore.getCanvas(group.id, opened.canvasId)!).runtimeReload).toEqual({ id: expect.any(String) });
        expect(canvasStore.listCanvases('workspace-2')).toEqual([]);
        expect(startHost.mock.calls.map(([opts]) => opts.extension.cwd)).toEqual([repo, secondRepo, secondRepo]);
    });
    it('closes a newly opened instance when its durable write fails', async () => {
        const close = vi.spyOn(CanvasExtensionHost.prototype, 'close');
        vi.spyOn(canvasStore, 'createCanvas').mockImplementationOnce(() => { throw new Error('Disk full'); });
        expect(await call('manage_canvas', { action: 'open', canvasId: qualifiedId, instanceId: 'unpersisted' }))
            .toMatchObject({ success: false, error: { message: 'Disk full' } });
        expect(close).toHaveBeenCalledExactlyOnceWith({ canvasId: 'counter', instanceId: 'unpersisted' });
        expect(canvasStore.listCanvases(owner.workspaceId)).toEqual([]);
        expect(emitProcessEvent).not.toHaveBeenCalled();
    });
    it('gates factories and captured handlers before discovery, persistence or spawn', async () => {
        const captured = tools(); enabled = false;
        expect(tools()).toEqual([]);
        const results = await Promise.all(captured.map(tool => tool.handler({})));
        for (const result of results as any[]) {
            expect(result.resultType).toBe('failure');
            expect(JSON.parse(result.textResultForLlm)).toMatchObject({
                success: false, error: { message: 'Canvas extensions are disabled' },
            });
        }
        expect(processStore.getWorkspaces).not.toHaveBeenCalled(); expect(processStore.getProcess).not.toHaveBeenCalled();
        expect(startHost).not.toHaveBeenCalled(); expect(emitProcessEvent).not.toHaveBeenCalled();
    });
    it('rejects archived, missing and foreign conversations before discovery', async () => {
        for (const process of [undefined, { archived: true, metadata: { workspaceId: owner.workspaceId } }, { metadata: { workspaceId: 'other' } }]) {
            vi.mocked(processStore.getProcess).mockResolvedValueOnce(process as any);
            expect(await call('list_canvas_capabilities')).toMatchObject({ success: false });
        }
        expect(processStore.getWorkspaces).not.toHaveBeenCalled(); expect(startHost).not.toHaveBeenCalled();
    });
    it('validates manage_canvas action and per-action parameters before touching runtimes or records', async () => {
        for (const args of [{}, { action: 'reopen', canvasId: qualifiedId }, { action: 'OPEN', canvasId: qualifiedId }]) {
            expect(await call('manage_canvas', args)).toEqual({
                success: false, error: { code: 'canvas-extension-error', message: 'action must be "open", "close" or "reload"' },
            });
        }
        expect(await call('manage_canvas', { action: 'open' })).toMatchObject({
            success: false, error: { message: 'canvasId must be a non-empty string' },
        });
        const opened = await open();
        expect(await call('manage_canvas', { action: 'close', instanceId: opened.instanceId, canvasId: qualifiedId }))
            .toMatchObject({ success: false, error: { message: 'canvasId is not supported for action "close"' } });
        expect(await call('manage_canvas', { action: 'close', instanceId: opened.instanceId, input: {} }))
            .toMatchObject({ success: false, error: { message: 'input is not supported for action "close"' } });
        expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, opened.canvasId)!).closed).not.toBe(true);
        expect(await call('manage_canvas', { action: 'close', instanceId: 'missing' }))
            .toMatchObject({ success: false, error: { message: 'Unknown canvas instance: missing' } });
        expect(startHost).toHaveBeenCalledTimes(1);
    });
    it('rejects malformed arguments, unknown canvases and removed extensions without extra records', async () => {
        for (const args of [{}, { canvasId: 'unknown/counter' }, { canvasId: qualifiedId, input: [] }, { canvasId: qualifiedId, instanceId: '' }]) {
            expect(await call('manage_canvas', { action: 'open', ...args })).toMatchObject({ success: false });
        }
        expect(await call('invoke_canvas_action', { instanceId: 'unknown', actionName: 'increment' })).toMatchObject({ success: false });
        expect(await call('manage_canvas', { action: 'close' })).toMatchObject({
            success: false, error: { message: 'instanceId must be a non-empty string' },
        });
        expect(startHost).not.toHaveBeenCalled();
        expect(await call('manage_canvas', { action: 'open', canvasId: 'workspace-1:counter/undeclared' })).toMatchObject({ success: false });
        expect(canvasStore.listCanvases(owner.workspaceId)).toEqual([]);
        const opened = await open(); fs.rmSync(path.join(repo, '.github', 'extensions'), { recursive: true });
        expect(await call('invoke_canvas_action', { instanceId: opened.instanceId, actionName: 'increment' }))
            .toMatchObject({ success: false, error: { message: expect.stringContaining('unavailable') } });
        expect(emitProcessEvent).toHaveBeenCalledTimes(1);
    });
    describe('one instance per canvas per conversation', () => {
        const records = (scope = owner) => canvasStore.listCanvases(scope.workspaceId, { processId: scope.processId });
        const openCanvas = (args: Record<string, unknown> = {}, scope = owner) =>
            call('manage_canvas', { action: 'open', canvasId: qualifiedId, ...args }, scope);

        it('reuses the saved instance for repeated and unknown-ID opens, with input replacing the saved input', async () => {
            const first = await openCanvas({ input: { count: 2 } });
            expect(first).toMatchObject({ success: true, reused: false });
            const second = await openCanvas();
            expect(second).toMatchObject({ success: true, reused: true, instanceId: first.instanceId, canvasId: first.canvasId });
            const third = await openCanvas({ instanceId: 'new-id', input: { count: 7 } });
            expect(third).toMatchObject({ reused: true, instanceId: first.instanceId, canvasId: first.canvasId });
            expect(records()).toHaveLength(1);
            expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, first.canvasId)!).input).toEqual({ count: 7 });
            expect(startHost).toHaveBeenCalledTimes(1);
        });
        it('serializes concurrent opens without IDs into one record', async () => {
            const results = await Promise.all([openCanvas(), openCanvas(), openCanvas({ instanceId: 'other' })]);
            expect(results.every(result => result.success)).toBe(true);
            expect(new Set(results.map(result => result.instanceId)).size).toBe(1);
            expect(results.filter(result => result.reused)).toHaveLength(2);
            expect(records()).toHaveLength(1);
        });
        it('reopens the closed instance with its saved input instead of creating another', async () => {
            const first = await openCanvas({ input: { count: 4 } });
            await call('manage_canvas', { action: 'close', instanceId: first.instanceId });
            const reopened = await openCanvas();
            expect(reopened).toMatchObject({ success: true, reused: true, instanceId: first.instanceId });
            expect(await (await fetch(reopened.url)).json()).toEqual({ count: 4 });
            expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, first.canvasId)!).closed).toBeUndefined();
            await hosts.dispose(); hosts = registry();
            expect(await call('invoke_canvas_action', { instanceId: first.instanceId, actionName: 'increment' })).toEqual({ success: true, result: 5 });
            expect(records()).toHaveLength(1);
        });
        it('keeps separate instances per extension and per conversation', async () => {
            const folder = path.join(repo, '.github', 'extensions', 'counter-two');
            fs.mkdirSync(folder, { recursive: true });
            fs.copyFileSync(path.join(repo, '.github', 'extensions', 'counter', 'extension.mjs'), path.join(folder, 'extension.mjs'));
            const sibling = { ...owner, processId: 'conversation-2' };
            const a = await openCanvas();
            const b = await openCanvas({ canvasId: 'workspace-1:counter-two/counter' });
            const c = await openCanvas({}, sibling);
            expect([b.reused, c.reused]).toEqual([false, false]);
            expect(new Set([a.instanceId, b.instanceId, c.instanceId]).size).toBe(3);
            expect(records()).toHaveLength(2); expect(records(sibling)).toHaveLength(1);
        });
        it('keeps pre-existing duplicates usable and reuses the most recent open one', async () => {
            singleton = false;
            await open(1, 'old'); await open(2, 'recent');
            await call('manage_canvas', { action: 'close', instanceId: 'recent' });
            singleton = undefined;
            expect(await openCanvas()).toMatchObject({ reused: true, instanceId: 'old' });
            expect(await openCanvas({ instanceId: 'recent' })).toMatchObject({ reused: true, instanceId: 'recent' });
            expect(records()).toHaveLength(2);
            await hosts.dispose(); hosts = registry();
            expect(await call('invoke_canvas_action', { instanceId: 'old', actionName: 'increment' })).toEqual({ success: true, result: 2 });
            expect(await call('invoke_canvas_action', { instanceId: 'recent', actionName: 'increment' })).toEqual({ success: true, result: 3 });
        });
        it('describes reuse to the model only while the flag is on', () => {
            const description = () => tools().find(tool => tool.name === 'manage_canvas')!.description;
            expect(description()).toContain('one instance per chat');
            singleton = false;
            expect(description()).not.toContain('one instance per chat');
        });
    });
});
