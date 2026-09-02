/**
 * Tests for POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/max-iterations
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as pathMod from 'path';
import { createRouter } from '../../../src/server/shared/router';
import {
    registerRalphMaxIterationsRoutes,
    parseMaxIterations,
} from '../../../src/server/routes/ralph-max-iterations-routes';
import type { Route } from '../../../src/server/types';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import type { RalphSessionRecord, RalphSessionPhase } from '../../../src/server/ralph/types';

function post(
    baseUrl: string,
    urlPath: string,
    body: unknown,
): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const payload = JSON.stringify(body);
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
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode || 0, json: () => JSON.parse(bodyStr) });
                });
            },
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function recordPath(dataDir: string, workspaceId: string, sessionId: string): string {
    return pathMod.join(dataDir, 'repos', workspaceId, 'ralph-sessions', sessionId, 'session.json');
}

async function seedSession(
    dataDir: string,
    workspaceId: string,
    sessionId: string,
    overrides: Partial<RalphSessionRecord> = {},
): Promise<RalphSessionRecord> {
    const journal = new RalphSessionStore({ dataDir });
    await journal.initSession(workspaceId, sessionId, {
        originalGoal: 'Original goal',
        maxIterations: 20,
        startedAt: '2026-05-11T00:00:00Z',
    });
    return journal.updateSessionRecord(workspaceId, sessionId, (rec) => ({
        ...(rec as RalphSessionRecord),
        currentIteration: 4,
        phase: 'executing' as RalphSessionPhase,
        ...overrides,
    }));
}

describe('parseMaxIterations', () => {
    it('accepts an integer inside the bound', () => {
        expect(parseMaxIterations({ maxIterations: 60 }, 500)).toEqual({ value: 60 });
        expect(parseMaxIterations({ maxIterations: 1 }, 500)).toEqual({ value: 1 });
        expect(parseMaxIterations({ maxIterations: 500 }, 500)).toEqual({ value: 500 });
    });

    it('rejects out-of-range, non-integer and missing values naming the bound', () => {
        for (const bad of [0, -1, 501, 2.5, Number.NaN, '10', undefined, null]) {
            const result = parseMaxIterations({ maxIterations: bad }, 500);
            expect(result).toHaveProperty('error');
            expect((result as { error: string }).error).toContain('between 1 and 500');
        }
        expect(parseMaxIterations({}, 500)).toHaveProperty('error');
        expect(parseMaxIterations(undefined, 500)).toHaveProperty('error');
    });
});

describe('POST /api/workspaces/:wsId/ralph-sessions/:sessionId/max-iterations', () => {
    let server: http.Server;
    let baseUrl: string;
    let dataDir: string;

    beforeAll(async () => {
        dataDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-maxiter-test-'));

        const routes: Route[] = [];
        registerRalphMaxIterationsRoutes(routes, { dataDir });

        const router = createRouter({ routes, spaHtml: '' });
        server = http.createServer(router);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    beforeEach(() => {
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
        fs.mkdirSync(dataDir, { recursive: true });
    });

    it('sets an absolute cap on an executing session', async () => {
        await seedSession(dataDir, 'ws-1', 'sess-live');

        const res = await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/sess-live/max-iterations', {
            maxIterations: 60,
        });
        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.updated).toBe(true);
        expect(data.maxIterations).toBe(60);
        expect(data.previousMaxIterations).toBe(20);
        expect(data.currentIteration).toBe(4);
        expect(data.phase).toBe('executing');

        const rec = JSON.parse(fs.readFileSync(recordPath(dataDir, 'ws-1', 'sess-live'), 'utf-8'));
        expect(rec.maxIterations).toBe(60);
        expect(rec.phase).toBe('executing');
    });

    it('appends a marker line to progress.md recording old -> new', async () => {
        await seedSession(dataDir, 'ws-1', 'sess-marker');

        await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/sess-marker/max-iterations', {
            maxIterations: 33,
        });

        const md = fs.readFileSync(
            pathMod.join(dataDir, 'repos', 'ws-1', 'ralph-sessions', 'sess-marker', 'progress.md'),
            'utf-8',
        );
        expect(md).toMatch(/Max iterations changed at .* — 20 -> 33/);
    });

    it('allows lowering the cap below the current iteration', async () => {
        await seedSession(dataDir, 'ws-1', 'sess-lower', { currentIteration: 8 });

        const res = await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/sess-lower/max-iterations', {
            maxIterations: 4,
        });
        expect(res.status).toBe(200);
        expect(res.json().maxIterations).toBe(4);
    });

    it('leaves phase, completedAt, terminalReason and currentIteration untouched', async () => {
        await seedSession(dataDir, 'ws-1', 'sess-untouched');

        const before = JSON.parse(fs.readFileSync(recordPath(dataDir, 'ws-1', 'sess-untouched'), 'utf-8'));
        await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/sess-untouched/max-iterations', {
            maxIterations: 12,
        });
        const after = JSON.parse(fs.readFileSync(recordPath(dataDir, 'ws-1', 'sess-untouched'), 'utf-8'));

        expect(after.phase).toBe(before.phase);
        expect(after.completedAt).toBe(before.completedAt);
        expect(after.terminalReason).toBe(before.terminalReason);
        expect(after.currentIteration).toBe(before.currentIteration);
        expect(after.maxIterations).toBe(12);
    });

    it.each(['grilling', 'executing'] as RalphSessionPhase[])(
        'accepts non-terminal phase %s',
        async (phase) => {
            await seedSession(dataDir, 'ws-1', `sess-${phase}`, { phase });
            const res = await post(
                baseUrl,
                `/api/workspaces/ws-1/ralph-sessions/sess-${phase}/max-iterations`,
                { maxIterations: 7 },
            );
            expect(res.status).toBe(200);
        },
    );

    it('rejects a value above the hard cap with 400 naming the bound', async () => {
        await seedSession(dataDir, 'ws-1', 'sess-hi');
        const res = await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/sess-hi/max-iterations', {
            maxIterations: 600,
        });
        expect(res.status).toBe(400);
        expect(res.json().error).toContain('between 1 and 500');

        const rec = JSON.parse(fs.readFileSync(recordPath(dataDir, 'ws-1', 'sess-hi'), 'utf-8'));
        expect(rec.maxIterations).toBe(20);
    });

    it('rejects zero with 400', async () => {
        await seedSession(dataDir, 'ws-1', 'sess-zero');
        const res = await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/sess-zero/max-iterations', {
            maxIterations: 0,
        });
        expect(res.status).toBe(400);
    });

    it('rejects a completed session with 409', async () => {
        await seedSession(dataDir, 'ws-1', 'sess-done', {
            phase: 'complete',
            completedAt: '2026-05-11T03:00:00Z',
            terminalReason: 'CAP_REACHED',
        });
        const res = await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/sess-done/max-iterations', {
            maxIterations: 40,
        });
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/already complete/i);

        const rec = JSON.parse(fs.readFileSync(recordPath(dataDir, 'ws-1', 'sess-done'), 'utf-8'));
        expect(rec.maxIterations).toBe(20);
    });

    it('returns 404 for a missing session record', async () => {
        const res = await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/nope/max-iterations', {
            maxIterations: 40,
        });
        expect(res.status).toBe(404);
    });
});
