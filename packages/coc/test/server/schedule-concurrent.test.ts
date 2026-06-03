/**
 * Schedule Concurrent Tests
 *
 * Covers Sections 4 & 5 of test-plan-schedule-system.md:
 * - Two Schedules With Same Cron Expression (Section 4)
 * - Schedule Concurrency With Queue (Section 5)
 *
 * Uses fake timers to control time and trigger scheduled fires.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { ScheduleManager } from '../../src/server/schedule/schedule-manager';
import { ScheduleYamlPersistence } from '../../src/server/schedule/schedule-yaml-persistence';
import { SqliteScheduleRunPersistence } from '../../src/server/schedule/sqlite-schedule-run-persistence';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore, initializeDatabase } from '@plusplusoneplusplus/forge';
import Database from 'better-sqlite3';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-concurrent-'));
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
// Section 4: Two Schedules With Same Cron Expression
// ============================================================================

describe('Two Schedules With Same Cron (Section 4)', () => {
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

    it('two schedules with same cron expression have independent IDs', () => {
        manager = new ScheduleManager(persistence, null);

        const s1 = manager.addSchedule(REPO_ID, {
            name: 'Schedule A',
            target: 'pipelines/a.yaml',
            cron: '* * * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });
        const s2 = manager.addSchedule(REPO_ID, {
            name: 'Schedule B',
            target: 'pipelines/b.yaml',
            cron: '* * * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });

        expect(s1.id).not.toBe(s2.id);
        expect(s1.id).toMatch(/^sch_/);
        expect(s2.id).toMatch(/^sch_/);
    });

    it('both schedules appear in getSchedules list', () => {
        manager = new ScheduleManager(persistence, null);

        manager.addSchedule(REPO_ID, {
            name: 'Schedule A',
            target: 'pipelines/a.yaml',
            cron: '* * * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });
        manager.addSchedule(REPO_ID, {
            name: 'Schedule B',
            target: 'pipelines/b.yaml',
            cron: '* * * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });

        const schedules = manager.getSchedules(REPO_ID);
        expect(schedules).toHaveLength(2);
        expect(schedules.map(s => s.name).sort()).toEqual(['Schedule A', 'Schedule B']);
    });

    it('both schedules fire independently when cron time is reached', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-01-01T08:59:00.000Z'));

            const fired = new Map<string, number>(); // scheduleId → fire count
            const queueManager = {
                enqueue: vi.fn((task: any) => {
                    const schedId = task.payload?.context?.scheduleId;
                    if (schedId) fired.set(schedId, (fired.get(schedId) ?? 0) + 1);
                    return `task_${Date.now()}`;
                }),
            } as any;
            manager = new ScheduleManager(persistence, queueManager);

            const s1 = manager.addSchedule(REPO_ID, {
                name: 'Schedule A',
                target: 'pipelines/a.yaml',
                cron: '* * * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });
            const s2 = manager.addSchedule(REPO_ID, {
                name: 'Schedule B',
                target: 'pipelines/b.yaml',
                cron: '* * * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            // Advance past the next minute boundary
            await vi.advanceTimersByTimeAsync(65_000);

            // Both should have fired at least once
            expect(fired.get(s1.id) ?? 0).toBeGreaterThanOrEqual(1);
            expect(fired.get(s2.id) ?? 0).toBeGreaterThanOrEqual(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('each schedule has its own independent run history', async () => {
        manager = new ScheduleManager(persistence, { enqueue: vi.fn(() => 'task_1') } as any);
        manager.restoreRunHistory(runPersistence);

        const s1 = manager.addSchedule(REPO_ID, {
            name: 'Schedule A',
            target: 'pipelines/a.yaml',
            cron: '* * * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });
        const s2 = manager.addSchedule(REPO_ID, {
            name: 'Schedule B',
            target: 'pipelines/b.yaml',
            cron: '* * * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });

        await manager.triggerRun(REPO_ID, s1.id);
        await manager.triggerRun(REPO_ID, s1.id);
        await manager.triggerRun(REPO_ID, s2.id);

        expect(manager.getRunHistory(s1.id)).toHaveLength(2);
        expect(manager.getRunHistory(s2.id)).toHaveLength(1);
    });

    it('pausing one schedule does not affect the other', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-01-01T08:59:00.000Z'));

            const firedBySchedule = new Map<string, number>();
            const queueManager = {
                enqueue: vi.fn((task: any) => {
                    const schedId = task.payload?.context?.scheduleId;
                    if (schedId) firedBySchedule.set(schedId, (firedBySchedule.get(schedId) ?? 0) + 1);
                    return `task_${Date.now()}`;
                }),
            } as any;
            manager = new ScheduleManager(persistence, queueManager);

            const s1 = manager.addSchedule(REPO_ID, {
                name: 'Active Schedule',
                target: 'pipelines/a.yaml',
                cron: '* * * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });
            const s2 = manager.addSchedule(REPO_ID, {
                name: 'Paused Schedule',
                target: 'pipelines/b.yaml',
                cron: '* * * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            // First fire
            await vi.advanceTimersByTimeAsync(65_000);
            const s1FiresAfterFirst = firedBySchedule.get(s1.id) ?? 0;

            // Pause s2
            await manager.updateSchedule(REPO_ID, s2.id, { status: 'paused' });
            const s2FiresAtPause = firedBySchedule.get(s2.id) ?? 0;

            // Advance more time
            await vi.advanceTimersByTimeAsync(120_000);

            // s1 should fire more times; s2 should not fire again
            expect(firedBySchedule.get(s1.id) ?? 0).toBeGreaterThan(s1FiresAfterFirst);
            expect(firedBySchedule.get(s2.id) ?? 0).toBe(s2FiresAtPause);
        } finally {
            vi.useRealTimers();
        }
    });
});

// ============================================================================
// Section 5: Schedule Concurrency With Queue (HTTP integration)
// ============================================================================

describe('Schedule Concurrency With Queue (Section 5)', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    // These tests exercise the manual `/run` path against a live server whose
    // ScheduleManager arms real cron timers. A frequent cron (e.g. '* * * * *')
    // can auto-fire on a minute boundary mid-test and add an extra history
    // record, making length assertions flaky. The cron value is irrelevant to
    // what these tests assert, so use one that won't fire during the test.
    const NON_FIRING_CRON = '0 0 1 1 *';

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

    it('triggered runs for two schedules create independent run records', async () => {
        await startServer();

        const cr1 = await postJSON(schedulesUrl(), {
            name: 'Schedule A',
            target: 'pipelines/a.yaml',
            cron: NON_FIRING_CRON,
            params: {},
            onFailure: 'notify',
        });
        const cr2 = await postJSON(schedulesUrl(), {
            name: 'Schedule B',
            target: 'pipelines/b.yaml',
            cron: NON_FIRING_CRON,
            params: {},
            onFailure: 'notify',
        });
        const id1 = JSON.parse(cr1.body).schedule.id;
        const id2 = JSON.parse(cr2.body).schedule.id;

        await postJSON(`${schedulesUrl()}/${id1}/run`, {});
        await postJSON(`${schedulesUrl()}/${id2}/run`, {});

        const h1Res = await request(`${schedulesUrl()}/${id1}/history`);
        const h2Res = await request(`${schedulesUrl()}/${id2}/history`);

        const h1 = JSON.parse(h1Res.body).history;
        const h2 = JSON.parse(h2Res.body).history;

        expect(h1).toHaveLength(1);
        expect(h2).toHaveLength(1);
        expect(h1[0].scheduleId).toBe(id1);
        expect(h2[0].scheduleId).toBe(id2);
        // Runs should have independent run IDs
        expect(h1[0].id).not.toBe(h2[0].id);
    });

    it('schedule run creates process entry with schedule context', async () => {
        await startServer();

        const cr = await postJSON(schedulesUrl(), {
            name: 'Queue Test Schedule',
            target: 'pipelines/test.yaml',
            cron: NON_FIRING_CRON,
            params: {},
            onFailure: 'notify',
        });
        const id = JSON.parse(cr.body).schedule.id;

        const runRes = await postJSON(`${schedulesUrl()}/${id}/run`, {});
        expect(runRes.status).toBe(200);
        const { run } = JSON.parse(runRes.body);

        expect(run.scheduleId).toBe(id);
        expect(['running', 'completed', 'failed']).toContain(run.status);
    });
});
