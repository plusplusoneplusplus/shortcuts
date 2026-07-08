/**
 * Tests for POST /api/processes/:id/ralph-start route.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as pathMod from 'path';
import { execFileSync } from 'child_process';
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
        expect(Object.keys(enqueueArg.payload.context)).toEqual(['ralph', 'taskGroup']);
        expect(enqueueArg.payload.context).not.toHaveProperty('skills');
        expect(enqueueArg.payload.provider).toBeUndefined();
        expect(enqueueArg.config).toEqual({});
    });

    it('passes provider, model, and reasoning effort to the first Ralph execution task', async () => {
        await store.addProcess({
            id: 'queue_grilling-ai-selection',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'grill me prompt',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What do you want to build?',
                workspaceId: 'ws-ai',
                workingDirectory: '/repos/myrepo',
                context: {
                    ralph: {
                        phase: 'grilling',
                        sessionId: 'ralph-session-ai',
                        maxIterations: 8,
                    },
                },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-ai-selection/ralph-start', {
            goalSpec: '## Goal\nBuild with Codex',
            workspaceId: 'ws-ai',
            provider: 'codex',
            config: {
                model: 'gpt-5.3-codex',
                reasoningEffort: 'high',
            },
        });

        expect(res.status).toBe(200);
        expect(mockEnqueue).toHaveBeenCalledOnce();
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.provider).toBe('codex');
        expect(enqueueArg.config).toEqual({
            model: 'gpt-5.3-codex',
            reasoningEffort: 'high',
        });
    });

    it('returns 400 for an invalid provider', async () => {
        await store.addProcess({
            id: 'queue_grilling-invalid-provider',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'prompt',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                context: { ralph: { phase: 'grilling', sessionId: 's-invalid-provider' } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-invalid-provider/ralph-start', {
            goalSpec: '## Goal\nDo something',
            provider: 'bogus',
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/Invalid provider/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid reasoning effort', async () => {
        await store.addProcess({
            id: 'queue_grilling-invalid-effort',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'prompt',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                context: { ralph: { phase: 'grilling', sessionId: 's-invalid-effort' } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-invalid-effort/ralph-start', {
            goalSpec: '## Goal\nDo something',
            config: { reasoningEffort: 'turbo' },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/Invalid reasoningEffort/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 400 for a malformed worktree request (AC-01)', async () => {
        await store.addProcess({
            id: 'queue_grilling-worktree',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'prompt',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                context: { ralph: { phase: 'grilling', sessionId: 's-worktree' } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-worktree/ralph-start', {
            goalSpec: '## Goal\nDo something',
            worktree: { enabled: true, baseRef: 'a b' },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/baseRef/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 400 for an enabled worktree request when the feature flag is off (AC-04)', async () => {
        // This suite registers the route without a getGitWorktreeExecutionEnabled
        // getter, so the flag is off: an enabled request is refused.
        await store.addProcess({
            id: 'queue_grilling-worktree-off',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'prompt',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                workspaceId: 'ws-wt',
                workingDirectory: '/repos/myrepo',
                context: { ralph: { phase: 'grilling', sessionId: 's-worktree-off', maxIterations: 6 } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-worktree-off/ralph-start', {
            goalSpec: '## Goal\nDo something',
            workspaceId: 'ws-wt',
            worktree: { enabled: true, baseRef: 'main' },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/not enabled/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('ignores an opted-out worktree request even when the flag is off (AC-04)', async () => {
        await store.addProcess({
            id: 'queue_grilling-worktree-optout',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'prompt',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                workspaceId: 'ws-wt',
                workingDirectory: '/repos/myrepo',
                context: { ralph: { phase: 'grilling', sessionId: 's-worktree-optout', maxIterations: 6 } },
            },
        } as any);

        const res = await post(baseUrl, '/api/processes/queue_grilling-worktree-optout/ralph-start', {
            goalSpec: '## Goal\nDo something',
            workspaceId: 'ws-wt',
            worktree: { enabled: false },
        });

        expect(res.status).toBe(200);
        expect(mockEnqueue).toHaveBeenCalledOnce();
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.context.ralph.sessionId).toBe('s-worktree-optout');
        expect(enqueueArg.payload.context.ralph.currentIteration).toBe(1);
        expect(res.json().worktree).toBeUndefined();
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

// ============================================================================
// AC-04: worktree execution wiring with the feature flag enabled
// ============================================================================

describe('POST /api/processes/:id/ralph-start with Git worktree (AC-04)', () => {
    const REPO_ID = 'ws-wt';
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let mockEnqueue: ReturnType<typeof vi.fn>;
    let dataDir: string;
    let sourceRepo: string;

    function git(dir: string, ...args: string[]): string {
        return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8' }).replace(/\r?\n$/, '');
    }

    beforeAll(async () => {
        store = createMockProcessStore();
        mockEnqueue = vi.fn().mockResolvedValue('new-task-id');
        dataDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-start-wt-data-'));
        sourceRepo = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-start-wt-src-'));
        git(sourceRepo, 'init', '-q');
        git(sourceRepo, 'config', 'user.email', 'test@test.com');
        git(sourceRepo, 'config', 'user.name', 'Test');
        git(sourceRepo, 'config', 'commit.gpgsign', 'false');
        fs.writeFileSync(pathMod.join(sourceRepo, 'README.md'), 'hello\n', 'utf-8');
        git(sourceRepo, 'add', '-A');
        git(sourceRepo, 'commit', '-q', '-m', 'init');
        await store.registerWorkspace({ id: REPO_ID, rootPath: sourceRepo } as any);

        const routes: Route[] = [];
        registerRalphRoutes(routes, {
            bridge: { enqueue: mockEnqueue } as any,
            store,
            dataDir,
            getGitWorktreeExecutionEnabled: () => true,
        });
        const router = createRouter({ routes, spaHtml: '' });
        server = http.createServer(router);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        try { git(sourceRepo, 'worktree', 'prune'); } catch { /* ignore */ }
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
        try { fs.rmSync(sourceRepo, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    beforeEach(() => {
        store.processes.clear();
        mockEnqueue.mockClear();
    });

    async function addGrilling(id: string, sessionId: string): Promise<void> {
        await store.addProcess({
            id,
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'prompt',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What?',
                workspaceId: REPO_ID,
                workingDirectory: sourceRepo,
                context: { ralph: { phase: 'grilling', sessionId, maxIterations: 6 } },
            },
        } as any);
    }

    it('creates the worktree keyed by the session id and runs iteration 1 in it', async () => {
        await addGrilling('queue_grilling-wt-1', 's-wt-run');

        const res = await post(baseUrl, '/api/processes/queue_grilling-wt-1/ralph-start', {
            goalSpec: '## Goal\nDo something',
            workspaceId: REPO_ID,
            worktree: { enabled: true },
        });

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.worktree).toBeDefined();
        const worktreePath = data.worktree.path;
        expect(worktreePath).toContain('git-worktrees');
        expect(fs.existsSync(worktreePath)).toBe(true);
        expect(data.worktree.id).toBe('s-wt-run');
        expect(data.worktree.ralphSessionId).toBe('s-wt-run');

        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.workingDirectory).toBe(worktreePath);
        expect(enqueueArg.payload.context.ralph.sessionId).toBe('s-wt-run');

        // Source checkout HEAD is not moved onto the worktree branch.
        expect(git(sourceRepo, 'rev-parse', '--abbrev-ref', 'HEAD')).not.toBe(data.worktree.branch);

        // Worktree metadata persisted on the session record for recovery.
        const recordRaw = fs.readFileSync(
            pathMod.join(dataDir, 'repos', REPO_ID, 'ralph-sessions', 's-wt-run', 'session.json'),
            'utf-8',
        );
        expect(JSON.parse(recordRaw).worktree.path).toBe(worktreePath);
    });

    it('returns 400 and does not enqueue when the base ref does not resolve', async () => {
        await addGrilling('queue_grilling-wt-badref', 's-wt-badref');

        const res = await post(baseUrl, '/api/processes/queue_grilling-wt-badref/ralph-start', {
            goalSpec: '## Goal\nDo something',
            workspaceId: REPO_ID,
            worktree: { enabled: true, baseRef: 'no-such-ref' },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/does not resolve/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('runs a normal in-place start when no worktree is requested', async () => {
        await addGrilling('queue_grilling-wt-none', 's-wt-none');

        const res = await post(baseUrl, '/api/processes/queue_grilling-wt-none/ralph-start', {
            goalSpec: '## Goal\nDo something',
            workspaceId: REPO_ID,
        });

        expect(res.status).toBe(200);
        expect(res.json().worktree).toBeUndefined();
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.workingDirectory).toBe(sourceRepo);
    });
});
