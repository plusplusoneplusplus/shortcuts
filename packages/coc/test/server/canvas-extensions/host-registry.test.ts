import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { CanvasExtensionHostRegistry, type CanvasExtensionRegistryOptions } from '../../../src/server/canvas-extensions/host-registry';
import { CanvasExtensionHost } from '../../../src/server/canvas-extensions/extension-host';

const owner = { workspaceId: 'workspace-1', processId: 'conversation-1' };
const extension = { extensionKey: 'member:counter', ownerWorkspaceId: 'member', name: 'counter',
    extensionPath: '/unused/extension.mjs', cwd: '/unused', contentHash: 'fixture' };
const instance = { canvasId: 'counter', instanceId: 'instance-1', input: { count: 5 } };

function fakeHost() {
    const host = {
        running: true, declarations: [{ id: 'counter' }],
        open: vi.fn(async () => ({ title: 'Counter', url: 'http://127.0.0.1:1234/' })),
        invoke: vi.fn(async () => 6), close: vi.fn(async () => {}),
        dispose: vi.fn(async () => { host.running = false; }),
    };
    return host;
}

describe('CanvasExtensionHostRegistry lifetime', () => {
    let registry: CanvasExtensionHostRegistry;
    let options: CanvasExtensionRegistryOptions;
    let host: ReturnType<typeof fakeHost>;
    let root: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-canvas-registry-'));
        host = fakeHost();
        options = {
            config: () => ({ canvasExtensions: { enabled: true } }), dataDir: root, log: vi.fn(),
            store: { getProcess: vi.fn(async (id: string, workspaceId: string) => ({
                id, metadata: { workspaceId },
            })) } as unknown as Pick<ProcessStore, 'getProcess'>,
            startHost: vi.fn(async () => { host.running = true; return host as unknown as CanvasExtensionHost; }),
        };
        vi.stubEnv('COC_CANVAS_EXT_IDLE_TTL_MS', '100');
        registry = new CanvasExtensionHostRegistry(options);
    });

    afterEach(async () => {
        await registry.dispose();
        vi.useRealTimers();
        vi.unstubAllEnvs();
        await fs.rm(root, { recursive: true, force: true });
    });

    it('is lazy, shares concurrent startup and expires declaration-only hosts after the idle TTL', async () => {
        vi.useFakeTimers();
        expect(options.startHost).not.toHaveBeenCalled();
        await Promise.all([registry.declarations(owner, extension), registry.declarations(owner, extension)]);
        expect(options.startHost).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(99);
        expect(host.dispose).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(host.running).toBe(false);
        await expect(registry.declarations(owner, extension)).resolves.toEqual(host.declarations);
        expect(options.startHost).toHaveBeenCalledTimes(1);
        await registry.open(owner, extension, instance);
        expect(options.startHost).toHaveBeenCalledTimes(2);
    });

    it('shares cloned declarations across conversations without hydrating or starting the reader runtime', async () => {
        options.loadInstances = vi.fn(() => []);
        const first = await registry.declarations(owner, extension);
        first[0].id = 'modified';
        const sibling = { ...owner, processId: 'conversation-2' };
        expect(await registry.declarations(sibling, extension)).toEqual([{ id: 'counter' }]);
        expect(options.startHost).toHaveBeenCalledTimes(1);
        expect(options.loadInstances).toHaveBeenCalledTimes(1);
        await registry.open(sibling, extension, instance);
        expect(options.startHost).toHaveBeenCalledTimes(2);
        expect(vi.mocked(options.startHost!).mock.calls[1][0].processId).toBe(sibling.processId);
    });

    it('caches declarations from opens and keys them by path as well as hash', async () => {
        await registry.open(owner, extension, instance);
        const sibling = { ...owner, processId: 'conversation-2' };
        await registry.declarations(sibling, extension);
        expect(options.startHost).toHaveBeenCalledTimes(1);
        await registry.declarations(sibling, { ...extension, extensionPath: path.join(root, 'other', 'extension.mjs') });
        expect(options.startHost).toHaveBeenCalledTimes(2);
    });

    it('refreshes a changed hash in an existing runtime and reopens its instances', async () => {
        await registry.open(owner, extension, instance);
        const changed = { ...extension, contentHash: 'changed' };
        const replacement = fakeHost();
        replacement.declarations = [{ id: 'new-counter' }];
        vi.mocked(options.startHost!).mockResolvedValueOnce(replacement as unknown as CanvasExtensionHost);
        expect(await registry.declarations(owner, changed)).toEqual([{ id: 'new-counter' }]);
        expect(host.running).toBe(false);
        expect(replacement.open).toHaveBeenCalledExactlyOnceWith(instance);
        expect(vi.mocked(options.startHost!).mock.calls[1][0].extension.contentHash).toBe('changed');
        const sibling = { ...owner, processId: 'conversation-2' };
        expect(await registry.declarations(sibling, changed)).toEqual([{ id: 'new-counter' }]);
        expect(options.startHost).toHaveBeenCalledTimes(2);
    });

    it('does not cache failed startup and retries on the next list', async () => {
        vi.mocked(options.startHost!).mockRejectedValueOnce(new Error('startup failed'));
        await expect(registry.declarations(owner, extension)).rejects.toThrow('startup failed');
        await expect(registry.declarations(owner, extension)).resolves.toEqual([{ id: 'counter' }]);
        expect(options.startHost).toHaveBeenCalledTimes(2);
    });

    it('validates the live gate and conversation owner even with cached declarations', async () => {
        await registry.declarations(owner, extension);
        for (const process of [undefined, { archived: true, metadata: { workspaceId: owner.workspaceId } }, { metadata: { workspaceId: 'other' } }]) {
            vi.mocked(options.store.getProcess).mockResolvedValueOnce(process as never);
            await expect(registry.declarations(owner, extension)).rejects.toThrow('missing, archived or owned');
        }
        options.config = () => ({ canvasExtensions: { enabled: false } });
        vi.mocked(options.store.getProcess).mockClear();
        await expect(registry.declarations(owner, extension)).rejects.toThrow('disabled');
        expect(options.store.getProcess).not.toHaveBeenCalled();
        expect(options.startHost).toHaveBeenCalledTimes(1);
        await registry.dispose();
        await expect(registry.declarations(owner, extension)).rejects.toThrow('disposed');
    });

    it('rechecks live disable after an asynchronous owner lookup on a cache hit', async () => {
        await registry.declarations(owner, extension);
        vi.mocked(options.store.getProcess).mockImplementationOnce(async id => {
            options.config = () => ({ canvasExtensions: { enabled: false } });
            return { id, metadata: { workspaceId: owner.workspaceId } } as never;
        });
        await expect(registry.declarations(owner, extension)).rejects.toThrow('disabled');
        expect(options.startHost).toHaveBeenCalledTimes(1);
    });

    it('keeps open instances alive and starts a fresh idle interval after the last close', async () => {
        vi.useFakeTimers();
        await registry.open(owner, extension, instance);
        await vi.advanceTimersByTimeAsync(1000);
        expect(host.dispose).not.toHaveBeenCalled();
        await registry.close(owner, extension, instance.instanceId);
        await vi.advanceTimersByTimeAsync(99);
        expect(host.dispose).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(host.running).toBe(false);
    });

    it('does not expire a busy runtime and does not replay failed actions', async () => {
        vi.useFakeTimers();
        await registry.open(owner, extension, instance);
        host.invoke.mockImplementationOnce(async () => { host.running = false; throw new Error('crash'); });
        await expect(registry.invoke(owner, extension, { instanceId: instance.instanceId, actionName: 'increment' })).rejects.toThrow('crash');
        expect(host.invoke).toHaveBeenCalledTimes(1);
        let finish!: () => void;
        host.close.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const closing = registry.close(owner, extension, instance.instanceId);
        await vi.waitFor(() => expect(host.close).toHaveBeenCalled());
        await vi.advanceTimersByTimeAsync(1000);
        expect(host.dispose).toHaveBeenCalledTimes(1); // Restart disposed the crashed runtime only.
        finish();
        await closing;
        await vi.advanceTimersByTimeAsync(100);
        expect(host.running).toBe(false);
    });

    it('reopens every known instance with its original input before the next action after a crash', async () => {
        const input = structuredClone(instance);
        await registry.open(owner, extension, input);
        await registry.open(owner, extension, { ...instance, instanceId: 'instance-2' });
        input.input.count = 99;
        host.running = false;
        const replacement = fakeHost();
        vi.mocked(options.startHost!).mockResolvedValueOnce(replacement as unknown as CanvasExtensionHost);
        await registry.invoke(owner, extension, { instanceId: instance.instanceId, actionName: 'increment', input: { by: 1 } });
        expect(replacement.open.mock.calls).toEqual([[instance], [{ ...instance, instanceId: 'instance-2' }]]);
        expect(replacement.open.mock.invocationCallOrder[1]).toBeLessThan(replacement.invoke.mock.invocationCallOrder[0]);
        expect(replacement.invoke).toHaveBeenCalledWith({ canvasId: 'counter', instanceId: instance.instanceId, actionName: 'increment', input: { by: 1 } });
    });

    it('binds separate conversation runtimes and callbacks to their owners', async () => {
        const sibling = { ...owner, processId: 'conversation-2' };
        options.send = vi.fn(async () => ({ messageId: 'message-1' }));
        options.ephemeralQuery = vi.fn(async () => ({ answer: 'answer' }));
        await registry.open(owner, extension, instance);
        await registry.open(sibling, extension, instance);
        expect(vi.mocked(options.startHost!).mock.calls.map(([call]) => call.processId)).toEqual([owner.processId, sibling.processId]);
        const first = vi.mocked(options.startHost!).mock.calls[0][0];
        await first.send('hi');
        await first.ephemeralQuery('question');
        expect(options.send).toHaveBeenCalledExactlyOnceWith(owner, extension.extensionKey, 'hi');
        expect(options.ephemeralQuery).toHaveBeenCalledExactlyOnceWith(owner, extension.extensionKey, 'question');
        await registry.stopConversation(owner);
        expect(() => first.send('late')).toThrow('stopped');
    });

    it('refuses disabled, disposed, archived, missing and foreign conversations before spawning', async () => {
        options.config = () => ({ canvasExtensions: { enabled: false } });
        await expect(registry.declarations(owner, extension)).rejects.toThrow('disabled');
        expect(options.store.getProcess).not.toHaveBeenCalled();
        options.config = () => ({ canvasExtensions: { enabled: true } });
        for (const process of [undefined, { archived: true, metadata: { workspaceId: owner.workspaceId } }, { metadata: { workspaceId: 'other' } }]) {
            vi.mocked(options.store.getProcess).mockResolvedValueOnce(process as never);
            await expect(registry.declarations(owner, extension)).rejects.toThrow('missing, archived or owned');
        }
        expect(options.startHost).not.toHaveBeenCalled();
        await registry.dispose();
        await expect(registry.declarations(owner, extension)).rejects.toThrow('disposed');
    });

    it('stops on live disable and supports subsequent re-enable', async () => {
        await registry.open(owner, extension, instance);
        options.config = () => ({ canvasExtensions: { enabled: false } });
        await registry.syncConfig();
        expect(host.running).toBe(false);
        options.config = () => ({ canvasExtensions: { enabled: true } });
        await registry.declarations(owner, extension);
        expect(options.startHost).toHaveBeenCalledTimes(2);
    });

    it('revokes a pending startup and queued calls on deletion, and waits for child disposal', async () => {
        let finish!: (value: CanvasExtensionHost) => void;
        vi.mocked(options.startHost!).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const opening = registry.open(owner, extension, instance);
        const queued = registry.declarations(owner, extension);
        const results = Promise.allSettled([opening, queued]);
        await vi.waitFor(() => expect(options.startHost).toHaveBeenCalled());
        const stopping = registry.stopConversation(owner, true);
        finish(host as unknown as CanvasExtensionHost);
        await stopping;
        expect((await results).every(result => result.status === 'rejected')).toBe(true);
        expect(host.open).not.toHaveBeenCalled();
        expect(host.running).toBe(false);
    });

    it('handles archive/remove store events and deletes only the target session state', async () => {
        const stateRoot = path.join(root, 'canvas-ext', 'home', 'session-state');
        await fs.mkdir(path.join(stateRoot, owner.processId), { recursive: true });
        await fs.mkdir(path.join(stateRoot, 'sibling'), { recursive: true });
        await registry.open(owner, extension, instance);
        registry.onProcessChange({ type: 'process-updated', process: { id: owner.processId, archived: true, metadata: { workspaceId: owner.workspaceId } } } as never);
        await registry.stopConversation(owner);
        expect(host.running).toBe(false);
        expect(await fs.stat(path.join(stateRoot, owner.processId))).toBeDefined();
        registry.onProcessChange({ type: 'process-removed', process: { id: owner.processId, metadata: { workspaceId: owner.workspaceId } } } as never);
        await registry.dispose();
        await expect(fs.stat(path.join(stateRoot, owner.processId))).rejects.toThrow();
        expect(await fs.stat(path.join(stateRoot, 'sibling'))).toBeDefined();
    });

    it('reconciles filtered clear events without stopping sibling workspace runtimes', async () => {
        const sibling = { workspaceId: 'workspace-2', processId: 'conversation-2' };
        const siblingHost = fakeHost();
        await registry.open(owner, extension, instance);
        vi.mocked(options.startHost!).mockResolvedValueOnce(siblingHost as unknown as CanvasExtensionHost);
        await registry.open(sibling, extension, instance);
        vi.mocked(options.store.getProcess).mockImplementation(async id => id === owner.processId
            ? undefined : { id, metadata: { workspaceId: sibling.workspaceId } } as never);
        registry.onProcessChange({ type: 'processes-cleared' });
        await vi.waitFor(() => expect(host.running).toBe(false));
        expect(siblingHost.running).toBe(true);
        await expect(registry.invoke(sibling, extension, { instanceId: instance.instanceId, actionName: 'increment' })).resolves.toBe(6);
    });

    it('disposes a failed recovery and retains known instances for another restart attempt', async () => {
        await registry.open(owner, extension, instance);
        host.running = false;
        const broken = fakeHost();
        broken.open.mockRejectedValueOnce(new Error('reopen failed'));
        vi.mocked(options.startHost!).mockResolvedValueOnce(broken as unknown as CanvasExtensionHost);
        await expect(registry.invoke(owner, extension, { instanceId: instance.instanceId, actionName: 'increment' })).rejects.toThrow('reopen failed');
        expect(broken.running).toBe(false);
        const replacement = fakeHost();
        vi.mocked(options.startHost!).mockResolvedValueOnce(replacement as unknown as CanvasExtensionHost);
        await registry.invoke(owner, extension, { instanceId: instance.instanceId, actionName: 'increment' });
        expect(replacement.open).toHaveBeenCalledWith(instance);
    });

    it('rejects unknown instances and conflicting canvas IDs, retaining failed closes for recovery', async () => {
        await registry.open(owner, extension, instance);
        await expect(registry.open(owner, extension, { ...instance, canvasId: 'other' })).rejects.toThrow('another canvas');
        await expect(registry.invoke(owner, extension, { instanceId: 'unknown', actionName: 'increment' })).rejects.toThrow('Unknown canvas');
        host.close.mockRejectedValueOnce(new Error('close failed'));
        await expect(registry.close(owner, extension, instance.instanceId)).rejects.toThrow('close failed');
        await expect(registry.invoke(owner, extension, { instanceId: instance.instanceId, actionName: 'increment' })).resolves.toBe(6);
    });

    it('uses the default TTL for invalid env values and refuses unsafe session-state deletion', async () => {
        vi.useFakeTimers();
        vi.stubEnv('COC_CANVAS_EXT_IDLE_TTL_MS', 'invalid');
        await registry.dispose();
        registry = new CanvasExtensionHostRegistry(options);
        await registry.declarations(owner, extension);
        await vi.advanceTimersByTimeAsync(599_999);
        expect(host.running).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
        expect(host.running).toBe(false);
        await expect(registry.stopConversation({ ...owner, processId: '..' }, true)).rejects.toThrow('Invalid');
    });
});

