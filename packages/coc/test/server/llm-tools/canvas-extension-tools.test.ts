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
    let root: string, repo: string, enabled: boolean;
    let canvasStore: CanvasStore, processStore: ProcessStore, hosts: CanvasExtensionHostRegistry;
    let emitProcessEvent: ReturnType<typeof vi.fn>, broadcastProcessEvent: ReturnType<typeof vi.fn>, startHost: ReturnType<typeof vi.fn>;
    const config = () => ({ canvasExtensions: { enabled } });
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
        const result = await call('open_canvas', { canvasId: qualifiedId, instanceId, input: { count } });
        expect(result.success).toBe(true);
        return result;
    }
    beforeEach(() => {
        enabled = true;
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
        expect(tools().map(tool => tool.name)).toEqual(['list_canvas_capabilities', 'open_canvas', 'invoke_canvas_action', 'close_canvas']);
        expect(startHost).not.toHaveBeenCalled();
        expect(await call('list_canvas_capabilities')).toMatchObject({ success: true, canvases: [{
            id: qualifiedId, extensionKey: 'workspace-1:counter', displayName: 'Counter',
            actions: expect.arrayContaining([expect.objectContaining({ name: 'increment' })]),
        }] });
        expect(startHost).toHaveBeenCalledTimes(1);
        expect(canvasStore.listCanvases(owner.workspaceId)).toEqual([]);
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
        expect(await call('close_canvas', { instanceId: opened.instanceId })).toEqual({ success: true, instanceId: opened.instanceId });
        expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, opened.canvasId)!).closed).toBe(true);
        await expect(fetch(opened.url)).rejects.toThrow();
        expect(await call('invoke_canvas_action', { instanceId: opened.instanceId, actionName: 'increment' }))
            .toMatchObject({ success: false, error: { message: expect.stringContaining('closed') } });
        await call('close_canvas', { instanceId: opened.instanceId });
        expect(emitProcessEvent).toHaveBeenCalledTimes(2);
        const reopened = await call('open_canvas', { canvasId: qualifiedId, instanceId: opened.instanceId });
        expect(reopened).toMatchObject({ success: true, canvasId: opened.canvasId, instanceId: opened.instanceId });
        expect(await (await fetch(reopened.url)).json()).toEqual({ count: 5 });
        expect(canvasStore.listCanvases(owner.workspaceId)).toHaveLength(1);
    });
    it('restores all saved open instances after registry restart before an action', async () => {
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
        const opened = await open(); await call('close_canvas', { instanceId: opened.instanceId });
        await hosts.dispose(); hosts = registry();
        expect(loadCanvasExtensionInstances(canvasStore, owner, 'workspace-1:counter')).toEqual([]);
        await call('close_canvas', { instanceId: opened.instanceId });
        expect(startHost).toHaveBeenCalledTimes(1);
    });
    it('serializes concurrent opens across factories into one record and generates IDs when omitted', async () => {
        const args = { canvasId: qualifiedId, instanceId: 'same', input: { count: 3 } };
        const results = await Promise.all([call('open_canvas', args), call('open_canvas', args)]);
        expect(results.every(result => result.success)).toBe(true);
        expect(results[0].canvasId).toBe(results[1].canvasId);
        expect(canvasStore.listCanvases(owner.workspaceId)).toHaveLength(1);
        const a = await call('open_canvas', { canvasId: qualifiedId });
        const b = await call('open_canvas', { canvasId: qualifiedId });
        expect(a.success && b.success).toBe(true); expect(a.instanceId).not.toBe(b.instanceId);
        expect(startHost).toHaveBeenCalledTimes(1);
    });
    it('isolates instance records and runtimes by conversation and workspace', async () => {
        await open();
        const sibling = { ...owner, processId: 'sibling' };
        expect(await call('invoke_canvas_action', { instanceId: 'instance-1', actionName: 'increment' }, sibling)).toMatchObject({ success: false });
        expect(await call('close_canvas', { instanceId: 'instance-1' }, { ...owner, workspaceId: 'foreign' })).toMatchObject({ success: false });
        expect(loadCanvasExtensionInstances(canvasStore, sibling, 'workspace-1:counter')).toEqual([]);
        const second = await call('open_canvas', { canvasId: qualifiedId, instanceId: 'instance-1', input: { count: 9 } }, sibling);
        expect(second.success).toBe(true); expect(await (await fetch(second.url)).json()).toEqual({ count: 9 });
        expect(startHost.mock.calls.map(([opts]) => opts.processId)).toEqual([owner.processId, sibling.processId]);
    });
    it('supports globals with extension-folder cwd and rejects cross-extension instance reuse', async () => {
        const folder = path.join(root, 'home', '.copilot', 'extensions', 'global-counter');
        fs.mkdirSync(folder, { recursive: true });
        fs.copyFileSync(path.join(repo, '.github', 'extensions', 'counter', 'extension.mjs'), path.join(folder, 'extension.mjs'));
        const result = await call('open_canvas', { canvasId: 'global:global-counter/counter', instanceId: 'global' });
        expect(result.success).toBe(true); expect(startHost.mock.calls[0][0].extension.cwd).toBe(folder);
        expect(canvasStore.getCanvas(owner.workspaceId, result.canvasId)?.processId).toBe(owner.processId);
        expect(await call('open_canvas', { canvasId: qualifiedId, instanceId: 'global' }))
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
        const scope = { ...owner, workspaceId: group.id };
        const result = await call('list_canvas_capabilities', {}, scope);
        expect(result.canvases.map((canvas: any) => canvas.id)).toEqual([qualifiedId, 'workspace-2:counter/counter']);
        const opened = await call('open_canvas', { canvasId: 'workspace-2:counter/counter', instanceId: 'member' }, scope);
        expect(opened.success).toBe(true);
        expect(canvasStore.getCanvas(group.id, opened.canvasId)).toMatchObject({ ...scope, type: 'copilot-extension' });
        expect(canvasStore.listCanvases('workspace-2')).toEqual([]);
        expect(startHost.mock.calls.map(([opts]) => opts.extension.cwd)).toEqual([repo, secondRepo]);
    });
    it('closes a newly opened instance when its durable write fails', async () => {
        const close = vi.spyOn(CanvasExtensionHost.prototype, 'close');
        vi.spyOn(canvasStore, 'createCanvas').mockImplementationOnce(() => { throw new Error('Disk full'); });
        expect(await call('open_canvas', { canvasId: qualifiedId, instanceId: 'unpersisted' }))
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
    it('rejects malformed arguments, unknown canvases and removed extensions without extra records', async () => {
        for (const args of [{}, { canvasId: 'unknown/counter' }, { canvasId: qualifiedId, input: [] }, { canvasId: qualifiedId, instanceId: '' }]) {
            expect(await call('open_canvas', args)).toMatchObject({ success: false });
        }
        expect(await call('invoke_canvas_action', { instanceId: 'unknown', actionName: 'increment' })).toMatchObject({ success: false });
        expect(await call('close_canvas', {})).toMatchObject({ success: false });
        expect(startHost).not.toHaveBeenCalled();
        expect(await call('open_canvas', { canvasId: 'workspace-1:counter/undeclared' })).toMatchObject({ success: false });
        expect(canvasStore.listCanvases(owner.workspaceId)).toEqual([]);
        const opened = await open(); fs.rmSync(path.join(repo, '.github', 'extensions'), { recursive: true });
        expect(await call('invoke_canvas_action', { instanceId: opened.instanceId, actionName: 'increment' }))
            .toMatchObject({ success: false, error: { message: expect.stringContaining('unavailable') } });
        expect(emitProcessEvent).toHaveBeenCalledTimes(1);
    });
});
