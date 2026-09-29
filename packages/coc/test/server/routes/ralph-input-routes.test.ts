/**
 * Tests for the RALPH_NEEDS_INPUT answer/stop routes:
 *   POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/input
 *   POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/stop
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as pathMod from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerRalphInputRoutes } from '../../../src/server/routes/ralph-input-routes';
import { registerRalphSubmitRoutes } from '../../../src/server/routes/ralph-submit-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore, type MockProcessStore } from '../helpers/mock-process-store';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import type { RalphPendingInput, RalphSessionRecord } from '../../../src/server/ralph/types';

function post(baseUrl: string, urlPath: string, body?: unknown): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode || 0, json: () => JSON.parse(text) });
                });
            },
        );
        req.on('error', reject);
        if (body !== undefined) req.write(JSON.stringify(body));
        req.end();
    });
}

const pendingInput: RalphPendingInput = {
    iteration: 3,
    taskId: 't3',
    processId: 'queue_p3',
    requestedAt: '2026-05-11T01:30:00Z',
    request: {
        context: 'The [decision] item conflicts with the repo layout.',
        questions: [
            {
                question: 'Which layout should win?',
                type: 'select',
                options: [{ value: 'spec', label: 'Spec' }, { value: 'repo', label: 'Repo' }],
                recommendation: 'repo',
            },
            { question: 'Also migrate old data?', type: 'yes-no', recommendation: 'no' },
        ],
    },
};

async function seedSession(
    dataDir: string,
    workspaceId: string,
    sessionId: string,
    overrides: Partial<RalphSessionRecord> = {},
): Promise<RalphSessionRecord> {
    const journal = new RalphSessionStore({ dataDir });
    await journal.initSession(workspaceId, sessionId, {
        originalGoal: 'Original goal',
        maxIterations: 10,
        startedAt: '2026-05-11T00:00:00Z',
    });
    return journal.updateSessionRecord(workspaceId, sessionId, (rec) => ({
        ...(rec as RalphSessionRecord),
        currentIteration: 3,
        phase: 'awaiting-input',
        pendingInput,
        iterations: [
            { iteration: 3, loopIndex: 1, taskId: 't3', processId: 'queue_p3', startedAt: '2026-05-11T01:20:00Z', endedAt: '2026-05-11T01:30:00Z', status: 'completed', signal: 'RALPH_NEEDS_INPUT' },
        ],
        loops: [{ loopIndex: 1, goal: 'Original goal', startIteration: 1, startedAt: '2026-05-11T00:00:00Z' }],
        ...overrides,
    }));
}

describe('Ralph input/stop routes', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let dataDir: string;
    const enqueue = vi.fn().mockResolvedValue('new-task-id');
    const publishRalphSessionComplete = vi.fn();
    const broadcastProcessEvent = vi.fn();
    const bridge: any = {
        enqueue,
        publishRalphSessionComplete,
        registry: { getAllQueues: () => new Map([['repo-1', { getAll: () => [] }]]) },
    };

    beforeAll(async () => {
        store = createMockProcessStore();
        dataDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-input-test-'));
        const routes: Route[] = [];
        registerRalphInputRoutes(routes, {
            bridge,
            store,
            dataDir,
            getWsServer: () => ({ broadcastProcessEvent } as any),
        });
        registerRalphSubmitRoutes(routes, { bridge, store, dataDir });
        server = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    beforeEach(() => {
        store.processes.clear();
        enqueue.mockClear();
        enqueue.mockResolvedValue('new-task-id');
        publishRalphSessionComplete.mockClear();
        broadcastProcessEvent.mockClear();
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
        fs.mkdirSync(dataDir, { recursive: true });
    });

    const inputUrl = (ws: string, s: string) => `/api/workspaces/${ws}/ralph-sessions/${s}/input`;
    const stopUrl = (ws: string, s: string) => `/api/workspaces/${ws}/ralph-sessions/${s}/stop`;

    describe('POST /input', () => {
        it('saves the answer, journals it, and enqueues the next iteration with a Human answers block', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-1');

            const res = await post(baseUrl, inputUrl('ws-1', 'sess-1'), { answers: ['repo', 'no'], note: 'Keep the repo layout.' });

            expect(res.status).toBe(200);
            expect(res.json()).toMatchObject({ resumed: true, taskId: 'new-task-id', nextIteration: 4, maxIterations: 10 });

            const record = await new RalphSessionStore({ dataDir }).readSessionRecord('ws-1', 'sess-1');
            expect(record?.phase).toBe('executing');
            expect(record?.pendingInput).toBeUndefined();
            expect(record?.humanInputs).toHaveLength(1);
            expect(record?.humanInputs?.[0]).toMatchObject({
                iteration: 3,
                note: 'Keep the repo layout.',
                answers: [
                    { question: 'Which layout should win?', answer: 'repo' },
                    { question: 'Also migrate old data?', answer: 'no' },
                ],
            });

            const md = fs.readFileSync(pathMod.join(dataDir, 'repos', 'ws-1', 'ralph-sessions', 'sess-1', 'progress.md'), 'utf-8');
            expect(md).toMatch(/## Human input — \d{4}-\d{2}-\d{2}T/);
            expect(md).toContain('Context: The [decision] item conflicts with the repo layout.');
            expect(md).toContain('1. Q: Which layout should win?\n   A: repo');
            expect(md).toContain('Note: Keep the repo layout.');

            expect(enqueue).toHaveBeenCalledOnce();
            const task = enqueue.mock.calls[0][0];
            expect(task.payload.mode).toBe('ralph');
            expect(task.payload.context.ralph.currentIteration).toBe(4);
            expect(task.payload.context.ralph.humanInput.answers[0].answer).toBe('repo');
            expect(task.payload.prompt).toContain('<human_answers>');
            expect(task.payload.prompt).toContain('Note: Keep the repo layout.');
        });

        it('recovers the prior provider and model like /resume', async () => {
            await seedSession(dataDir, 'ws-ai', 'sess-ai');
            await store.addProcess({
                id: 'queue_p3',
                type: 'chat',
                status: 'completed',
                startTime: new Date(),
                promptPreview: 'asked',
                metadata: { provider: 'codex', model: 'gpt-5.3-codex' },
                payload: { kind: 'chat', mode: 'ralph', prompt: 'asked', provider: 'codex', reasoningEffort: 'high', workingDirectory: '/repos/ai' },
            } as any);

            const res = await post(baseUrl, inputUrl('ws-ai', 'sess-ai'), { answers: ['repo', 'no'] });

            expect(res.status).toBe(200);
            const task = enqueue.mock.calls[0][0];
            expect(task.payload.provider).toBe('codex');
            expect(task.payload.workingDirectory).toBe('/repos/ai');
            expect(task.config.model).toBe('gpt-5.3-codex');
            expect(task.config.reasoningEffort).toBe('high');
        });

        it('raises maxIterations when the asking iteration was the last one', async () => {
            await seedSession(dataDir, 'ws-cap', 'sess-cap', { maxIterations: 3 });
            const res = await post(baseUrl, inputUrl('ws-cap', 'sess-cap'), { answers: ['repo', 'no'] });
            expect(res.status).toBe(200);
            expect(res.json()).toMatchObject({ nextIteration: 4, maxIterations: 4 });
        });

        it('returns 409 when the session is not awaiting input', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-exec', { phase: 'executing', pendingInput: undefined });
            const res = await post(baseUrl, inputUrl('ws-1', 'sess-exec'), { answers: ['repo'] });
            expect(res.status).toBe(409);
            expect(enqueue).not.toHaveBeenCalled();
        });

        it('returns 409 on a duplicate submit and enqueues only once', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-dup');
            const body = { answers: ['repo', 'no'] };

            const [first, second] = await Promise.all([
                post(baseUrl, inputUrl('ws-1', 'sess-dup'), body),
                post(baseUrl, inputUrl('ws-1', 'sess-dup'), body),
            ]);
            const third = await post(baseUrl, inputUrl('ws-1', 'sess-dup'), body);

            expect([first.status, second.status].sort()).toEqual([200, 409]);
            expect(third.status).toBe(409);
            expect(enqueue).toHaveBeenCalledOnce();
        });

        it('returns 404 for an unknown session', async () => {
            const res = await post(baseUrl, inputUrl('ws-1', 'missing'), { answers: ['x'] });
            expect(res.status).toBe(404);
        });

        it.each([
            [{}, 'answers must be a non-empty array'],
            [{ answers: [] }, 'answers must be a non-empty array'],
            [{ answers: [1] }, 'each answer must be a string or an array of strings'],
            [{ answers: ['a'], note: 5 }, 'note must be a string'],
            [{ answers: ['x'.repeat(10_001)] }, 'each answer must be at most 10000 characters'],
        ])('rejects bad body %#', async (body, error) => {
            await seedSession(dataDir, 'ws-1', 'sess-bad');
            const res = await post(baseUrl, inputUrl('ws-1', 'sess-bad'), body);
            expect(res.status).toBe(400);
            expect(res.json().error).toContain(error);
        });

        it('rejects an answer count that does not match the questions', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-count');
            const res = await post(baseUrl, inputUrl('ws-1', 'sess-count'), { answers: ['repo'] });
            expect(res.status).toBe(400);
            const record = await new RalphSessionStore({ dataDir }).readSessionRecord('ws-1', 'sess-count');
            expect(record?.phase).toBe('awaiting-input');
        });

        it('keeps the answer and reports 500 when enqueue fails', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-fail');
            enqueue.mockRejectedValueOnce(new Error('queue down'));
            const res = await post(baseUrl, inputUrl('ws-1', 'sess-fail'), { answers: ['repo', 'no'] });
            expect(res.status).toBe(500);
            const record = await new RalphSessionStore({ dataDir }).readSessionRecord('ws-1', 'sess-fail');
            expect(record?.phase).toBe('executing');
            expect(record?.humanInputs).toHaveLength(1);
        });

        it('keeps the session awaiting input when the progress journal cannot be written', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-journal-fail');
            const append = vi.spyOn(RalphSessionStore.prototype, 'appendHumanInputSection')
                .mockRejectedValueOnce(new Error('journal unavailable'));
            try {
                const res = await post(baseUrl, inputUrl('ws-1', 'sess-journal-fail'), { answers: ['repo', 'no'] });
                expect(res.status).toBe(500);
                const record = await new RalphSessionStore({ dataDir }).readSessionRecord('ws-1', 'sess-journal-fail');
                expect(record?.phase).toBe('awaiting-input');
                expect(record?.humanInputs).toBeUndefined();
                expect(enqueue).not.toHaveBeenCalled();
            } finally {
                append.mockRestore();
            }
        });
    });

    async function addAskingProcess(): Promise<void> {
        await store.addProcess({
            id: 'queue_p3',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'asked',
            metadata: { ralph: { sessionId: 'sess', phase: 'awaiting-input', currentIteration: 3 } },
        } as any);
    }

    describe('chat-list attention marker (AC-05)', () => {
        it('resets the asking process phase to executing after an answer', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-mark-in');
            await addAskingProcess();

            const res = await post(baseUrl, inputUrl('ws-1', 'sess-mark-in'), { answers: ['repo', 'no'] });

            expect(res.status).toBe(200);
            expect(((await store.getProcess('queue_p3'))?.metadata as any).ralph.phase).toBe('executing');
        });

        it('resets the asking process phase to complete after stop', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-mark-stop');
            await addAskingProcess();

            const res = await post(baseUrl, stopUrl('ws-1', 'sess-mark-stop'));

            expect(res.status).toBe(200);
            expect(((await store.getProcess('queue_p3'))?.metadata as any).ralph.phase).toBe('complete');
        });
    });

    describe('POST /stop', () => {
        it('ends the session with USER_STOPPED and broadcasts user-stopped', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-stop');

            const res = await post(baseUrl, stopUrl('ws-1', 'sess-stop'));

            expect(res.status).toBe(200);
            expect(res.json()).toMatchObject({ stopped: true, phase: 'complete', terminalReason: 'USER_STOPPED' });
            const record = await new RalphSessionStore({ dataDir }).readSessionRecord('ws-1', 'sess-stop');
            expect(record?.phase).toBe('complete');
            expect(record?.terminalReason).toBe('USER_STOPPED');
            expect(record?.completedAt).toBeDefined();
            expect(record?.pendingInput).toBeUndefined();
            expect(record?.loops?.[0]).toMatchObject({ terminalReason: 'USER_STOPPED', endIteration: 3 });

            const expected = { workspaceId: 'ws-1', sessionId: 'sess-stop', processId: 'queue_p3', totalIterations: 3, reason: 'user-stopped' };
            expect(publishRalphSessionComplete).toHaveBeenCalledWith({ type: 'ralphSessionComplete', ...expected });
            expect(broadcastProcessEvent).toHaveBeenCalledWith({ type: 'ralph-session-complete', ...expected });
            expect(enqueue).not.toHaveBeenCalled();
        });

        it('returns 409 when the session is not awaiting input', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-running', { phase: 'executing', pendingInput: undefined });
            const res = await post(baseUrl, stopUrl('ws-1', 'sess-running'));
            expect(res.status).toBe(409);
            expect(publishRalphSessionComplete).not.toHaveBeenCalled();
        });

        it('rejects input after stop', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-stop2');
            await post(baseUrl, stopUrl('ws-1', 'sess-stop2'));
            const res = await post(baseUrl, inputUrl('ws-1', 'sess-stop2'), { answers: ['repo', 'no'] });
            expect(res.status).toBe(409);
        });

        it('leaves Submit PR available after stop', async () => {
            await seedSession(dataDir, 'ws-1', 'sess-submit');
            await post(baseUrl, stopUrl('ws-1', 'sess-submit'));
            const res = await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/sess-submit/submit', {});
            expect(res.status).not.toBe(409);
        });
    });
});
