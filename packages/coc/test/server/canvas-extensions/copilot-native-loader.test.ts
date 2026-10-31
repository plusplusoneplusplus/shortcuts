import fs from 'node:fs';
import * as os from 'os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopilotClient, RuntimeConnection, type SessionConfig } from '@github/copilot-sdk';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { RequestRunner } from '../../../../coc-agent-sdk/src/request-runner';
import { SessionManager } from '../../../../coc-agent-sdk/src/session-manager';
import { findCopilotNativeCliPath } from '../../../../coc-agent-sdk/src/sdk-client-factory';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { createCanvasUpdateNotifier } from '../../../src/server/canvas/canvas-update-notifier';
import { CanvasExtensionHost } from '../../../src/server/canvas-extensions/extension-host';
import { CanvasExtensionHostRegistry } from '../../../src/server/canvas-extensions/host-registry';
import { createCanvasExtensionTools } from '../../../src/server/llm-tools/canvas-extension-tools';
import { CANVAS_EXTENSION_LLM_TOOL_NAMES } from '../../../src/server/llm-tools/llm-tool-registry';
import recorded from '../../fixtures/canvas-extensions/copilot-cli-1.0.78-tools.json';

vi.mock('node:child_process', async importOriginal => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

vi.mock('../../../../coc-agent-sdk/src/sdk-client-factory', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../../coc-agent-sdk/src/sdk-client-factory')>();
    return { ...actual, findCopilotNativeCliPath: vi.fn(actual.findCopilotNativeCliPath) };
});

vi.mock('os', async importOriginal => {
    const actual = await importOriginal<typeof import('os')>();
    return { ...actual, homedir: vi.fn(actual.homedir) };
});

const runtimeEnabled = process.env.COC_CANVAS_COPILOT_RUNTIME === '1';
const names = [...CANVAS_EXTENSION_LLM_TOOL_NAMES];
const owner = { workspaceId: 'workspace-1', processId: 'conversation-1' };
const actions = [
    { name: 'list_canvas_capabilities', arguments: {} },
    { name: 'manage_canvas', arguments: { action: 'open', canvasId: 'workspace-1:counter/counter', instanceId: 'counter-instance' } },
    { name: 'invoke_canvas_action', arguments: { instanceId: 'counter-instance', actionName: 'increment' } },
    { name: 'manage_canvas', arguments: { action: 'close', instanceId: 'counter-instance' } },
];

