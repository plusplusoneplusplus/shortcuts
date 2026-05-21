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
import { testMcpConnection } from '../../src/server/routes/mcp-connection-tester';

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
function makeIncomingMessage(statusCode: number) {
    const msg = new EventEmitter() as any;
    msg.statusCode = statusCode;
    msg.resume = vi.fn();
    return msg;
}

/** Build a minimal fake http.ClientRequest stub */
function makeClientRequest() {
    const req = new EventEmitter() as any;
    req.end = vi.fn();
    req.destroy = vi.fn();
    return req;
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
