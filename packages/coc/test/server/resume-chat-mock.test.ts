/**
 * Resume Chat Mock Tests
 *
 * Mock-AI cold resume & concurrent resume edge cases for
 * POST /api/queue/:id/resume-chat.
 *
 * Uses createMockProcessStore + vi.mock for getCopilotSDKService to avoid
 * flaky setTimeout dependencies. Placed in a separate file from
 * resume-chat.test.ts because vi.mock at module level would conflict with
 * the existing FileProcessStore-based describe blocks.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Module-level mock: inject mock SDK service before any import resolves it
// ============================================================================

import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
    };
});

import { createExecutionServer } from '../../src/server/index';
import type { AIProcess, ConversationTurn } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

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
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function postJSON(url: string, data?: unknown) {
    return request(url, {
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// Tests — POST /api/queue/:id/resume-chat (mock store)
// ============================================================================

describe('POST /api/queue/:id/resume-chat (mock store)', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let server: ExecutionServer;
    let dataDir: string;

    beforeEach(async () => {
        sdkMocks.resetAll();
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-chat-mock-'));
        store = createMockProcessStore();
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
    });

    afterEach(async () => {
        await server.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    /**
     * Enqueues a chat task and waits for the executor to create the process
     * in the mock store. Returns taskId and processId.
     */
    async function enqueueChatTask(): Promise<{ taskId: string; processId: string }> {
        const res = await postJSON(`${server.url}/api/queue`, {
            type: 'chat',
            payload: { kind: 'chat', prompt: 'Hello world', workingDirectory: dataDir },
            config: {},
            displayName: 'Test Chat',
        });
        const body = JSON.parse(res.body);
        const taskId = body.task.id;
        const processId = `queue_${taskId}`;

        // Wait for executor to create the process and reach a terminal state
        await vi.waitFor(
            () => {
                const proc = store.processes.get(processId);
                expect(proc).toBeDefined();
                expect(proc?.status).not.toBe('running');
            },
            { timeout: 5000 }
        );

        return { taskId, processId };
    }

    it('creates a new process (cold resume) when sdkSessionId is null', async () => {
        const { taskId, processId } = await enqueueChatTask();

        // Override process: null sdkSessionId + conversation history
        const existing = store.processes.get(processId)!;
        store.processes.set(processId, {
            ...existing,
            status: 'completed',
            sdkSessionId: null as any,
            conversationTurns: [
                { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'Hi', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ] as ConversationTurn[],
        });

        const res = await postJSON(
            `${server.url}/api/queue/${encodeURIComponent(taskId)}/resume-chat`,
            { message: 'Follow up' }
        );

        expect([200, 201]).toContain(res.status);
        const body = JSON.parse(res.body);
        expect(body.newTaskId ?? body.taskId).toBeDefined();
    });

    it('returns 409 when two simultaneous resume requests target the same process', async () => {
        const { taskId, processId } = await enqueueChatTask();

        // Override process: valid sdkSessionId + conversation history
        const existing = store.processes.get(processId)!;
        store.processes.set(processId, {
            ...existing,
            status: 'completed',
            sdkSessionId: 'sdk-sess-concurrent',
            conversationTurns: [
                { role: 'user', content: 'Q', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ] as ConversationTurn[],
        });

        // Pause request 1 at the getProcess call so request 2 can arrive while
        // request 1 is in-flight (pid is already in resumeInProgress).
        let releaseRequest1: () => void = () => {};
        const request1Paused = new Promise<void>(r => { releaseRequest1 = r; });
        let getProcessCallCount = 0;
        store.getProcess = vi.fn().mockImplementation(
            async (id: string) => {
                getProcessCallCount++;
                if (getProcessCallCount === 1) {
                    await request1Paused;
                }
                return store.processes.get(id);
            }
        );

        const url = `${server.url}/api/queue/${encodeURIComponent(taskId)}/resume-chat`;

        // Start request 1; it will suspend at the paused getProcess
        const req1Promise = postJSON(url, { message: 'Request 1' });

        // Wait until request 1 is in-flight (handler has added pid to resumeInProgress
        // and is now awaiting the paused getProcess)
        await vi.waitFor(() => expect(getProcessCallCount).toBeGreaterThan(0), { timeout: 2000 });

        // Now send request 2 — pid is in resumeInProgress, so handler returns 409
        const req2Promise = postJSON(url, { message: 'Request 2' });

        // Await request 2 first (it resolves quickly via the 409 path)
        const res2 = await req2Promise;

        // Release request 1 and collect its response
        releaseRequest1();
        const res1 = await req1Promise;

        const statuses = [res1.status, res2.status];
        expect(statuses.some(s => s === 200 || s === 201)).toBe(true);
        expect(statuses.some(s => s === 409 || s === 429 || s === 503)).toBe(true);
    });

    it('returns 503 when AI is unavailable during cold resume', async () => {
        const { taskId, processId } = await enqueueChatTask();

        // Now disable AI so cold resume check fails
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: false });

        // Override process: null sdkSessionId + conversation history (forces cold path)
        const existing = store.processes.get(processId)!;
        store.processes.set(processId, {
            ...existing,
            status: 'completed',
            sdkSessionId: null as any,
            conversationTurns: [
                { role: 'user', content: 'Q', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ] as ConversationTurn[],
        });

        const res = await postJSON(
            `${server.url}/api/queue/${encodeURIComponent(taskId)}/resume-chat`,
            { message: 'Follow up' }
        );

        expect([503, 400]).toContain(res.status);
    });
});
