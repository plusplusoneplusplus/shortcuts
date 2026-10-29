import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { mkdtemp, mkdir, rm, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { CopilotSDKService, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../../src/server/index';
import { CanvasExtensionHostRegistry } from '../../../src/server/canvas-extensions/host-registry';

it('server composition forwards archive/delete events and awaits registry shutdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'canvas-server-lifetime-'));
    await writeFile(join(root, 'config.yaml'), 'canvasExtensions:\n  enabled: true\n');
    const repo = join(root, 'repo');
    const extensionFolder = join(repo, '.github', 'extensions', 'counter');
    await mkdir(extensionFolder, { recursive: true });
    const extensionPath = join(extensionFolder, 'extension.mjs');
    await copyFile(resolve('test/fixtures/canvas-extensions/minimal/extension.mjs'), extensionPath);
    const store = new SqliteProcessStore({ dbPath: join(root, 'processes.db') });
    const service = new CopilotSDKService();
    vi.spyOn(service, 'listModels').mockResolvedValue([]);
    vi.spyOn(service, 'isAvailable').mockResolvedValue({ available: false });
    const completion = vi.spyOn(service, 'sendMessage').mockResolvedValue({ success: true, response: 'Server answer' });
    const lifecycle = vi.spyOn(CanvasExtensionHostRegistry.prototype, 'onProcessChange');
    const dispose = vi.spyOn(CanvasExtensionHostRegistry.prototype, 'dispose');
    let server: Awaited<ReturnType<typeof createExecutionServer>> | undefined;
    try {
        server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: root,
            configPath: join(root, 'config.yaml'), aiService: service, store });
        await store.registerWorkspace({ id: 'workspace-1', name: 'Canvas repo', rootPath: repo });
        await server.store.addProcess({ id: 'canvas-conversation', type: 'chat', status: 'completed',
            promptPreview: 'Canvas', fullPrompt: 'Canvas', startTime: new Date(),
            metadata: { type: 'chat', workspaceId: 'workspace-1' } });
        const hosts = lifecycle.mock.contexts.at(-1)!;
        const owner = { workspaceId: 'workspace-1', processId: 'canvas-conversation' };
        const extension = { extensionKey: 'workspace-1:counter', name: 'counter', ownerWorkspaceId: owner.workspaceId,
            extensionPath, cwd: repo, contentHash: 'fixture' };
        const instance = { canvasId: 'counter', instanceId: 'instance-1' };
        const opened = await hosts.open(owner, extension, instance);
        expect((await fetch(opened.url!)).ok).toBe(true);
        await store.updateProcess(owner.processId, { status: 'running' });
        const callbackResult = await hosts.invoke(owner, extension, { instanceId: instance.instanceId, actionName: 'callbacks' });
        expect(callbackResult).toMatchObject({ messageId: expect.any(String), answer: 'Server answer' });
        expect((await store.getProcess(owner.processId))?.pendingMessages).toEqual([expect.objectContaining({
            content: '[Canvas extension workspace-1:counter]\n\nhi', id: expect.any(String),
        })]);
        expect(completion).toHaveBeenCalledOnce();
        lifecycle.mockClear();
        store.archiveProcess('canvas-conversation');
        expect(lifecycle).toHaveBeenCalledWith({ type: 'process-updated', process: expect.objectContaining({
            id: 'canvas-conversation', archived: true, metadata: expect.objectContaining({ workspaceId: 'workspace-1' }),
        }) });
        await vi.waitFor(async () => { await expect(fetch(opened.url!)).rejects.toThrow(); });
        await hosts.stopConversation(owner);
        store.unarchiveProcess(owner.processId);
        const reopened = await hosts.open(owner, extension, instance);
        await server.store.removeProcess('canvas-conversation');
        expect(lifecycle).toHaveBeenCalledWith({ type: 'process-removed', process: expect.objectContaining({ id: 'canvas-conversation' }) });
        await vi.waitFor(async () => { await expect(fetch(reopened.url!)).rejects.toThrow(); });
        await hosts.stopConversation(owner, true);
        await server.store.addProcess({ id: 'shutdown-conversation', type: 'chat', status: 'completed',
            promptPreview: 'Canvas', fullPrompt: 'Canvas', startTime: new Date(),
            metadata: { type: 'chat', workspaceId: owner.workspaceId } });
        const shutdownOwner = { ...owner, processId: 'shutdown-conversation' };
        // Production composition hydrates saved instances before an action, including after restart.
        const saved = new CanvasStore(root).createCanvas({ ...shutdownOwner, type: 'copilot-extension', title: 'Saved counter',
            editor: 'ai', content: JSON.stringify({ extensionKey: extension.extensionKey, ...instance,
                input: { count: 41 }, title: 'Saved counter' }) });
        expect(await hosts.invoke(shutdownOwner, extension, { instanceId: instance.instanceId, actionName: 'increment' })).toBe(42);
        await hosts.stopConversation(shutdownOwner);
        const restoredResponse = await fetch(`${server.url}/api/workspaces/${owner.workspaceId}/canvases/${saved.id}/copilot-extension/open`, {
            method: 'POST',
        });
        expect(restoredResponse.status).toBe(200);
        const restored = await restoredResponse.json();
        expect(restored).toMatchObject({ canvasId: saved.id, instanceId: instance.instanceId, extensionKey: extension.extensionKey });
        expect(await (await fetch(restored.url)).json()).toEqual({ count: 41 });
        const final = await hosts.open(shutdownOwner, extension, { ...instance, input: { count: 42 } });
        const env = await hosts.invoke(shutdownOwner, extension, { instanceId: instance.instanceId, actionName: 'environment' }) as { pid: number };
        await server.close();
        server = undefined;
        await expect(fetch(final.url!)).rejects.toThrow();
        expect(() => process.kill(env.pid, 0)).toThrow();
        expect(dispose).toHaveBeenCalledOnce();
        await expect(dispose.mock.results[0].value).resolves.toBeUndefined();
    } finally {
        await server?.close();
        service.dispose();
        store.close();
        vi.restoreAllMocks();
        await rm(root, { recursive: true, force: true });
    }
}, 30_000);
