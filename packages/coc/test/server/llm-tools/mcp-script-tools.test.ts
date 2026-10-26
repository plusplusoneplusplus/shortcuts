/**
 * Tests for the run_tool_script MCP scope: lazy per-scope clients against a
 * real fake MCP server (stdio child and in-process streamable HTTP), tool
 * filtering, error codes, OAuth cache reads and cleanup on close.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { CocToolRuntime, runToolScript, type MCPServerConfig } from '@plusplusoneplusplus/coc-agent-sdk';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    createMcpScriptTools,
    MCP_CALL_TOOL_NAME,
    MCP_LIST_TOOLS_TOOL_NAME,
    McpScriptScope,
} from '../../../src/server/llm-tools/mcp-script-tools';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createFakeMcpServer } = require('./fixtures/fake-mcp-server.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-mcp-server.cjs');
const stdioServer = (extra: Partial<MCPServerConfig> = {}): MCPServerConfig =>
    ({ command: process.execPath, args: [FIXTURE], tools: ['*'], ...extra }) as MCPServerConfig;

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitForExit(pid: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (isAlive(pid) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    expect(isAlive(pid)).toBe(false);
}

const scopes: McpScriptScope[] = [];
function scope(servers: Record<string, MCPServerConfig> | undefined, extra: Partial<ConstructorParameters<typeof McpScriptScope>[0]> = {}) {
    const s = new McpScriptScope({ servers, ...extra });
    scopes.push(s);
    return s;
}

afterEach(async () => {
    await Promise.all(scopes.splice(0).map(s => s.close()));
});

describe('McpScriptScope over stdio', () => {
    it('lists server names from config without starting anything', () => {
        const s = scope({
            a: stdioServer({ command: path.join(os.tmpdir(), 'does-not-exist') }),
            off: stdioServer({ enabled: false }),
        });
        expect(s.serverNames()).toEqual(['a']);
        expect(scope({}).serverNames()).toEqual([]);
        expect(scope(undefined).serverNames()).toEqual([]);
    });

    it('lists tools and calls them on one shared client', async () => {
        const s = scope({ fake: stdioServer() });
        const tools = await s.listTools('fake');
        expect(tools.map(t => t.name)).toEqual(['echo', 'pid', 'fail', 'secret']);
        expect(tools[0].description).toBe('Echo the text back');
        expect(await s.callTool('fake', 'echo', { text: 'hi' })).toBe('echo:hi');
        const [pid1, pid2] = await Promise.all([s.callTool('fake', 'pid', {}), s.callTool('fake', 'pid', {})]);
        expect(pid1).toBe(pid2);
    });

    it('rejects unknown servers and tools, and surfaces tool errors', async () => {
        const s = scope({ fake: stdioServer() });
        await expect(s.listTools('nope')).rejects.toThrow('unknown-server: nope');
        await expect(s.callTool('nope', 'echo', {})).rejects.toThrow('unknown-server: nope');
        await expect(s.callTool('toString', 'echo', {})).rejects.toThrow('unknown-server: toString');
        await expect(s.callTool('fake', 'missing', {})).rejects.toThrow('unknown-tool: fake/missing');
        await expect(s.callTool('fake', 'fail', {})).rejects.toThrow('boom from fail');
    });

    it('hides and blocks tools outside the config allowlist and the turn filter', async () => {
        const s = scope(
            { fake: stdioServer({ tools: ['echo', 'pid', 'secret'] }) },
            { isToolAllowed: (server, tool) => !(server === 'fake' && tool === 'secret') },
        );
        expect((await s.listTools('fake')).map(t => t.name)).toEqual(['echo', 'pid']);
        await expect(s.callTool('fake', 'secret', {})).rejects.toThrow('tool-not-allowed: fake/secret');
        await expect(s.callTool('fake', 'fail', {})).rejects.toThrow('tool-not-allowed: fake/fail');
    });

    it('kills the stdio child on close and refuses later calls', async () => {
        const s = scope({ fake: stdioServer() });
        const pid = Number(await s.callTool('fake', 'pid', {}));
        expect(isAlive(pid)).toBe(true);
        await s.close();
        await waitForExit(pid);
        await expect(s.callTool('fake', 'pid', {})).rejects.toThrow('MCP scope is closed');
    });

    it('fails a connect that exceeds the timeout', async () => {
        const s = scope(
            { hang: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] } as MCPServerConfig },
            { connectTimeoutMs: 300 },
        );
        await expect(s.listTools('hang')).rejects.toThrow(/timed out/i);
    });

    it('keeps two scopes isolated', async () => {
        const a = scope({ fake: stdioServer() });
        const b = scope({ other: stdioServer() });
        await expect(a.callTool('other', 'pid', {})).rejects.toThrow('unknown-server: other');
        const pidA = Number(await a.callTool('fake', 'pid', {}));
        const pidB = Number(await b.callTool('other', 'pid', {}));
        expect(pidA).not.toBe(pidB);
        await a.close();
        await waitForExit(pidA);
        expect(isAlive(pidB)).toBe(true);
    });

    it('lets a script catch a failed call and keep going', async () => {
        const s = scope({ fake: stdioServer() });
        const tools = createMcpScriptTools(s);
        expect(tools.map(t => t.name)).toEqual([MCP_LIST_TOOLS_TOOL_NAME, MCP_CALL_TOOL_NAME]);
        const runtime = new CocToolRuntime(tools, {});
        const events: string[] = [];
        try {
            const run = await runToolScript({
                code: `
                    const listed = await tools.mcp_list_tools({ server: 'fake' });
                    let failure;
                    try { await tools.mcp_call({ server: 'fake', tool: 'fail' }); }
                    catch (e) { failure = e.name + ':' + e.message; }
                    const echoed = await tools.mcp_call({ server: 'fake', tool: 'echo', args: { text: 'after' } });
                    return { count: listed.tools.length, failure, echoed };
                `,
                runtime,
                scriptToolCallId: 'script-1',
                depth: 1,
                onToolEvent: e => events.push(`${e.type}:${(e as { toolName?: string }).toolName ?? ''}`),
            });
            expect(run.ok).toBe(true);
            expect(run.result).toEqual({ count: 4, failure: 'ToolCallError:boom from fail', echoed: 'echo:after' });
            expect(events.some(e => e.includes(MCP_CALL_TOOL_NAME))).toBe(true);
        } finally {
            runtime.dispose();
        }
    });
});

describe('McpScriptScope over HTTP', () => {
    let httpServer: http.Server;
    let url: string;
    let tmpHome: string;
    const seenAuth: Array<string | undefined> = [];

    beforeAll(async () => {
        httpServer = http.createServer(async (req, res) => {
            const auth = req.headers.authorization ?? (req.headers['x-api-key'] ? `key ${req.headers['x-api-key']}` : undefined);
            seenAuth.push(auth);
            if (auth !== 'Bearer good-token' && auth !== 'key static') {
                res.writeHead(401, { 'Content-Type': 'text/plain' }).end('unauthorized');
                return;
            }
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
            const server = createFakeMcpServer();
            res.on('close', () => { void transport.close(); void server.close(); });
            await server.connect(transport);
            await transport.handleRequest(req, res);
        });
        await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
        url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-script-home-'));
    });

    afterAll(async () => {
        await new Promise<void>(resolve => httpServer.close(() => resolve()));
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    function writeToken(accessToken: string, expiresAt: number): void {
        const dir = path.join(tmpHome, '.copilot', 'mcp-oauth-config');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'h1.json'), JSON.stringify({ serverUrl: url, clientId: 'c' }));
        fs.writeFileSync(path.join(dir, 'h1.tokens.json'), JSON.stringify({ accessToken, expiresAt, refreshToken: 'r' }));
    }

    function snapshotCache(): Record<string, string> {
        const dir = path.join(tmpHome, '.copilot', 'mcp-oauth-config');
        if (!fs.existsSync(dir)) return {};
        return Object.fromEntries(fs.readdirSync(dir).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf-8')]));
    }

    const remote = (headers?: Record<string, string>): MCPServerConfig => ({ type: 'http', url, headers, tools: ['*'] });

    it('uses static headers', async () => {
        const s = scope({ api: remote({ 'x-api-key': 'static' }) }, { homeDir: tmpHome });
        expect(await s.callTool('api', 'echo', { text: 'h' })).toBe('echo:h');
    });

    it('uses a valid cached OAuth token without touching the cache', async () => {
        writeToken('good-token', Math.floor(Date.now() / 1000) + 3600);
        const before = snapshotCache();
        const s = scope({ api: remote() }, { homeDir: tmpHome });
        expect(await s.callTool('api', 'echo', { text: 'o' })).toBe('echo:o');
        expect(seenAuth).toContain('Bearer good-token');
        expect(snapshotCache()).toEqual(before);
    });

    it('fails with auth-required for an expired token and leaves the cache unchanged', async () => {
        writeToken('good-token', Math.floor(Date.now() / 1000) - 60);
        const before = snapshotCache();
        const s = scope({ api: remote() }, { homeDir: tmpHome });
        await expect(s.listTools('api')).rejects.toThrow(/^auth-required: api/);
        expect(snapshotCache()).toEqual(before);
    });

    it('fails with auth-required when no token is cached', async () => {
        const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-script-empty-'));
        try {
            const s = scope({ api: remote() }, { homeDir: emptyHome });
            await expect(s.callTool('api', 'echo', {})).rejects.toThrow(/^auth-required: api/);
            expect(fs.existsSync(path.join(emptyHome, '.copilot'))).toBe(false);
        } finally {
            fs.rmSync(emptyHome, { recursive: true, force: true });
        }
    });
});
