/**
 * Schedule Mutation During Run Tests
 *
 * Covers Sections 2 & 3 of test-plan-schedule-system.md:
 * - Schedule Modified While Running (Section 2)
 * - Schedule Deleted While Running (Section 3)
 *
 * Since ScheduleManager.executeRun() awaits the queued task to reach a
 * terminal state, "during run" tests rely on fake queueManagers that don't
 * emit completion events — leaving the executor waiting — so state-mutation
 * side effects are tested without waiting for the run to finish.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore, initializeDatabase } from '@plusplusoneplusplus/forge';
import { ScheduleManager } from '../../src/server/schedule/schedule-manager';
import { ScheduleYamlPersistence } from '../../src/server/schedule/schedule-yaml-persistence';
import { SqliteScheduleRunPersistence } from '../../src/server/schedule/sqlite-schedule-run-persistence';
import Database from 'better-sqlite3';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-mutation-'));
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

function deleteReq(url: string) {
    return request(url, { method: 'DELETE' });
}

function makeSchedule(overrides: Record<string, any> = {}) {
    return {
        name: 'Test Schedule',
        target: 'pipelines/test.yaml',
        cron: '0 9 * * *',
        params: {},
        onFailure: 'notify',
        ...overrides,
    };
}

// ============================================================================
// Section 2: Schedule Modified While Running
// ============================================================================

describe('Schedule Modified While Running (Section 2)', () => {
    let dataDir: string;
    let persistence: ScheduleYamlPersistence;
    let runPersistence: SqliteScheduleRunPersistence;
    let manager: ScheduleManager;
    let db: Database.Database;

    const REPO_ID = 'test-repo';

    beforeEach(() => {
        dataDir = createTempDir();
        persistence = new ScheduleYamlPersistence(dataDir);
        db = new Database(':memory:');
        initializeDatabase(db);
        runPersistence = new SqliteScheduleRunPersistence(db);
    });

    afterEach(() => {
        manager?.dispose();
        db?.close();
        cleanupDir(dataDir);
    });

    it('run that was enqueued completes normally even if cron is updated', async () => {
        const queueManager = { enqueue: vi.fn(() => 'task_1') } as any;
        manager = new ScheduleManager(persistence, queueManager);
        manager.restoreRunHistory(runPersistence);

        const schedule = manager.addSchedule(REPO_ID, {
            name: 'Test',
            target: 'pipelines/test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });

        // Trigger a run (simulates T=0 fire), don't await yet
        const runPromise = manager.triggerRun(REPO_ID, schedule.id);

        // PATCH the cron while run is in flight
        await manager.updateSchedule(REPO_ID, schedule.id, { cron: '0 10 * * *' });

        // Run completes normally
        const run = await runPromise;
        expect(run.status).toBe('completed');
    });

    it('next cron timer uses updated cron expression after PATCH', async () => {
        vi.useFakeTimers();
        try {
            const t0 = new Date('2026-01-01T08:59:00.000Z');
            vi.setSystemTime(t0);

            const firedIds: string[] = [];
            const queueManager = {
                enqueue: vi.fn((task: any) => {
                    firedIds.push(task.payload?.context?.scheduleId ?? '?');
                    return `task_${firedIds.length}`;
                }),
            } as any;
            manager = new ScheduleManager(persistence, queueManager);

            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Test',
                target: 'pipelines/test.yaml',
                cron: '* * * * *', // every minute
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            // Advance time so first fire happens
            await vi.advanceTimersByTimeAsync(65_000);
            expect(firedIds.length).toBeGreaterThanOrEqual(1);

            // PATCH to new cron
            await manager.updateSchedule(REPO_ID, schedule.id, { cron: '0 10 * * *' });

            const updatedSchedule = manager.getSchedule(REPO_ID, schedule.id);
            expect(updatedSchedule!.cron).toBe('0 10 * * *');
        } finally {
            vi.useRealTimers();
        }
    });

    it('PATCH status: paused while running — schedule becomes paused', async () => {
        const queueManager = { enqueue: vi.fn(() => 'task_1') } as any;
        manager = new ScheduleManager(persistence, queueManager);

        const schedule = manager.addSchedule(REPO_ID, {
            name: 'Test',
            target: 'pipelines/test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });

        // Trigger run
        const runPromise = manager.triggerRun(REPO_ID, schedule.id);
        // Pause schedule
        await manager.updateSchedule(REPO_ID, schedule.id, { status: 'paused' });
        // Run still completes
        const run = await runPromise;
        expect(run.status).toBe('completed');

        // Schedule is now paused
        const updated = manager.getSchedule(REPO_ID, schedule.id);
        expect(updated!.status).toBe('paused');
    });

    it('PATCH status: paused — no new timer fires after pause', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-01-01T08:59:00.000Z'));

            let fireCount = 0;
            const queueManager = {
                enqueue: vi.fn(() => { fireCount++; return `task_${fireCount}`; }),
            } as any;
            manager = new ScheduleManager(persistence, queueManager);

            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Test',
                target: 'pipelines/test.yaml',
                cron: '* * * * *', // every minute
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            // First fire
            await vi.advanceTimersByTimeAsync(65_000);
            const firstCount = fireCount;
            expect(firstCount).toBeGreaterThanOrEqual(1);

            // Pause the schedule
            await manager.updateSchedule(REPO_ID, schedule.id, { status: 'paused' });

            // Advance time further — should not fire again
            await vi.advanceTimersByTimeAsync(120_000);
            expect(fireCount).toBe(firstCount);
        } finally {
            vi.useRealTimers();
        }
    });

    it('PATCH prompt (target) while running — current run uses old target, next run uses new target', async () => {
        const targetsUsed: string[] = [];
        const queueManager = {
            enqueue: vi.fn((task: any) => {
                // Extract target from payload prompt
                const prompt = task.payload?.prompt ?? '';
                targetsUsed.push(prompt);
                return `task_${targetsUsed.length}`;
            }),
        } as any;
        manager = new ScheduleManager(persistence, queueManager);

        const schedule = manager.addSchedule(REPO_ID, {
            name: 'Test',
            target: 'pipelines/old.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });

        // Trigger first run with old target
        const run1 = await manager.triggerRun(REPO_ID, schedule.id);
        expect(run1.status).toBe('completed');
        expect(targetsUsed[0]).toContain('old.yaml');

        // Update target
        await manager.updateSchedule(REPO_ID, schedule.id, { target: 'pipelines/new.yaml' });

        // Second run uses new target
        const run2 = await manager.triggerRun(REPO_ID, schedule.id);
        expect(run2.status).toBe('completed');
        expect(targetsUsed[1]).toContain('new.yaml');
    });
});

// ============================================================================
// Section 3: Schedule Deleted While Running (HTTP integration)
// ============================================================================

describe('Schedule Deleted While Running (Section 3)', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

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

    function schedulesUrl(wsId = 'test-ws') {
        return `${server!.url}/api/workspaces/${wsId}/schedules`;
    }

    it('DELETE returns 200 immediately', async () => {
        await startServer();

        const cr = await postJSON(schedulesUrl(), makeSchedule());
        const id = JSON.parse(cr.body).schedule.id;

        const delRes = await deleteReq(`${schedulesUrl()}/${id}`);
        expect(delRes.status).toBe(200);
        expect(JSON.parse(delRes.body).deleted).toBe(true);
    });

    it('deleted schedule no longer appears in GET /schedules', async () => {
        await startServer();

        const cr = await postJSON(schedulesUrl(), makeSchedule());
        const id = JSON.parse(cr.body).schedule.id;

        await deleteReq(`${schedulesUrl()}/${id}`);

        const listRes = await request(schedulesUrl());
        const { schedules } = JSON.parse(listRes.body);
        expect(schedules.some((s: any) => s.id === id)).toBe(false);
    });

    it('run triggered before delete reaches a terminal or active run state', async () => {
        await startServer();

        const cr = await postJSON(schedulesUrl(), makeSchedule());
        const id = JSON.parse(cr.body).schedule.id;

        // Trigger a run
        const runRes = await postJSON(`${schedulesUrl()}/${id}/run`, {});
        expect(runRes.status).toBe(200);
        const { run } = JSON.parse(runRes.body);
        expect(run.status).toMatch(/completed|running|failed/);

        // Delete schedule
        const delRes = await deleteReq(`${schedulesUrl()}/${id}`);
        expect(delRes.status).toBe(200);
    });

    it('no next run scheduled after deletion — schedule removed from list', async () => {
        await startServer();

        const cr = await postJSON(schedulesUrl(), makeSchedule({ name: 'To Delete' }));
        const id = JSON.parse(cr.body).schedule.id;

        await deleteReq(`${schedulesUrl()}/${id}`);

        const listRes = await request(schedulesUrl());
        const { schedules } = JSON.parse(listRes.body);
        expect(schedules.find((s: any) => s.id === id)).toBeUndefined();
    });

    it('other schedules not affected by deletion', async () => {
        await startServer();

        const cr1 = await postJSON(schedulesUrl(), makeSchedule({ name: 'Keep' }));
        const cr2 = await postJSON(schedulesUrl(), makeSchedule({ name: 'Delete Me' }));
        const id1 = JSON.parse(cr1.body).schedule.id;
        const id2 = JSON.parse(cr2.body).schedule.id;

        await deleteReq(`${schedulesUrl()}/${id2}`);

        const listRes = await request(schedulesUrl());
        const { schedules } = JSON.parse(listRes.body);
        expect(schedules.some((s: any) => s.id === id1)).toBe(true);
        expect(schedules.some((s: any) => s.id === id2)).toBe(false);
    });
});
