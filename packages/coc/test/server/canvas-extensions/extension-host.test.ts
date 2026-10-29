import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CanvasExtensionHost, type CanvasExtensionHostOptions } from '../../../src/server/canvas-extensions/extension-host';

describe('CanvasExtensionHost with the installed SDK', () => {
    let root: string;
    let options: CanvasExtensionHostOptions;
    const hosts: CanvasExtensionHost[] = [];
    const instance = { canvasId: 'counter', instanceId: 'instance-1' };

    beforeEach(async () => {
        // Outside the repository, with spaces: the resolver must supply CoC's SDK over file URLs.
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'coc canvas host '));
        const cwd = path.join(root, 'repo');
        const folder = path.join(cwd, '.github', 'extensions', 'counter');
        await fs.mkdir(folder, { recursive: true });
        const extensionPath = path.join(folder, 'extension.mjs');
        await fs.copyFile(path.resolve('test/fixtures/canvas-extensions/minimal/extension.mjs'), extensionPath);
        // A broken extension-local copy must never supersede CoC's installed pin, for root or subpath imports.
        const shadow = path.join(folder, 'node_modules', '@github', 'copilot-sdk');
        await fs.mkdir(shadow, { recursive: true });
        await fs.writeFile(path.join(shadow, 'package.json'), JSON.stringify({
            name: '@github/copilot-sdk', type: 'module', exports: { '.': './bad.mjs', './extension': './bad.mjs' },
        }));
        await fs.writeFile(path.join(shadow, 'bad.mjs'), "throw new Error('Wrong SDK loaded');");
        options = {
            config: { canvasExtensions: { enabled: true } },
            extension: { extensionKey: 'member:counter', name: 'counter', ownerWorkspaceId: 'member',
                extensionPath, cwd, contentHash: 'fixture' },
            processId: 'conversation-1', dataDir: path.join(root, 'data'), log: vi.fn(),
            send: vi.fn(async () => ({ messageId: 'follow-up-1' })),
            ephemeralQuery: vi.fn(async () => ({ answer: 'One' })), timeoutMs: 10_000,
        };
    });

    afterEach(async () => {
        await Promise.all(hosts.splice(0).map(host => host.dispose()));
        await fs.rm(root, { recursive: true, force: true });
        vi.unstubAllEnvs();
    });

    async function start(overrides: Partial<CanvasExtensionHostOptions> = {}) {
        const host = await CanvasExtensionHost.start({ ...options, ...overrides });
        hosts.push(host);
        return host;
    }

    it('handshakes, captures declarations, opens HTTP, invokes state mutation and closes the server', async () => {
        const host = await start();
        expect(host.declarations).toEqual([expect.objectContaining({
            id: 'counter', displayName: 'Counter', actions: expect.arrayContaining([{ name: 'increment' }]),
        })]);
        const opened = await host.open({ ...instance, input: { count: 5 } });
        expect(opened.title).toBe('Counter');
        expect(new URL(opened.url!).hostname).toBe('127.0.0.1');
        expect(await (await fetch(opened.url!)).json()).toEqual({ count: 5 });
        expect(await host.invoke({ ...instance, actionName: 'increment' })).toBe(6);
        expect(await (await fetch(`${opened.url!}state`)).json()).toEqual({ count: 6 });
        expect(await host.open(instance)).toEqual(opened);
        await host.close(instance);
        await expect(fetch(opened.url!)).rejects.toThrow();
    });

    it('passes the owning cwd and isolated home without requiring a Copilot CLI or token', async () => {
        vi.stubEnv('COPILOT_HOME', path.join(root, 'ambient-home'));
        vi.stubEnv('ELECTRON_RUN_AS_NODE', undefined);
        const host = await start();
        expect(await host.invoke({ ...instance, actionName: 'environment' })).toEqual({
            sessionId: options.processId, home: path.join(options.dataDir, 'canvas-ext', 'home'),
            cwd: options.extension.cwd, pid: expect.any(Number), rootImport: 'function',
        });
        expect(await host.invoke({ ...instance, actionName: 'ping' })).toEqual({ protocolVersion: expect.any(Number) });
    });

    it('adds ELECTRON_RUN_AS_NODE under Electron', async () => {
        Object.defineProperty(process.versions, 'electron', { value: 'test', configurable: true });
        try {
            const host = await start();
            expect(await host.invoke({ ...instance, actionName: 'environment' })).toMatchObject({ electron: '1' });
        } finally { delete process.versions.electron; }
    });

    it('returns CanvasError details across the real SDK transport', async () => {
        const host = await start();
        await expect(host.invoke({ ...instance, actionName: 'error' })).rejects.toMatchObject({
            data: { code: 'counter_error', message: 'Counter failed' },
        });
    });

    it('dispatches supported callbacks and prefixes session logs and stderr', async () => {
        const host = await start();
        expect(await host.invoke({ ...instance, actionName: 'callbacks' })).toEqual({
            messageId: 'follow-up-1', answer: 'One', eventId: expect.any(String),
        });
        expect(options.send).toHaveBeenCalledExactlyOnceWith('hi');
        expect(options.ephemeralQuery).toHaveBeenCalledExactlyOnceWith('How many?');
        expect(options.log).toHaveBeenCalledWith('[canvas-extension member:counter] Fixture message');
        await vi.waitFor(() => expect(options.log).toHaveBeenCalledWith('[canvas-extension member:counter] fixture stderr'));
    });

    it('returns MethodNotFound and logs once per extension and method across runtimes', async () => {
        const host = await start();
        const sibling = await start({ processId: 'conversation-2' });
        for (const runtime of [host, sibling]) {
            expect(await runtime.invoke({ ...instance, actionName: 'unknown' })).toEqual([-32601, -32601]);
        }
        expect(options.log).toHaveBeenCalledExactlyOnceWith(
            '[canvas-extension member:counter] Unsupported JSON-RPC method: fixture.unsupported',
        );
    });

    it('rejects callbacks targeting a sibling conversation', async () => {
        const host = await start();
        expect(await host.invoke({ ...instance, actionName: 'wrong-session' })).toBe(-32602);
        expect(options.send).not.toHaveBeenCalled();
    });

    it('refuses to execute an extension while disabled', async () => {
        await fs.writeFile(options.extension.extensionPath, "throw new Error('Must not execute');");
        await expect(start({ config: { canvasExtensions: { enabled: false } } })).rejects.toThrow('disabled');
        expect(options.log).not.toHaveBeenCalled();
    });

    it('reports early exit and spawn errors without waiting for the startup deadline', async () => {
        await fs.writeFile(options.extension.extensionPath, 'process.exit(12);');
        await expect(start()).rejects.toThrow(/exited|closed/);
        options.extension.cwd = path.join(root, 'missing');
        await expect(start()).rejects.toThrow(/ENOENT/);
    });

    it('bounds startup and kills a runtime that never joins', async () => {
        await fs.writeFile(options.extension.extensionPath, 'setInterval(() => {}, 1000);');
        await expect(start({ timeoutMs: 100 })).rejects.toThrow('timed out');
    });

    it('rejects pending calls on crash and marks the runtime stopped', async () => {
        const host = await start();
        await expect(host.invoke({ ...instance, actionName: 'crash' })).rejects.toThrow();
        expect(host.running).toBe(false);
        await expect(host.open(instance)).rejects.toThrow('not running');
    });

    it('bounds hung requests and waits for child termination on dispose', async () => {
        const host = await start({ timeoutMs: 2000 });
        const environment = await host.invoke({ ...instance, actionName: 'environment' }) as { pid: number };
        await expect(host.invoke({ ...instance, actionName: 'hang' })).rejects.toThrow('timed out');
        await host.dispose();
        await host.dispose();
        expect(host.running).toBe(false);
        expect(() => process.kill(environment.pid, 0)).toThrow();
    });
});