describe('Copilot native canvas loader ownership', () => {
    let root: string, repo: string, home: string, starts: string;
    let hosts: CanvasExtensionHostRegistry;
    let tools: ReturnType<typeof createCanvasExtensionTools>;
    let startHost: ReturnType<typeof vi.fn>;
    let clients: CopilotClient[];

    beforeEach(() => {
        root = fs.mkdtempSync(path.resolve('.canvas-cli-'));
        repo = path.join(root, 'repo');
        home = path.join(root, 'home');
        starts = path.join(root, 'starts.jsonl');
        const folder = path.join(repo, '.github', 'extensions', 'counter');
        fs.mkdirSync(folder, { recursive: true });
        execFileSync('git', ['init', '--quiet', repo]);
        const fixture = fs.readFileSync(path.resolve('test/fixtures/canvas-extensions/minimal/extension.mjs'), 'utf8');
        fs.writeFileSync(path.join(folder, 'extension.mjs'),
            `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(starts)}, JSON.stringify({ pid: process.pid }) + '\\n');\n${fixture}`);
        vi.mocked(os.homedir).mockReturnValue(home);
        const config = () => ({ canvasExtensions: { enabled: true } });
        const store = {
            getWorkspaces: vi.fn(async () => [{ id: owner.workspaceId, rootPath: repo }]),
            getProcess: vi.fn(async (id, workspaceId) => ({ id, metadata: { workspaceId } })),
            emitProcessEvent: vi.fn(),
        } as unknown as ProcessStore;
        startHost = vi.fn(CanvasExtensionHost.start);
        hosts = new CanvasExtensionHostRegistry({ config, store, dataDir: root, startHost, log: vi.fn() });
        tools = createCanvasExtensionTools({
            ...owner, config, processStore: store, dataDir: root, hosts, canvasStore: new CanvasStore(root),
            notifier: createCanvasUpdateNotifier({ processStore: store }),
        });
        clients = [];
    });

    afterEach(async () => {
        const pids = fs.existsSync(starts)
            ? fs.readFileSync(starts, 'utf8').trim().split('\n').map(line => JSON.parse(line).pid as number)
            : [];
        await Promise.all(clients.map(client => client.stop()));
        await hosts.dispose();
        try {
            await vi.waitFor(() => {
                for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
            }, { timeout: 5000 });
        } finally {
            vi.restoreAllMocks();
            vi.unstubAllEnvs();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    function runtimeClient(copilotHome = path.join(home, '.copilot')) {
        const executable = findCopilotNativeCliPath();
        if (!executable) throw new Error('Pinned Copilot executable unavailable; use the recorded tool-list test in CI');
        expect(execFileSync(executable, ['--version'], {
            encoding: 'utf8', env: { ...process.env, COPILOT_AUTO_UPDATE: 'false' },
        })).toContain('1.0.78');
        const client = new CopilotClient({
            connection: RuntimeConnection.forStdio({ path: executable, args: [] }),
            workingDirectory: repo,
            env: {
                ...process.env, COPILOT_HOME: copilotHome, HOME: home, USERPROFILE: home,
                COPILOT_AUTO_UPDATE: 'false',
            },
            logLevel: 'error',
        });
        clients.push(client);
        return client;
    }

    function sessionConfig(baseUrl = 'http://127.0.0.1:1/v1'): SessionConfig {
        return {
            model: 'fixture-model', onPermissionRequest: () => ({ kind: 'approved' }),
            provider: { type: 'openai', baseUrl, apiKey: 'fixture', wireApi: 'completions' },
        };
    }

    function assertInventory(inventory: { tools: { name: string; source: string }[] }) {
        expect(inventory.tools.map(tool => tool.name).sort()).toEqual([...recorded.cocOwned].sort());
        for (const name of names) {
            expect(inventory.tools.filter(tool => tool.name === name)).toMatchObject([{ name, source: 'coc' }]);
        }
        expect(inventory.tools.some(tool => tool.name.startsWith('extensions_'))).toBe(false);
    }

    it.each([undefined, 'true'])('disables updates for the version probe when the shell value is %s', shellValue => {
        vi.stubEnv('COPILOT_AUTO_UPDATE', shellValue);
        vi.stubEnv('COPILOT_PROBE_SENTINEL', 'preserved');
        const executable = path.join(root, 'copilot');
        vi.mocked(findCopilotNativeCliPath).mockReturnValueOnce(executable);
        vi.mocked(execFileSync).mockImplementationOnce((_file, _args, options) =>
            options && typeof options === 'object' && options.env?.COPILOT_AUTO_UPDATE === 'false'
                ? '1.0.78' : '1.0.96-2');

        runtimeClient();

        expect(execFileSync).toHaveBeenLastCalledWith(executable, ['--version'], {
            encoding: 'utf8',
            env: expect.objectContaining({ COPILOT_AUTO_UPDATE: 'false', COPILOT_PROBE_SENTINEL: 'preserved' }),
        });
        expect(process.env.COPILOT_AUTO_UPDATE).toBe(shellValue);
    });

    it('replays the recorded pinned tool list with one real CoC extension process', async () => {
        const session = {
            sessionId: 'recorded-session', disconnect: vi.fn(),
            rpc: { tools: {
                initializeAndValidate: vi.fn(async () => ({})),
                getCurrentMetadata: vi.fn(async () => ({ tools: recorded.cocOwned.map(name => ({ name })) })),
            } },
            sendAndWait: vi.fn(async () => {
                for (const action of actions) {
                    const result = await tools.find(tool => tool.name === action.name)!.handler(action.arguments) as any;
                    expect(result.success).toBe(true);
                }
                return { data: { content: 'Canvas ready' } };
            }),
        };
        const client = {
            createSession: vi.fn(async (config: SessionConfig) => {
                expect(config).not.toHaveProperty('requestExtensions');
                expect(config).not.toHaveProperty('requestCanvasRenderer');
                expect(config).not.toHaveProperty('enableConfigDiscovery');
                expect(config.tools).toBe(tools);
                return session;
            }),
            stop: vi.fn(),
        } as unknown as CopilotClient;
        const runner = new RequestRunner(async () => ({ available: true }), async () => client, new SessionManager());
        const result = await runner.send({
            client, prompt: 'List, open, increment and close the counter', tools,
            workingDirectory: repo, loadDefaultMcpConfig: false, onToolInventory: assertInventory,
        });
        expect(result, result.error).toMatchObject({ success: true, response: 'Canvas ready' });
        expect(startHost).toHaveBeenCalledOnce();
        expect(fs.readFileSync(starts, 'utf8').trim().split('\n')).toHaveLength(1);
    });

    it.skipIf(!runtimeEnabled)('runs an actual Copilot turn with only CoC canvas tools and one extension', async () => {
        let requests = 0;
        const modelTools: string[][] = [];
        const server = createServer(async (request, response) => {
            let body = '';
            for await (const chunk of request) body += chunk;
            const input = JSON.parse(body);
            modelTools.push(input.tools.map((tool: any) => tool.function.name));
            const action = actions[requests++];
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
                id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture-model',
                choices: [{
                    index: 0, finish_reason: action ? 'tool_calls' : 'stop',
                    message: action ? {
                        role: 'assistant', content: null,
                        tool_calls: [{ id: `call_${requests}`, type: 'function', function: {
                            name: action.name, arguments: JSON.stringify(action.arguments),
                        } }],
                    } : { role: 'assistant', content: 'Canvas ready' },
                }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }));
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing fixture address');
        try {
            const client = runtimeClient();
            const create = client.createSession.bind(client);
            vi.spyOn(client, 'createSession').mockImplementation(config => create({
                ...sessionConfig(`http://127.0.0.1:${address.port}/v1`), ...config,
            }));
            let inventorySeen = false;
            const runner = new RequestRunner(async () => ({ available: true }), async () => client, new SessionManager());
            const result = await runner.send({
                client, prompt: 'List, open, increment and close the counter', tools,
                workingDirectory: repo, loadDefaultMcpConfig: false, timeoutMs: 30000,
                onPermissionRequest: () => ({ kind: 'approved' }),
                onToolInventory: inventory => { assertInventory(inventory); inventorySeen = true; },
            });
            expect(result, result.error).toMatchObject({ success: true, response: 'Canvas ready' });
            expect(inventorySeen).toBe(true);
            expect(requests).toBe(5);
            for (const advertised of modelTools) {
                expect(advertised.sort()).toEqual([...recorded.cocOwned].sort());
                expect(advertised.filter(name => name === 'list_canvas_capabilities')).toHaveLength(1);
            }
            expect(startHost).toHaveBeenCalledOnce();
            expect(fs.readFileSync(starts, 'utf8').trim().split('\n')).toHaveLength(1);
        } finally {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    it.skipIf(!runtimeEnabled).each([
        { source: 'repo', renderer: false },
        { source: 'repo', renderer: true },
        { source: 'user', renderer: false },
        { source: 'user', renderer: true },
    ])('proves native $source loading is independent of renderer=$renderer', async ({ source, renderer }) => {
        if (source === 'user') {
            const target = path.join(home, '.copilot', 'extensions');
            fs.mkdirSync(target, { recursive: true });
            fs.renameSync(path.join(repo, '.github', 'extensions', 'counter'), path.join(target, 'counter'));
        }
        const client = runtimeClient();
        const optedOut = await client.createSession({
            ...sessionConfig(), requestCanvasRenderer: renderer,
        });
        try {
            await optedOut.rpc.tools.initializeAndValidate();
            const metadata = await optedOut.rpc.tools.getCurrentMetadata();
            expect(metadata.tools.some(tool => tool.name.startsWith('extensions_'))).toBe(false);
            expect(metadata.tools.some(tool => tool.name === 'list_canvas_capabilities')).toBe(renderer);
            expect(fs.existsSync(starts)).toBe(false);
        } finally {
            await optedOut.disconnect();
        }
        const session = await client.createSession({
            ...sessionConfig(), requestExtensions: true, requestCanvasRenderer: renderer,
        });
        try {
            await vi.waitFor(() => expect(fs.existsSync(starts)).toBe(true), { timeout: 10000 });
            await vi.waitFor(async () => {
                await session.rpc.tools.initializeAndValidate();
                const metadata = await session.rpc.tools.getCurrentMetadata();
                expect(metadata.tools.map(tool => tool.name).sort()).toEqual([
                    ...(renderer ? recorded.nativeWithRenderer : recorded.nativeWithoutRenderer),
                ].sort());
            }, { timeout: 10000 });
            expect(startHost).not.toHaveBeenCalled();
            expect(fs.readFileSync(starts, 'utf8').trim().split('\n')).toHaveLength(1);
        } finally {
            await session.disconnect();
        }
    });

    it.skipIf(!runtimeEnabled)('loads native user extensions only from the overridden COPILOT_HOME', async () => {
        const target = path.join(home, '.copilot', 'extensions');
        fs.mkdirSync(target, { recursive: true });
        fs.renameSync(path.join(repo, '.github', 'extensions', 'counter'), path.join(target, 'counter'));
        const isolatedHome = path.join(root, 'isolated-copilot-home');
        const client = runtimeClient(isolatedHome);
        const session = await client.createSession({
            ...sessionConfig(), requestExtensions: true,
        });
        try {
            await session.rpc.tools.initializeAndValidate();
            expect(fs.existsSync(starts)).toBe(false);
        } finally {
            await session.disconnect();
        }
        fs.mkdirSync(path.join(isolatedHome, 'extensions'), { recursive: true });
        fs.renameSync(path.join(target, 'counter'), path.join(isolatedHome, 'extensions', 'counter'));
        const isolatedSession = await client.createSession({
            ...sessionConfig(), requestExtensions: true,
        });
        try {
            await vi.waitFor(() => expect(fs.existsSync(starts)).toBe(true), { timeout: 10000 });
            expect(fs.readFileSync(starts, 'utf8').trim().split('\n')).toHaveLength(1);
        } finally {
            await isolatedSession.disconnect();
        }
    });
});
