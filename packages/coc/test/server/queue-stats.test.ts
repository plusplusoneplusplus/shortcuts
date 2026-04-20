/**
 * Queue Statistics Tests
 *
 * Covers Section 8 of test-plan-queue-advanced.md:
 * - GET /api/queue/stats returns { queued, running, completed, failed, cancelled, total, isPaused, isDraining }
 * - Stats after enqueue → pendingCount increments
 * - Stats after task fails (via force-fail) → pendingCount - 1, failedCount + 1
 * - Stats with 0 items → all counts are 0 (not null/undefined)
 * - Stats include isPaused: true when globally paused
 * - Stats scoped to workspace when ?workspaceId= param provided
 *
 * Note: "Stats after task completes" requires AI execution and is not tested here.
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

// ============================================================================
// Tests
// ============================================================================

describe('Queue Statistics', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-stats-'));
        server = await createExecutionServer({ port: 0, host: 'localhost', dataDir , skipNonEssentialInit: true });
        await post(`${server.url}/api/queue/pause`, {});
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function enqueueTask(displayName = 'Test task'): Promise<string> {
        const res = await post(`${server!.url}/api/queue`, {
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
            config: {},
            displayName,
        });
        return JSON.parse(res.body).task.id;
    }

    // ========================================================================
    // Stats shape
    // ========================================================================

    it('GET /api/queue/stats returns required fields', async () => {
        const res = await request(`${server!.url}/api/queue/stats`);
        expect(res.status).toBe(200);
        const { stats } = JSON.parse(res.body);
        expect(typeof stats.queued).toBe('number');
        expect(typeof stats.running).toBe('number');
        expect(typeof stats.completed).toBe('number');
        expect(typeof stats.failed).toBe('number');
        expect(typeof stats.cancelled).toBe('number');
        expect(typeof stats.total).toBe('number');
        expect(typeof stats.isPaused).toBe('boolean');
        expect(typeof stats.isDraining).toBe('boolean');
    });

    // ========================================================================
    // Stats with 0 items
    // ========================================================================

    it('stats with 0 items — all counts are 0, not null or undefined', async () => {
        // Resume to clear global pause so aggregateStats works normally
        await post(`${server!.url}/api/queue/resume`, {});

        const res = await request(`${server!.url}/api/queue/stats`);
        const { stats } = JSON.parse(res.body);
        expect(stats.queued).toBe(0);
        expect(stats.running).toBe(0);
        expect(stats.completed).toBe(0);
        expect(stats.failed).toBe(0);
        expect(stats.cancelled).toBe(0);
        expect(stats.total).toBe(0);
    });

    // ========================================================================
    // Stats after enqueue
    // ========================================================================

    it('stats after enqueue → queued increments by 1', async () => {
        const before = JSON.parse((await request(`${server!.url}/api/queue/stats`)).body).stats.queued;
        await enqueueTask('stat-task');
        const after = JSON.parse((await request(`${server!.url}/api/queue/stats`)).body).stats.queued;
        expect(after).toBe(before + 1);
    });

    it('stats after cancelling a task → queued - 1, cancelled + 1', async () => {
        const id = await enqueueTask('cancel-stat');
        const before = JSON.parse((await request(`${server!.url}/api/queue/stats`)).body).stats;

        await request(`${server!.url}/api/queue/${id}`, { method: 'DELETE' });

        const after = JSON.parse((await request(`${server!.url}/api/queue/stats`)).body).stats;
        expect(after.queued).toBe(before.queued - 1);
        expect(after.cancelled).toBe(before.cancelled + 1);
    });

    // ========================================================================
    // isPaused in stats
    // ========================================================================

    it('stats include isPaused: true when globally paused', async () => {
        // Already paused from beforeEach; enqueue a task to create a manager
        await enqueueTask('paused-stat');
        const res = await request(`${server!.url}/api/queue/stats`);
        expect(JSON.parse(res.body).stats.isPaused).toBe(true);
    });

    it('stats include isPaused: false after global resume', async () => {
        await enqueueTask('resume-stat');
        await post(`${server!.url}/api/queue/resume`, {});
        const res = await request(`${server!.url}/api/queue/stats`);
        expect(JSON.parse(res.body).stats.isPaused).toBe(false);
    });

    it('stats isPaused: true with no queues when globally paused', async () => {
        // Queue is empty but global pause is active
        const res = await request(`${server!.url}/api/queue/stats`);
        expect(JSON.parse(res.body).stats.isPaused).toBe(true);
    });

    // ========================================================================
    // Stats scoped to workspace
    // ========================================================================

    it('stats scoped to workspace via ?repoId= param', async () => {
        await post(`${server!.url}/api/workspaces`, { id: 'ws-stats', name: 'stats', rootPath: '/repos/stats' });

        // Enqueue a task for that workspace
        await post(`${server!.url}/api/queue`, {
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', workingDirectory: '/repos/stats' },
            config: {},
            displayName: 'workspace-task',
        });

        const res = await request(`${server!.url}/api/queue/stats?repoId=ws-stats`);
        expect(res.status).toBe(200);
        const { stats } = JSON.parse(res.body);
        expect(stats.queued).toBe(1);
    });

    it('stats for nonexistent workspace → 404', async () => {
        const res = await request(`${server!.url}/api/queue/stats?repoId=does-not-exist`);
        expect(res.status).toBe(404);
    });

    // ========================================================================
    // Stats across multiple repos
    // ========================================================================

    it('aggregate stats include tasks from all repos', async () => {
        await post(`${server!.url}/api/workspaces`, { id: 'ws-multi-a', name: 'a', rootPath: '/repos/multi-a' });
        await post(`${server!.url}/api/workspaces`, { id: 'ws-multi-b', name: 'b', rootPath: '/repos/multi-b' });

        await post(`${server!.url}/api/queue`, {
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', workingDirectory: '/repos/multi-a' },
            config: {},
        });
        await post(`${server!.url}/api/queue`, {
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', workingDirectory: '/repos/multi-b' },
            config: {},
        });

        const res = await request(`${server!.url}/api/queue/stats`);
        const { stats } = JSON.parse(res.body);
        expect(stats.queued).toBeGreaterThanOrEqual(2);
    });
});
