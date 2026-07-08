/**
 * Tests for POST /api/ralph-launch route.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as pathMod from 'path';
import { execFileSync } from 'child_process';
import { createRouter } from '../../../src/server/shared/router';
import { registerRalphLaunchRoutes } from '../../../src/server/routes/ralph-launch-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';

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

describe('POST /api/ralph-launch', () => {
    let server: http.Server;
    let baseUrl: string;
    let mockEnqueue: ReturnType<typeof vi.fn>;
    let dataDir: string;

    beforeAll(async () => {
        mockEnqueue = vi.fn().mockResolvedValue('new-task-id');

        const mockBridge = {
            enqueue: mockEnqueue,
        } as any;

        dataDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-launch-routes-test-'));

        const routes: Route[] = [];
        registerRalphLaunchRoutes(routes, { bridge: mockBridge, dataDir });

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
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    beforeEach(() => {
        mockEnqueue.mockClear();
    });

    // -----------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------

    it('returns 200 with processId and sessionId for valid goalSpec', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: '## Goal\nBuild a feature',
            workspaceId: 'ws-1',
        });

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.processId).toMatch(/^queue_/);
        expect(data.sessionId).toMatch(/^ralph-/);
        expect(mockEnqueue).toHaveBeenCalledOnce();

        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.type).toBe('chat');
        expect(enqueueArg.payload.mode).toBe('ralph');
        expect(enqueueArg.payload.context.ralph.phase).toBe('executing');
        expect(enqueueArg.payload.context.ralph.originalGoal).toBe('## Goal\nBuild a feature');
        expect(enqueueArg.payload.context.ralph.currentIteration).toBe(1);
    });

    it('uses default maxIterations when no per-repo preference exists', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-no-prefs',
        });

        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.context.ralph.maxIterations).toBeGreaterThan(0);
    });

    it('keeps folderPath separate from workingDirectory when no execution directory is provided', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
            folderPath: '/notes/Plans/my-goal',
        });

        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.repoId).toBe('ws-1');
        expect(enqueueArg.folderPath).toBe('/notes/Plans/my-goal');
        expect(enqueueArg.payload.workspaceId).toBe('ws-1');
        expect(enqueueArg.payload.folderPath).toBe('/notes/Plans/my-goal');
        expect(enqueueArg.payload.workingDirectory).toBeUndefined();
    });

    it('passes folderPath and explicit workingDirectory to the enqueued task', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
            folderPath: '/repos/myrepo',
            workingDirectory: '/repos/myrepo/src',
        });

        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.folderPath).toBe('/repos/myrepo');
        expect(enqueueArg.payload.workingDirectory).toBe('/repos/myrepo/src');
        expect(enqueueArg.payload.folderPath).toBe('/repos/myrepo');
    });

    it('passes provider, model, and reasoning effort to the enqueued task', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
            provider: 'codex',
            config: { model: 'gpt-5.3-codex', reasoningEffort: 'high' },
        });

        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.provider).toBe('codex');
        expect(enqueueArg.config).toEqual({ model: 'gpt-5.3-codex', reasoningEffort: 'high' });
    });

    it('accepts reasoning effort from the top-level body for compatibility', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
            reasoningEffort: 'medium',
        });

        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.config).toEqual({ reasoningEffort: 'medium' });
    });

    it('omits provider, model, and reasoning effort config when no overrides are provided', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
        });

        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.provider).toBeUndefined();
        expect(enqueueArg.config).toEqual({});
    });

    it('initialises the per-session journal when workspaceId is provided', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-journal-test',
        });

        expect(res.status).toBe(200);
        const data = res.json();
        const sessionDir = pathMod.join(dataDir, 'repos', 'ws-journal-test', 'ralph-sessions', data.sessionId);
        const sessionJson = pathMod.join(sessionDir, 'session.json');
        expect(fs.existsSync(sessionJson)).toBe(true);
        const session = JSON.parse(fs.readFileSync(sessionJson, 'utf-8'));
        expect(session.originalGoal).toBe('Build something');
        expect(session.phase).toBe('executing');
    });

    it('embeds goal text in the prompt for skill retrieval', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: '## Goal\nSpecific feature description',
            workspaceId: 'ws-1',
        });

        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.prompt).toContain('Specific feature description');
        expect(enqueueArg.payload.prompt).toContain('<goal>');
    });

    // -----------------------------------------------------------------------
    // Validation errors
    // -----------------------------------------------------------------------

    it('returns 400 when goalSpec is missing', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            workspaceId: 'ws-1',
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/goalSpec/i);
    });

    it('returns 400 when goalSpec is empty', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: '   ',
            workspaceId: 'ws-1',
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/goalSpec/i);
    });

    it('returns 400 for invalid JSON body', async () => {
        const res = await request(baseUrl, '/api/ralph-launch', {
            method: 'POST',
            body: 'not-json',
        });

        expect(res.status).toBe(400);
    });

    it('returns 400 for invalid provider', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
            provider: 'bad-provider',
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/Invalid provider/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid reasoning effort', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
            config: { reasoningEffort: 'maximum' },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/Invalid reasoningEffort/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Worktree request (AC-01)
    // -----------------------------------------------------------------------

    it('returns 400 for a malformed worktree request', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
            worktree: { enabled: 'yes' },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/worktree\.enabled/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid worktree baseRef', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
            worktree: { enabled: true, baseRef: '--evil' },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/baseRef/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 400 for an enabled worktree request when the feature flag is off (AC-04)', async () => {
        // This suite registers the route without a getGitWorktreeExecutionEnabled
        // getter, so the flag is treated as off: an enabled request is refused,
        // not silently run in-place.
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
            worktree: { enabled: true, baseRef: 'main' },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/not enabled/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('ignores an opted-out worktree request even when the flag is off (AC-04)', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
            worktree: { enabled: false },
        });

        expect(res.status).toBe(200);
        expect(mockEnqueue).toHaveBeenCalledOnce();
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.context.ralph.currentIteration).toBe(1);
        expect(enqueueArg.repoId).toBe('ws-1');
        expect(res.json().worktree).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Optional fields
    // -----------------------------------------------------------------------

    it('works without workspaceId (no journal initialised)', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
        });

        expect(res.status).toBe(200);
        expect(mockEnqueue).toHaveBeenCalledOnce();
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.repoId).toBeUndefined();
    });
});

// ============================================================================
// AC-04: worktree execution wiring with the feature flag enabled
// ============================================================================

describe('POST /api/ralph-launch with Git worktree (AC-04)', () => {
    const REPO_ID = 'ws-wt';
    let server: http.Server;
    let baseUrl: string;
    let mockEnqueue: ReturnType<typeof vi.fn>;
    let store: ReturnType<typeof createMockProcessStore>;
    let dataDir: string;
    let sourceRepo: string;

    function git(dir: string, ...args: string[]): string {
        return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8' }).replace(/\r?\n$/, '');
    }

    beforeAll(async () => {
        mockEnqueue = vi.fn().mockResolvedValue('new-task-id');
        store = createMockProcessStore();
        dataDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-launch-wt-data-'));
        sourceRepo = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-launch-wt-src-'));
        git(sourceRepo, 'init', '-q');
        git(sourceRepo, 'config', 'user.email', 'test@test.com');
        git(sourceRepo, 'config', 'user.name', 'Test');
        git(sourceRepo, 'config', 'commit.gpgsign', 'false');
        fs.writeFileSync(pathMod.join(sourceRepo, 'README.md'), 'hello\n', 'utf-8');
        git(sourceRepo, 'add', '-A');
        git(sourceRepo, 'commit', '-q', '-m', 'init');
        await store.registerWorkspace({ id: REPO_ID, rootPath: sourceRepo } as any);

        const routes: Route[] = [];
        registerRalphLaunchRoutes(routes, {
            bridge: { enqueue: mockEnqueue } as any,
            dataDir,
            store,
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
        mockEnqueue.mockClear();
    });

    it('creates the worktree, runs iteration 1 in it, and persists metadata on the session record', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: '## Goal\nBuild a feature',
            workspaceId: REPO_ID,
            worktree: { enabled: true },
        });

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.worktree).toBeDefined();
        const worktreePath = data.worktree.path;
        expect(worktreePath).toContain('git-worktrees');
        expect(fs.existsSync(worktreePath)).toBe(true);
        expect(data.worktree.ralphSessionId).toBe(data.sessionId);

        // Iteration 1 runs in the worktree, not the source checkout.
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.workingDirectory).toBe(worktreePath);

        // Source checkout HEAD is not moved onto the worktree branch.
        expect(git(sourceRepo, 'rev-parse', '--abbrev-ref', 'HEAD')).not.toBe(data.worktree.branch);

        // Worktree metadata is persisted on the session record for recovery/chip.
        const recordRaw = fs.readFileSync(
            pathMod.join(dataDir, 'repos', REPO_ID, 'ralph-sessions', data.sessionId, 'session.json'),
            'utf-8',
        );
        const record = JSON.parse(recordRaw);
        expect(record.worktree.path).toBe(worktreePath);
        expect(record.worktree.status).toBe('active');
    });

    it('creates the worktree from a valid base ref', async () => {
        const headSha = git(sourceRepo, 'rev-parse', 'HEAD');
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: REPO_ID,
            worktree: { enabled: true, baseRef: headSha },
        });

        expect(res.status).toBe(200);
        expect(res.json().worktree.baseSha).toBe(headSha);
        expect(res.json().worktree.baseRef).toBe(headSha);
    });

    it('returns 400 and does not enqueue when the base ref does not resolve', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: REPO_ID,
            worktree: { enabled: true, baseRef: 'no-such-ref' },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/does not resolve/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 400 for a non-Git workspace folder', async () => {
        const nonGit = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-launch-nongit-'));
        await store.registerWorkspace({ id: 'ws-nongit', rootPath: nonGit } as any);
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-nongit',
            worktree: { enabled: true },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/not a git repository/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
        try { fs.rmSync(nonGit, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('runs a normal in-place launch when no worktree is requested', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: REPO_ID,
        });

        expect(res.status).toBe(200);
        expect(res.json().worktree).toBeUndefined();
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.workingDirectory).toBeUndefined();
    });
});
