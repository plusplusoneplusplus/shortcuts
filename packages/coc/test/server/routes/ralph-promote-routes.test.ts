/**
 * Tests for POST /api/processes/:id/promote-to-ralph route.
 *
 * Promotes a completed ask-mode chat into a Ralph session by attaching a
 * grilling-phase ralph context to the existing process and enqueueing a
 * synthesis follow-up turn.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../../src/server/shared/router';
import { registerRalphPromoteRoutes } from '../../../src/server/routes/ralph-promote-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';

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

interface FixtureOptions {
    id?: string;
    status?: 'completed' | 'running' | 'failed';
    mode?: 'ask' | 'plan' | 'autopilot' | 'ralph';
    ralph?: { phase?: string; sessionId?: string };
    workspaceId?: string;
    conversationTurns?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function makeFixture(opts: FixtureOptions = {}): any {
    const turns = opts.conversationTurns ?? [
        { role: 'user', content: 'Build a feature please' },
        { role: 'assistant', content: 'Sure — could you clarify scope?' },
    ];
    const payload: Record<string, any> = {
        kind: 'chat',
        mode: opts.mode ?? 'ask',
        prompt: 'Build a feature please',
        ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
        workingDirectory: '/repos/myrepo',
    };
    if (opts.ralph) {
        payload.context = { ralph: opts.ralph };
    }
    return {
        id: opts.id ?? 'queue_promote-fixture',
        type: 'chat',
        status: opts.status ?? 'completed',
        startTime: new Date(),
        promptPreview: 'Build a feature please',
        payload,
        metadata: opts.workspaceId ? { workspaceId: opts.workspaceId } : {},
        conversationTurns: turns.map((t, i) => ({
            ...t,
            turnIndex: i,
            timestamp: new Date(),
            timeline: [],
        })),
    };
}

describe('POST /api/processes/:id/promote-to-ralph', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let mockEnqueue: ReturnType<typeof vi.fn>;
    let dataDir: string;

    beforeAll(async () => {
        store = createMockProcessStore();
        mockEnqueue = vi.fn().mockResolvedValue('synthesis-task-id');

        const mockBridge = { enqueue: mockEnqueue } as any;

        const fs = await import('fs');
        const os = await import('os');
        const pathMod = await import('path');
        dataDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-promote-routes-test-'));

        const routes: Route[] = [];
        registerRalphPromoteRoutes(routes, { bridge: mockBridge, store, dataDir });

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

    // ── Happy path ──

    it('returns 200, attaches ralph metadata, initialises journal, and enqueues a synthesis turn', async () => {
        await store.addProcess(makeFixture({ id: 'queue_p-happy', workspaceId: 'ws-happy' }));

        const res = await post(baseUrl, '/api/processes/queue_p-happy/promote-to-ralph', {
            workspaceId: 'ws-happy',
        });

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.promoted).toBe(true);
        expect(data.processId).toMatch(/^queue_/);
        expect(data.sessionId).toMatch(/^ralph-/);
        expect(data.synthesisTaskId).toMatch(/^queue_/);

        const proc = await store.getProcess('queue_p-happy');
        expect((proc as any)?.metadata?.ralph?.phase).toBe('grilling');
        expect((proc as any)?.metadata?.ralph?.sessionId).toBe(data.sessionId);

        expect(mockEnqueue).toHaveBeenCalledOnce();
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.processId).toBe('queue_p-happy');
        expect(enqueueArg.payload.mode).toBe('ask');
        expect(enqueueArg.payload.context.ralph.phase).toBe('grilling');
        expect(enqueueArg.payload.context.ralph.sessionId).toBe(data.sessionId);
        expect(enqueueArg.payload.context.skills).toEqual(['grill-me']);
        expect(enqueueArg.payload.prompt).toContain('## Goal');

        const fs = await import('fs');
        const pathMod = await import('path');
        const sessionDir = pathMod.join(dataDir, 'repos', 'ws-happy', 'ralph-sessions', data.sessionId);
        expect(fs.existsSync(sessionDir)).toBe(true);
    });

    it('forwards extraGuidance into the synthesis prompt', async () => {
        await store.addProcess(makeFixture({ id: 'queue_p-hint', workspaceId: 'ws-hint' }));

        const res = await post(baseUrl, '/api/processes/queue_p-hint/promote-to-ralph', {
            workspaceId: 'ws-hint',
            extraGuidance: 'focus the goal on the queue refactor',
        });

        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls.at(-1)![0];
        expect(enqueueArg.payload.prompt).toContain('focus the goal on the queue refactor');
    });

    it('stores and forwards a normalized multi-agent grill setup when provided', async () => {
        await store.addProcess(makeFixture({ id: 'queue_p-grill', workspaceId: 'ws-grill' }));

        const res = await post(baseUrl, '/api/processes/queue_p-grill/promote-to-ralph', {
            workspaceId: 'ws-grill',
            grill: {
                enabled: true,
                depth: 'deep',
                agents: [
                    { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
                    { role: 'ux', provider: 'not-real', model: 'claude-sonnet-4.6' },
                    { role: 'unknown', provider: 'codex', model: 'ignored' },
                ],
            },
        });

        expect(res.status).toBe(200);
        const proc = await store.getProcess('queue_p-grill');
        expect((proc as any)?.metadata?.ralph?.grill).toEqual(expect.objectContaining({
            enabled: true,
            depth: 'deep',
        }));
        expect((proc as any)?.metadata?.ralph?.grill?.agents).toEqual(expect.arrayContaining([
            { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
            { role: 'ux', model: 'claude-sonnet-4.6' },
        ]));
        expect((proc as any)?.metadata?.ralph?.grill?.agents.some((agent: any) => agent.role === 'unknown')).toBe(false);

        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.context.ralph.grill).toEqual((proc as any).metadata.ralph.grill);
    });

    it('accepts processes whose mode/kind only live in metadata (payload=null)', async () => {
        // Real persisted processes do not always mirror the queue-task
        // payload onto the process record — `mode`/`type` live on
        // `metadata.mode` / `metadata.type`. The route must accept either
        // source, otherwise every promotion request 400s in production.
        const fixture = makeFixture({ id: 'queue_p-meta-only', workspaceId: 'ws-meta' });
        fixture.payload = null;
        fixture.metadata = {
            ...fixture.metadata,
            type: 'chat',
            mode: 'ask',
            workspaceId: 'ws-meta',
        };
        await store.addProcess(fixture);

        const res = await post(baseUrl, '/api/processes/queue_p-meta-only/promote-to-ralph', {
            workspaceId: 'ws-meta',
        });

        expect(res.status).toBe(200);
        expect(mockEnqueue).toHaveBeenCalledOnce();
        const enqueueArg = mockEnqueue.mock.calls[0][0];
        expect(enqueueArg.payload.mode).toBe('ask');
        expect(enqueueArg.payload.context.ralph.phase).toBe('grilling');
    });

    // ── 404 ──

    it('returns 404 when the process does not exist', async () => {
        const res = await post(baseUrl, '/api/processes/nonexistent/promote-to-ralph', {});
        expect(res.status).toBe(404);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    // ── 400 — eligibility gates ──

    it('returns 400 when the process is still running', async () => {
        await store.addProcess(makeFixture({ id: 'queue_p-running', status: 'running' }));
        const res = await post(baseUrl, '/api/processes/queue_p-running/promote-to-ralph', {});
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/completed/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 400 when the process is plan-mode (only ask-mode is eligible)', async () => {
        await store.addProcess(makeFixture({ id: 'queue_p-plan', mode: 'plan' }));
        const res = await post(baseUrl, '/api/processes/queue_p-plan/promote-to-ralph', {});
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/ask-mode/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 400 when the process already has a ralph context', async () => {
        await store.addProcess(makeFixture({
            id: 'queue_p-already',
            ralph: { phase: 'grilling', sessionId: 'pre-existing' },
        }));
        const res = await post(baseUrl, '/api/processes/queue_p-already/promote-to-ralph', {});
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/already/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 400 when the process has no assistant turns yet', async () => {
        await store.addProcess(makeFixture({
            id: 'queue_p-no-asst',
            conversationTurns: [{ role: 'user', content: 'just a question' }],
        }));
        const res = await post(baseUrl, '/api/processes/queue_p-no-asst/promote-to-ralph', {});
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/assistant/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 400 when extraGuidance exceeds the length cap', async () => {
        await store.addProcess(makeFixture({ id: 'queue_p-huge-hint' }));
        const res = await post(baseUrl, '/api/processes/queue_p-huge-hint/promote-to-ralph', {
            extraGuidance: 'a'.repeat(3000),
        });
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/extraGuidance/i);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    // ── Rollback on enqueue failure ──

    it('rolls back the attached ralph metadata if the synthesis enqueue fails', async () => {
        mockEnqueue.mockRejectedValueOnce(new Error('queue full'));
        await store.addProcess(makeFixture({ id: 'queue_p-rollback', workspaceId: 'ws-rb' }));

        const res = await post(baseUrl, '/api/processes/queue_p-rollback/promote-to-ralph', {
            workspaceId: 'ws-rb',
        });

        expect(res.status).toBe(500);
        const proc = await store.getProcess('queue_p-rollback');
        expect((proc as any)?.metadata?.ralph).toBeUndefined();
    });

    // ── Seed goal detection (AC-02) ──

    it('injects seedGoal into synthesis prompt when last assistant turn contains ## Goal', async () => {
        const goalBlock = '## Goal\nBuild the widget factory.\n\n[decision] Use TypeScript only.';
        await store.addProcess(makeFixture({
            id: 'queue_p-seed',
            workspaceId: 'ws-seed',
            conversationTurns: [
                { role: 'user', content: 'Build something' },
                { role: 'assistant', content: `Here is the spec:\n\n${goalBlock}` },
            ],
        }));

        const res = await post(baseUrl, '/api/processes/queue_p-seed/promote-to-ralph', {
            workspaceId: 'ws-seed',
        });

        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls.at(-1)![0];
        const prompt: string = enqueueArg.payload.prompt;
        expect(prompt).toContain(goalBlock);
        expect(prompt).toContain('authoritative');
        expect(prompt).toContain('preserve all [decision] tags and constraints verbatim');
    });

    it('does not inject seedGoal when last assistant turn has no ## Goal block', async () => {
        await store.addProcess(makeFixture({
            id: 'queue_p-no-seed',
            workspaceId: 'ws-no-seed',
            conversationTurns: [
                { role: 'user', content: 'Build something' },
                { role: 'assistant', content: 'Sure, let me help you with that.' },
            ],
        }));

        const res = await post(baseUrl, '/api/processes/queue_p-no-seed/promote-to-ralph', {
            workspaceId: 'ws-no-seed',
        });

        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls.at(-1)![0];
        const prompt: string = enqueueArg.payload.prompt;
        expect(prompt).not.toContain('authoritative');
        expect(prompt).not.toContain('preserve all [decision] tags');
    });

    it('uses only the last assistant turn for seed detection, ignoring earlier turns', async () => {
        const oldGoal = '## Goal\nOld spec that should not be used.';
        await store.addProcess(makeFixture({
            id: 'queue_p-last-turn',
            workspaceId: 'ws-last-turn',
            conversationTurns: [
                { role: 'user', content: 'First question' },
                { role: 'assistant', content: `Early response:\n\n${oldGoal}` },
                { role: 'user', content: 'Changed my mind' },
                { role: 'assistant', content: 'OK, no goal block here.' },
            ],
        }));

        const res = await post(baseUrl, '/api/processes/queue_p-last-turn/promote-to-ralph', {
            workspaceId: 'ws-last-turn',
        });

        expect(res.status).toBe(200);
        const enqueueArg = mockEnqueue.mock.calls.at(-1)![0];
        const prompt: string = enqueueArg.payload.prompt;
        // Old goal from the non-last turn should NOT be seeded
        expect(prompt).not.toContain('Old spec that should not be used');
        expect(prompt).not.toContain('authoritative');
    });
});
