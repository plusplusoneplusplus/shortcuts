/**
 * MCP Connection Tester Unit Tests
 *
 * Tests for testMcpConnection — stdio, http, and sse transports.
 * Node.js built-in modules (child_process, http) are mocked via vi.mock/vi.hoisted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ============================================================================
// Mock child_process
// ============================================================================

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
    spawn: mockSpawn,
}));

// ============================================================================
// Mock http (used for http/sse transport)
// ============================================================================

const mockHttpRequest = vi.hoisted(() => vi.fn());

vi.mock('http', () => ({
    request: mockHttpRequest,
}));

// ============================================================================
// Mock https (ensure it's available but unused in http tests)
// ============================================================================

vi.mock('https', () => ({
    request: vi.fn(),
}));

// ============================================================================
// Module under test — imported AFTER mocks
// ============================================================================

import type { McpTestRequest } from '../../src/server/routes/mcp-connection-tester';
import { testMcpConnection, listMcpTools } from '../../src/server/routes/mcp-connection-tester';

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal fake ChildProcess stub */
function makeChildStub() {
    const stdin = new EventEmitter() as any;
    stdin.write = vi.fn(() => true);
    stdin.end = vi.fn();

    const stdout = new EventEmitter() as any;
    const stderr = new EventEmitter() as any;

    const child = new EventEmitter() as any;
    child.stdin = stdin;
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = vi.fn();
    child.pid = 12345;

    return { child, stdin, stdout, stderr };
}

/** Build a minimal fake http.IncomingMessage stub */
function makeIncomingMessage(statusCode: number, headers: Record<string, string> = {}) {
    const msg = new EventEmitter() as any;
    msg.statusCode = statusCode;
    msg.headers = headers;
    msg.resume = vi.fn();
    return msg;
}

/** Build a minimal fake http.ClientRequest stub */
function makeClientRequest() {
    const req = new EventEmitter() as any;
    req.write = vi.fn();
    req.end = vi.fn();
    req.destroy = vi.fn();
    return req;
}

/**
 * Drive a sequence of POST responses for the Streamable HTTP discovery path.
 * Each entry maps to one `http.request` call (initialize, initialized, tools/list).
 */
