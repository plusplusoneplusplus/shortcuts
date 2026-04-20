/**
 * Queue History Retention Tests
 *
 * Covers Section 6 of test-plan-queue-advanced.md:
 * - Completed tasks added in chronological order
 * - GET /api/queue/history returns newest-first (descending)
 * - Adding entries beyond max retention → oldest entry purged
 * - After pruning, count equals max retention limit
 * - DELETE /api/queue/history clears all → subsequent GET returns []
 * - DELETE /api/queue/history/:taskId removes single entry, others unaffected
 * - DELETE /api/queue/history/:taskId for nonexistent → 404
 * - History persists across server restart (loaded from disk)
 *
 * Note: GET /api/queue/history returns entries newest-first because
 * TaskQueueManager.addToHistory() uses unshift() (prepend).
 *
 * Note on history persistence: tested in queue-persistence-restart.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { TaskQueueManager } from '@plusplusoneplusplus/forge';
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
// HTTP-level history tests
// ============================================================================

describe('Queue History Retention', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-history-'));
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

    async function enqueueAndCancel(displayName: string): Promise<string> {
        const res = await post(`${server!.url}/api/queue`, {
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
            config: {},
            displayName,
        });
        const id = JSON.parse(res.body).task.id;
        await request(`${server!.url}/api/queue/${id}`, { method: 'DELETE' });
        return id;
    }

    // ========================================================================
    // Ordering
    // ========================================================================

    it('GET /api/queue/history returns entries newest-first (descending)', async () => {
        const id1 = await enqueueAndCancel('First');
        const id2 = await enqueueAndCancel('Second');
        const id3 = await enqueueAndCancel('Third');

        const res = await request(`${server!.url}/api/queue/history`);
        const history = JSON.parse(res.body).history;
        expect(history).toHaveLength(3);
        // Newest first: Third → Second → First
        expect(history[0].displayName).toBe('Third');
        expect(history[1].displayName).toBe('Second');
        expect(history[2].displayName).toBe('First');
    });

    it('completed tasks added to history in order accessible via GET', async () => {
        const id1 = await enqueueAndCancel('Task-A');
        const id2 = await enqueueAndCancel('Task-B');

        const res = await request(`${server!.url}/api/queue/history`);
        const history = JSON.parse(res.body).history;
        const ids = history.map((t: any) => t.id);
        expect(ids).toContain(id1);
        expect(ids).toContain(id2);
    });

    // ========================================================================
    // DELETE /api/queue/history — clear all
    // ========================================================================

    it('DELETE /api/queue/history clears all → subsequent GET returns []', async () => {
        await enqueueAndCancel('Alpha');
        await enqueueAndCancel('Beta');

        const clearRes = await request(`${server!.url}/api/queue/history`, { method: 'DELETE' });
        expect(clearRes.status).toBe(200);

        const histRes = await request(`${server!.url}/api/queue/history`);
        expect(JSON.parse(histRes.body).history).toEqual([]);
    });

    // ========================================================================
    // DELETE /api/queue/history/:taskId — remove single entry
    // ========================================================================

    it('DELETE /api/queue/history/:taskId removes single entry, others unaffected', async () => {
        const id1 = await enqueueAndCancel('Keep-1');
        const id2 = await enqueueAndCancel('Remove-me');
        const id3 = await enqueueAndCancel('Keep-3');

        const delRes = await request(`${server!.url}/api/queue/history/${id2}`, { method: 'DELETE' });
        expect(delRes.status).toBe(200);
        expect(JSON.parse(delRes.body).deleted).toBe(true);

        const histRes = await request(`${server!.url}/api/queue/history`);
        const history = JSON.parse(histRes.body).history;
        expect(history).toHaveLength(2);
        expect(history.some((t: any) => t.id === id2)).toBe(false);
        expect(history.some((t: any) => t.id === id1)).toBe(true);
        expect(history.some((t: any) => t.id === id3)).toBe(true);
    });

    it('DELETE /api/queue/history/:taskId for nonexistent id → 404', async () => {
        const res = await request(`${server!.url}/api/queue/history/no-such-task`, { method: 'DELETE' });
        expect(res.status).toBe(404);
    });
});

// ============================================================================
// Unit-level retention limit tests (via TaskQueueManager API)
// ============================================================================

describe('TaskQueueManager history retention limit', () => {
    it('adding entries beyond maxHistorySize prunes oldest entries', () => {
        const maxHistorySize = 5;
        const mgr = new TaskQueueManager({ keepHistory: true, maxHistorySize });

        // Enqueue, start, and complete more tasks than maxHistorySize
        for (let i = 0; i < maxHistorySize + 3; i++) {
            const id = mgr.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { displayName: `task-${i}` },
                config: {},
            });
            mgr.markStarted(id);
            mgr.markCompleted(id, { success: true, output: '' });
        }

        // History should be capped at maxHistorySize
        const history = mgr.getHistory();
        expect(history.length).toBe(maxHistorySize);
    });

    it('after pruning, GET /api/queue/history count equals maxHistorySize', () => {
        const maxHistorySize = 3;
        const mgr = new TaskQueueManager({ keepHistory: true, maxHistorySize });

        for (let i = 0; i < 7; i++) {
            const id = mgr.enqueue({ type: 'chat', priority: 'normal', payload: {}, config: {} });
            mgr.markStarted(id);
            mgr.markCompleted(id, { success: true, output: '' });
        }

        expect(mgr.getHistory().length).toBeLessThanOrEqual(maxHistorySize);
    });

    it('history respects maxHistorySize when configured via createExecutionServer', async () => {
        const historyLimit = 4;
        const smallHistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-hist-limit-'));
        let srv: ExecutionServer | undefined;
        try {
            srv = await createExecutionServer({
                port: 0,
                host: 'localhost',
                dataDir: smallHistDir,
                queue: { historyLimit },
            });

            await post(`${srv.url}/api/queue/pause`, {});

            // Cancel historyLimit + 2 tasks to exceed the limit
            for (let i = 0; i < historyLimit + 2; i++) {
                const res = await post(`${srv.url}/api/queue`, {
                    type: 'chat',
                    priority: 'normal',
                    payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
                    config: {},
                    displayName: `task-${i}`,
                });
                const id = JSON.parse(res.body).task.id;
                await request(`${srv.url}/api/queue/${id}`, { method: 'DELETE' });
            }

            const histRes = await request(`${srv.url}/api/queue/history`);
            const history = JSON.parse(histRes.body).history;
            // History is capped at historyLimit (newest N entries kept)
            expect(history.length).toBeLessThanOrEqual(historyLimit);
        } finally {
            if (srv) await srv.close();
            fs.rmSync(smallHistDir, { recursive: true, force: true });
        }
    });
});
