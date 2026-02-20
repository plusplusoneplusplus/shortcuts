/**
 * Schedule Handler Tests
 *
 * Tests for the Schedule REST API endpoints:
 * CRUD, trigger, history.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
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
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
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

function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
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

const WORKSPACE_ID = 'test-workspace-123';

// ============================================================================
// Tests
// ============================================================================

describe('Schedule Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-handler-test-'));
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
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    function schedulesUrl(wsId: string = WORKSPACE_ID): string {
        return `${server!.url}/api/workspaces/${encodeURIComponent(wsId)}/schedules`;
    }

    // ========================================================================
    // Create
    // ========================================================================

    describe('POST /api/workspaces/:id/schedules — Create', () => {
        it('should create a schedule and return it with an ID', async () => {
            await startServer();

            const res = await postJSON(schedulesUrl(), makeSchedule());
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.schedule).toBeDefined();
            expect(body.schedule.id).toMatch(/^sch_/);
            expect(body.schedule.name).toBe('Test Schedule');
            expect(body.schedule.target).toBe('pipelines/test/pipeline.yaml');
            expect(body.schedule.cron).toBe('0 9 * * *');
            expect(body.schedule.status).toBe('active');
            expect(body.schedule.cronDescription).toBeDefined();
        });

        it('should reject missing name', async () => {
            await startServer();

            const res = await postJSON(schedulesUrl(), makeSchedule({ name: '' }));
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('name');
        });

        it('should reject missing target', async () => {
            await startServer();

            const res = await postJSON(schedulesUrl(), makeSchedule({ target: '' }));
            expect(res.status).toBe(400);
        });

        it('should reject invalid cron expression', async () => {
            await startServer();

            const res = await postJSON(schedulesUrl(), makeSchedule({ cron: 'not a cron' }));
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('cron');
        });

        it('should reject invalid onFailure value', async () => {
            await startServer();

            const res = await postJSON(schedulesUrl(), makeSchedule({ onFailure: 'invalid' }));
            expect(res.status).toBe(400);
        });

        it('should accept optional params', async () => {
            await startServer();

            const res = await postJSON(schedulesUrl(), makeSchedule({ params: { env: 'prod' } }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.schedule.params).toEqual({ env: 'prod' });
        });
    });

    // ========================================================================
    // List
    // ========================================================================

    describe('GET /api/workspaces/:id/schedules — List', () => {
        it('should return empty array when no schedules exist', async () => {
            await startServer();

            const res = await request(schedulesUrl());
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.schedules).toEqual([]);
        });

        it('should return all schedules for a workspace', async () => {
            await startServer();

            await postJSON(schedulesUrl(), makeSchedule({ name: 'Schedule A' }));
            await postJSON(schedulesUrl(), makeSchedule({ name: 'Schedule B' }));

            const res = await request(schedulesUrl());
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.schedules).toHaveLength(2);
        });

        it('should isolate schedules between workspaces', async () => {
            await startServer();

            await postJSON(schedulesUrl('ws-1'), makeSchedule({ name: 'WS1 Schedule' }));
            await postJSON(schedulesUrl('ws-2'), makeSchedule({ name: 'WS2 Schedule' }));

            const res1 = await request(schedulesUrl('ws-1'));
            const body1 = JSON.parse(res1.body);
            expect(body1.schedules).toHaveLength(1);
            expect(body1.schedules[0].name).toBe('WS1 Schedule');

            const res2 = await request(schedulesUrl('ws-2'));
            const body2 = JSON.parse(res2.body);
            expect(body2.schedules).toHaveLength(1);
            expect(body2.schedules[0].name).toBe('WS2 Schedule');
        });
    });

    // ========================================================================
    // Update
    // ========================================================================

    describe('PATCH /api/workspaces/:id/schedules/:scheduleId — Update', () => {
        it('should update schedule name', async () => {
            await startServer();

            const createRes = await postJSON(schedulesUrl(), makeSchedule());
            const id = JSON.parse(createRes.body).schedule.id;

            const res = await patchJSON(`${schedulesUrl()}/${id}`, { name: 'Updated Name' });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.schedule.name).toBe('Updated Name');
        });

        it('should pause a schedule', async () => {
            await startServer();

            const createRes = await postJSON(schedulesUrl(), makeSchedule());
            const id = JSON.parse(createRes.body).schedule.id;

            const res = await patchJSON(`${schedulesUrl()}/${id}`, { status: 'paused' });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.schedule.status).toBe('paused');
        });

        it('should resume a paused schedule', async () => {
            await startServer();

            const createRes = await postJSON(schedulesUrl(), makeSchedule());
            const id = JSON.parse(createRes.body).schedule.id;

            await patchJSON(`${schedulesUrl()}/${id}`, { status: 'paused' });
            const res = await patchJSON(`${schedulesUrl()}/${id}`, { status: 'active' });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).schedule.status).toBe('active');
        });

        it('should reject invalid cron on update', async () => {
            await startServer();

            const createRes = await postJSON(schedulesUrl(), makeSchedule());
            const id = JSON.parse(createRes.body).schedule.id;

            const res = await patchJSON(`${schedulesUrl()}/${id}`, { cron: 'bad' });
            expect(res.status).toBe(400);
        });

        it('should return 404 for non-existent schedule', async () => {
            await startServer();

            const res = await patchJSON(`${schedulesUrl()}/nonexistent`, { name: 'X' });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Delete
    // ========================================================================

    describe('DELETE /api/workspaces/:id/schedules/:scheduleId — Delete', () => {
        it('should delete a schedule', async () => {
            await startServer();

            const createRes = await postJSON(schedulesUrl(), makeSchedule());
            const id = JSON.parse(createRes.body).schedule.id;

            const res = await deleteRequest(`${schedulesUrl()}/${id}`);
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).deleted).toBe(true);

            // Verify it's gone
            const listRes = await request(schedulesUrl());
            expect(JSON.parse(listRes.body).schedules).toHaveLength(0);
        });

        it('should return 404 for non-existent schedule', async () => {
            await startServer();

            const res = await deleteRequest(`${schedulesUrl()}/nonexistent`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Trigger
    // ========================================================================

    describe('POST /api/workspaces/:id/schedules/:scheduleId/run — Trigger', () => {
        it('should trigger a schedule run', async () => {
            await startServer();

            const createRes = await postJSON(schedulesUrl(), makeSchedule());
            const id = JSON.parse(createRes.body).schedule.id;

            const res = await postJSON(`${schedulesUrl()}/${id}/run`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.run).toBeDefined();
            expect(body.run.scheduleId).toBe(id);
            expect(body.run.status).toMatch(/completed|running/);
        });

        it('should return 404 for non-existent schedule', async () => {
            await startServer();

            const res = await postJSON(`${schedulesUrl()}/nonexistent/run`, {});
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // History
    // ========================================================================

    describe('GET /api/workspaces/:id/schedules/:scheduleId/history — History', () => {
        it('should return empty history when no runs exist', async () => {
            await startServer();

            const createRes = await postJSON(schedulesUrl(), makeSchedule());
            const id = JSON.parse(createRes.body).schedule.id;

            const res = await request(`${schedulesUrl()}/${id}/history`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history).toEqual([]);
        });

        it('should return run history after trigger', async () => {
            await startServer();

            const createRes = await postJSON(schedulesUrl(), makeSchedule());
            const id = JSON.parse(createRes.body).schedule.id;

            // Trigger a run
            await postJSON(`${schedulesUrl()}/${id}/run`, {});

            const res = await request(`${schedulesUrl()}/${id}/history`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history.length).toBeGreaterThan(0);
            expect(body.history[0].scheduleId).toBe(id);
        });
    });

    // ========================================================================
    // Persistence
    // ========================================================================

    describe('Persistence across server restarts', () => {
        it('should persist schedules and restore them', async () => {
            const store = new FileProcessStore({ dataDir });
            server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });

            // Create a schedule
            await postJSON(schedulesUrl(), makeSchedule({ name: 'Persistent Schedule' }));

            // Verify it exists
            let listRes = await request(schedulesUrl());
            expect(JSON.parse(listRes.body).schedules).toHaveLength(1);

            // Stop and restart
            await server.close();

            const store2 = new FileProcessStore({ dataDir });
            server = await createExecutionServer({ port: 0, host: 'localhost', store: store2, dataDir });

            // Verify restored
            listRes = await request(schedulesUrl());
            const body = JSON.parse(listRes.body);
            expect(body.schedules).toHaveLength(1);
            expect(body.schedules[0].name).toBe('Persistent Schedule');
        });
    });

    // ========================================================================
    // Request Logs
    // ========================================================================

    describe('Request logs', () => {
        let stderrSpy: ReturnType<typeof import('vitest').vi.spyOn>;

        beforeEach(async () => {
            const { vi } = await import('vitest');
            stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        });

        afterEach(() => {
            stderrSpy.mockRestore();
        });

        function stderrLines(): string[] {
            return stderrSpy.mock.calls
                .map(([msg]) => (typeof msg === 'string' ? msg : ''))
                .filter(Boolean);
        }

        it('should log [Schedule] manual-run on POST .../run', async () => {
            const srv = await startServer();
            // Create a schedule first
            const createRes = await postJSON(schedulesUrl(), makeSchedule());
            const scheduleId = JSON.parse(createRes.body).schedule.id;
            stderrSpy.mockClear();

            await request(`${srv.url}/api/workspaces/${WORKSPACE_ID}/schedules/${scheduleId}/run`, { method: 'POST' });
            const lines = stderrLines();
            expect(lines.some(l => l.includes(`[Schedule] manual-run scheduleId=${scheduleId} repoId=${WORKSPACE_ID}`))).toBe(true);
        });
    });
});
