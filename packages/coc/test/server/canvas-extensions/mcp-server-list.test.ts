import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import {
    createMessageConnection, ErrorCodes, ResponseError, StreamMessageReader, StreamMessageWriter,
    type MessageConnection,
} from 'vscode-jsonrpc/node';
import { setHomeDirectoryOverride, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { CanvasExtensionHostRegistry } from '../../../src/server/canvas-extensions/host-registry';
import { listCanvasMcpServers } from '../../../src/server/canvas-extensions/mcp-server-list';
import type { DiscoveredCanvasExtension } from '../../../src/server/canvas-extensions/discovery';

// The repository's own .github/extensions/mcp-server-list, run against a fake Copilot CLI parent and the CoC host.
const repoRoot = path.resolve(__dirname, '../../../../..');
const extensionPath = path.join(repoRoot, '.github', 'extensions', 'mcp-server-list', 'extension.mjs');
const instance = { canvasId: 'mcp-server-list', instanceId: 'instance-1' };

describe('mcp-server-list canvas extension', () => {
    describe('under a Copilot CLI parent that answers session.mcp.list', () => {
        let child: ChildProcessWithoutNullStreams;
        let connection: MessageConnection;
        const base = { sessionId: 's1', extensionId: 'x', session: { workingDirectory: repoRoot } };

        beforeEach(async () => {
            child = spawn(process.execPath, [extensionPath], {
                cwd: repoRoot, env: { ...process.env, SESSION_ID: 's1' }, stdio: ['pipe', 'pipe', 'pipe'],
            });
            connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
            let resumed!: () => void;
            const ready = new Promise<void>(resolve => { resumed = resolve; });
            connection.onRequest((method, params: { sessionId?: string }) => {
                if (method === 'connect' || method === 'ping') {
                    const sdkRequire = createRequire(path.join(repoRoot, 'package.json'));
                    const sdkDirectory = path.dirname(sdkRequire.resolve('@github/copilot-sdk'));
                    return { protocolVersion: sdkRequire(path.join(sdkDirectory, 'sdkProtocolVersion.js')).getSdkProtocolVersion() };
                }
                if (method === 'session.resume') {
                    resumed();
                    return { sessionId: 's1', capabilities: {}, workspacePath: tmpdir() };
                }
                if (method === 'session.mcp.list') {
                    expect(params.sessionId).toBe('s1');
                    return { servers: [
                        { name: 'github', status: 'connected', source: 'user' },
                        { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
                    ] };
                }
                throw new ResponseError(ErrorCodes.MethodNotFound, `Method not found: ${method}`);
            });
            connection.listen();
            await ready;
        });

        afterEach(() => {
            connection.dispose();
            child.kill();
        });

        it('returns the session MCP servers from the action and the page', async () => {
            const expected = { servers: [
                { name: 'github', status: 'connected', source: 'user' },
                { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
            ] };
            await expect(connection.sendRequest('canvas.action.invoke', {
                ...base, ...instance, actionName: 'list_servers', input: {},
            })).resolves.toEqual(expected);

            const opened = await connection.sendRequest<{ url: string }>('canvas.open', { ...base, ...instance });
            expect(new URL(opened.url).hostname).toBe('127.0.0.1');
            const html = await (await fetch(opened.url)).text();
            expect(() => new vm.Script(/<script>([\s\S]*)<\/script>/.exec(html)![1])).not.toThrow();
            await expect((await fetch(`${opened.url}servers`)).json()).resolves.toEqual(expected);
            await connection.sendRequest('canvas.close', { ...base, ...instance });
        });
    });

    describe('under the CoC host', () => {
        const owner = { workspaceId: 'workspace-a', processId: 'mcp-list-chat' };
        const extension: DiscoveredCanvasExtension = { extensionKey: 'workspace-a:mcp-server-list', ownerWorkspaceId: owner.workspaceId,
            name: 'mcp-server-list', extensionPath, cwd: repoRoot, contentHash: 'test' };
        let root: string;
        let store: SqliteProcessStore;
        let hosts: CanvasExtensionHostRegistry;

        beforeEach(async () => {
            root = await mkdtemp(path.join(tmpdir(), 'mcp-server-list-'));
            const home = path.join(root, 'home');
            const repo = path.join(root, owner.workspaceId);
            await mkdir(path.join(home, '.copilot'), { recursive: true });
            await mkdir(path.join(repo, '.vscode'), { recursive: true });
            // Secrets in the config must never reach the extension.
            await writeFile(path.join(home, '.copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: {
                globalTool: { command: 'global-bin', env: { TOKEN: 'secret-global' } },
                turnedOff: { command: 'off-bin' },
            } }));
            await writeFile(path.join(repo, '.vscode', 'mcp.json'), JSON.stringify({ servers: {
                repoTool: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'secret-header' } },
            } }));
            setHomeDirectoryOverride(home);
            store = new SqliteProcessStore({ dbPath: ':memory:' });
            await store.registerWorkspace({ id: owner.workspaceId, name: owner.workspaceId, rootPath: repo,
                enabledMcpServers: ['globalTool', 'repoTool'] });
            await store.addProcess({ id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
                promptPreview: 'MCP list', workingDirectory: repo,
                metadata: { workspaceId: owner.workspaceId, mode: 'ask', provider: 'copilot' } });
            hosts = new CanvasExtensionHostRegistry({
                config: () => ({ canvasExtensions: { enabled: true } }), store, dataDir: root, log: vi.fn(),
                listMcpServers: owner => listCanvasMcpServers({ store, dataDir: root, workspaceId: owner.workspaceId }),
            });
        });

        afterEach(async () => {
            await hosts.dispose();
            store.close();
            setHomeDirectoryOverride(null);
            await rm(root, { recursive: true, force: true });
        });

        const expected = { servers: [
            { name: 'globalTool', status: 'pending', source: 'user' },
            { name: 'turnedOff', status: 'disabled', source: 'user' },
            { name: 'repoTool', status: 'pending', source: 'workspace' },
        ] };

        it('answers session.mcp.list from the owner workspace config without leaking it', async () => {
            const opened = await hosts.open(owner, extension, instance) as { url: string };
            const html = await (await fetch(opened.url)).text();
            expect(() => new vm.Script(/<script>([\s\S]*)<\/script>/.exec(html)![1])).not.toThrow();

            const response = await fetch(`${opened.url}servers`);
            expect(response.status).toBe(200);
            const body = await response.text();
            expect(JSON.parse(body)).toEqual(expected);
            expect(body).not.toMatch(/secret|global-bin|example\.test/);
            await expect(hosts.invoke(owner, extension, { instanceId: instance.instanceId, actionName: 'list_servers' }))
                .resolves.toEqual(expected);
        });

        it('rejects the list once the owner conversation is archived', async () => {
            await hosts.open(owner, extension, instance);
            const archived = { ...(await store.getProcess(owner.processId, owner.workspaceId))!, archived: true };
            vi.spyOn(store, 'getProcess').mockResolvedValue(archived);
            await expect(hosts.invoke(owner, extension, { instanceId: instance.instanceId, actionName: 'list_servers' }))
                .rejects.toThrow('archived');
        });
    });
});
