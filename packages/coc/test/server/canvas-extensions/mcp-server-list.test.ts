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
import { createRuntimeToolInventory } from '@plusplusoneplusplus/coc-agent-sdk';
import { CanvasExtensionHostRegistry } from '../../../src/server/canvas-extensions/host-registry';
import { listCanvasMcpServers } from '../../../src/server/canvas-extensions/mcp-server-list';
import { getCanvasToolMetadata } from '../../../src/server/canvas-extensions/tool-metadata';
import { ConversationToolInventoryStore } from '../../../src/server/storage/conversation-tool-inventory-store';
import type { DiscoveredCanvasExtension } from '../../../src/server/canvas-extensions/discovery';

// The repository's own .github/extensions/mcp-server-list, run against a fake Copilot CLI parent and the CoC host.
const repoRoot = path.resolve(__dirname, '../../../../..');
const extensionPath = path.join(repoRoot, '.github', 'extensions', 'mcp-server-list', 'extension.mjs');
const instance = { canvasId: 'mcp-server-list', instanceId: 'instance-1' };
const groupedTools = {
    initialized: true,
    builtin: [{ name: 'bash', description: 'Run a shell command' }, { name: 'ask_user', description: 'Ask the user' }],
    mcp: { github: [{ name: 'github-search', description: 'Search GitHub' }] },
};

describe('mcp-server-list canvas extension', () => {
    describe('under a Copilot CLI parent that answers session.mcp.list and session.tools.*', () => {
        let child: ChildProcessWithoutNullStreams;
        let connection: MessageConnection;
        let toolsInitialized: boolean;
        const base = { sessionId: 's1', extensionId: 'x', session: { workingDirectory: repoRoot } };

        beforeEach(async () => {
            child = spawn(process.execPath, [extensionPath], {
                cwd: repoRoot, env: { ...process.env, SESSION_ID: 's1' }, stdio: ['pipe', 'pipe', 'pipe'],
            });
            connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
            toolsInitialized = false;
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
                if (method === 'session.tools.initializeAndValidate') {
                    toolsInitialized = true;
                    return {};
                }
                if (method === 'session.tools.getCurrentMetadata') {
                    return { tools: toolsInitialized ? [
                        { name: 'bash', description: 'Run a shell command', input_schema: { type: 'object' } },
                        { name: 'github-search', description: 'Search GitHub', mcpServerName: 'github', mcpToolName: 'search' },
                        { name: 'ask_user', description: 'Ask the user' },
                    ] : null };
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

        it('initializes tools when needed and groups them into built-in and per-server MCP', async () => {
            await expect(connection.sendRequest('canvas.action.invoke', {
                ...base, ...instance, actionName: 'list_tools', input: {},
            })).resolves.toEqual(groupedTools);
            expect(toolsInitialized).toBe(true);

            const opened = await connection.sendRequest<{ url: string }>('canvas.open', { ...base, ...instance });
            await expect((await fetch(`${opened.url}tools`)).json()).resolves.toEqual(groupedTools);
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
        let inventory: ConversationToolInventoryStore;

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
            inventory = new ConversationToolInventoryStore(store.getDatabase());
            hosts = new CanvasExtensionHostRegistry({
                config: () => ({ canvasExtensions: { enabled: true } }), store, dataDir: root, log: vi.fn(),
                listMcpServers: owner => listCanvasMcpServers({ store, dataDir: root, workspaceId: owner.workspaceId }),
                getToolMetadata: owner => getCanvasToolMetadata(inventory, owner),
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

        it('reports tools as not initialized before the first turn, then groups the captured inventory', async () => {
            await hosts.open(owner, extension, instance);
            const listTools = () => hosts.invoke(owner, extension, { instanceId: instance.instanceId, actionName: 'list_tools' });
            await expect(listTools()).resolves.toEqual({ initialized: false, builtin: [], mcp: {} });

            const turn = inventory.beginTurn(owner.workspaceId, owner.processId, 'copilot', 0);
            await expect(listTools()).resolves.toEqual({ initialized: false, builtin: [], mcp: {} });
            inventory.record(turn, createRuntimeToolInventory('copilot', [
                { name: 'bash', source: 'builtin', description: 'Run a shell command', inputSchema: { type: 'object' } },
                { name: 'github-search', source: 'mcp', serverName: 'github', description: 'Search GitHub' },
                { name: 'ask_user', source: 'coc', description: 'Ask the user' },
            ], [
                { source: 'builtin', status: 'complete' }, { source: 'coc', status: 'complete' }, { source: 'mcp', status: 'complete' },
            ]));
            await expect(listTools()).resolves.toEqual(groupedTools);
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
