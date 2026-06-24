/**
 * Queue Persistence Across Server Restart Tests
 *
 * Covers Section 10 of test-plan-queue-advanced.md.
 * Uses the pattern from per-repo-pause-integration.test.ts:
 *   start server → enqueue tasks into global queue → close → restart → verify state.
 *
 * KEY: Tasks are enqueued without a workingDirectory so they go into the
 * GLOBAL workspace queue. GET /api/queue (without repoId) returns tasks from
 * the global workspace queue. This keeps the tests simple and cross-platform.
 *
 * Actual behaviors documented here:
 *
 * ✓ Pending tasks are preserved across restart (order maintained)
 *
 * ✗ Frozen state is NOT preserved (restoreRepoQueueState re-enqueues via
 *   queueManager.enqueue() which creates a fresh task without frozen=true)
 *
 * ✗ Pause markers are NOT preserved (getQueued() filters them out so they are
 *   never written to disk)
 *
 * ✓ Per-repo manager pause state set via HTTP API is preserved.
 *
 * ✗ History (tasks cancelled before execution) is NOT preserved across
 *   restart. History is served from the process store, which only tracks
 *   tasks that were actually executed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { GLOBAL_WORKSPACE_ID } from '../../src/server/workspaces/global-workspace';
import { safeRmSync } from '../helpers/safe-rm';

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

/** Task without workingDirectory — goes into the global workspace queue */
function makeGlobalTask(displayName: string) {
    return {
        type: 'chat',
        priority: 'normal',
        payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
        config: {},
        displayName,
        repoId: GLOBAL_WORKSPACE_ID,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Queue Persistence Across Server Restart', () => {
    let dataDir: string;
    let dbPath: string;
    const activeServers: ExecutionServer[] = [];
    const activeStores: SqliteProcessStore[] = [];

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-persist-restart-'));
        dbPath = path.join(dataDir, 'processes.db');
    });

    afterEach(async () => {
        for (const srv of activeServers) {
            try { await srv.close(); } catch { /* already closed */ }
        }
        activeServers.length = 0;
        for (const s of activeStores) {
            try { s.close(); } catch { /* already closed */ }
        }
        activeStores.length = 0;
        safeRmSync(dataDir);
    });

    // ========================================================================
    // Section 10.1: Tasks preserved across restart
    // ========================================================================

    it('enqueue 3 tasks → restart → all 3 tasks present in queue after restart', async () => {
        const store1 = new SqliteProcessStore({ dbPath });
        activeStores.push(store1);
        const server1 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir, store: store1 });
        activeServers.push(server1);
        await post(`${server1.url}/api/queue/pause`, {});
        await post(`${server1.url}/api/queue`, makeGlobalTask('Task-1'));
        await post(`${server1.url}/api/queue`, makeGlobalTask('Task-2'));
        await post(`${server1.url}/api/queue`, makeGlobalTask('Task-3'));

        await server1.close();
        store1.close();

        const store2 = new SqliteProcessStore({ dbPath });
        activeStores.push(store2);
        const server2 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir, store: store2, queue: { autoStart: false } });
        activeServers.push(server2);
        const listRes = await request(`${server2.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        expect(queued).toHaveLength(3);

        await server2.close();
        store2.close();
    });

    it('task at position 2 after restart → maintains its position', async () => {
        const store1 = new SqliteProcessStore({ dbPath });
        activeStores.push(store1);
        const server1 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir, store: store1 });
        activeServers.push(server1);
        await post(`${server1.url}/api/queue/pause`, {});
        await post(`${server1.url}/api/queue`, makeGlobalTask('First'));
        await post(`${server1.url}/api/queue`, makeGlobalTask('Second'));
        await post(`${server1.url}/api/queue`, makeGlobalTask('Third'));

        await server1.close();
        store1.close();

        const store2 = new SqliteProcessStore({ dbPath });
        activeStores.push(store2);
        const server2 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir, store: store2, queue: { autoStart: false } });
        activeServers.push(server2);
        const listRes = await request(`${server2.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;

        const secondIdx = queued.findIndex((t: any) => t.displayName === 'Second');
        expect(secondIdx).toBe(1); // 0-based = position 2

        await server2.close();
        store2.close();
    });

    // ========================================================================
    // Section 10.2: Frozen state preserved
    // ========================================================================

    it('frozen task after restart → preserves frozen state', async () => {
        const store1 = new SqliteProcessStore({ dbPath });
        activeStores.push(store1);
        const server1 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir, store: store1 });
        activeServers.push(server1);
        await post(`${server1.url}/api/queue/pause`, {});
        const taskRes = await post(`${server1.url}/api/queue`, makeGlobalTask('Freeze-me'));
        const taskId = JSON.parse(taskRes.body).task.id;

        await post(`${server1.url}/api/queue/${taskId}/freeze`, {});

        // Verify frozen before restart
        const before = JSON.parse((await request(`${server1.url}/api/queue`)).body).queued;
        expect(before.find((t: any) => t.id === taskId)?.frozen).toBe(true);

        await server1.close();
        store1.close();

        const store2 = new SqliteProcessStore({ dbPath });
        activeStores.push(store2);
        const server2 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir, store: store2, queue: { autoStart: false } });
        activeServers.push(server2);
        const listRes = await request(`${server2.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        expect(queued.find((t: any) => t.id === taskId)?.frozen).toBe(true);

        await server2.close();
        store2.close();
    });

    // ========================================================================
    // Section 10.3: Pause marker preserved
    // ========================================================================

    it('pause marker after restart → present with duration', async () => {
        const store1 = new SqliteProcessStore({ dbPath });
        activeStores.push(store1);
        const server1 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir, store: store1 });
        activeServers.push(server1);
        await post(`${server1.url}/api/queue/pause`, {});
        await post(`${server1.url}/api/queue`, makeGlobalTask('T1'));
        await post(`${server1.url}/api/queue/pause-marker`, { afterIndex: 0, durationHours: 2 });

        // Verify marker before restart
        const before = JSON.parse((await request(`${server1.url}/api/queue`)).body).queued;
        expect(before.find((i: any) => i.kind === 'pause-marker')?.durationHours).toBe(2);

        await server1.close();
        store1.close();

        const store2 = new SqliteProcessStore({ dbPath });
        activeStores.push(store2);
        const server2 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir, store: store2, queue: { autoStart: false } });
        activeServers.push(server2);
        const after = JSON.parse((await request(`${server2.url}/api/queue`)).body).queued;
        expect(after.find((i: any) => i.kind === 'pause-marker')?.durationHours).toBe(2);

        await server2.close();
        store2.close();
    });

    // ========================================================================
    // Section 10.5: Per-repo pause preserved via HTTP pause API
    // ========================================================================

    it('per-repo pause via HTTP API is preserved across restart', async () => {
        // Use the built-in global workspace ID (always registered by createExecutionServer)
        const WS_ID = 'global-workspace-00';
        const store1 = new SqliteProcessStore({ dbPath });
        activeStores.push(store1);
        const server1 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir, store: store1 });
        activeServers.push(server1);
        await post(`${server1.url}/api/queue/pause`, {});
        await post(`${server1.url}/api/queue`, makeGlobalTask('T'));
        await post(`${server1.url}/api/queue/resume`, {});

        // Per-repo pause via HTTP API sets manager.paused=true.
        await request(`${server1.url}/api/queue/pause?repoId=${WS_ID}`, { method: 'POST' });

        const beforeRepos = JSON.parse((await request(`${server1.url}/api/queue/repos`)).body).repos;
        expect(beforeRepos.find((r: any) => r.repoId === WS_ID)?.isPaused).toBe(true);

        await server1.close();
        store1.close();

        const store2 = new SqliteProcessStore({ dbPath });
        activeStores.push(store2);
        const server2 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir, store: store2, queue: { autoStart: false } });
        activeServers.push(server2);
        const afterRepos = JSON.parse((await request(`${server2.url}/api/queue/repos`)).body).repos;
        const repo = afterRepos.find((r: any) => r.repoId === WS_ID);
        expect(repo).toBeDefined();
        expect(repo.isPaused).toBe(true);

        await server2.close();
        store2.close();
    });
});

