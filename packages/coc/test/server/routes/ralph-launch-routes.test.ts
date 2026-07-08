/**
 * Tests for POST /api/ralph-launch route.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as pathMod from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerRalphLaunchRoutes } from '../../../src/server/routes/ralph-launch-routes';
import type { Route } from '../../../src/server/types';

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

    it('accepts a valid worktree request without changing the enqueued base payload', async () => {
        const res = await post(baseUrl, '/api/ralph-launch', {
            goalSpec: 'Build something',
            workspaceId: 'ws-1',
            worktree: { enabled: true, baseRef: 'main' },
        });

        expect(res.status).toBe(200);
        expect(mockEnqueue).toHaveBeenCalledOnce();
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.context.ralph.currentIteration).toBe(1);
        expect(enqueueArg.repoId).toBe('ws-1');
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