function setupHttpSequence(responses: Array<{ status?: number; body?: any; headers?: Record<string, string> }>) {
    let call = 0;
    mockHttpRequest.mockImplementation((_opts: any, callback: any) => {
        const spec = responses[call++] ?? { status: 200, body: '' };
        const clientReq = makeClientRequest();
        const msg = makeIncomingMessage(spec.status ?? 200, { 'content-type': 'application/json', ...(spec.headers ?? {}) });
        callback(msg);
        queueMicrotask(() => {
            const bodyStr = spec.body === undefined ? '' : typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body);
            if (bodyStr) msg.emit('data', Buffer.from(bodyStr));
            msg.emit('end');
        });
        return clientReq;
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('testMcpConnection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    // stdio transport
    // -------------------------------------------------------------------------

    describe('stdio transport', () => {
        it('returns error when command is missing', async () => {
            const result = await testMcpConnection({ type: 'stdio' } as McpTestRequest);
            expect(result.success).toBe(false);
            expect(result.message).toMatch(/command/i);
        });

        it('returns error when spawn throws', async () => {
            mockSpawn.mockImplementation(() => { throw new Error('spawn ENOENT'); });
            const result = await testMcpConnection({ type: 'stdio', command: 'does-not-exist' });
            expect(result.success).toBe(false);
            expect(result.message).toMatch(/spawn|ENOENT/i);
        });

        it('returns error when process emits an error event', async () => {
            const { child } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = testMcpConnection({ type: 'stdio', command: 'fake' });
            child.emit('error', new Error('ENOENT'));
            const result = await resultPromise;

            expect(result.success).toBe(false);
            expect(result.message).toMatch(/ENOENT/);
        });

        it('returns error when process exits before responding', async () => {
            const { child } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = testMcpConnection({ type: 'stdio', command: 'fake' });
            child.emit('close', 1);
            const result = await resultPromise;

            expect(result.success).toBe(false);
            expect(result.message).toMatch(/exit/i);
        });

        it('parses successful JSON-RPC initialize response', async () => {
            const { child, stdout } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = testMcpConnection({ type: 'stdio', command: 'fake' });

            const response = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    serverInfo: { name: 'my-mcp', version: '1.0.0' },
                },
            }) + '\n';
            stdout.emit('data', Buffer.from(response));

            const result = await resultPromise;
            expect(result.success).toBe(true);
            expect(result.protocolVersion).toBe('2024-11-05');
            expect(result.serverName).toBe('my-mcp');
        });

        it('returns error when JSON-RPC error response is received', async () => {
            const { child, stdout } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = testMcpConnection({ type: 'stdio', command: 'fake' });

            const response = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                error: { code: -32600, message: 'Invalid request' },
            }) + '\n';
            stdout.emit('data', Buffer.from(response));

            const result = await resultPromise;
            expect(result.success).toBe(false);
            expect(result.message).toMatch(/Invalid request/);
        });

        it('ignores non-JSON stdout lines then succeeds on valid response', async () => {
            const { child, stdout } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = testMcpConnection({ type: 'stdio', command: 'fake' });

            stdout.emit('data', Buffer.from('Some debug output\n'));
            const validResponse = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'srv' } },
            }) + '\n';
            stdout.emit('data', Buffer.from(validResponse));

            const result = await resultPromise;
            expect(result.success).toBe(true);
        });

        it('ignores JSON-RPC responses with wrong id then fails on close', async () => {
            const { child, stdout } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = testMcpConnection({ type: 'stdio', command: 'fake' });

            const wrongId = JSON.stringify({ jsonrpc: '2.0', id: 99, result: { protocolVersion: '2024-11-05' } }) + '\n';
            stdout.emit('data', Buffer.from(wrongId));
            child.emit('close', 0);

            const result = await resultPromise;
            expect(result.success).toBe(false);
        });

        it('kills process after successful response', async () => {
            const { child, stdout } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = testMcpConnection({ type: 'stdio', command: 'fake' });

            const response = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: { protocolVersion: '2024-11-05', capabilities: {} },
            }) + '\n';
            stdout.emit('data', Buffer.from(response));

            await resultPromise;
            expect(child.kill).toHaveBeenCalledWith('SIGKILL');
        });

        it('handles multi-chunk stdout correctly', async () => {
            const { child, stdout } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = testMcpConnection({ type: 'stdio', command: 'fake' });

            const fullMsg = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'chunked' } },
            }) + '\n';
            const half = Math.floor(fullMsg.length / 2);
            stdout.emit('data', Buffer.from(fullMsg.slice(0, half)));
            stdout.emit('data', Buffer.from(fullMsg.slice(half)));

            const result = await resultPromise;
            expect(result.success).toBe(true);
            expect(result.serverName).toBe('chunked');
        });
    });

    // -------------------------------------------------------------------------
    // http / sse transport
    // -------------------------------------------------------------------------

    describe('http/sse transport', () => {
        it('returns error when url is missing', async () => {
            const result = await testMcpConnection({ type: 'http' } as McpTestRequest);
            expect(result.success).toBe(false);
            expect(result.message).toMatch(/url/i);
        });

        it('returns error for invalid url', async () => {
            const result = await testMcpConnection({ type: 'http', url: 'not-a-url' });
            expect(result.success).toBe(false);
            expect(result.message).toMatch(/Invalid URL/i);
        });

        it('returns success on 200 response', async () => {
            const clientReq = makeClientRequest();
            const incomingMsg = makeIncomingMessage(200);
            mockHttpRequest.mockImplementation((_opts: any, callback: any) => {
                callback(incomingMsg);
                return clientReq;
            });

            const result = await testMcpConnection({ type: 'http', url: 'http://localhost:8080/mcp' });
            expect(result.success).toBe(true);
            expect(result.message).toMatch(/200/);
        });

        it('returns success on 401 (reachable but auth required)', async () => {
            const clientReq = makeClientRequest();
            const incomingMsg = makeIncomingMessage(401);
            mockHttpRequest.mockImplementation((_opts: any, callback: any) => {
                callback(incomingMsg);
                return clientReq;
            });

            const result = await testMcpConnection({ type: 'http', url: 'http://localhost:8080/mcp' });
            expect(result.success).toBe(true);
            expect(result.message).toMatch(/401/);
        });

        it('returns failure on 500', async () => {
            const clientReq = makeClientRequest();
            const incomingMsg = makeIncomingMessage(500);
            mockHttpRequest.mockImplementation((_opts: any, callback: any) => {
                callback(incomingMsg);
                return clientReq;
            });

            const result = await testMcpConnection({ type: 'http', url: 'http://localhost:8080/mcp' });
            expect(result.success).toBe(false);
        });

        it('returns failure on connection error', async () => {
            const clientReq = makeClientRequest();
            mockHttpRequest.mockImplementation(() => clientReq);

            const resultPromise = testMcpConnection({ type: 'http', url: 'http://localhost:9999/mcp' });
            clientReq.emit('error', new Error('ECONNREFUSED'));
            const result = await resultPromise;

            expect(result.success).toBe(false);
            expect(result.message).toMatch(/ECONNREFUSED/);
        });

        it('works for sse type with same http logic', async () => {
            const clientReq = makeClientRequest();
            const incomingMsg = makeIncomingMessage(200);
            mockHttpRequest.mockImplementation((_opts: any, callback: any) => {
                callback(incomingMsg);
                return clientReq;
            });

            const result = await testMcpConnection({ type: 'sse', url: 'http://localhost:8080/events' });
            expect(result.success).toBe(true);
        });
    });
});

