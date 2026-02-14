/**
 * Server Integration Tests
 *
 * End-to-end tests validating the full server lifecycle, WebSocket broadcasts,
 * SSE streaming, multi-workspace isolation, concurrent access, and error handling.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { sendFrame, decodeFrame } from '../../src/server/websocket';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '../../src/server/types';
import type { Socket } from 'net';

// ============================================================================
// Helpers
// ============================================================================

/** Make an HTTP request and return status, headers, and body. */
function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

function makeProcessBody(id: string, overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        id,
        promptPreview: `prompt-${id}`,
        fullPrompt: `Full prompt for ${id}`,
        status: 'running',
        startTime: new Date().toISOString(),
        type: 'clarification',
        ...overrides,
    });
}

function makeWorkspaceBody(id: string, name: string): string {
    return JSON.stringify({ id, name, rootPath: `/ws/${name}` });
}

/** Parse SSE text into events array: [{event, data}] */
function parseSSE(text: string): Array<{ event: string; data: unknown }> {
    const events: Array<{ event: string; data: unknown }> = [];
    const blocks = text.split('\n\n').filter(b => b.trim());
    for (const block of blocks) {
        const lines = block.split('\n');
        let event = '';
        let data = '';
        for (const line of lines) {
            if (line.startsWith('event: ')) { event = line.slice(7); }
            if (line.startsWith('data: ')) { data = line.slice(6); }
        }
        if (event && data) {
            events.push({ event, data: JSON.parse(data) });
        }
    }
    return events;
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Server Integration', () => {
    let server: ExecutionServer;
    let stubServer: ExecutionServer;
    let store: FileProcessStore;
    let baseUrl: string;
    let stubBaseUrl: string;
    let tmpDir: string;
    let stubTmpDir: string;

    beforeAll(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-'));
        store = new FileProcessStore({ dataDir: tmpDir });
        server = await createExecutionServer({ store, port: 0, host: '127.0.0.1', dataDir: tmpDir });
        baseUrl = server.url;

        // Create a second server using the default stub store (no store option)
        stubTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-stub-'));
        stubServer = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: stubTmpDir });
        stubBaseUrl = stubServer.url;
    });

    afterAll(async () => {
        // Force-close all connections before closing the servers
        await server.close();
        await stubServer.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(stubTmpDir, { recursive: true, force: true });
    }, 10_000);

    // ------------------------------------------------------------------
    // Full Lifecycle
    // ------------------------------------------------------------------
    describe('full lifecycle', () => {
        const wsId = 'ws-lifecycle';
        const procId = 'lifecycle-proc-1';

        it('should register workspace → 201', async () => {
            const res = await request(`${baseUrl}/api/workspaces`, {
                method: 'POST',
                body: makeWorkspaceBody(wsId, 'lifecycle'),
            });
            expect(res.status).toBe(201);
        });

        it('should create process → 201 with ID', async () => {
            const res = await request(`${baseUrl}/api/processes`, {
                method: 'POST',
                body: makeProcessBody(procId, { workspaceId: wsId }),
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.id).toBe(procId);
        });

        it('should get process → 200 with correct data', async () => {
            const res = await request(`${baseUrl}/api/processes/${procId}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.process.id).toBe(procId);
        });

        it('should update process → 200', async () => {
            const res = await request(`${baseUrl}/api/processes/${procId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'completed', result: 'done' }),
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.process.status).toBe('completed');
        });

        it('should list processes → 200 with array', async () => {
            const res = await request(`${baseUrl}/api/processes?workspace=${wsId}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.processes.length).toBeGreaterThanOrEqual(1);
        });

        it('should delete process → 204', async () => {
            const res = await request(`${baseUrl}/api/processes/${procId}`, { method: 'DELETE' });
            expect(res.status).toBe(204);
        });

        it('should return 404 for deleted process', async () => {
            const res = await request(`${baseUrl}/api/processes/${procId}`);
            expect(res.status).toBe(404);
        });
    });

    // ------------------------------------------------------------------
    // WebSocket Broadcasts
    // ------------------------------------------------------------------
    describe('websocket', () => {
        it('should receive process-added event via WS', async () => {
            const parsed = new URL(baseUrl);
            const wsPort = parsed.port;

            const messages = await new Promise<any[]>((resolve, reject) => {
                const collected: any[] = [];
                const socket = new (require('net').Socket)();
                const key = crypto.randomBytes(16).toString('base64');

                socket.connect(Number(wsPort), '127.0.0.1', () => {
                    socket.write(
                        'GET /ws HTTP/1.1\r\n' +
                        `Host: 127.0.0.1:${wsPort}\r\n` +
                        'Upgrade: websocket\r\n' +
                        'Connection: Upgrade\r\n' +
                        `Sec-WebSocket-Key: ${key}\r\n` +
                        'Sec-WebSocket-Version: 13\r\n' +
                        '\r\n'
                    );
                });

                let handshakeDone = false;
                socket.on('data', (buf: Buffer) => {
                    if (!handshakeDone) {
                        const text = buf.toString();
                        if (text.includes('101')) {
                            handshakeDone = true;
                            // Now create a process via REST to trigger broadcast
                            request(`${baseUrl}/api/processes`, {
                                method: 'POST',
                                body: makeProcessBody('ws-proc-1'),
                            }).catch(reject);
                        }
                        // Handle case where handshake + first frame arrive together
                        const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'));
                        if (headerEnd >= 0 && headerEnd + 4 < buf.length) {
                            const wsFrame = buf.slice(headerEnd + 4);
                            const decoded = decodeFrame(wsFrame);
                            if (decoded) {
                                collected.push(JSON.parse(decoded));
                            }
                        }
                        return;
                    }
                    const decoded = decodeFrame(buf);
                    if (decoded) {
                        collected.push(JSON.parse(decoded));
                        // Wait for process-added event (second message after welcome)
                        if (collected.some(m => m.type === 'process-added')) {
                            socket.end();
                        }
                    }
                });

                socket.on('close', () => resolve(collected));
                socket.on('error', reject);
                setTimeout(() => {
                    socket.end();
                    resolve(collected);
                }, 3000);
            });

            expect(messages.some(m => m.type === 'welcome')).toBe(true);
            expect(messages.some(m => m.type === 'process-added')).toBe(true);

            // Clean up
            await store.removeProcess('ws-proc-1');
        });
    });

    // ------------------------------------------------------------------
    // SSE Streaming
    // ------------------------------------------------------------------
    describe('sse streaming', () => {
        it('should return 404 for non-existent process', async () => {
            const res = await request(`${baseUrl}/api/processes/nonexistent/stream`);
            expect(res.status).toBe(404);
        });

        it('should return immediate status + done for completed process', async () => {
            // Create a completed process
            await request(`${baseUrl}/api/processes`, {
                method: 'POST',
                body: makeProcessBody('sse-completed', { status: 'completed', result: 'ok' }),
            });

            const res = await request(`${baseUrl}/api/processes/sse-completed/stream`);
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('text/event-stream');

            const events = parseSSE(res.body);
            expect(events.some(e => e.event === 'status')).toBe(true);
            expect(events.some(e => e.event === 'done')).toBe(true);

            const statusEvent = events.find(e => e.event === 'status');
            expect((statusEvent!.data as any).status).toBe('completed');

            // Clean up
            await store.removeProcess('sse-completed');
        });

        it('should stream chunks and complete for running process', async () => {
            // Create a running process
            await request(`${baseUrl}/api/processes`, {
                method: 'POST',
                body: makeProcessBody('sse-running', { status: 'running' }),
            });

            // Collect SSE events
            const events = await new Promise<Array<{ event: string; data: unknown }>>((resolve, reject) => {
                const parsed = new URL(`${baseUrl}/api/processes/sse-running/stream`);
                const req = http.request({
                    hostname: parsed.hostname,
                    port: parsed.port,
                    path: parsed.pathname,
                    method: 'GET',
                }, (res) => {
                    let buffer = '';
                    const collected: Array<{ event: string; data: unknown }> = [];

                    res.on('data', (chunk: Buffer) => {
                        buffer += chunk.toString();
                        // Parse complete events
                        const parts = buffer.split('\n\n');
                        buffer = parts.pop() || '';
                        for (const part of parts) {
                            if (!part.trim()) { continue; }
                            const lines = part.split('\n');
                            let event = '';
                            let data = '';
                            for (const line of lines) {
                                if (line.startsWith('event: ')) { event = line.slice(7); }
                                if (line.startsWith('data: ')) { data = line.slice(6); }
                            }
                            if (event && data) {
                                collected.push({ event, data: JSON.parse(data) });
                            }
                            if (event === 'done') {
                                resolve(collected);
                            }
                        }
                    });

                    res.on('end', () => resolve(collected));
                    res.on('error', reject);
                });

                req.on('error', reject);
                req.end();

                // Emit chunks after a brief delay
                setTimeout(() => {
                    store.emitProcessOutput('sse-running', 'hello ');
                    store.emitProcessOutput('sse-running', 'world');
                    store.emitProcessComplete('sse-running', 'completed', '1s');
                }, 100);
            });

            const chunks = events.filter(e => e.event === 'chunk');
            expect(chunks).toHaveLength(2);
            expect((chunks[0].data as any).content).toBe('hello ');
            expect((chunks[1].data as any).content).toBe('world');

            expect(events.some(e => e.event === 'status')).toBe(true);
            expect(events.some(e => e.event === 'done')).toBe(true);

            // Clean up
            await store.removeProcess('sse-running');
        });

        it('should return immediate status for failed process', async () => {
            await request(`${baseUrl}/api/processes`, {
                method: 'POST',
                body: makeProcessBody('sse-failed', { status: 'failed', error: 'boom' }),
            });

            const res = await request(`${baseUrl}/api/processes/sse-failed/stream`);
            expect(res.status).toBe(200);

            const events = parseSSE(res.body);
            const statusEvent = events.find(e => e.event === 'status');
            expect((statusEvent!.data as any).status).toBe('failed');
            expect((statusEvent!.data as any).error).toBe('boom');

            await store.removeProcess('sse-failed');
        });
    });

    // ------------------------------------------------------------------
    // Multi-Workspace Isolation
    // ------------------------------------------------------------------
    describe('multi-workspace', () => {
        beforeEach(async () => {
            // Clean slate
            await store.clearProcesses();
        });

        it('should isolate processes by workspace', async () => {
            // Register workspaces
            await request(`${baseUrl}/api/workspaces`, {
                method: 'POST',
                body: makeWorkspaceBody('ws-a', 'A'),
            });
            await request(`${baseUrl}/api/workspaces`, {
                method: 'POST',
                body: makeWorkspaceBody('ws-b', 'B'),
            });

            // Create processes in each
            await request(`${baseUrl}/api/processes`, {
                method: 'POST',
                body: makeProcessBody('pa1', { workspaceId: 'ws-a' }),
            });
            await request(`${baseUrl}/api/processes`, {
                method: 'POST',
                body: makeProcessBody('pa2', { workspaceId: 'ws-a' }),
            });
            await request(`${baseUrl}/api/processes`, {
                method: 'POST',
                body: makeProcessBody('pb1', { workspaceId: 'ws-b' }),
            });

            // Query workspace A
            const resA = await request(`${baseUrl}/api/processes?workspace=ws-a`);
            const bodyA = JSON.parse(resA.body);
            expect(bodyA.processes).toHaveLength(2);

            // Query workspace B
            const resB = await request(`${baseUrl}/api/processes?workspace=ws-b`);
            const bodyB = JSON.parse(resB.body);
            expect(bodyB.processes).toHaveLength(1);

            // Query all
            const resAll = await request(`${baseUrl}/api/processes`);
            const bodyAll = JSON.parse(resAll.body);
            expect(bodyAll.processes).toHaveLength(3);
        });
    });

    // ------------------------------------------------------------------
    // Concurrent Requests
    // ------------------------------------------------------------------
    describe('concurrent', () => {
        beforeEach(async () => {
            await store.clearProcesses();
        });

        it('should handle 10 simultaneous POST requests', async () => {
            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) =>
                    request(`${baseUrl}/api/processes`, {
                        method: 'POST',
                        body: makeProcessBody(`conc-${i}`),
                    })
                )
            );

            // All should return 201
            for (const res of results) {
                expect(res.status).toBe(201);
            }

            // All IDs should be unique
            const ids = results.map(r => JSON.parse(r.body).id);
            expect(new Set(ids).size).toBe(10);

            // List should contain all 10
            const listRes = await request(`${baseUrl}/api/processes`);
            const body = JSON.parse(listRes.body);
            expect(body.processes).toHaveLength(10);
        });
    });

    // ------------------------------------------------------------------
    // Error Handling
    // ------------------------------------------------------------------
    describe('error handling', () => {
        it('should return 400 for missing required fields', async () => {
            const res = await request(`${baseUrl}/api/processes`, {
                method: 'POST',
                body: JSON.stringify({ id: 'incomplete' }),
            });
            expect(res.status).toBe(400);
        });

        it('should return 404 for GET nonexistent process', async () => {
            const res = await request(`${baseUrl}/api/processes/nonexistent`);
            expect(res.status).toBe(404);
        });

        it('should return 404 for PATCH nonexistent process', async () => {
            const res = await request(`${baseUrl}/api/processes/nonexistent`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'completed' }),
            });
            expect(res.status).toBe(404);
        });

        it('should return 404 for DELETE nonexistent process', async () => {
            const res = await request(`${baseUrl}/api/processes/nonexistent`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(404);
        });

        it('should return 400 for invalid JSON body', async () => {
            const res = await request(`${baseUrl}/api/processes`, {
                method: 'POST',
                body: 'not json',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });

        it('should return 404 for unknown API route', async () => {
            const res = await request(`${baseUrl}/api/does-not-exist`);
            expect(res.status).toBe(404);
        });
    });

    // ------------------------------------------------------------------
    // Stub Store — In-Memory Process Tracking & SSE Streaming
    // ------------------------------------------------------------------
    describe('stub store process tracking', () => {
        it('should store and retrieve processes via the stub store', async () => {
            // Create a process
            const createRes = await request(`${stubBaseUrl}/api/processes`, {
                method: 'POST',
                body: JSON.stringify({
                    id: 'stub-proc-1',
                    type: 'queue-ai-clarification',
                    promptPreview: 'Test prompt',
                    fullPrompt: 'Full test prompt',
                    status: 'running',
                    startTime: new Date().toISOString(),
                }),
            });
            expect(createRes.status).toBe(201);

            // Retrieve it
            const getRes = await request(`${stubBaseUrl}/api/processes/stub-proc-1`);
            expect(getRes.status).toBe(200);
            const body = JSON.parse(getRes.body);
            expect(body.process).toBeDefined();
            expect(body.process.id).toBe('stub-proc-1');
            expect(body.process.status).toBe('running');
        });

        it('should update process status via the stub store', async () => {
            // Create a process
            await request(`${stubBaseUrl}/api/processes`, {
                method: 'POST',
                body: JSON.stringify({
                    id: 'stub-proc-2',
                    type: 'queue-custom',
                    promptPreview: 'Update test',
                    fullPrompt: 'Full prompt',
                    status: 'running',
                    startTime: new Date().toISOString(),
                }),
            });

            // Update it
            const patchRes = await request(`${stubBaseUrl}/api/processes/stub-proc-2`, {
                method: 'PATCH',
                body: JSON.stringify({
                    status: 'completed',
                    result: 'Task completed successfully',
                }),
            });
            expect(patchRes.status).toBe(200);

            // Verify update
            const getRes = await request(`${stubBaseUrl}/api/processes/stub-proc-2`);
            const body = JSON.parse(getRes.body);
            expect(body.process.status).toBe('completed');
            expect(body.process.result).toBe('Task completed successfully');
        });

        it('should list all processes from stub store', async () => {
            const listRes = await request(`${stubBaseUrl}/api/processes`);
            expect(listRes.status).toBe(200);
            const body = JSON.parse(listRes.body);
            expect(body.processes).toBeDefined();
            expect(Array.isArray(body.processes)).toBe(true);
        });

        it('should return SSE stream for a completed process', async () => {
            // Create a completed process
            await request(`${stubBaseUrl}/api/processes`, {
                method: 'POST',
                body: JSON.stringify({
                    id: 'stub-sse-1',
                    type: 'queue-ai-clarification',
                    promptPreview: 'SSE test',
                    fullPrompt: 'Full prompt',
                    status: 'completed',
                    startTime: new Date().toISOString(),
                    endTime: new Date().toISOString(),
                    result: 'Completed result',
                }),
            });

            // Connect to SSE stream — should get status + done immediately
            const sseRes = await request(`${stubBaseUrl}/api/processes/stub-sse-1/stream`);
            expect(sseRes.status).toBe(200);
            expect(sseRes.headers['content-type']).toBe('text/event-stream');
            expect(sseRes.body).toContain('event: status');
            expect(sseRes.body).toContain('event: done');
        });

        it('should return 404 for SSE stream of nonexistent process', async () => {
            const res = await request(`${stubBaseUrl}/api/processes/nonexistent-sse/stream`);
            expect(res.status).toBe(404);
        });
    });
});
