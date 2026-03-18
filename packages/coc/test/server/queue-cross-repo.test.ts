/**
 * Queue Cross-Repo Pause Isolation Tests
 *
 * Covers Section 1 & 2 of test-plan-queue-advanced.md:
 * - Section 1: Per-repo pause isolation
 * - Section 2: Global pause vs per-repo pause precedence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
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
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') })
                );
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function post(url: string, data: unknown) {
    return request(url, { method: 'POST', body: JSON.stringify(data) });
}

function makeTask(workingDirectory: string, displayName?: string) {
    return {
        type: 'chat',
        priority: 'normal',
        payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', workingDirectory },
        config: {},
        displayName: displayName ?? `Task-${workingDirectory}`,
    };
}

async function registerWorkspace(baseUrl: string, id: string, rootPath: string) {
    await post(`${baseUrl}/api/workspaces`, { id, name: id, rootPath });
}

async function enqueueForRepo(baseUrl: string, workingDirectory: string, displayName?: string) {
    const res = await post(`${baseUrl}/api/queue`, makeTask(workingDirectory, displayName));
    return JSON.parse(res.body).task;
}

// ============================================================================
// Section 1: Cross-Repo Pause Isolation
// ============================================================================

describe('Queue Cross-Repo Pause Isolation', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-cross-repo-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer() {
        server = await createExecutionServer({ port: 0, host: 'localhost', dataDir });
        return server;
    }

    it('pausing repo A does not affect repo B pause state', async () => {
        const srv = await startServer();
        await registerWorkspace(srv.url, 'ws-a', '/repos/a');
        await registerWorkspace(srv.url, 'ws-b', '/repos/b');

        // Global pause to prevent execution, then enqueue to create bridges
        await post(`${srv.url}/api/queue/pause`, {});
        await enqueueForRepo(srv.url, '/repos/a');
        await enqueueForRepo(srv.url, '/repos/b');

        // Resume globally, then pause only repo A
        await post(`${srv.url}/api/queue/resume`, {});
        await request(`${srv.url}/api/queue/pause?repoId=ws-a`, { method: 'POST' });

        // GET /api/queue/repos — A paused, B active
        const res = await request(`${srv.url}/api/queue/repos`);
        const repos = JSON.parse(res.body).repos;
        expect(repos.find((r: any) => r.repoId === 'ws-a')?.isPaused).toBe(true);
        expect(repos.find((r: any) => r.repoId === 'ws-b')?.isPaused).toBe(false);
    });

    it('pausing repo A keeps its tasks queued while repo B tasks remain unaffected', async () => {
        const srv = await startServer();
        await registerWorkspace(srv.url, 'ws-a2', '/repos/a2');
        await registerWorkspace(srv.url, 'ws-b2', '/repos/b2');

        await post(`${srv.url}/api/queue/pause`, {});
        const taskA = await enqueueForRepo(srv.url, '/repos/a2', 'task-a2');
        const taskB = await enqueueForRepo(srv.url, '/repos/b2', 'task-b2');

        // Pause A
        await request(`${srv.url}/api/queue/pause?repoId=ws-a2`, { method: 'POST' });

        // Repo A tasks still in queue
        const resA = await request(`${srv.url}/api/queue?repoId=ws-a2`);
        expect(JSON.parse(resA.body).queued).toHaveLength(1);
        expect(JSON.parse(resA.body).queued[0].id).toBe(taskA.id);

        // Repo B tasks still in queue (not affected)
        const resB = await request(`${srv.url}/api/queue?repoId=ws-b2`);
        expect(JSON.parse(resB.body).queued).toHaveLength(1);
        expect(JSON.parse(resB.body).queued[0].id).toBe(taskB.id);
    });

    it('resume repo A after pausing shows isPaused: false', async () => {
        const srv = await startServer();
        await registerWorkspace(srv.url, 'ws-ra', '/repos/ra');

        await post(`${srv.url}/api/queue/pause`, {});
        await enqueueForRepo(srv.url, '/repos/ra');

        // Pause then resume repo A
        await request(`${srv.url}/api/queue/pause?repoId=ws-ra`, { method: 'POST' });
        await request(`${srv.url}/api/queue/resume?repoId=ws-ra`, { method: 'POST' });

        const res = await request(`${srv.url}/api/queue/repos`);
        const repos = JSON.parse(res.body).repos;
        expect(repos.find((r: any) => r.repoId === 'ws-ra')?.isPaused).toBe(false);
    });

    it('pausing an already-paused repo is idempotent — returns 200', async () => {
        const srv = await startServer();
        await registerWorkspace(srv.url, 'ws-idem', '/repos/idem');

        await post(`${srv.url}/api/queue/pause`, {});
        await enqueueForRepo(srv.url, '/repos/idem');
        await request(`${srv.url}/api/queue/pause?repoId=ws-idem`, { method: 'POST' });

        // Pause again — should not error
        const res = await request(`${srv.url}/api/queue/pause?repoId=ws-idem`, { method: 'POST' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).paused).toBe(true);
    });

    it('resuming an already-active repo is idempotent — returns 200', async () => {
        const srv = await startServer();
        await registerWorkspace(srv.url, 'ws-idem2', '/repos/idem2');

        await post(`${srv.url}/api/queue/pause`, {});
        await enqueueForRepo(srv.url, '/repos/idem2');
        // Resume without pausing first
        await request(`${srv.url}/api/queue/resume?repoId=ws-idem2`, { method: 'POST' });

        // Resume again — idempotent
        const res = await request(`${srv.url}/api/queue/resume?repoId=ws-idem2`, { method: 'POST' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).paused).toBe(false);
    });
});

// ============================================================================
// Section 2: Global Pause vs Per-Repo Pause Precedence
// ============================================================================

describe('Global Pause vs Per-Repo Pause', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-global-pause-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer() {
        server = await createExecutionServer({ port: 0, host: 'localhost', dataDir });
        return server;
    }

    it('global pause causes all repos to report isPaused: true', async () => {
        const srv = await startServer();
        await post(`${srv.url}/api/workspaces`, { id: 'ws-g1', name: 'g1', rootPath: '/repos/g1' });
        await post(`${srv.url}/api/workspaces`, { id: 'ws-g2', name: 'g2', rootPath: '/repos/g2' });

        await post(`${srv.url}/api/queue/pause`, {});
        await post(`${srv.url}/api/queue`, makeTask('/repos/g1'));
        await post(`${srv.url}/api/queue`, makeTask('/repos/g2'));

        const res = await request(`${srv.url}/api/queue/repos`);
        const repos = JSON.parse(res.body).repos;
        for (const repo of repos) {
            expect(repo.isPaused).toBe(true);
        }
    });

    it('enqueuing while globally paused succeeds (201)', async () => {
        const srv = await startServer();
        await post(`${srv.url}/api/queue/pause`, {});

        const res = await post(`${srv.url}/api/queue`, {
            type: 'chat',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
            config: {},
        });
        expect(res.status).toBe(201);
    });

    it('GET /api/queue/stats shows isPaused: true when globally paused', async () => {
        const srv = await startServer();
        await post(`${srv.url}/api/queue/pause`, {});

        // With at least one queue manager created
        await post(`${srv.url}/api/queue`, {
            type: 'chat',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
            config: {},
        });

        const statsRes = await request(`${srv.url}/api/queue/stats`);
        expect(JSON.parse(statsRes.body).stats.isPaused).toBe(true);
    });

    it('GET /api/queue/stats shows isPaused: true when globally paused with no queues', async () => {
        const srv = await startServer();
        await post(`${srv.url}/api/queue/pause`, {});

        const statsRes = await request(`${srv.url}/api/queue/stats`);
        // globalPaused flag is reflected when no queues exist
        expect(JSON.parse(statsRes.body).stats.isPaused).toBe(true);
    });

    it('global resume causes repos to show isPaused: false', async () => {
        const srv = await startServer();
        await post(`${srv.url}/api/workspaces`, { id: 'ws-gr', name: 'gr', rootPath: '/repos/gr' });

        await post(`${srv.url}/api/queue/pause`, {});
        await post(`${srv.url}/api/queue`, makeTask('/repos/gr'));
        await post(`${srv.url}/api/queue/resume`, {});

        const res = await request(`${srv.url}/api/queue/repos`);
        const repos = JSON.parse(res.body).repos;
        for (const repo of repos) {
            expect(repo.isPaused).toBe(false);
        }
    });

    it('rapid global pause/resume cycle (10×) — final state consistent', async () => {
        const srv = await startServer();
        await post(`${srv.url}/api/workspaces`, { id: 'ws-rapid', name: 'rapid', rootPath: '/repos/rapid' });

        await post(`${srv.url}/api/queue/pause`, {});
        await post(`${srv.url}/api/queue`, makeTask('/repos/rapid'));

        // Alternate pause/resume 10 times (ends on resume)
        for (let i = 0; i < 10; i++) {
            if (i % 2 === 0) {
                await post(`${srv.url}/api/queue/pause`, {});
            } else {
                await post(`${srv.url}/api/queue/resume`, {});
            }
        }
        // Last iteration: i=9 (odd) → resume
        const statsRes = await request(`${srv.url}/api/queue/stats`);
        expect(JSON.parse(statsRes.body).stats.isPaused).toBe(false);
    });

    it('rapid global pause/resume cycle — can end on paused state', async () => {
        const srv = await startServer();
        await post(`${srv.url}/api/workspaces`, { id: 'ws-rapid2', name: 'rapid2', rootPath: '/repos/rapid2' });

        await post(`${srv.url}/api/queue/pause`, {});
        await post(`${srv.url}/api/queue`, makeTask('/repos/rapid2'));

        // Alternate pause/resume 11 times (ends on pause)
        for (let i = 0; i < 11; i++) {
            if (i % 2 === 0) {
                await post(`${srv.url}/api/queue/pause`, {});
            } else {
                await post(`${srv.url}/api/queue/resume`, {});
            }
        }
        // Last iteration: i=10 (even) → pause
        const statsRes = await request(`${srv.url}/api/queue/stats`);
        expect(JSON.parse(statsRes.body).stats.isPaused).toBe(true);
    });
});
