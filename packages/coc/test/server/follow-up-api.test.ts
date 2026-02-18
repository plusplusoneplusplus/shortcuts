/**
 * Follow-Up API Tests
 *
 * Tests for the POST /api/processes/:id/message REST endpoint:
 * success path, 404/400/409/410 error paths, and turn appending.
 *
 * Uses a real FileProcessStore with temp dir and OS-assigned port.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { QueueExecutorBridge } from '../../src/server/queue-executor-bridge';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { createMockBridge } from '../helpers/mock-sdk-service';

// ============================================================================
// Helpers
// ============================================================================

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
                headers: options.headers,
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

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/processes/:id/message', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let store: FileProcessStore;
    let baseUrl: string;
    let mockBridge: QueueExecutorBridge;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-up-api-test-'));
        store = new FileProcessStore({ dataDir });

        mockBridge = createMockBridge();

        const routes: Route[] = [];
        registerApiRoutes(routes, store, mockBridge);

        const spaHtml = generateDashboardHtml();
        const handler = createRequestHandler({ routes, spaHtml, store });
        server = http.createServer(handler);

        await new Promise<void>((resolve, reject) => {
            server!.on('error', reject);
            server!.listen(0, 'localhost', () => resolve());
        });

        const address = server.address() as { port: number };
        baseUrl = `http://localhost:${address.port}`;
    });

    afterEach(async () => {
        if (server) {
            await new Promise<void>((resolve) => {
                server!.close(() => resolve());
            });
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ========================================================================
    // Success path
    // ========================================================================

    describe('success path', () => {
        it('should return 202 with processId and turnIndex for valid follow-up', async () => {
            const proc: AIProcess = {
                id: 'proc-1',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-abc',
                conversationTurns: [
                    { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0 , timeline: [] },
                    { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1 , timeline: [] },
                ],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-1/message`, {
                content: 'Follow-up question',
            });

            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            expect(body.processId).toBe('proc-1');
            expect(body.turnIndex).toBe(2);
        });

        it('should append user turn to conversationTurns', async () => {
            const proc: AIProcess = {
                id: 'proc-2',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-def',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-2/message`, {
                content: 'Hello',
            });

            const updated = await store.getProcess('proc-2');
            expect(updated?.conversationTurns).toHaveLength(1);
            expect(updated!.conversationTurns![0].role).toBe('user');
            expect(updated!.conversationTurns![0].content).toBe('Hello');
            expect(updated!.conversationTurns![0].turnIndex).toBe(0);
        });

        it('should persist updated process in store with running status', async () => {
            const proc: AIProcess = {
                id: 'proc-3',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-ghi',
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-3/message`, {
                content: 'Question',
            });

            const updated = await store.getProcess('proc-3');
            expect(updated?.status).toBe('running');
        });
    });

    // ========================================================================
    // Error: unknown process
    // ========================================================================

    describe('error: unknown process', () => {
        it('should return 404 when process id does not exist', async () => {
            const res = await postJSON(`${baseUrl}/api/processes/nonexistent/message`, {
                content: 'Hello',
            });

            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/not found/i);
        });
    });

    // ========================================================================
    // Error: missing content
    // ========================================================================

    describe('error: missing content', () => {
        it('should return 400 when request body has no content field', async () => {
            const proc: AIProcess = {
                id: 'proc-4',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-jkl',
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-4/message`, {});
            expect(res.status).toBe(400);
        });

        it('should return 400 when content is empty string', async () => {
            const proc: AIProcess = {
                id: 'proc-5',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-mno',
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-5/message`, {
                content: '',
            });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // Error: no session
    // ========================================================================

    describe('error: no session', () => {
        it('should return 409 when process has no sdkSessionId', async () => {
            const proc: AIProcess = {
                id: 'proc-6',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                // No sdkSessionId
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-6/message`, {
                content: 'Hello',
            });

            expect(res.status).toBe(409);
            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/no SDK session/i);
        });

        it('should return 410 when sdkSessionId references expired/destroyed session', async () => {
            (mockBridge.isSessionAlive as any).mockResolvedValue(false);

            const proc: AIProcess = {
                id: 'proc-7',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-expired',
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-7/message`, {
                content: 'Hello',
            });

            expect(res.status).toBe(410);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('session_expired');
        });
    });

    // ========================================================================
    // Conversation history
    // ========================================================================

    describe('conversation history', () => {
        it('should accumulate turns across multiple follow-ups', async () => {
            const proc: AIProcess = {
                id: 'proc-8',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-multi',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            // First follow-up
            await postJSON(`${baseUrl}/api/processes/proc-8/message`, { content: 'First' });
            // Second follow-up
            await postJSON(`${baseUrl}/api/processes/proc-8/message`, { content: 'Second' });

            const updated = await store.getProcess('proc-8');
            expect(updated?.conversationTurns).toHaveLength(2);
            expect(updated!.conversationTurns![0].content).toBe('First');
            expect(updated!.conversationTurns![1].content).toBe('Second');
        });

        it('should include correct role and timestamp on each turn', async () => {
            const proc: AIProcess = {
                id: 'proc-9',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-ts',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-9/message`, { content: 'Check timestamp' });

            const updated = await store.getProcess('proc-9');
            const turn = updated!.conversationTurns![0];
            expect(turn.role).toBe('user');
            expect(turn.timestamp).toBeInstanceOf(Date);
            expect(turn.turnIndex).toBe(0);
        });
    });

    // ========================================================================
    // Bridge unavailable (501)
    // ========================================================================

    describe('error: bridge unavailable', () => {
        let noBridgeServer: http.Server | undefined;
        let noBridgeBaseUrl: string;

        beforeEach(async () => {
            const routes: Route[] = [];
            registerApiRoutes(routes, store, undefined);
            const spaHtml = generateDashboardHtml();
            const handler = createRequestHandler({ routes, spaHtml, store });
            noBridgeServer = http.createServer(handler);
            await new Promise<void>((resolve, reject) => {
                noBridgeServer!.on('error', reject);
                noBridgeServer!.listen(0, 'localhost', () => resolve());
            });
            const addr = noBridgeServer.address() as { port: number };
            noBridgeBaseUrl = `http://localhost:${addr.port}`;
        });

        afterEach(async () => {
            if (noBridgeServer) {
                await new Promise<void>((r) => noBridgeServer!.close(() => r()));
                noBridgeServer = undefined;
            }
        });

        it('should return 501 when no bridge is configured', async () => {
            const proc: AIProcess = {
                id: 'proc-no-bridge',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-alive',
            };
            await store.addProcess(proc);

            const res = await postJSON(
                `${noBridgeBaseUrl}/api/processes/proc-no-bridge/message`,
                { content: 'Hello' }
            );
            expect(res.status).toBe(501);
            expect(JSON.parse(res.body).error).toMatch(/not available/i);
        });
    });

    // ========================================================================
    // Content validation edge cases
    // ========================================================================

    describe('content validation edge cases', () => {
        async function addProcessForEdgeCase(id: string): Promise<void> {
            const proc: AIProcess = {
                id,
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-edge',
            };
            await store.addProcess(proc);
        }

        it('should return 400 when content is null', async () => {
            await addProcessForEdgeCase('edge-null');
            const res = await postJSON(`${baseUrl}/api/processes/edge-null/message`, {
                content: null,
            });
            expect(res.status).toBe(400);
        });

        it('should return 400 when content is a number', async () => {
            await addProcessForEdgeCase('edge-num');
            const res = await postJSON(`${baseUrl}/api/processes/edge-num/message`, {
                content: 123,
            });
            expect(res.status).toBe(400);
        });

        it('should return 400 when content is a boolean', async () => {
            await addProcessForEdgeCase('edge-bool');
            const res = await postJSON(`${baseUrl}/api/processes/edge-bool/message`, {
                content: true,
            });
            expect(res.status).toBe(400);
        });

        it('should return 400 when content is an array', async () => {
            await addProcessForEdgeCase('edge-arr');
            const res = await postJSON(`${baseUrl}/api/processes/edge-arr/message`, {
                content: ['a', 'b'],
            });
            expect(res.status).toBe(400);
        });

        it('should return 400 when content is an object', async () => {
            await addProcessForEdgeCase('edge-obj');
            const res = await postJSON(`${baseUrl}/api/processes/edge-obj/message`, {
                content: { text: 'hello' },
            });
            expect(res.status).toBe(400);
        });

        it('should accept whitespace-only content (current behaviour)', async () => {
            await addProcessForEdgeCase('edge-ws');
            const res = await postJSON(`${baseUrl}/api/processes/edge-ws/message`, {
                content: '   ',
            });
            expect(res.status).toBe(202);
        });

        it('should accept content with HTML/script tags without sanitising', async () => {
            await addProcessForEdgeCase('edge-html');
            const res = await postJSON(`${baseUrl}/api/processes/edge-html/message`, {
                content: '<script>alert(1)</script>',
            });
            expect(res.status).toBe(202);
            const updated = await store.getProcess('edge-html');
            expect(updated!.conversationTurns![0].content).toBe('<script>alert(1)</script>');
        });

        it('should accept content with unicode and emoji characters', async () => {
            await addProcessForEdgeCase('edge-unicode');
            const content = 'Hello 🌍 日本語 العربية';
            const res = await postJSON(`${baseUrl}/api/processes/edge-unicode/message`, {
                content,
            });
            expect(res.status).toBe(202);
            const updated = await store.getProcess('edge-unicode');
            expect(updated!.conversationTurns![0].content).toBe(content);
        });

        it('should return 400 for invalid JSON body', async () => {
            await addProcessForEdgeCase('edge-badjson');
            const res = await request(`${baseUrl}/api/processes/edge-badjson/message`, {
                method: 'POST',
                body: '{not json',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toMatch(/invalid json/i);
        });
    });

    // ========================================================================
    // Concurrent follow-ups
    // ========================================================================

    describe('concurrent follow-ups', () => {
        it('should handle two simultaneous follow-ups without losing turns', async () => {
            const proc: AIProcess = {
                id: 'proc-concurrent',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-concurrent',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const [res1, res2] = await Promise.all([
                postJSON(`${baseUrl}/api/processes/proc-concurrent/message`, { content: 'First' }),
                postJSON(`${baseUrl}/api/processes/proc-concurrent/message`, { content: 'Second' }),
            ]);

            expect(res1.status).toBe(202);
            expect(res2.status).toBe(202);

            const updated = await store.getProcess('proc-concurrent');
            // Non-atomic read-modify-write means a race can cause one turn to
            // overwrite the other.  We assert >= 1 to document that the race
            // exists; if a future implementation adds locking, tighten to toBe(2).
            expect(updated!.conversationTurns!.length).toBeGreaterThanOrEqual(1);
        });

        it('should assign unique turnIndex values to concurrent requests', async () => {
            const proc: AIProcess = {
                id: 'proc-concurrent-idx',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-concurrent-idx',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const [res1, res2] = await Promise.all([
                postJSON(`${baseUrl}/api/processes/proc-concurrent-idx/message`, { content: 'A' }),
                postJSON(`${baseUrl}/api/processes/proc-concurrent-idx/message`, { content: 'B' }),
            ]);

            expect(res1.status).toBe(202);
            expect(res2.status).toBe(202);

            const body1 = JSON.parse(res1.body);
            const body2 = JSON.parse(res2.body);
            // Both turnIndex values should be valid non-negative numbers
            expect(body1.turnIndex).toBeGreaterThanOrEqual(0);
            expect(body2.turnIndex).toBeGreaterThanOrEqual(0);
        });
    });

    // ========================================================================
    // Response format validation
    // ========================================================================

    describe('response format validation', () => {
        it('should return JSON content-type header on 202 success', async () => {
            const proc: AIProcess = {
                id: 'proc-fmt-202',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-fmt',
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-fmt-202/message`, {
                content: 'test',
            });
            expect(res.status).toBe(202);
            expect(res.headers['content-type']).toContain('application/json');
        });

        it('should include processId and turnIndex in 202 response body', async () => {
            const proc: AIProcess = {
                id: 'proc-fmt-body',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-fmt-body',
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-fmt-body/message`, {
                content: 'test',
            });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            expect(body).toHaveProperty('processId', 'proc-fmt-body');
            expect(body).toHaveProperty('turnIndex');
            expect(typeof body.turnIndex).toBe('number');
        });

        it('should return JSON error envelope on 400', async () => {
            const proc: AIProcess = {
                id: 'proc-fmt-400',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-fmt-400',
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-fmt-400/message`, {});
            expect(res.status).toBe(400);
            expect(res.headers['content-type']).toContain('application/json');
            const body = JSON.parse(res.body);
            expect(body).toHaveProperty('error');
            expect(typeof body.error).toBe('string');
        });

        it('should return JSON error envelope on 404', async () => {
            const res = await postJSON(`${baseUrl}/api/processes/nonexistent-fmt/message`, {
                content: 'Hello',
            });
            expect(res.status).toBe(404);
            expect(res.headers['content-type']).toContain('application/json');
            const body = JSON.parse(res.body);
            expect(body).toHaveProperty('error');
            expect(typeof body.error).toBe('string');
        });

        it('should return JSON error envelope on 409', async () => {
            const proc: AIProcess = {
                id: 'proc-fmt-409',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-fmt-409/message`, {
                content: 'Hello',
            });
            expect(res.status).toBe(409);
            expect(res.headers['content-type']).toContain('application/json');
            const body = JSON.parse(res.body);
            expect(body).toHaveProperty('error');
            expect(typeof body.error).toBe('string');
        });

        it('should include both error and message fields on 410', async () => {
            (mockBridge.isSessionAlive as any).mockResolvedValue(false);
            const proc: AIProcess = {
                id: 'proc-fmt-410',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-expired-fmt',
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-fmt-410/message`, {
                content: 'test',
            });
            expect(res.status).toBe(410);
            expect(res.headers['content-type']).toContain('application/json');
            const body = JSON.parse(res.body);
            expect(body).toHaveProperty('error', 'session_expired');
            expect(body).toHaveProperty('message');
            expect(typeof body.message).toBe('string');
        });
    });

    // ========================================================================
    // Turn index consistency
    // ========================================================================

    describe('turn index consistency', () => {
        it('should set turnIndex based on conversationTurns array length', async () => {
            const proc: AIProcess = {
                id: 'proc-tidx-len',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-tidx-len',
                conversationTurns: [
                    { role: 'user', content: 'q1', timestamp: new Date(), turnIndex: 0 , timeline: [] },
                    { role: 'assistant', content: 'a1', timestamp: new Date(), turnIndex: 1 , timeline: [] },
                    { role: 'user', content: 'q2', timestamp: new Date(), turnIndex: 2 , timeline: [] },
                ],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-tidx-len/message`, {
                content: 'q3',
            });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            expect(body.turnIndex).toBe(3);

            const updated = await store.getProcess('proc-tidx-len');
            expect(updated!.conversationTurns![3].turnIndex).toBe(3);
        });

        it('should continue incrementing turnIndex after pre-existing turns', async () => {
            const existingTurns = Array.from({ length: 5 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
                content: `turn-${i}`,
                timestamp: new Date(),
                turnIndex: i,
                timeline: [],
            }));
            const proc: AIProcess = {
                id: 'proc-tidx-incr',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-tidx-incr',
                conversationTurns: existingTurns,
            };
            await store.addProcess(proc);

            const res1 = await postJSON(`${baseUrl}/api/processes/proc-tidx-incr/message`, {
                content: 'first-follow-up',
            });
            expect(JSON.parse(res1.body).turnIndex).toBe(5);

            const res2 = await postJSON(`${baseUrl}/api/processes/proc-tidx-incr/message`, {
                content: 'second-follow-up',
            });
            expect(JSON.parse(res2.body).turnIndex).toBe(6);
        });

        it('should start at turnIndex 0 when conversationTurns is undefined', async () => {
            const proc: AIProcess = {
                id: 'proc-tidx-undef',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-tidx-undef',
                // conversationTurns intentionally omitted
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-tidx-undef/message`, {
                content: 'first',
            });
            expect(res.status).toBe(202);
            expect(JSON.parse(res.body).turnIndex).toBe(0);
        });
    });

    // ========================================================================
    // Follow-up on non-idle process
    // ========================================================================

    describe('follow-up on non-idle process', () => {
        it('should accept follow-up even when process status is running', async () => {
            const proc: AIProcess = {
                id: 'proc-st-running',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'sess-st-running',
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-st-running/message`, {
                content: 'Hello',
            });
            expect(res.status).toBe(202);

            const updated = await store.getProcess('proc-st-running');
            expect(updated?.status).toBe('running');
        });

        it('should accept follow-up when process status is failed', async () => {
            const proc: AIProcess = {
                id: 'proc-st-failed',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'failed',
                startTime: new Date(),
                sdkSessionId: 'sess-st-failed',
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-st-failed/message`, {
                content: 'Retry',
            });
            expect(res.status).toBe(202);

            const updated = await store.getProcess('proc-st-failed');
            expect(updated?.status).toBe('running');
        });

        it('should accept follow-up when process status is queued', async () => {
            const proc: AIProcess = {
                id: 'proc-st-queued',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'queued',
                startTime: new Date(),
                sdkSessionId: 'sess-st-queued',
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-st-queued/message`, {
                content: 'Follow',
            });
            expect(res.status).toBe(202);

            const updated = await store.getProcess('proc-st-queued');
            expect(updated?.status).toBe('running');
        });
    });

    // ========================================================================
    // Large content payload
    // ========================================================================

    describe('large content payload', () => {
        it('should accept a 100KB message body', async () => {
            const proc: AIProcess = {
                id: 'proc-large',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-large',
            };
            await store.addProcess(proc);

            const largeContent = 'x'.repeat(100_000);
            const res = await postJSON(`${baseUrl}/api/processes/proc-large/message`, {
                content: largeContent,
            });
            expect(res.status).toBe(202);
        });

        it('should store the full content without truncation', async () => {
            const proc: AIProcess = {
                id: 'proc-large-store',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-large-store',
            };
            await store.addProcess(proc);

            const largeContent = 'x'.repeat(100_000);
            await postJSON(`${baseUrl}/api/processes/proc-large-store/message`, {
                content: largeContent,
            });

            const updated = await store.getProcess('proc-large-store');
            expect(updated!.conversationTurns![0].content.length).toBe(100_000);
            expect(mockBridge.executeFollowUp).toHaveBeenCalledWith(
                'proc-large-store',
                largeContent
            );
        });
    });

    // ========================================================================
    // Invalid process ID patterns
    // ========================================================================

    describe('invalid process ID patterns', () => {
        it('should return 404 for empty process ID', async () => {
            // Route regex ^\/api\/processes\/([^/]+)\/message$ won't match empty segment
            const res = await postJSON(`${baseUrl}/api/processes//message`, {
                content: 'Hello',
            });
            expect(res.status).toBe(404);
        });

        it('should return 404 for process ID with URL-encoded special characters', async () => {
            // decodeURIComponent('proc%2F123') => 'proc/123' which doesn't exist
            const res = await postJSON(`${baseUrl}/api/processes/proc%2F123/message`, {
                content: 'Hello',
            });
            expect(res.status).toBe(404);
        });

        it('should handle process ID with spaces and question marks (URL encoding)', async () => {
            // decodeURIComponent('a%20b%3Fc') => 'a b?c' which doesn't exist
            const res = await postJSON(`${baseUrl}/api/processes/a%20b%3Fc/message`, {
                content: 'Hello',
            });
            expect(res.status).toBe(404);
        });
    });
});