// ============================================================================
// listMcpTools
// ============================================================================

describe('listMcpTools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('stdio transport', () => {
        /** Emit the initialize (id=1) response then the tools/list (id=2) response. */
        function driveHandshake(stdout: EventEmitter, tools: unknown[]) {
            stdout.emit('data', Buffer.from(JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'srv' } },
            }) + '\n'));
            stdout.emit('data', Buffer.from(JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                result: { tools },
            }) + '\n'));
        }

        it('returns error (not throw) when command is missing', async () => {
            const result = await listMcpTools({ type: 'stdio' } as McpTestRequest);
            expect(result.success).toBe(false);
            expect(result.tools).toEqual([]);
            expect(result.message).toMatch(/command/i);
        });

        it('returns error entry when spawn throws (per-server isolation)', async () => {
            mockSpawn.mockImplementation(() => { throw new Error('spawn ENOENT'); });
            const result = await listMcpTools({ type: 'stdio', command: 'nope' });
            expect(result.success).toBe(false);
            expect(result.tools).toEqual([]);
            expect(result.message).toMatch(/spawn|ENOENT/i);
        });

        it('discovers real tools after a full initialize + tools/list handshake', async () => {
            const { child, stdout, stdin } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = listMcpTools({ type: 'stdio', command: 'fake' });
            driveHandshake(stdout, [
                { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
                { name: 'write_file', description: 'Write a file' },
            ]);

            const result = await resultPromise;
            expect(result.success).toBe(true);
            expect(result.serverName).toBe('srv');
            expect(result.tools).toHaveLength(2);
            expect(result.tools[0]).toEqual({
                name: 'read_file',
                description: 'Read a file',
                inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
            });
            expect(result.tools[1]).toEqual({ name: 'write_file', description: 'Write a file' });
            // It must complete the handshake before requesting tools.
            const written = (stdin.write as any).mock.calls.map((c: any[]) => String(c[0]));
            expect(written.some((w: string) => w.includes('"method":"initialize"'))).toBe(true);
            expect(written.some((w: string) => w.includes('notifications/initialized'))).toBe(true);
            expect(written.some((w: string) => w.includes('"method":"tools/list"'))).toBe(true);
        });

        it('drops malformed tool entries (missing name)', async () => {
            const { child, stdout } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = listMcpTools({ type: 'stdio', command: 'fake' });
            driveHandshake(stdout, [{ name: 'ok' }, { description: 'no name' }, 'not-an-object']);

            const result = await resultPromise;
            expect(result.success).toBe(true);
            expect(result.tools).toEqual([{ name: 'ok' }]);
        });

        it('returns error when initialize fails', async () => {
            const { child, stdout } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = listMcpTools({ type: 'stdio', command: 'fake' });
            stdout.emit('data', Buffer.from(JSON.stringify({
                jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad init' },
            }) + '\n'));

            const result = await resultPromise;
            expect(result.success).toBe(false);
            expect(result.tools).toEqual([]);
            expect(result.message).toMatch(/bad init/);
        });

        it('returns error when tools/list fails', async () => {
            const { child, stdout } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = listMcpTools({ type: 'stdio', command: 'fake' });
            stdout.emit('data', Buffer.from(JSON.stringify({
                jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' },
            }) + '\n'));
            stdout.emit('data', Buffer.from(JSON.stringify({
                jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'no tools method' },
            }) + '\n'));

            const result = await resultPromise;
            expect(result.success).toBe(false);
            expect(result.message).toMatch(/no tools method/);
        });

        it('returns error when the process exits before responding', async () => {
            const { child } = makeChildStub();
            mockSpawn.mockReturnValue(child);

            const resultPromise = listMcpTools({ type: 'stdio', command: 'fake' });
            child.emit('close', 1);

            const result = await resultPromise;
            expect(result.success).toBe(false);
            expect(result.message).toMatch(/exit/i);
        });
    });

    describe('http transport', () => {
        it('returns error when url is missing', async () => {
            const result = await listMcpTools({ type: 'http' } as McpTestRequest);
            expect(result.success).toBe(false);
            expect(result.tools).toEqual([]);
            expect(result.message).toMatch(/url/i);
        });

        it('discovers tools over Streamable HTTP (initialize → tools/list)', async () => {
            setupHttpSequence([
                { status: 200, headers: { 'mcp-session-id': 'sess-1' }, body: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'remote' } } } },
                { status: 202, body: '' },
                { status: 200, body: { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'search', description: 'Search docs' }] } } },
            ]);

            const result = await listMcpTools({ type: 'http', url: 'http://localhost:8080/mcp' });
            expect(result.success).toBe(true);
            expect(result.serverName).toBe('remote');
            expect(result.tools).toEqual([{ name: 'search', description: 'Search docs' }]);
        });

        it('parses tools from a text/event-stream response', async () => {
            setupHttpSequence([
                { status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}\n\n' },
                { status: 202, body: '' },
                { status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"x"}]}}\n\n' },
            ]);

            const result = await listMcpTools({ type: 'http', url: 'http://localhost:8080/mcp' });
            expect(result.success).toBe(true);
            expect(result.tools).toEqual([{ name: 'x' }]);
        });

        it('returns a per-server error on HTTP 500', async () => {
            setupHttpSequence([{ status: 500, body: '' }]);
            const result = await listMcpTools({ type: 'http', url: 'http://localhost:8080/mcp' });
            expect(result.success).toBe(false);
            expect(result.tools).toEqual([]);
            expect(result.message).toMatch(/500/);
        });

        it('returns a per-server error on connection failure', async () => {
            const clientReq = makeClientRequest();
            mockHttpRequest.mockImplementation(() => clientReq);
            const resultPromise = listMcpTools({ type: 'http', url: 'http://localhost:9999/mcp' });
            clientReq.emit('error', new Error('ECONNREFUSED'));
            const result = await resultPromise;
            expect(result.success).toBe(false);
            expect(result.message).toMatch(/ECONNREFUSED/);
        });
    });
});
