import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { createCanvasUpdateNotifier } from '../../../src/server/canvas/canvas-update-notifier';
import { CanvasExtensionHost } from '../../../src/server/canvas-extensions/extension-host';
import { CanvasExtensionHostRegistry } from '../../../src/server/canvas-extensions/host-registry';
import { loadCanvasExtensionInstances, readCanvasExtensionInstance } from '../../../src/server/canvas-extensions/instance-records';
import { registerCanvasExtensionRoutes } from '../../../src/server/canvas-extensions/routes';
import { createCanvasExtensionTools } from '../../../src/server/llm-tools/canvas-extension-tools';
import { createRouter, type Route } from '../../../src/server/shared/router';
import { createRepoGroup } from '../../../src/server/workspaces/repo-group-workspace';

vi.mock('os', async importOriginal => {
    const actual = await importOriginal<typeof import('os')>();
    return { ...actual, homedir: vi.fn(actual.homedir) };
});

const owner = { workspaceId: 'repo-a', processId: 'chat-a' };

describe('persisted canvas extension reopening routes', () => {
    let root: string, repo: string, enabled: boolean, baseUrl: string;
    let processStore: SqliteProcessStore, canvasStore: CanvasStore, hosts: CanvasExtensionHostRegistry, server: Server;
    let startHost: ReturnType<typeof vi.fn<typeof CanvasExtensionHost.start>>;
    let emit: ReturnType<typeof vi.fn>;
    const config = () => ({ canvasExtensions: { enabled } });
    const runtime = () => ({
        config, hosts, canvasStore, notifier: createCanvasUpdateNotifier({ processStore }),
    });
    const deps = () => ({ ...runtime(), ...owner, processStore, dataDir: root });
    function registry() {
        return new CanvasExtensionHostRegistry({
            config, dataDir: root, store: processStore, log: vi.fn(), startHost,
            loadInstances: (scope, key) => loadCanvasExtensionInstances(canvasStore, scope, key),
        });
    }
    async function addConversation(scope = owner) {
        await processStore.addProcess({
            id: scope.processId, type: 'chat', status: 'completed', promptPreview: 'Canvas',
            fullPrompt: 'Canvas', startTime: new Date(), metadata: { workspaceId: scope.workspaceId },
        });
    }
    function saved(scope = owner, extensionKey = 'repo-a:counter') {
        return canvasStore.createCanvas({
            ...scope, type: 'copilot-extension', title: 'Saved counter', content: JSON.stringify({
                extensionKey, canvasId: 'counter', instanceId: 'saved-instance',
                input: { count: 7 }, title: 'Saved counter',
            }),
        });
    }
    function post(canvasId: string, workspaceId = owner.workspaceId, body?: unknown) {
        return fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(canvasId)}/copilot-extension/open`, {
            method: 'POST', ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
        });
    }
    beforeEach(async () => {
        enabled = true;
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-reopen-'));
        repo = path.join(root, 'repo');
        const folder = path.join(repo, '.github', 'extensions', 'counter');
        fs.mkdirSync(folder, { recursive: true });
        fs.copyFileSync(path.resolve('test/fixtures/canvas-extensions/minimal/extension.mjs'), path.join(folder, 'extension.mjs'));
        vi.mocked(os.homedir).mockReturnValue(path.join(root, 'home'));
        processStore = new SqliteProcessStore({ dbPath: path.join(root, 'processes.db') });
        await processStore.registerWorkspace({ id: owner.workspaceId, rootPath: repo, name: 'Repo A' });
        await addConversation();
        emit = vi.spyOn(processStore, 'emitProcessEvent');
        canvasStore = new CanvasStore(root);
        startHost = vi.fn(CanvasExtensionHost.start);
        hosts = registry();
        const routes: Route[] = [];
        // The accessor resolves the replacement registry in the restart test.
        registerCanvasExtensionRoutes(routes, {
            dataDir: root, processStore, runtime: { ...runtime(), get hosts() { return hosts; } },
        });
        server = createServer(createRouter({ routes, spaHtml: '' }));
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Server did not bind');
        baseUrl = `http://127.0.0.1:${address.port}`;
    });
    afterEach(async () => {
        await hosts.dispose();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        processStore.close();
        vi.restoreAllMocks();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('reopens the stored identity/input, returns a fresh URL and emits a durable update', async () => {
        const canvas = saved();
        const response = await post(canvas.id, owner.workspaceId, {
            processId: 'another-chat', extensionKey: 'global:other', instanceId: 'other', input: { count: 999 },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const opened = await response.json();
        expect(opened).toMatchObject({
            success: true, canvasId: canvas.id, instanceId: 'saved-instance', extensionKey: 'repo-a:counter', title: 'Counter',
        });
        expect(await (await fetch(opened.url)).json()).toEqual({ count: 7 });
        expect(canvasStore.listCanvases(owner.workspaceId)).toHaveLength(1);
        expect(canvasStore.getCanvas(owner.workspaceId, canvas.id)).toMatchObject({ revision: 2, processId: owner.processId });
        expect(canvasStore.getCanvas(owner.workspaceId, canvas.id)!.content).not.toContain('http:');
        expect(emit).toHaveBeenCalledExactlyOnceWith(owner.processId, expect.objectContaining({ type: 'canvas-updated' }));
        const second = await (await post(canvas.id)).json();
        expect(second.url).toBe(opened.url);
        expect(startHost).toHaveBeenCalledOnce();
    });

    it('restores persisted instances through a replacement registry without saving runtime URLs', async () => {
        const canvas = saved();
        const first = await (await post(canvas.id)).json();
        await hosts.dispose();
        await expect(fetch(first.url)).rejects.toThrow();
        hosts = registry();
        const reopened = await (await post(canvas.id)).json();
        expect(reopened).toMatchObject({ success: true, canvasId: canvas.id, instanceId: 'saved-instance' });
        expect(await (await fetch(reopened.url)).json()).toEqual({ count: 7 });
        expect(startHost).toHaveBeenCalledTimes(2);
    });

    it('reopens a tool-closed instance with its original input and serializes with agent operations', async () => {
        const canvas = saved();
        await post(canvas.id);
        const close = createCanvasExtensionTools(deps()).find(tool => tool.name === 'close_canvas')!;
        await close.handler({ instanceId: 'saved-instance' });
        expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, canvas.id)!).closed).toBe(true);
        const responses = await Promise.all([post(canvas.id), post(canvas.id)]);
        expect(responses.map(response => response.status)).toEqual([200, 200]);
        const opened = await responses[0].json();
        expect(await (await fetch(opened.url)).json()).toEqual({ count: 7 });
        expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, canvas.id)!).closed).toBeUndefined();
        expect(canvasStore.listCanvases(owner.workspaceId)).toHaveLength(1);
        expect(canvasStore.getCanvas(owner.workspaceId, canvas.id)!.revision).toBe(5);
    });

    it('does no record reads, discovery or startup while disabled, including after live disable', async () => {
        const canvas = saved();
        enabled = false;
        const read = vi.spyOn(canvasStore, 'getCanvas');
        const discover = vi.spyOn(processStore, 'getWorkspaces');
        expect((await post(canvas.id)).status).toBe(404);
        expect(read).not.toHaveBeenCalled();
        expect(discover).not.toHaveBeenCalled();
        expect(startHost).not.toHaveBeenCalled();
        enabled = true;
        expect((await post(canvas.id)).status).toBe(200);
        enabled = false;
        await hosts.syncConfig();
        read.mockClear(); discover.mockClear();
        expect((await post(canvas.id)).status).toBe(404);
        expect(read).not.toHaveBeenCalled();
        expect(discover).not.toHaveBeenCalled();
        expect(startHost).toHaveBeenCalledOnce();
    });

    it('serializes tab reopening with a concurrent agent close', async () => {
        const canvas = saved();
        const original = hosts.open.bind(hosts);
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const open = vi.spyOn(hosts, 'open').mockImplementationOnce(async (...args) => {
            await held;
            return original(...args);
        });
        const pending = post(canvas.id);
        try {
            await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
            const close = createCanvasExtensionTools(deps()).find(tool => tool.name === 'close_canvas')!;
            const closed = close.handler({ instanceId: 'saved-instance' });
            release();
            expect((await pending).status).toBe(200);
            expect(await closed).toEqual({ success: true, instanceId: 'saved-instance' });
            expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, canvas.id)!).closed).toBe(true);
            expect(canvasStore.getCanvas(owner.workspaceId, canvas.id)!.revision).toBe(3);
        } finally {
            release();
            await pending;
        }
    });

    it('revokes an already queued reopen when the flag is disabled', async () => {
        const canvas = saved();
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const read = vi.spyOn(processStore, 'getProcess').mockImplementationOnce(async () => {
            await held;
            return undefined;
        });
        const canvasReads = vi.spyOn(canvasStore, 'getCanvas');
        const first = post(canvas.id);
        let second: ReturnType<typeof post> | undefined;
        try {
            await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
            second = post(canvas.id);
            await vi.waitFor(() => expect(canvasReads).toHaveBeenCalledTimes(2));
            enabled = false;
            release();
            expect((await first).status).toBe(422);
            expect((await second).status).toBe(422);
            expect(startHost).not.toHaveBeenCalled();
            expect(emit).not.toHaveBeenCalled();
        } finally {
            release();
            await first;
            await second;
        }
    });

    it('rejects invalid IDs, unknown/cross-workspace records and non-extension canvases without startup', async () => {
        const canvas = saved();
        const markdown = canvasStore.createCanvas({ ...owner, title: 'Document', content: 'hello' });
        expect((await post('../escape')).status).toBe(400);
        expect((await post('missing')).status).toBe(404);
        expect((await post(canvas.id, 'repo-b')).status).toBe(404);
        expect((await post(markdown.id)).status).toBe(404);
        expect(startHost).not.toHaveBeenCalled();
    });

    it.each(['missing', 'archived', 'foreign'] as const)('rejects a %s owning conversation without startup', async state => {
        const canvas = saved();
        if (state === 'missing') await processStore.removeProcess(owner.processId);
        if (state === 'archived') processStore.archiveProcess(owner.processId);
        if (state === 'foreign') await processStore.updateProcess(owner.processId, { metadata: { workspaceId: 'repo-b' } });
        const response = await post(canvas.id);
        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({ success: false, error: {
            code: 'canvas-extension-error', message: expect.stringContaining('conversation'),
        } });
        expect(startHost).not.toHaveBeenCalled();
    });

    it('rejects corrupt records and removed extensions without startup or record mutations', async () => {
        const canvas = saved();
        canvasStore.updateCanvas(owner.workspaceId, canvas.id, { content: '{}', editor: 'user' });
        expect((await post(canvas.id)).status).toBe(422);
        const missing = saved(owner, 'repo-a:removed');
        expect((await post(missing.id)).status).toBe(422);
        expect(startHost).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('rejects records without an owner and does not reopen on a GET', async () => {
        const canvas = canvasStore.createCanvas({ workspaceId: owner.workspaceId,
            type: 'copilot-extension', title: 'Unowned', content: '{}' });
        expect((await post(canvas.id)).status).toBe(422);
        const response = await fetch(`${baseUrl}/api/workspaces/${owner.workspaceId}/canvases/${saved().id}/copilot-extension/open`);
        expect(response.status).toBe(404);
        expect(startHost).not.toHaveBeenCalled();
    });

    it('uses the group conversation owner and the member repository cwd', async () => {
        const group = await createRepoGroup(root, processStore, { name: 'Group', members: [owner.workspaceId] });
        const groupOwner = { workspaceId: group.id, processId: 'group-chat' };
        await addConversation(groupOwner);
        const canvas = saved(groupOwner);
        const response = await post(canvas.id, group.id);
        expect(response.status).toBe(200);
        const opened = await response.json();
        expect(await (await fetch(opened.url)).json()).toEqual({ count: 7 });
        expect(startHost).toHaveBeenCalledWith(expect.objectContaining({
            processId: groupOwner.processId,
            extension: expect.objectContaining({ extensionKey: 'repo-a:counter', cwd: repo }),
        }));
        expect(canvasStore.getCanvas(group.id, canvas.id)!.processId).toBe(groupOwner.processId);
        expect(canvasStore.getCanvas(owner.workspaceId, canvas.id)).toBeNull();
    });

    it('preserves structured CanvasError codes for HTTP callers', async () => {
        const canvas = saved();
        vi.spyOn(hosts, 'open').mockRejectedValue({ data: { code: 'open_failed', message: 'Cannot open counter' } });
        const response = await post(canvas.id);
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ success: false, error: { code: 'open_failed', message: 'Cannot open counter' } });
        expect(emit).not.toHaveBeenCalled();
    });

    describe('"+" menu list and open-by-key', () => {
        const list = (workspaceId = owner.workspaceId) =>
            fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/canvas-extensions`);
        const openByKey = (body: unknown, workspaceId = owner.workspaceId) =>
            fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/canvas-extensions/open`, {
                method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
            });

        it('lists discovered extensions from discovery alone, and nothing while disabled', async () => {
            fs.writeFileSync(path.join(repo, '.github', 'extensions', 'counter', 'package.json'),
                JSON.stringify({ description: 'A counter' }));
            const response = await list();
            expect(response.status).toBe(200);
            expect(response.headers.get('cache-control')).toBe('no-store');
            expect(await response.json()).toEqual({ extensions: [
                { extensionKey: 'repo-a:counter', name: 'counter', description: 'A counter' },
            ] });
            expect(startHost).not.toHaveBeenCalled();
            enabled = false;
            const discover = vi.spyOn(processStore, 'getWorkspaces');
            expect(await (await list()).json()).toEqual({ extensions: [] });
            expect(discover).not.toHaveBeenCalled();
        });

        it('opens the first declared canvas in the chat and reuses its instance on the next pick', async () => {
            const response = await openByKey({ processId: owner.processId, extensionKey: 'repo-a:counter' });
            expect(response.status).toBe(200);
            expect(response.headers.get('cache-control')).toBe('no-store');
            const opened = await response.json();
            expect(opened).toMatchObject({ success: true, title: 'Counter', extensionKey: 'repo-a:counter' });
            expect(await (await fetch(opened.url)).json()).toEqual({ count: 0 });
            const record = canvasStore.getCanvas(owner.workspaceId, opened.canvasId)!;
            expect(record).toMatchObject({ type: 'copilot-extension', processId: owner.processId });
            expect(readCanvasExtensionInstance(record)).toMatchObject({ extensionKey: 'repo-a:counter', canvasId: 'counter' });

            const again = await (await openByKey({ processId: owner.processId, extensionKey: 'repo-a:counter' })).json();
            expect(again).toMatchObject({ canvasId: opened.canvasId, instanceId: opened.instanceId, url: opened.url });
            expect(canvasStore.listCanvases(owner.workspaceId)).toHaveLength(1);
            expect(startHost).toHaveBeenCalledOnce();
        });

        it('reopens a closed instance instead of creating another record', async () => {
            const canvas = saved();
            const close = createCanvasExtensionTools(deps()).find(tool => tool.name === 'close_canvas')!;
            await close.handler({ instanceId: 'saved-instance' });
            const opened = await (await openByKey({ processId: owner.processId, extensionKey: 'repo-a:counter' })).json();
            expect(opened).toMatchObject({ canvasId: canvas.id, instanceId: 'saved-instance' });
            expect(await (await fetch(opened.url)).json()).toEqual({ count: 7 });
            expect(readCanvasExtensionInstance(canvasStore.getCanvas(owner.workspaceId, canvas.id)!).closed).toBeUndefined();
        });

        it('rejects bad bodies, unknown extensions and foreign chats without startup', async () => {
            expect((await openByKey({ extensionKey: 'repo-a:counter' })).status).toBe(400);
            expect((await openByKey({ processId: owner.processId })).status).toBe(400);
            expect((await fetch(`${baseUrl}/api/workspaces/${owner.workspaceId}/canvas-extensions/open`,
                { method: 'POST', body: 'not json' })).status).toBe(400);
            const unknown = await openByKey({ processId: owner.processId, extensionKey: 'repo-a:missing' });
            expect(unknown.status).toBe(422);
            expect(await unknown.json()).toMatchObject({ success: false, error: { message: expect.stringContaining('unavailable') } });
            expect((await openByKey({ processId: 'no-such-chat', extensionKey: 'repo-a:counter' })).status).toBe(422);
            expect(startHost).not.toHaveBeenCalled();
            enabled = false;
            expect((await openByKey({ processId: owner.processId, extensionKey: 'repo-a:counter' })).status).toBe(404);
            expect(canvasStore.listCanvases(owner.workspaceId)).toHaveLength(0);
        });
    });
});
