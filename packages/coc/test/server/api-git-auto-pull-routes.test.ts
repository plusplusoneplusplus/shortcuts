/**
 * Tests for GET /api/workspaces/:id/git/auto-pull (AC-05 read API).
 *
 * The route is a thin reader over `AutoPullManager.getStatus`, so these run a
 * real manager over a real temp data dir and a real HTTP server — what they
 * pin down is that the client can see the schedule (`nextRunAt`), the
 * preference (`enabled` / `intervalMinutes`), and the persisted outcome of the
 * last run without owning a timer of its own.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerGitAutoPullRoutes } from '../../src/server/routes/api-git-auto-pull-routes';
import { AutoPullManager, type AutoPullPreference, type AutoPullWorkspace } from '../../src/server/git/auto-pull-manager';
import { writeAutoPullState } from '../../src/server/git/auto-pull-state';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';

function get(url: string): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'GET' },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode || 0, json: () => JSON.parse(body) });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

describe('GET /api/workspaces/:id/git/auto-pull', () => {
    let server: http.Server;
    let port: number;
    let tmpDir: string;
    let manager: AutoPullManager;
    const workspaces: AutoPullWorkspace[] = [{ id: 'ws-1', rootPath: '/repo/one' }];
    let preference: AutoPullPreference | undefined;

    beforeAll(async () => {
        const routes: Route[] = [];
        const store = createMockProcessStore();
        (store.getWorkspaces as any).mockImplementation(async () => workspaces);
        registerGitAutoPullRoutes({
            routes,
            store,
            autoPullManager: {
                getStatus: (id: string) => manager.getStatus(id),
            } as unknown as AutoPullManager,
        });
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pull-route-'));
        preference = undefined;
        manager = new AutoPullManager({
            dataDir: tmpDir,
            listWorkspaces: async () => workspaces,
            readAutoPullPreference: () => preference,
            runTick: async () => {},
            timerApi: { setTimeout: () => ({}), clearTimeout: () => {} },
        });
    });

    afterEach(() => {
        manager.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const base = () => `http://127.0.0.1:${port}`;

    it('reports auto-pull as disabled when the repo has no preference', async () => {
        const res = await get(`${base()}/api/workspaces/ws-1/git/auto-pull`);
        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ enabled: false });
    });

    it('reports the interval and the next scheduled run once a timer is armed', async () => {
        preference = { enabled: true, intervalMinutes: 30 };
        await manager.startAll();

        const body = (await get(`${base()}/api/workspaces/ws-1/git/auto-pull`)).json();
        expect(body.enabled).toBe(true);
        expect(body.intervalMinutes).toBe(30);
        const nextRunMs = Date.parse(body.nextRunAt);
        expect(Number.isNaN(nextRunMs)).toBe(false);
        expect(nextRunMs).toBeGreaterThan(Date.now());
    });

    it('surfaces the last run outcome and message from persisted state', async () => {
        preference = { enabled: true, intervalMinutes: 15 };
        const lastRunAt = new Date(Date.now() - 60_000).toISOString();
        writeAutoPullState(tmpDir, 'ws-1', {
            lastRunAt,
            outcome: 'skipped-dirty',
            message: 'Skipped — uncommitted changes',
        });

        const body = (await get(`${base()}/api/workspaces/ws-1/git/auto-pull`)).json();
        expect(body.lastRunAt).toBe(lastRunAt);
        expect(body.outcome).toBe('skipped-dirty');
        expect(body.message).toBe('Skipped — uncommitted changes');
    });

    it('404s for an unknown workspace', async () => {
        const res = await get(`${base()}/api/workspaces/nope/git/auto-pull`);
        expect(res.status).toBe(404);
    });
});