describe('registry with real SDK children', () => {
    it('isolates conversations, restarts and reopens after a real crash, and leaves no child after deletion/shutdown', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coc registry real '));
        const registries: CanvasExtensionHostRegistry[] = [];
        const pids: number[] = [];
        try {
            const extensionPath = path.join(root, 'extension.mjs');
            await fs.copyFile(path.resolve('test/fixtures/canvas-extensions/minimal/extension.mjs'), extensionPath);
            const discovered = { ...extension, extensionPath, cwd: root };
            const registry = new CanvasExtensionHostRegistry({ config: () => ({ canvasExtensions: { enabled: true } }),
                dataDir: root, log: () => {}, store: { getProcess: async (id, workspaceId) => ({ id, metadata: { workspaceId } }) } as Pick<ProcessStore, 'getProcess'> });
            registries.push(registry);
            const sibling = { ...owner, processId: 'conversation-2' };
            const first = await registry.open(owner, discovered, instance);
            await registry.open(sibling, discovered, instance);
            const env = async (target: typeof owner) => registry.invoke(target, discovered, { instanceId: instance.instanceId, actionName: 'environment' }) as Promise<{ pid: number; sessionId: string }>;
            const a = await env(owner), b = await env(sibling);
            pids.push(a.pid, b.pid);
            expect(a.pid).not.toBe(b.pid);
            expect([a.sessionId, b.sessionId]).toEqual([owner.processId, sibling.processId]);
            await expect(registry.invoke(owner, discovered, { instanceId: instance.instanceId, actionName: 'crash' })).rejects.toThrow();
            expect(await registry.invoke(owner, discovered, { instanceId: instance.instanceId, actionName: 'increment' })).toBe(6);
            const recovered = await env(owner);
            pids.push(recovered.pid);
            expect(recovered.pid).not.toBe(a.pid);
            await expect(fetch(first.url!)).rejects.toThrow();
            await registry.stopConversation(owner, true);
            expect(() => process.kill(recovered.pid, 0)).toThrow();
            expect(await registry.invoke(sibling, discovered, { instanceId: instance.instanceId, actionName: 'increment' })).toBe(6);
            await registry.dispose();
            for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
        } finally {
            await Promise.all(registries.map(registry => registry.dispose()));
            await fs.rm(root, { recursive: true, force: true });
        }
    }, 20_000);
});
