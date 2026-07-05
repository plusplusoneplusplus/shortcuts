import { afterEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import { CocToolRuntime } from '../../src/llm-tools/coc-tool-runtime';
import { CocToolBridgeServer } from '../../src/llm-tools/bridge-server';
import {
    createBridgeHandlers,
    createHttpTransport,
    runBridge,
} from '../../src/llm-tools/bridge';
import {
    buildCocLlmToolsMcpConfig,
    resolveCocLlmToolsBridgePath,
    setCocLlmToolsBridgePath,
    COC_LLM_TOOLS_ENDPOINT_ENV,
    COC_LLM_TOOLS_TOKEN_ENV,
    COC_LLM_TOOLS_MCP_SERVER_NAME,
} from '../../src/llm-tools/mcp-config';
import type { Tool } from '../../src/types';

function tool(name: string, handler: Tool<any>['handler']): Tool<any> {
    return {
        name,
        description: `desc ${name}`,
        parameters: { type: 'object', properties: { x: { type: 'string' } } },
        handler,
    } as Tool<any>;
}

/** Minimal raw POST helper that returns { status, json }. */
function postJson(endpoint: string, path: string, token: string | undefined, body: unknown): Promise<{ status: number; json: any }> {
    const base = new URL(endpoint);
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    return new Promise((resolve, reject) => {
        const headers: Record<string, string | number> = {
            'content-type': 'application/json',
            'content-length': payload.length,
        };
        if (token) headers.authorization = `Bearer ${token}`;
        const req = http.request({ hostname: base.hostname, port: base.port, path, method: 'POST', headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : undefined });
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

describe('CocToolBridgeServer', () => {
    let server: CocToolBridgeServer | undefined;

    afterEach(() => {
        server?.closeAll();
        server = undefined;
    });

    it('exposes only the enabled tools the runtime was constructed with', async () => {
        server = new CocToolBridgeServer();
        const runtime = new CocToolRuntime([
            tool('ask_user', async () => 'a'),
            tool('search_conversations', async () => 'b'),
        ]);
        const reg = await server.register(runtime);

        const res = await postJson(reg.endpoint, '/list', reg.token, {});
        expect(res.status).toBe(200);
        const names = res.json.tools.map((t: { name: string }) => t.name).sort();
        expect(names).toEqual(['ask_user', 'search_conversations']);
        expect(res.json.tools[0]).toHaveProperty('inputSchema.type', 'object');
    });

    it('routes /call to the original handler with the provided arguments', async () => {
        server = new CocToolBridgeServer();
        const handler = vi.fn(async (args: { title?: string }) => `created ${args.title}`);
        const runtime = new CocToolRuntime([tool('create_update_work_item', handler as Tool<any>['handler'])], {
            workspaceId: 'ws-1',
            processId: 'proc-1',
        });
        const reg = await server.register(runtime);

        const res = await postJson(reg.endpoint, '/call', reg.token, { name: 'create_update_work_item', arguments: { title: 'Hi' } });
        expect(res.status).toBe(200);
        expect(res.json).toEqual({ content: [{ type: 'text', text: 'created Hi' }], isError: false });
        expect(handler).toHaveBeenCalledWith({ title: 'Hi' }, expect.objectContaining({ toolName: 'create_update_work_item' }));
    });

    it('blocks /call until a deferred (ask_user) handler resolves, then returns the answer', async () => {
        server = new CocToolBridgeServer();
        let resolveAnswer!: (value: unknown) => void;
        const pending = new Promise(resolve => { resolveAnswer = resolve; });
        const runtime = new CocToolRuntime([tool('ask_user', async () => pending)]);
        const reg = await server.register(runtime);

        const callPromise = postJson(reg.endpoint, '/call', reg.token, { name: 'ask_user', arguments: { questions: [] } });

        let settled = false;
        void callPromise.then(() => { settled = true; });
        await new Promise(r => setTimeout(r, 30));
        expect(settled).toBe(false); // still awaiting the user

        resolveAnswer([{ questionId: 'q1', answer: 'yes', skipped: false }]);
        const res = await callPromise;
        expect(res.status).toBe(200);
        expect(res.json.isError).toBe(false);
        expect(JSON.parse(res.json.content[0].text)).toEqual([{ questionId: 'q1', answer: 'yes', skipped: false }]);
    });

    it('rejects requests with an unknown/missing token', async () => {
        server = new CocToolBridgeServer();
        const reg = await server.register(new CocToolRuntime([tool('ask_user', async () => 'a')]));

        const bad = await postJson(reg.endpoint, '/list', 'not-a-real-token', {});
        expect(bad.status).toBe(401);
        const missing = await postJson(reg.endpoint, '/list', undefined, {});
        expect(missing.status).toBe(401);
    });

    it('isolates runtimes by token (one token cannot see another runtime tools)', async () => {
        server = new CocToolBridgeServer();
        const regA = await server.register(new CocToolRuntime([tool('only_a', async () => 'a')]));
        const regB = await server.register(new CocToolRuntime([tool('only_b', async () => 'b')]));

        const listA = await postJson(regA.endpoint, '/list', regA.token, {});
        const listB = await postJson(regB.endpoint, '/list', regB.token, {});
        expect(listA.json.tools.map((t: { name: string }) => t.name)).toEqual(['only_a']);
        expect(listB.json.tools.map((t: { name: string }) => t.name)).toEqual(['only_b']);
    });

    it('reference-counts and tears down when the last runtime unregisters', async () => {
        server = new CocToolBridgeServer();
        const regA = await server.register(new CocToolRuntime([tool('a', async () => 'a')]));
        const regB = await server.register(new CocToolRuntime([tool('b', async () => 'b')]));
        expect(server.activeCount).toBe(2);
        expect(server.endpoint).not.toBeNull();

        regA.unregister();
        expect(server.activeCount).toBe(1);
        expect(server.endpoint).not.toBeNull(); // still serving regB

        regB.unregister();
        expect(server.activeCount).toBe(0);
        expect(server.endpoint).toBeNull(); // torn down
    });

    it('works end-to-end through the bridge HTTP transport', async () => {
        server = new CocToolBridgeServer();
        const runtime = new CocToolRuntime([tool('echo', async (a: { v?: string }) => `echo:${a.v}`)]);
        const reg = await server.register(runtime);

        const transport = createHttpTransport(reg.endpoint, reg.token);
        const list = await transport('/list', {}) as { tools: { name: string }[] };
        expect(list.tools.map(t => t.name)).toEqual(['echo']);
        const call = await transport('/call', { name: 'echo', arguments: { v: 'hi' } });
        expect(call).toEqual({ content: [{ type: 'text', text: 'echo:hi' }], isError: false });
    });
});

describe('bridge JSON-RPC handlers', () => {
    it('answers initialize echoing the requested protocol version', async () => {
        const { handleMessage } = createBridgeHandlers({ transport: vi.fn() });
        const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
        expect(res).toMatchObject({
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'coc-llm-tools' } },
        });
    });

    it('returns null for notifications (no id)', async () => {
        const { handleMessage } = createBridgeHandlers({ transport: vi.fn() });
        const res = await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
        expect(res).toBeNull();
    });

    it('proxies tools/list to the transport', async () => {
        const transport = vi.fn(async () => ({ tools: [{ name: 'ask_user', description: '', inputSchema: { type: 'object' } }] }));
        const { handleMessage } = createBridgeHandlers({ transport });
        const res = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
        expect(transport).toHaveBeenCalledWith('/list', {});
        expect((res as any).result.tools).toHaveLength(1);
    });

    it('proxies tools/call to the transport and returns the CallToolResult', async () => {
        const transport = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }));
        const { handleMessage } = createBridgeHandlers({ transport });
        const res = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ask_user', arguments: { q: 1 } } });
        expect(transport).toHaveBeenCalledWith('/call', { name: 'ask_user', arguments: { q: 1 } });
        expect((res as any).result).toEqual({ content: [{ type: 'text', text: 'ok' }], isError: false });
    });

    it('surfaces a transport failure on tools/call as an isError result (not a protocol error)', async () => {
        const transport = vi.fn(async () => { throw new Error('connection refused'); });
        const { handleMessage } = createBridgeHandlers({ transport });
        const res = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ask_user' } });
        expect((res as any).error).toBeUndefined();
        expect((res as any).result.isError).toBe(true);
        expect((res as any).result.content[0].text).toContain('connection refused');
    });

    it('returns method-not-found for unknown methods', async () => {
        const { handleMessage } = createBridgeHandlers({ transport: vi.fn() });
        const res = await handleMessage({ jsonrpc: '2.0', id: 5, method: 'resources/list' });
        expect((res as any).error.code).toBe(-32601);
    });

    it('runBridge reads newline-delimited messages and writes responses', async () => {
        const { Readable, Writable } = await import('stream');
        const written: string[] = [];
        const stdout = new Writable({
            write(chunk, _enc, cb) { written.push(chunk.toString()); cb(); },
        });
        const stdin = new Readable({ read() {} });
        runBridge({ transport: vi.fn(async () => ({ tools: [] })), stdin, stdout });

        stdin.push(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
        stdin.push(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        stdin.push(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
        await new Promise(r => setTimeout(r, 30));

        const responses = written.join('').trim().split('\n').map(l => JSON.parse(l));
        // initialize + tools/list answered; notification produced no output.
        expect(responses.map(r => r.id)).toEqual([1, 2]);
    });
});

describe('buildCocLlmToolsMcpConfig', () => {
    const hadElectron = 'electron' in process.versions;
    const originalElectron = (process.versions as { electron?: string }).electron;

    const setElectron = (version: string | undefined) => {
        if (version === undefined) {
            delete (process.versions as { electron?: string }).electron;
        } else {
            (process.versions as { electron?: string }).electron = version;
        }
    };

    afterEach(() => {
        setCocLlmToolsBridgePath(undefined);
        delete process.env.COC_LLM_TOOLS_BRIDGE_PATH;
        // Restore the real Electron marker (absent under a plain-node vitest run).
        setElectron(hadElectron ? originalElectron : undefined);
    });

    it('produces a stdio server spec with endpoint+token env vars', () => {
        const config = buildCocLlmToolsMcpConfig({ endpoint: 'http://127.0.0.1:5000', token: 'tok123', bridgePath: '/x/bridge.js' });
        expect(config.command).toBe(process.execPath);
        expect(config.args).toEqual(['/x/bridge.js']);
        expect(config.env).toEqual({
            [COC_LLM_TOOLS_ENDPOINT_ENV]: 'http://127.0.0.1:5000',
            [COC_LLM_TOOLS_TOKEN_ENV]: 'tok123',
        });
    });

    it('does NOT set ELECTRON_RUN_AS_NODE when not running under Electron', () => {
        setElectron(undefined);
        const config = buildCocLlmToolsMcpConfig({ endpoint: 'http://127.0.0.1:5000', token: 'tok', bridgePath: '/x/bridge.js' });
        expect(config.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    });

    it('sets ELECTRON_RUN_AS_NODE=1 when the bridge is launched with the Electron binary', () => {
        // Regression: the CoC desktop server runs as Electron's Node
        // (ELECTRON_RUN_AS_NODE=1), so process.execPath is the Electron binary.
        // Codex strips inherited env from MCP server children, so the flag must be
        // injected explicitly or the bridge boots Electron's GUI runtime, never
        // answers the MCP handshake, and CoC tools silently disappear.
        setElectron('35.7.5');
        const config = buildCocLlmToolsMcpConfig({ endpoint: 'http://127.0.0.1:5000', token: 'tok', bridgePath: '/x/bridge.js' });
        expect(config.command).toBe(process.execPath);
        expect(config.env.ELECTRON_RUN_AS_NODE).toBe('1');
        // Endpoint/token still present alongside the injected flag.
        expect(config.env[COC_LLM_TOOLS_ENDPOINT_ENV]).toBe('http://127.0.0.1:5000');
        expect(config.env[COC_LLM_TOOLS_TOKEN_ENV]).toBe('tok');
    });

    it('does NOT set ELECTRON_RUN_AS_NODE when a non-Electron command is supplied explicitly', () => {
        // Even under Electron, an explicit real-Node launcher must not be forced
        // into ELECTRON_RUN_AS_NODE mode.
        setElectron('35.7.5');
        const config = buildCocLlmToolsMcpConfig({
            endpoint: 'http://127.0.0.1:5000',
            token: 'tok',
            command: '/usr/local/bin/node',
            bridgePath: '/x/bridge.js',
        });
        expect(config.command).toBe('/usr/local/bin/node');
        expect(config.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    });

    it('honors an explicit bridge-path override', () => {
        setCocLlmToolsBridgePath('/override/bridge.js');
        expect(resolveCocLlmToolsBridgePath()).toBe('/override/bridge.js');
    });

    it('falls back to COC_LLM_TOOLS_BRIDGE_PATH env, then dist-adjacent default', () => {
        process.env.COC_LLM_TOOLS_BRIDGE_PATH = '/env/bridge.js';
        expect(resolveCocLlmToolsBridgePath()).toBe('/env/bridge.js');
        delete process.env.COC_LLM_TOOLS_BRIDGE_PATH;
        expect(resolveCocLlmToolsBridgePath()).toMatch(/bridge\.js$/);
    });

    it('exposes an identifier-safe MCP server name', () => {
        expect(COC_LLM_TOOLS_MCP_SERVER_NAME).toBe('coc_llm_tools');
        expect(COC_LLM_TOOLS_MCP_SERVER_NAME).toMatch(/^[a-z0-9_]+$/);
    });
});
