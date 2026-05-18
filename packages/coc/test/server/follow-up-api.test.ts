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
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { QueueExecutorBridge } from '../../src/server/queue/queue-executor-bridge';
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

        it('should persist user turn and set status to running atomically', async () => {
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
            // Handler persists the user turn atomically with the status change
            expect(updated?.conversationTurns).toHaveLength(1);
            expect(updated?.conversationTurns![0].role).toBe('user');
            expect(updated?.conversationTurns![0].content).toBe('Hello');
            expect(updated?.status).toBe('running');
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

        it('should enqueue a chat-followup task instead of calling executeFollowUp directly', async () => {
            const proc: AIProcess = {
                id: 'proc-enqueue',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-enqueue',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-enqueue/message`, {
                content: 'Hello from enqueue',
            });

            expect(res.status).toBe(202);
            // Should use enqueue, not executeFollowUp directly
            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn).toHaveBeenCalledOnce();
            const call = enqueueFn.mock.calls[0][0];
            expect(call.type).toBe('chat');
            expect(call.payload.kind).toBe('chat');
            expect(call.payload.processId).toBe('proc-enqueue');
            expect(call.payload.prompt).toBe('Hello from enqueue');
            // executeFollowUp should NOT be called directly
            expect(mockBridge.executeFollowUp).not.toHaveBeenCalled();
        });

        it('should call bridge.enqueue (fresh task) when a completed parent task exists', async () => {
            const bridgeWithFind = createMockBridge();
            (bridgeWithFind as any).findTaskByProcessId = vi.fn().mockReturnValue({ id: 'parent-task-1', type: 'chat', status: 'completed' });

            const freshRoutes: Route[] = [];
            registerApiRoutes(freshRoutes, store, bridgeWithFind);
            const freshSpaHtml = generateDashboardHtml();
            const freshHandler = createRequestHandler({ routes: freshRoutes, spaHtml: freshSpaHtml, store });
            const freshServer = http.createServer(freshHandler);
            await new Promise<void>((resolve, reject) => {
                freshServer.on('error', reject);
                freshServer.listen(0, 'localhost', () => resolve());
            });
            const freshAddr = freshServer.address() as { port: number };
            const freshUrl = `http://localhost:${freshAddr.port}`;

            const proc: AIProcess = {
                id: 'proc-completed-parent',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-completed-parent',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${freshUrl}/api/processes/proc-completed-parent/message`, {
                content: 'Follow-up for completed process',
            });

            expect(res.status).toBe(202);
            const enqueueFn = bridgeWithFind.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn).toHaveBeenCalledOnce();
            const call = enqueueFn.mock.calls[0][0];
            expect(call.type).toBe('chat');
            expect(call.payload.prompt).toBe('Follow-up for completed process');
            expect(call.payload.processId).toBe('proc-completed-parent');

            await new Promise<void>((resolve) => freshServer.close(() => resolve()));
        });

        it('should preserve /skill tokens in AI-facing prompt (no stripping)', async () => {
            const proc: AIProcess = {
                id: 'proc-skill',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-skill',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-skill/message`, {
                content: '/impl analyze auth module',
                skillNames: ['impl'],
            });

            expect(res.status).toBe(202);
            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn).toHaveBeenCalledTimes(1);
            const payload = enqueueFn.mock.calls[0][0].payload;
            const sentContent = payload.prompt;
            // /impl must be preserved so the AI SDK sees the skill invocation
            expect(sentContent).toBe('/impl analyze auth module');
            expect(payload.context.skills).toEqual(['impl']);
        });

        it('should pass raw content unchanged when skillNames present', async () => {
            const proc: AIProcess = {
                id: 'proc-raw-display',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-raw-display',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-raw-display/message`, {
                content: '/impl analyze auth module',
                skillNames: ['impl'],
            });

            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            const payload = enqueueFn.mock.calls[0][0].payload;
            const sentContent = payload.prompt;
            expect(sentContent).toBe('/impl analyze auth module');
            expect(payload.context.skills).toEqual(['impl']);
        });

        it('should preserve multiple /skill tokens in prompt', async () => {
            const proc: AIProcess = {
                id: 'proc-multi-skill',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-multi-skill',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-multi-skill/message`, {
                content: '/impl /unknown-skill analyze',
                skillNames: ['impl'],
            });

            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            const payload = enqueueFn.mock.calls[0][0].payload;
            const sentContent = payload.prompt;
            expect(sentContent).toContain('/unknown-skill');
            expect(sentContent).toContain('/impl');
            expect(sentContent).toBe('/impl /unknown-skill analyze');
            expect(payload.context.skills).toEqual(['impl']);
        });

        it('should not alter prompt when skillNames is empty', async () => {
            const proc: AIProcess = {
                id: 'proc-noskill',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-noskill',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-noskill/message`, {
                content: 'plain question',
                skillNames: [],
            });

            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            const sentContent = enqueueFn.mock.calls[0][0].payload.prompt;
            expect(sentContent).toBe('plain question');
            expect(enqueueFn.mock.calls[0][0].payload.context).toBeUndefined();
        });

        it('should not alter prompt when skillNames is not provided', async () => {
            const proc: AIProcess = {
                id: 'proc-nofield',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-nofield',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-nofield/message`, {
                content: 'another question',
            });

            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            const sentContent = enqueueFn.mock.calls[0][0].payload.prompt;
            expect(sentContent).toBe('another question');
            expect(enqueueFn.mock.calls[0][0].payload.context).toBeUndefined();
        });

        it('should not produce empty prompt when only /skill is sent (regression)', async () => {
            const proc: AIProcess = {
                id: 'proc-only-skill',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-only-skill',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-only-skill/message`, {
                content: '/impl',
                skillNames: ['impl'],
            });

            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            const payload = enqueueFn.mock.calls[0][0].payload;
            const sentContent = payload.prompt;
            // Must NOT be empty — the /impl token is the user's full intent
            expect(sentContent).toBe('/impl');
            expect(sentContent.length).toBeGreaterThan(0);
            expect(payload.context.skills).toEqual(['impl']);
        });
    });

    // ========================================================================
    // Mode override
    // ========================================================================

    describe('mode override', () => {
        it('should not eagerly write metadata.mode; mode is passed to dispatch instead', async () => {
            const proc: AIProcess = {
                id: 'proc-mode',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-mode',
                metadata: { mode: 'autopilot' },
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-mode/message`, {
                content: 'switch to ask',
                mode: 'ask',
            });

            expect(res.status).toBe(202);
            // The handler no longer pre-writes mode to metadata; executeFollowUp owns that write.
            const updated = await store.getProcess('proc-mode');
            expect(updated?.metadata?.mode).toBe('autopilot');
        });

        it('should pass mode to enqueue payload when no parent task exists', async () => {
            const proc: AIProcess = {
                id: 'proc-mode-enqueue',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-mode-enq',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-mode-enqueue/message`, {
                content: 'hello',
                mode: 'plan',
            });

            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn).toHaveBeenCalledOnce();
            expect(enqueueFn.mock.calls[0][0].payload.mode).toBe('plan');
        });

        it('should forward mode in enqueue payload when completed parent task exists', async () => {
            const bridgeWithFind = createMockBridge();
            (bridgeWithFind as any).findTaskByProcessId = vi.fn().mockReturnValue({ id: 'parent-mode-1', type: 'chat', status: 'completed' });

            const freshRoutes: Route[] = [];
            registerApiRoutes(freshRoutes, store, bridgeWithFind);
            const freshSpaHtml = generateDashboardHtml();
            const freshHandler = createRequestHandler({ routes: freshRoutes, spaHtml: freshSpaHtml, store });
            const freshServer = http.createServer(freshHandler);
            await new Promise<void>((resolve, reject) => {
                freshServer.on('error', reject);
                freshServer.listen(0, 'localhost', () => resolve());
            });
            const freshAddr = freshServer.address() as { port: number };
            const freshUrl = `http://localhost:${freshAddr.port}`;

            const proc: AIProcess = {
                id: 'proc-mode-completed',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-mode-completed',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${freshUrl}/api/processes/proc-mode-completed/message`, {
                content: 'plan this',
                mode: 'plan',
            });

            expect(res.status).toBe(202);
            const enqueueFn = bridgeWithFind.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn).toHaveBeenCalledOnce();
            expect(enqueueFn.mock.calls[0][0].payload.mode).toBe('plan');

            await new Promise<void>((resolve) => freshServer.close(() => resolve()));
        });

        it('should ignore invalid mode values', async () => {
            const proc: AIProcess = {
                id: 'proc-bad-mode',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-bad-mode',
                metadata: { mode: 'autopilot' },
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-bad-mode/message`, {
                content: 'hello',
                mode: 'invalid-mode',
            });

            const updated = await store.getProcess('proc-bad-mode');
            expect(updated?.metadata?.mode).toBe('autopilot');
        });

        it('should not update metadata when mode is not provided', async () => {
            const proc: AIProcess = {
                id: 'proc-no-mode',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-no-mode',
                metadata: { mode: 'autopilot' },
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-no-mode/message`, {
                content: 'hello',
            });

            const updated = await store.getProcess('proc-no-mode');
            expect(updated?.metadata?.mode).toBe('autopilot');
        });
    });

    // ========================================================================
    // Model override
    // ========================================================================

    describe('model override', () => {
        it('should pass model to enqueue payload', async () => {
            const proc: AIProcess = {
                id: 'proc-model',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-model',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-model/message`, {
                content: 'hello',
                model: 'gpt-5.4',
            });

            expect(res.status).toBe(202);
            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn).toHaveBeenCalledOnce();
            expect(enqueueFn.mock.calls[0][0].payload.model).toBe('gpt-5.4');
        });

        it('should not include model in payload when not provided', async () => {
            const proc: AIProcess = {
                id: 'proc-no-model',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-no-model',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-no-model/message`, {
                content: 'hello',
            });

            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn.mock.calls[0][0].payload.model).toBeUndefined();
        });

        it('should store model on the appended user turn', async () => {
            const proc: AIProcess = {
                id: 'proc-model-turn',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-model-turn',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-model-turn/message`, {
                content: 'hello with model',
                model: 'claude-sonnet-4.6',
            });

            const updated = await store.getProcess('proc-model-turn');
            const userTurn = updated?.conversationTurns?.find(t => t.role === 'user');
            expect(userTurn).toBeDefined();
            expect(userTurn!.model).toBe('claude-sonnet-4.6');
        });

        it('should not store model on user turn when not provided', async () => {
            const proc: AIProcess = {
                id: 'proc-no-model-turn',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-no-model-turn',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-no-model-turn/message`, {
                content: 'hello without model',
            });

            const updated = await store.getProcess('proc-no-model-turn');
            const userTurn = updated?.conversationTurns?.find(t => t.role === 'user');
            expect(userTurn).toBeDefined();
            expect(userTurn!.model).toBeUndefined();
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
        it('should accept follow-up even when process has no sdkSessionId', async () => {
            const proc: AIProcess = {
                id: 'proc-6',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                // No sdkSessionId — still allowed since follow-ups create fresh sessions
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-6/message`, {
                content: 'Hello',
            });

            expect(res.status).toBe(202);
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
            expect(body.error).toBe('The AI session has ended. Please start a new task.');
            expect(body.code).toBe('SESSION_EXPIRED');
        });
    });

    // ========================================================================
    // Conversation history
    // ========================================================================

    describe('conversation history', () => {
        it('should accumulate user turns in store across multiple follow-ups', async () => {
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

            // First follow-up: process is completed → enqueue
            await postJSON(`${baseUrl}/api/processes/proc-8/message`, { content: 'First' });
            // Second follow-up: process is now running → buffered as pending message
            await postJSON(`${baseUrl}/api/processes/proc-8/message`, { content: 'Second' });

            // Handler persists user turns atomically — but NOT for buffered messages.
            // The buffered (2nd) message is only in pendingMessages.
            const updated = await store.getProcess('proc-8');
            expect(updated?.conversationTurns).toHaveLength(1);
            expect(updated?.conversationTurns![0].content).toBe('First');
            // First follow-up enqueues (process was completed), second buffers as pending
            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn).toHaveBeenCalledTimes(1);
            // Second follow-up is buffered in pendingMessages for server-side drain
            expect(updated?.pendingMessages).toHaveLength(1);
            expect(updated?.pendingMessages![0].content).toBe('Second');
        });

        it('should set status to running and enqueue with correct content', async () => {
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

            // Handler no longer saves turns; verify status and enqueue
            const updated = await store.getProcess('proc-9');
            expect(updated?.status).toBe('running');
            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn.mock.calls[0][0].payload.prompt).toBe('Check timestamp');
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
            // Handler no longer saves turns; verify enqueue payload is unsanitised
            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn.mock.calls[0][0].payload.prompt).toBe('<script>alert(1)</script>');
        });

        it('should accept content with unicode and emoji characters', async () => {
            await addProcessForEdgeCase('edge-unicode');
            const content = 'Hello 🌍 日本語 العربية';
            const res = await postJSON(`${baseUrl}/api/processes/edge-unicode/message`, {
                content,
            });
            expect(res.status).toBe(202);
            // Handler no longer saves turns; verify enqueue payload preserves unicode
            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn.mock.calls[0][0].payload.prompt).toBe(content);
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
        it('should handle two simultaneous follow-ups without errors', async () => {
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

            // With server-side drain, one request may enqueue while the other
            // buffers as a pending message (depending on race timing).
            // Both requests must succeed (202).
            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            const updated = await store.getProcess('proc-concurrent');
            const pendingCount = updated?.pendingMessages?.length ?? 0;
            expect(enqueueFn.mock.calls.length + pendingCount).toBeGreaterThanOrEqual(2);
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
            const turnIndexes = [body1.turnIndex, body2.turnIndex];
            expect(turnIndexes.every(value => typeof value === 'number')).toBe(true);

            const appendedTurnIndexes = turnIndexes.filter(value => value >= 0);
            const bufferedCount = turnIndexes.filter(value => value === -1).length;
            expect(appendedTurnIndexes.length + bufferedCount).toBe(2);
            expect(new Set(appendedTurnIndexes).size).toBe(appendedTurnIndexes.length);
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

        it('should return JSON success envelope on 202 when process has no sdkSessionId', async () => {
            const proc: AIProcess = {
                id: 'proc-fmt-202',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-fmt-202/message`, {
                content: 'Hello',
            });
            expect(res.status).toBe(202);
            expect(res.headers['content-type']).toContain('application/json');
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
            expect(body).toHaveProperty('error', 'The AI session has ended. Please start a new task.');
            expect(body).toHaveProperty('code', 'SESSION_EXPIRED');
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
            // turnIndex is estimated from existing conversationTurns length
            expect(body.turnIndex).toBe(3);
        });

        it('should return incrementing turnIndex as handler persists user turns', async () => {
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

            // Handler persists turns, so array length increments
            // Second message is buffered (process is now running, no parent task) → turnIndex -1
            const res2 = await postJSON(`${baseUrl}/api/processes/proc-tidx-incr/message`, {
                content: 'second-follow-up',
            });
            expect(JSON.parse(res2.body).turnIndex).toBe(-1);
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
            // Buffered path — status remains unchanged
            expect(updated?.status).toBe('queued');
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

            // Handler no longer saves turns; verify enqueue payload has full content
            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'chat',
                    payload: expect.objectContaining({
                        processId: 'proc-large-store',
                        prompt: largeContent,
                    }),
                })
            );
        });
    });

    // ========================================================================
    // Enqueue failure rollback
    // ========================================================================

    describe('enqueue failure rollback', () => {
        it('should return 500 and rollback status when enqueue throws', async () => {
            const proc: AIProcess = {
                id: 'proc-enq-fail2',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'failed',
                startTime: new Date(),
                sdkSessionId: 'sess-enq-fail2',
            };
            await store.addProcess(proc);

            // Make enqueue throw
            (mockBridge.enqueue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                new Error('Queue full'),
            );

            const res = await postJSON(`${baseUrl}/api/processes/proc-enq-fail2/message`, {
                content: 'Retry message',
            });

            expect(res.status).toBe(500);
            const body = JSON.parse(res.body);
            expect(body.code).toBe('ENQUEUE_FAILED');

            // Status must be rolled back to 'failed' (the prior status)
            const updated = await store.getProcess('proc-enq-fail2');
            expect(updated?.status).toBe('failed');
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

    // ========================================================================
    // Selected-skills directive in follow-up turns
    // ========================================================================

    describe('selected_skills directive in follow-up turn content', () => {
        it('should prepend selected_skills directive to stored turn content when skills are provided', async () => {
            const proc: AIProcess = {
                id: 'proc-skills-1',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-skills',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-skills-1/message`, {
                content: 'Fix the bug',
                skillNames: ['impl', 'review'],
            });

            const updated = await store.getProcess('proc-skills-1');
            const userTurn = updated?.conversationTurns?.find(t => t.role === 'user');
            expect(userTurn?.content).toContain('<selected_skills>');
            expect(userTurn?.content).toContain('impl, review');
            expect(userTurn?.content).toContain('Fix the bug');
        });

        it('should not alter stored turn content when no skills are provided', async () => {
            const proc: AIProcess = {
                id: 'proc-skills-2',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-noskills',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-skills-2/message`, {
                content: 'Hello world',
            });

            const updated = await store.getProcess('proc-skills-2');
            const userTurn = updated?.conversationTurns?.find(t => t.role === 'user');
            expect(userTurn?.content).toBe('Hello world');
            expect(userTurn?.content).not.toContain('<selected_skills>');
        });

        it('should pass original content (without directive) to executor paths', async () => {
            const proc: AIProcess = {
                id: 'proc-skills-3',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-exec',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${baseUrl}/api/processes/proc-skills-3/message`, {
                content: 'Fix the bug',
                skillNames: ['impl'],
            });

            // The enqueue call should receive the original content, not the directive-prepended one
            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            const call = enqueueFn.mock.calls[0][0];
            expect(call.payload.prompt).toBe('Fix the bug');
            expect(call.payload.prompt).not.toContain('<selected_skills>');
        });
    });

    // ========================================================================
    // Server-side pending message buffering
    // ========================================================================

    describe('server-side pending message buffering', () => {
        it('should buffer follow-up as pending message when task is running with enqueue delivery', async () => {
            const bridgeWithRunning = createMockBridge();
            (bridgeWithRunning as any).findTaskByProcessId = vi.fn().mockReturnValue({ id: 'task-running-1', type: 'chat', status: 'running' });

            const freshRoutes: Route[] = [];
            registerApiRoutes(freshRoutes, store, bridgeWithRunning);
            const freshHandler = createRequestHandler({ routes: freshRoutes, spaHtml: generateDashboardHtml(), store });
            const freshServer = http.createServer(freshHandler);
            await new Promise<void>((resolve, reject) => {
                freshServer.on('error', reject);
                freshServer.listen(0, 'localhost', () => resolve());
            });
            const freshUrl = `http://localhost:${(freshServer.address() as { port: number }).port}`;

            const proc: AIProcess = {
                id: 'proc-running-buf',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'sess-run',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${freshUrl}/api/processes/proc-running-buf/message`, {
                content: 'Queued while running',
            });

            expect(res.status).toBe(202);
            // enqueue should NOT be called — message is buffered instead
            expect(bridgeWithRunning.enqueue as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
            // Verify pending message was stored
            const updated = await store.getProcess('proc-running-buf');
            expect(updated?.pendingMessages).toHaveLength(1);
            expect(updated?.pendingMessages![0].content).toBe('Queued while running');
            expect(updated?.pendingMessages![0].id).toBeDefined();
            expect(updated?.pendingMessages![0].createdAt).toBeDefined();

            await new Promise<void>((resolve) => freshServer.close(() => resolve()));
        });

        it('should buffer follow-up when task is queued', async () => {
            const bridgeWithQueued = createMockBridge();
            (bridgeWithQueued as any).findTaskByProcessId = vi.fn().mockReturnValue({ id: 'task-queued-1', type: 'chat', status: 'queued' });

            const freshRoutes: Route[] = [];
            registerApiRoutes(freshRoutes, store, bridgeWithQueued);
            const freshHandler = createRequestHandler({ routes: freshRoutes, spaHtml: generateDashboardHtml(), store });
            const freshServer = http.createServer(freshHandler);
            await new Promise<void>((resolve, reject) => {
                freshServer.on('error', reject);
                freshServer.listen(0, 'localhost', () => resolve());
            });
            const freshUrl = `http://localhost:${(freshServer.address() as { port: number }).port}`;

            const proc: AIProcess = {
                id: 'proc-queued-buf',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'queued',
                startTime: new Date(),
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${freshUrl}/api/processes/proc-queued-buf/message`, {
                content: 'Queued while queued',
            });

            expect(res.status).toBe(202);
            expect(bridgeWithQueued.enqueue as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
            const updated = await store.getProcess('proc-queued-buf');
            expect(updated?.pendingMessages).toHaveLength(1);
            expect(updated?.pendingMessages![0].content).toBe('Queued while queued');

            await new Promise<void>((resolve) => freshServer.close(() => resolve()));
        });

        it('should buffer follow-up when task not found but process is non-terminal', async () => {
            // Default mock bridge has no findTaskByProcessId → returns undefined
            const proc: AIProcess = {
                id: 'proc-nonterminal-buf',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'sess-nt',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-nonterminal-buf/message`, {
                content: 'Follow-up to running process',
            });

            expect(res.status).toBe(202);
            // No parentTask found, but priorStatus is 'running' (non-terminal) → buffer
            const updated = await store.getProcess('proc-nonterminal-buf');
            expect(updated?.pendingMessages).toHaveLength(1);
            expect(updated?.pendingMessages![0].content).toBe('Follow-up to running process');
        });

        it('should enqueue when task not found and process was terminal (failed)', async () => {
            const proc: AIProcess = {
                id: 'proc-failed-enqueue',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'failed',
                startTime: new Date(),
                sdkSessionId: 'sess-fail',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${baseUrl}/api/processes/proc-failed-enqueue/message`, {
                content: 'Retry after failure',
            });

            expect(res.status).toBe(202);
            // No parentTask found, priorStatus is 'failed' (terminal) → enqueue
            const enqueueFn = mockBridge.enqueue as ReturnType<typeof vi.fn>;
            expect(enqueueFn).toHaveBeenCalled();
            const call = enqueueFn.mock.calls[0][0];
            expect(call.payload.prompt).toBe('Retry after failure');
        });

        it('should buffer follow-up with mode override when task is running', async () => {
            const bridgeWithRunning = createMockBridge();
            (bridgeWithRunning as any).findTaskByProcessId = vi.fn().mockReturnValue({ id: 'task-running-mode', type: 'chat', status: 'running' });

            const freshRoutes: Route[] = [];
            registerApiRoutes(freshRoutes, store, bridgeWithRunning);
            const freshHandler = createRequestHandler({ routes: freshRoutes, spaHtml: generateDashboardHtml(), store });
            const freshServer = http.createServer(freshHandler);
            await new Promise<void>((resolve, reject) => {
                freshServer.on('error', reject);
                freshServer.listen(0, 'localhost', () => resolve());
            });
            const freshUrl = `http://localhost:${(freshServer.address() as { port: number }).port}`;

            const proc: AIProcess = {
                id: 'proc-running-mode',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'sess-mode',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${freshUrl}/api/processes/proc-running-mode/message`, {
                content: 'Switch mode',
                mode: 'autopilot',
            });

            expect(res.status).toBe(202);
            const updated = await store.getProcess('proc-running-mode');
            expect(updated?.pendingMessages).toHaveLength(1);
            expect(updated?.pendingMessages![0].mode).toBe('autopilot');

            await new Promise<void>((resolve) => freshServer.close(() => resolve()));
        });

        it('should buffer when steering fails for immediate delivery on running task', async () => {
            const bridgeWithFailedSteer = createMockBridge();
            (bridgeWithFailedSteer as any).findTaskByProcessId = vi.fn().mockReturnValue({ id: 'task-steer-fail', type: 'chat', status: 'running' });
            (bridgeWithFailedSteer as any).steerProcess = vi.fn().mockResolvedValue(false);

            const freshRoutes: Route[] = [];
            registerApiRoutes(freshRoutes, store, bridgeWithFailedSteer);
            const freshHandler = createRequestHandler({ routes: freshRoutes, spaHtml: generateDashboardHtml(), store });
            const freshServer = http.createServer(freshHandler);
            await new Promise<void>((resolve, reject) => {
                freshServer.on('error', reject);
                freshServer.listen(0, 'localhost', () => resolve());
            });
            const freshUrl = `http://localhost:${(freshServer.address() as { port: number }).port}`;

            const proc: AIProcess = {
                id: 'proc-steer-fail',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'sess-steer',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            const res = await postJSON(`${freshUrl}/api/processes/proc-steer-fail/message`, {
                content: 'Steering failed message',
                deliveryMode: 'immediate',
            });

            expect(res.status).toBe(202);
            // Steering failed → should buffer as pending, not enqueue
            expect(bridgeWithFailedSteer.enqueue as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
            const updated = await store.getProcess('proc-steer-fail');
            expect(updated?.pendingMessages).toHaveLength(1);
            expect(updated?.pendingMessages![0].content).toBe('Steering failed message');

            await new Promise<void>((resolve) => freshServer.close(() => resolve()));
        });

        it('should accumulate multiple pending messages in order', async () => {
            const bridgeWithRunning = createMockBridge();
            (bridgeWithRunning as any).findTaskByProcessId = vi.fn().mockReturnValue({ id: 'task-multi-pend', type: 'chat', status: 'running' });

            const freshRoutes: Route[] = [];
            registerApiRoutes(freshRoutes, store, bridgeWithRunning);
            const freshHandler = createRequestHandler({ routes: freshRoutes, spaHtml: generateDashboardHtml(), store });
            const freshServer = http.createServer(freshHandler);
            await new Promise<void>((resolve, reject) => {
                freshServer.on('error', reject);
                freshServer.listen(0, 'localhost', () => resolve());
            });
            const freshUrl = `http://localhost:${(freshServer.address() as { port: number }).port}`;

            const proc: AIProcess = {
                id: 'proc-multi-pend',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'sess-multi-pend',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            await postJSON(`${freshUrl}/api/processes/proc-multi-pend/message`, { content: 'First pending' });
            await postJSON(`${freshUrl}/api/processes/proc-multi-pend/message`, { content: 'Second pending' });
            await postJSON(`${freshUrl}/api/processes/proc-multi-pend/message`, { content: 'Third pending' });

            const updated = await store.getProcess('proc-multi-pend');
            expect(updated?.pendingMessages).toHaveLength(3);
            expect(updated?.pendingMessages![0].content).toBe('First pending');
            expect(updated?.pendingMessages![1].content).toBe('Second pending');
            expect(updated?.pendingMessages![2].content).toBe('Third pending');

            await new Promise<void>((resolve) => freshServer.close(() => resolve()));
        });
    });
});
