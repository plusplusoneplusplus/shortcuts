/**
 * Tests for POST /api/processes/:id/ralph-start route.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../../src/server/shared/router';
import { registerRalphRoutes } from '../../../src/server/routes/queue-ralph-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Helpers
// ============================================================================

function request(
    baseUrl: string,
    urlPath: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function post(baseUrl: string, urlPath: string, body: unknown) {
    return request(baseUrl, urlPath, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/processes/:id/ralph-start', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let mockEnqueue: ReturnType<typeof vi.fn>;
    let dataDir: string;

    beforeAll(async () => {
        store = createMockProcessStore();
        mockEnqueue = vi.fn().mockResolvedValue('new-task-id');

        const mockBridge = {
            enqueue: mockEnqueue,
        } as any;

        const fs = await import('fs');
        const os = await import('os');
        const pathMod = await import('path');
        dataDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-start-routes-test-'));

        const routes: Route[] = [];
        registerRalphRoutes(routes, { bridge: mockBridge, store, dataDir });

        const router = createRouter({ routes, spaHtml: '' });
        server = http.createServer(router);

        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });

        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        const fs = await import('fs');
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    beforeEach(() => {
        store.processes.clear();
        mockEnqueue.mockClear();
    });

    // -----------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------

    it('returns 200 and a processId for a valid grilling process', async () => {
        await store.addProcess({
            id: 'queue_grilling-process',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'grill me prompt',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What do you want to build?',
                workspaceId: 'ws-1',
                workingDirectory: '/repos/myrepo',
                context: {
                    ralph: {
                        phase: 'grilling',
                        sessionId: 'ralph-session-abc',
                        maxIterations: 10,
                    },
                },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-process/ralph-start', {
            goalSpec: '## Goal\nBuild a feature',
            workspaceId: 'ws-1',
        });

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.processId).toMatch(/^queue_/);
        expect(mockEnqueue).toHaveBeenCalledOnce();
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.type).toBe('chat');
        expect(enqueueArg.payload.mode).toBe('ralph');
        expect(enqueueArg.payload.context.ralph.phase).toBe('executing');
        expect(enqueueArg.payload.context.ralph.originalGoal).toBe('## Goal\nBuild a feature');
        expect(enqueueArg.payload.context.ralph.sessionId).toBe('ralph-session-abc');
        expect(enqueueArg.payload.context.ralph.currentIteration).toBe(1);
        expect(enqueueArg.payload.context.ralph.maxIterations).toBe(10);
        // The user prompt MUST embed the goal text and skill pointer.
        expect(enqueueArg.payload.prompt).toContain('Build a feature');
        expect(enqueueArg.payload.prompt).toContain('<goal>');
        expect(enqueueArg.payload.prompt).toContain('ultra-ralph');
        expect(enqueueArg.payload.prompt).not.toBe('Begin Ralph execution loop.');
        expect(Object.keys(enqueueArg.payload.context)).toEqual(['ralph']);
        expect(enqueueArg.payload.context).not.toHaveProperty('skills');
    });

    it('initialises the per-session journal directory and session.json', async () => {
        await store.addProcess({
            id: 'queue_grilling-init',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'init me',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                workspaceId: 'ws-init',
                workingDirectory: '/repos/myrepo',
                context: { ralph: { phase: 'grilling', sessionId: 'sess-init', maxIterations: 4 } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-init/ralph-start', {
            goalSpec: 'Write feature X',
            workspaceId: 'ws-init',
        });
        expect(res.status).toBe(200);

        const fs = await import('fs');
        const pathMod = await import('path');
        const sessionDir = pathMod.join(dataDir, 'repos', 'ws-init', 'ralph-sessions', 'sess-init');
        expect(fs.existsSync(sessionDir)).toBe(true);
        expect(fs.existsSync(pathMod.join(sessionDir, 'progress.md'))).toBe(true);
        const recordRaw = fs.readFileSync(pathMod.join(sessionDir, 'session.json'), 'utf-8');
        const record = JSON.parse(recordRaw);
        expect(record.sessionId).toBe('sess-init');
        expect(record.workspaceId).toBe('ws-init');
        expect(record.originalGoal).toBe('Write feature X');
        expect(record.maxIterations).toBe(4);
        expect(record.phase).toBe('executing');
    });

    // -----------------------------------------------------------------------
    // 404 — process not found
    // -----------------------------------------------------------------------

    it('returns 404 when process does not exist', async () => {
        const res = await post(baseUrl, '/api/processes/nonexistent-id/ralph-start', {
            goalSpec: '## Goal\nDo something',
        });
        expect(res.status).toBe(404);
    });

    // -----------------------------------------------------------------------
    // 400 — missing goalSpec
    // -----------------------------------------------------------------------

    it('returns 400 when goalSpec is missing', async () => {
        await store.addProcess({
            id: 'queue_grilling-p2',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'prompt',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                context: { ralph: { phase: 'grilling', sessionId: 's1' } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-p2/ralph-start', {});
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/goalSpec/i);
    });

    it('returns 400 when goalSpec is empty string', async () => {
        await store.addProcess({
            id: 'queue_grilling-p3',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'prompt',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                context: { ralph: { phase: 'grilling', sessionId: 's2' } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-p3/ralph-start', {
            goalSpec: '   ',
        });
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/goalSpec/i);
    });

    // -----------------------------------------------------------------------
    // 400 — not in grilling phase
    // -----------------------------------------------------------------------

    it('returns 400 when process is not in grilling phase (no ralph context)', async () => {
        await store.addProcess({
            id: 'queue_no-ralph',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'prompt',
            payload: { kind: 'chat', mode: 'ask', prompt: 'Hello' },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_no-ralph/ralph-start', {
            goalSpec: '## Goal\nSomething',
        });
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/grilling/i);
    });

    it('returns 400 when process ralph phase is "executing" not "grilling"', async () => {
        await store.addProcess({
            id: 'queue_executing-ralph',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'prompt',
            payload: {
                kind: 'chat',
                mode: 'ralph',
                prompt: 'Begin',
                context: { ralph: { phase: 'executing', sessionId: 'sx' } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_executing-ralph/ralph-start', {
            goalSpec: '## Goal\nSomething',
        });
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/grilling/i);
    });

    // -----------------------------------------------------------------------
    // 400 — process not completed
    // -----------------------------------------------------------------------

    it('returns 400 when process is still running', async () => {
        await store.addProcess({
            id: 'queue_running-grilling',
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'prompt',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                context: { ralph: { phase: 'grilling', sessionId: 's3' } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_running-grilling/ralph-start', {
            goalSpec: '## Goal\nSomething',
        });
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/completed/i);
    });

    // -----------------------------------------------------------------------
    // maxIterations resolution: prefs vs fallback
    // -----------------------------------------------------------------------

    it('resolves maxIterations from per-repo preferences when context omits it', async () => {
        const fsMod = await import('fs');
        const pathMod = await import('path');
        const prefsDir = pathMod.join(dataDir, 'repos', 'ws-prefs');
        fsMod.mkdirSync(prefsDir, { recursive: true });
        fsMod.writeFileSync(
            pathMod.join(prefsDir, 'preferences.json'),
            JSON.stringify({ maxRalphIterations: 25 }),
            'utf-8',
        );

        await store.addProcess({
            id: 'queue_grilling-prefs',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'p',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                workspaceId: 'ws-prefs',
                workingDirectory: '/repos/r',
                context: { ralph: { phase: 'grilling', sessionId: 'sess-prefs' } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-prefs/ralph-start', {
            goalSpec: 'do the thing',
            workspaceId: 'ws-prefs',
        });
        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls.at(-1)![0];
        expect(enqueueArg.payload.context.ralph.maxIterations).toBe(25);

        const recordRaw = fsMod.readFileSync(
            pathMod.join(dataDir, 'repos', 'ws-prefs', 'ralph-sessions', 'sess-prefs', 'session.json'),
            'utf-8',
        );
        expect(JSON.parse(recordRaw).maxIterations).toBe(25);
    });

    it('falls back to default 20 when neither context nor prefs provide a value', async () => {
        await store.addProcess({
            id: 'queue_grilling-default',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'p',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                workspaceId: 'ws-default',
                workingDirectory: '/repos/r',
                context: { ralph: { phase: 'grilling', sessionId: 'sess-default' } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-default/ralph-start', {
            goalSpec: 'do the thing',
            workspaceId: 'ws-default',
        });
        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls.at(-1)![0];
        expect(enqueueArg.payload.context.ralph.maxIterations).toBe(20);
    });
});
