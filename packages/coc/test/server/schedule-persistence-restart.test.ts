/**
 * Schedule Persistence Restart Tests
 *
 * Covers Section 6 of test-plan-schedule-system.md:
 * Persistence Across Server Restart — schedule restoration, nextRun
 * recalculation, run history preservation, and disabled-schedule behaviour.
 *
 * Uses the HTTP server stop()+start() pattern with a shared dataDir.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-restart-'));
}

function cleanupDir(dir: string): void {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

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
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString() }));
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, { method: 'POST', body: JSON.stringify(data) });
}

function patchJSON(url: string, data: unknown) {
    return request(url, { method: 'PATCH', body: JSON.stringify(data) });
}

// ============================================================================
// Tests
// ============================================================================

describe('Schedule Persistence Across Restart (Section 6)', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    const WORKSPACE_ID = 'test-ws-restart';

    beforeEach(() => {
        dataDir = createTempDir();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        cleanupDir(dataDir);
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir , skipNonEssentialInit: true });
        return server;
    }

    function schedulesUrl() {
        return `${server!.url}/api/workspaces/${WORKSPACE_ID}/schedules`;
    }

    // ========================================================================

    it('schedule created before restart is listed after restart', async () => {
        await startServer();

        await postJSON(schedulesUrl(), {
            name: 'Persistent Schedule',
            target: 'pipelines/test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
        });

        // Verify exists
        let listRes = await request(schedulesUrl());
        expect(JSON.parse(listRes.body).schedules).toHaveLength(1);

        // Restart
        await server!.close();
        await startServer();

        // Verify restored
        listRes = await request(schedulesUrl());
        const { schedules } = JSON.parse(listRes.body);
        expect(schedules).toHaveLength(1);
        expect(schedules[0].name).toBe('Persistent Schedule');
    });

    it('schedule ID is preserved across restart', async () => {
        await startServer();

        const cr = await postJSON(schedulesUrl(), {
            name: 'ID Test Schedule',
            target: 'pipelines/test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
        });
        const originalId = JSON.parse(cr.body).schedule.id;

        await server!.close();
        await startServer();

        const listRes = await request(schedulesUrl());
        const { schedules } = JSON.parse(listRes.body);
        expect(schedules[0].id).toBe(originalId);
    });

    it('nextRun is defined and in the future after restart', async () => {
        await startServer();

        await postJSON(schedulesUrl(), {
            name: 'NextRun Test',
            target: 'pipelines/test.yaml',
            cron: '* * * * *', // every minute
            params: {},
            onFailure: 'notify',
        });

        await server!.close();
        await startServer();

        const listRes = await request(schedulesUrl());
        const { schedules } = JSON.parse(listRes.body);
        const schedule = schedules[0];

        expect(schedule.status).toBe('active');
        expect(schedule.nextRun).not.toBeNull();

        // nextRun should be in the future (UTC ISO)
        const nextRunDate = new Date(schedule.nextRun);
        expect(nextRunDate.getTime()).toBeGreaterThan(Date.now());
    });

    it('multiple schedules all restored after restart', async () => {
        await startServer();

        await postJSON(schedulesUrl(), { name: 'Schedule 1', target: 'a.yaml', cron: '0 9 * * *', params: {}, onFailure: 'notify' });
        await postJSON(schedulesUrl(), { name: 'Schedule 2', target: 'b.yaml', cron: '0 10 * * *', params: {}, onFailure: 'notify' });
        await postJSON(schedulesUrl(), { name: 'Schedule 3', target: 'c.yaml', cron: '0 11 * * *', params: {}, onFailure: 'notify' });

        await server!.close();
        await startServer();

        const listRes = await request(schedulesUrl());
        const { schedules } = JSON.parse(listRes.body);
        expect(schedules).toHaveLength(3);
        const names = schedules.map((s: any) => s.name).sort();
        expect(names).toEqual(['Schedule 1', 'Schedule 2', 'Schedule 3']);
    });

    it('disabled (paused) schedule remains paused after restart and does not fire', async () => {
        await startServer();

        const cr = await postJSON(schedulesUrl(), {
            name: 'Paused Schedule',
            target: 'pipelines/test.yaml',
            cron: '* * * * *',
            params: {},
            onFailure: 'notify',
        });
        const id = JSON.parse(cr.body).schedule.id;

        // Pause it
        await patchJSON(`${schedulesUrl()}/${id}`, { status: 'paused' });

        await server!.close();
        await startServer();

        const listRes = await request(schedulesUrl());
        const { schedules } = JSON.parse(listRes.body);
        const restored = schedules.find((s: any) => s.id === id);
        expect(restored).toBeDefined();
        expect(restored.status).toBe('paused');
        // Paused schedule should have no nextRun
        expect(restored.nextRun).toBeNull();
    });

    it('run history is preserved across restart', async () => {
        await startServer();

        const cr = await postJSON(schedulesUrl(), {
            name: 'History Test',
            target: 'pipelines/test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
        });
        const id = JSON.parse(cr.body).schedule.id;

        // Trigger some runs
        await postJSON(`${schedulesUrl()}/${id}/run`, {});
        await postJSON(`${schedulesUrl()}/${id}/run`, {});

        const histBefore = JSON.parse(
            (await request(`${schedulesUrl()}/${id}/history`)).body
        ).history;
        expect(histBefore).toHaveLength(2);

        // Restart
        await server!.close();
        await startServer();

        const histAfter = JSON.parse(
            (await request(`${schedulesUrl()}/${id}/history`)).body
        ).history;
        expect(histAfter).toHaveLength(2);
        // Most recent run should match
        expect(histAfter[0].scheduleId).toBe(id);
        expect(histAfter[0].id).toBe(histBefore[0].id);
    });

    it('schedule cron expression preserved across restart', async () => {
        await startServer();

        await postJSON(schedulesUrl(), {
            name: 'Cron Test',
            target: 'pipelines/test.yaml',
            cron: '30 8 * * 1-5',
            params: {},
            onFailure: 'notify',
        });

        await server!.close();
        await startServer();

        const listRes = await request(schedulesUrl());
        const { schedules } = JSON.parse(listRes.body);
        expect(schedules[0].cron).toBe('30 8 * * 1-5');
    });

    it('schedule params preserved across restart', async () => {
        await startServer();

        await postJSON(schedulesUrl(), {
            name: 'Params Test',
            target: 'pipelines/test.yaml',
            cron: '0 9 * * *',
            params: { env: 'production', branch: 'main' },
            onFailure: 'notify',
        });

        await server!.close();
        await startServer();

        const listRes = await request(schedulesUrl());
        const { schedules } = JSON.parse(listRes.body);
        expect(schedules[0].params).toEqual({ env: 'production', branch: 'main' });
    });
});
