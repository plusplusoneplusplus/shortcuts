/**
 * sensitive-input leak guard.
 *
 * Drives a `sensitive-input` ask_user question through the real answer path —
 * HTTP ask-user-response route → CLITaskExecutor bridge → ChatExecutor ask_user
 * tool — while a buggy client tries to smuggle a marker value through every
 * answer field. The marker must be rejected and must never reach the tool
 * result, `pendingAskUser`, emitted SSE events, the stored process/timeline,
 * or logs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { CLITaskExecutor } from '../../../src/server/queue/queue-executor-bridge';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import { createRouter } from '../../../src/server/shared/router';
import { createFixedQueueRuntimeConfig } from '../../../src/server/queue/queue-runtime-config';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { nestRuntime } from './runtime-options-helper';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        promises: { ...actual.promises, readdir: vi.fn().mockResolvedValue([]), mkdir: vi.fn().mockResolvedValue(undefined) },
    };
});
vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));
vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../src/server/executors/memory-v2-addon', () => ({
    buildMemoryV2Addon: vi.fn().mockResolvedValue({
        tools: [], suffix: '', systemMessageSuffix: undefined, excludedBuiltinTools: [], dispose: vi.fn(),
    }),
}));
vi.mock('../../../src/server/memory/conversation-recorder', () => ({
    recordUserMessage: vi.fn(),
}));

const MARKER = 'LEAKMARKER_sess=8f3c1d0e2b';
const sdkMocks = createMockSDKService();

function post(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const url = new URL(path, baseUrl);
        const req = http.request({
            hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }, res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
        });
        req.on('error', reject);
        req.end(JSON.stringify(body));
    });
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
    for (let i = 0; i < 200; i++) {
        const value = read();
        if (value !== undefined) return value;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for condition');
}

describe('sensitive-input answer path never carries the secret', () => {
    let server: http.Server;
    let baseUrl: string;
    let logs: string[];

    beforeEach(async () => {
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        logs = [];
        const capture = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); return true; };
        vi.spyOn(process.stderr, 'write').mockImplementation(capture as any);
        vi.spyOn(process.stdout, 'write').mockImplementation(capture as any);
        for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
            vi.spyOn(console, level).mockImplementation(capture as any);
        }
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    });

    it('rejects a marker in every answer field and delivers only a count/domain receipt', async () => {
        const store = createMockProcessStore();
        const chat = new ChatExecutor(store, nestRuntime({
            aiService: sdkMocks.service as any,
            defaultTimeoutMs: 30_000,
            followUpSuggestions: { enabled: false, count: 3 },
            askUser: { enabled: true },
            queueConfig: createFixedQueueRuntimeConfig({
                defaultTimeoutMs: 30_000,
                askUser: { enabled: true },
                sensitiveInput: { enabled: true },
            }),
            resolveSkillConfig: vi.fn().mockResolvedValue({}),
            resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
            resolveAiServiceForProvider: () => sdkMocks.service as any,
        }) as any);
        const bridge = new CLITaskExecutor(store, {
            aiService: sdkMocks.service as any,
            followUpSuggestions: { enabled: false, count: 3 },
        });
        (bridge as any).executors = { getAskUserHandles: (id: string) => chat.getAskUserHandles(id) };

        const routes: Route[] = [];
        registerApiProcessRoutes({ routes, store, bridge, dataDir: '/tmp/test-coc', gitOpsStore: {} as any });
        server = http.createServer(createRouter({ routes }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

        let toolResult: unknown;
        sdkMocks.mockSendMessage.mockImplementation(async (options: any) => {
            const tool = options.tools.find((t: any) => t.name === 'ask_user');
            toolResult = await tool.handler({
                questions: [{
                    question: 'Paste cookies', type: 'sensitive-input',
                    sink: 'browser.cookies', sinkArgs: { domain: 'example.com' },
                }],
            });
            return { success: true, response: JSON.stringify(toolResult), sessionId: 's1' };
        });

        const processId = 'queue_leak';
        // ProcessLifecycleRunner creates the process record before the executor runs.
        await store.addProcess({
            id: processId, type: 'chat', status: 'running', startTime: new Date(), promptPreview: 'Log me in',
            metadata: { type: 'chat', workspaceId: 'ws-1', mode: 'ask' },
            conversationTurns: [{ role: 'user', content: 'Log me in', timestamp: new Date(), turnIndex: 0, timeline: [] }],
        } as any);
        const task = {
            id: 'leak', type: 'chat', priority: 'normal', status: 'running', createdAt: Date.now(),
            payload: { kind: 'chat', mode: 'ask', prompt: 'Log me in' }, config: {}, displayName: 'Log me in',
        } as QueuedTask;
        const run = chat.execute(task, 'Log me in');

        const pending = await waitFor(() => store.processes.get(processId)?.pendingAskUser?.[0]);
        const { batchId, questionId } = pending;
        const respond = (answer: Record<string, unknown>) =>
            post(baseUrl, `/api/processes/${processId}/ask-user-response`, { batchId, answers: [{ questionId, ...answer }] });

        // Every smuggling attempt is refused before the question settles.
        const attempts: Array<Record<string, unknown>> = [
            { answer: MARKER },
            { answer: { cookies: MARKER } },
            { receipt: { ok: true, count: 2, value: MARKER } },
            { receipt: { ok: false, reason: MARKER } },
            { receipt: { ok: true, count: MARKER } },
            { receipt: { ok: true, count: 2 }, answer: MARKER },
            { receipt: MARKER },
            { skipped: true, reason: MARKER },
        ];
        for (const attempt of attempts) {
            const res = await respond(attempt);
            expect(res.status, JSON.stringify(attempt)).toBeGreaterThanOrEqual(400);
            expect(res.body).not.toContain(MARKER);
            expect(chat.getAskUserHandles(processId)?.hasPending()).toBe(true);
        }

        // The SPA's real submission: a receipt only (plus a stray note that is dropped).
        const ok = await respond({ receipt: { ok: true, count: 2 }, note: MARKER });
        expect(ok.status).toBe(200);
        await run;

        expect(JSON.stringify(toolResult)).toContain('"count":2');
        expect(JSON.stringify(toolResult)).toContain('example.com');
        expect(JSON.stringify(toolResult)).not.toContain(MARKER);

        const pendingWrites = vi.mocked(store.updateProcess).mock.calls
            .map(([, patch]) => patch.pendingAskUser).filter(Boolean);
        expect(pendingWrites.length).toBeGreaterThan(0);
        expect(JSON.stringify(pendingWrites)).not.toContain(MARKER);
        expect(JSON.stringify(vi.mocked(store.emitProcessEvent).mock.calls)).not.toContain(MARKER);
        expect(JSON.stringify(vi.mocked(store.updateProcess).mock.calls)).not.toContain(MARKER);
        expect(JSON.stringify([...store.processes.values()])).not.toContain(MARKER);
        expect(logs.join('\n')).not.toContain(MARKER);
    });
});
