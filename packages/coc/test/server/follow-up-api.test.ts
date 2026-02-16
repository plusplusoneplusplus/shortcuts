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
import type { Route } from '../../src/server/types';
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
                    { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0 },
                    { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1 },
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
});
