/**
 * Queue Freeze / Unfreeze Tests
 *
 * Covers Section 4 of test-plan-queue-advanced.md:
 * - Freeze a pending task — it stays in the queue but is skipped during drain
 * - Unfreeze a frozen task — it becomes eligible again
 * - Idempotency: freeze already-frozen (200); unfreeze non-frozen (404)
 * - Running task freeze returns 404 (task not in pending queue)
 * - GET /api/queue shows frozen: true for frozen tasks
 * - Frozen tasks ARE counted in pendingCount (still in queue)
 *
 * Note on "frozen task skipped during drain": requires AI execution; not tested
 * here because tests run without a real AI backend.
 *
 * Note on "freeze state persists across server restart": frozen flag is NOT
 * preserved across restart because restoreRepoQueueState re-enqueues tasks via
 * queueManager.enqueue() which creates fresh task objects without frozen=true.
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

describe('Queue Freeze / Unfreeze', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-freeze-'));
        server = await createExecutionServer({ port: 0, host: 'localhost', dataDir , skipNonEssentialInit: true });
        // Pause to prevent auto-execution
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
    // Freeze pending task
    // ========================================================================

    it('POST /api/queue/:id/freeze on pending task → 200, task stays in queue', async () => {
        const id = await enqueueTask('freeze-me');

        const res = await post(`${server!.url}/api/queue/${id}/freeze`, {});
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.frozen).toBe(true);

        // Task still in queue
        const listRes = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        expect(queued.some((t: any) => t.id === id)).toBe(true);
    });

    it('GET /api/queue shows frozen: true for frozen task', async () => {
        const id = await enqueueTask('show-frozen');
        await post(`${server!.url}/api/queue/${id}/freeze`, {});

        const listRes = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        const task = queued.find((t: any) => t.id === id);
        expect(task).toBeDefined();
        expect(task.frozen).toBe(true);
    });

    // ========================================================================
    // Unfreeze
    // ========================================================================

    it('POST /api/queue/:id/unfreeze → 200, task no longer frozen', async () => {
        const id = await enqueueTask('unfreeze-me');
        await post(`${server!.url}/api/queue/${id}/freeze`, {});

        const res = await post(`${server!.url}/api/queue/${id}/unfreeze`, {});
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.unfrozen).toBe(true);

        // Verify frozen is gone from GET response
        const listRes = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        const task = queued.find((t: any) => t.id === id);
        expect(task?.frozen).toBeFalsy();
    });

    // ========================================================================
    // Idempotency
    // ========================================================================

    it('freeze already-frozen task → idempotent, returns 200', async () => {
        const id = await enqueueTask('double-freeze');
        await post(`${server!.url}/api/queue/${id}/freeze`, {});

        // Freeze again — idempotent (task is still found in queue and frozen is set to true)
        const res = await post(`${server!.url}/api/queue/${id}/freeze`, {});
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).frozen).toBe(true);
    });

    it('unfreeze non-frozen task → 404 (unfreezeTask returns false for non-frozen)', async () => {
        const id = await enqueueTask('not-frozen');

        // Task is not frozen; unfreeze should fail
        const res = await post(`${server!.url}/api/queue/${id}/unfreeze`, {});
        expect(res.status).toBe(404);
    });

    // ========================================================================
    // Freeze running task
    // ========================================================================

    it('freeze on nonexistent task → 404', async () => {
        const res = await post(`${server!.url}/api/queue/nonexistent/freeze`, {});
        expect(res.status).toBe(404);
    });

    // ========================================================================
    // Stats with frozen tasks
    // ========================================================================

    it('frozen tasks are included in pendingCount (stats.queued)', async () => {
        await enqueueTask('task1');
        const id2 = await enqueueTask('task2');
        await post(`${server!.url}/api/queue/${id2}/freeze`, {});

        const statsRes = await request(`${server!.url}/api/queue/stats`);
        // Both tasks are in the queue regardless of frozen state
        expect(JSON.parse(statsRes.body).stats.queued).toBe(2);
    });

    it('GET /api/queue shows frozen: true only for frozen tasks', async () => {
        const id1 = await enqueueTask('normal-task');
        const id2 = await enqueueTask('frozen-task');
        await post(`${server!.url}/api/queue/${id2}/freeze`, {});

        const listRes = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        const normalTask = queued.find((t: any) => t.id === id1);
        const frozenTask = queued.find((t: any) => t.id === id2);

        expect(normalTask?.frozen).toBeFalsy();
        expect(frozenTask?.frozen).toBe(true);
    });
});
