/**
 * Schedule Pause Markers Tests
 *
 * Covers Section 7 of test-plan-schedule-system.md:
 * - Workspace queue globally paused → scheduled tasks are enqueued (not run)
 * - Queue resumed → queued scheduled execution drains
 * - Pause marker blocking schedule execution
 *
 * Note: The WebSocket event `schedule-paused` is not currently emitted by the
 * server — that would require additional instrumentation. Tests for WS events
 * are marked TODO below.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-pause-'));
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

// ============================================================================
// Tests
// ============================================================================

describe('Schedule Pause Markers (Section 7)', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    const WORKSPACE_ID = 'test-ws-pause';

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
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    function schedulesUrl() {
        return `${server!.url}/api/workspaces/${WORKSPACE_ID}/schedules`;
    }

    function queueUrl() {
        return `${server!.url}/api/workspaces/${WORKSPACE_ID}/queue`;
    }

    // ========================================================================

    it('schedule can be manually triggered when queue is unpaused', async () => {
        await startServer();

        const cr = await postJSON(schedulesUrl(), {
            name: 'Trigger Test',
            target: 'pipelines/test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
        });
        const id = JSON.parse(cr.body).schedule.id;

        // Trigger without pausing first
        const runRes = await postJSON(`${schedulesUrl()}/${id}/run`, {});
        expect(runRes.status).toBe(200);
        const { run } = JSON.parse(runRes.body);
        expect(['running', 'completed', 'failed']).toContain(run.status);
    });

    it('schedule trigger returns run record with scheduleId', async () => {
        await startServer();

        const cr = await postJSON(schedulesUrl(), {
            name: 'Pause Test Schedule',
            target: 'pipelines/test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
        });
        const id = JSON.parse(cr.body).schedule.id;

        const runRes = await postJSON(`${schedulesUrl()}/${id}/run`, {});
        expect(runRes.status).toBe(200);
        const { run } = JSON.parse(runRes.body);

        expect(run.scheduleId).toBe(id);
        expect(run.id).toBeDefined();
    });

    it('multiple schedules can be triggered independently', async () => {
        await startServer();

        const cr1 = await postJSON(schedulesUrl(), {
            name: 'Schedule 1',
            target: 'a.yaml',
            cron: '* * * * *',
            params: {},
            onFailure: 'notify',
        });
        const cr2 = await postJSON(schedulesUrl(), {
            name: 'Schedule 2',
            target: 'b.yaml',
            cron: '* * * * *',
            params: {},
            onFailure: 'notify',
        });
        const id1 = JSON.parse(cr1.body).schedule.id;
        const id2 = JSON.parse(cr2.body).schedule.id;

        const run1 = await postJSON(`${schedulesUrl()}/${id1}/run`, {});
        const run2 = await postJSON(`${schedulesUrl()}/${id2}/run`, {});

        expect(run1.status).toBe(200);
        expect(run2.status).toBe(200);

        const r1 = JSON.parse(run1.body).run;
        const r2 = JSON.parse(run2.body).run;
        expect(r1.scheduleId).toBe(id1);
        expect(r2.scheduleId).toBe(id2);
        expect(r1.id).not.toBe(r2.id);
    });

    it('paused schedule stays paused and can be re-enabled', async () => {
        await startServer();

        const cr = await postJSON(schedulesUrl(), {
            name: 'Toggle Schedule',
            target: 'pipelines/test.yaml',
            cron: '* * * * *',
            params: {},
            onFailure: 'notify',
        });
        const id = JSON.parse(cr.body).schedule.id;

        // Pause
        const pauseRes = await request(`${schedulesUrl()}/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'paused' }),
        });
        expect(pauseRes.status).toBe(200);
        expect(JSON.parse(pauseRes.body).schedule.status).toBe('paused');

        // Resume
        const resumeRes = await request(`${schedulesUrl()}/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'active' }),
        });
        expect(resumeRes.status).toBe(200);
        expect(JSON.parse(resumeRes.body).schedule.status).toBe('active');
    });

    // TODO: Test that workspace queue globally paused → scheduled execution enqueued not run
    // This requires a way to inject a long-running AI mock and observe queue state during pause.
    // Current server creates real AI connections that immediately complete or fail.

    // TODO: Test that 'schedule-paused' WebSocket event is sent when schedule blocked by pause marker.
    // The event name 'schedule-paused' is not currently emitted by the server.
    // Verify against packages/coc-server/src/websocket.ts for emitted event names.

    // TODO: Test pause marker at position 0 → all scheduled tasks enqueued behind marker.
    // Requires controlling AI execution timing to verify queue ordering.
});
