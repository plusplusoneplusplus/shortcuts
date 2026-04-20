/**
 * Workspace Schedule Isolation Tests — Section 3
 *
 * Verifies that schedules in workspace A are completely isolated from
 * workspace B: listing, creation, and deletion are all workspace-scoped.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// HTTP Helpers
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
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function deleteRequest(url: string) {
    return request(url, { method: 'DELETE' });
}

function makeSchedule(overrides: Record<string, any> = {}) {
    return {
        name: 'Test Schedule',
        target: 'pipelines/test/pipeline.yaml',
        cron: '0 9 * * *',
        params: {},
        onFailure: 'notify',
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Workspace Schedule Isolation', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    const wsIdA = 'ws-sched-a';
    const wsIdB = 'ws-sched-b';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sched-iso-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir , skipNonEssentialInit: true });
        return server;
    }

    function schedulesUrl(wsId: string) {
        return `${server!.url}/api/workspaces/${wsId}/schedules`;
    }

    function scheduleUrl(wsId: string, schedId: string) {
        return `${server!.url}/api/workspaces/${wsId}/schedules/${schedId}`;
    }

    // ========================================================================
    // Section 3 tests
    // ========================================================================

    it('GET schedules for A returns A\'s schedules only', async () => {
        await startServer();

        await postJSON(schedulesUrl(wsIdA), makeSchedule({ name: 'A Schedule 1' }));
        await postJSON(schedulesUrl(wsIdA), makeSchedule({ name: 'A Schedule 2' }));

        const resA = await request(schedulesUrl(wsIdA));
        expect(resA.status).toBe(200);
        const bodyA = JSON.parse(resA.body);
        expect(bodyA.schedules).toHaveLength(2);
        expect(bodyA.schedules.every((s: any) => s.name.startsWith('A Schedule'))).toBe(true);
    });

    it('GET schedules for B returns B\'s schedules only (not A\'s)', async () => {
        await startServer();

        await postJSON(schedulesUrl(wsIdA), makeSchedule({ name: 'Only in A' }));

        const resB = await request(schedulesUrl(wsIdB));
        expect(resB.status).toBe(200);
        const bodyB = JSON.parse(resB.body);
        expect(bodyB.schedules).toEqual([]);
    });

    it('Schedule created for A → not listed in B\'s schedule endpoint', async () => {
        await startServer();

        const createRes = await postJSON(schedulesUrl(wsIdA), makeSchedule({ name: 'A Only Schedule' }));
        expect(createRes.status).toBe(201);

        const resB = await request(schedulesUrl(wsIdB));
        const bodyB = JSON.parse(resB.body);
        expect(bodyB.schedules.some((s: any) => s.name === 'A Only Schedule')).toBe(false);
    });

    it('Both workspaces can have schedules with the same name independently', async () => {
        await startServer();

        await postJSON(schedulesUrl(wsIdA), makeSchedule({ name: 'Shared Name' }));
        await postJSON(schedulesUrl(wsIdB), makeSchedule({ name: 'Shared Name' }));

        const resA = await request(schedulesUrl(wsIdA));
        const resB = await request(schedulesUrl(wsIdB));
        const bodyA = JSON.parse(resA.body);
        const bodyB = JSON.parse(resB.body);

        expect(bodyA.schedules).toHaveLength(1);
        expect(bodyB.schedules).toHaveLength(1);
        // IDs should be different (independent schedules)
        expect(bodyA.schedules[0].id).not.toBe(bodyB.schedules[0].id);
    });

    it('DELETE schedule in A → B\'s schedules unaffected', async () => {
        await startServer();

        const resA = await postJSON(schedulesUrl(wsIdA), makeSchedule({ name: 'A Schedule' }));
        await postJSON(schedulesUrl(wsIdB), makeSchedule({ name: 'B Schedule' }));
        const schedAId = JSON.parse(resA.body).schedule.id;

        const delRes = await deleteRequest(scheduleUrl(wsIdA, schedAId));
        expect(delRes.status).toBe(200);

        // B's schedules should be intact
        const resB = await request(schedulesUrl(wsIdB));
        const bodyB = JSON.parse(resB.body);
        expect(bodyB.schedules).toHaveLength(1);
        expect(bodyB.schedules[0].name).toBe('B Schedule');
    });

    it('A\'s schedule list unaffected by B\'s schedule operations', async () => {
        await startServer();

        await postJSON(schedulesUrl(wsIdA), makeSchedule({ name: 'Permanent A' }));
        const resBCreate = await postJSON(schedulesUrl(wsIdB), makeSchedule({ name: 'Temp B' }));
        const schedBId = JSON.parse(resBCreate.body).schedule.id;

        // Delete B's schedule
        await deleteRequest(scheduleUrl(wsIdB, schedBId));

        // A's schedules should remain
        const resA = await request(schedulesUrl(wsIdA));
        const bodyA = JSON.parse(resA.body);
        expect(bodyA.schedules).toHaveLength(1);
        expect(bodyA.schedules[0].name).toBe('Permanent A');
    });
});
