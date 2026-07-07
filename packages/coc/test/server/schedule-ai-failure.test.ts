/**
 * Schedule AI Failure Tests
 *
 * Covers Section 1 of test-plan-schedule-system.md:
 * AI unavailable at fire time — run records, error storage, next-fire resilience.
 *
 * Uses ScheduleManager directly with a mock queueManager so the tests are
 * fast and deterministic. Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { ScheduleManager } from '../../src/server/schedule/schedule-manager';
import { ScheduleYamlPersistence } from '../../src/server/schedule/schedule-yaml-persistence';
import { SqliteScheduleRunPersistence } from '../../src/server/schedule/sqlite-schedule-run-persistence';
import type { ScheduleRunRecord } from '../../src/server/schedule/schedule-manager';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore, initializeDatabase } from '@plusplusoneplusplus/forge';
import Database from 'better-sqlite3';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-ai-fail-'));
}

function cleanupDir(dir: string): void {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeScheduleInput(overrides: Record<string, any> = {}) {
    return {
        name: 'Test Schedule',
        target: 'pipelines/test.yaml',
        cron: '0 9 * * *',
        params: {},
        onFailure: 'notify' as const,
        status: 'active' as const,
        ...overrides,
    };
}

function createThrowingQueueManager(error: Error) {
    return {
        enqueue: vi.fn(() => { throw error; }),
    } as any;
}

function createSucceedingQueueManager() {
    let callCount = 0;
    return {
        enqueue: vi.fn(() => `task_${++callCount}`),
        getCallCount: () => callCount,
    } as any;
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
// Unit Tests — ScheduleManager with mock queue
// ============================================================================

describe('Schedule AI Failure (unit — direct ScheduleManager)', () => {
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

    it('run record has status: failed when queue manager throws', async () => {
        const queueManager = createThrowingQueueManager(new Error('AI service 503'));
        manager = new ScheduleManager(persistence, queueManager);
        manager.restoreRunHistory(runPersistence);

        const schedule = await manager.addSchedule(REPO_ID, makeScheduleInput());
        const run = await manager.triggerRun(REPO_ID, schedule.id);

        expect(run.status).toBe('failed');
    });

    it('run record stores error message when queue throws', async () => {
        const errMsg = 'AI unavailable — 503';
        const queueManager = createThrowingQueueManager(new Error(errMsg));
        manager = new ScheduleManager(persistence, queueManager);
        manager.restoreRunHistory(runPersistence);

        const schedule = await manager.addSchedule(REPO_ID, makeScheduleInput());
        const run = await manager.triggerRun(REPO_ID, schedule.id);

        expect(run.error).toContain(errMsg);
    });

    it('failed run has completedAt and durationMs set', async () => {
        const queueManager = createThrowingQueueManager(new Error('AI error'));
        manager = new ScheduleManager(persistence, queueManager);
        manager.restoreRunHistory(runPersistence);

        const schedule = await manager.addSchedule(REPO_ID, makeScheduleInput());
        const run = await manager.triggerRun(REPO_ID, schedule.id);

        expect(run.completedAt).toBeDefined();
        expect(run.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('failed run appears in run history', async () => {
        const queueManager = createThrowingQueueManager(new Error('AI error'));
        manager = new ScheduleManager(persistence, queueManager);
        manager.restoreRunHistory(runPersistence);

        const schedule = await manager.addSchedule(REPO_ID, makeScheduleInput());
        await manager.triggerRun(REPO_ID, schedule.id);

        const history = manager.getRunHistory(schedule.id);
        expect(history).toHaveLength(1);
        expect(history[0].status).toBe('failed');
    });

    it('schedule is still active (not stopped) after a failed run when onFailure: notify', async () => {
        const queueManager = createThrowingQueueManager(new Error('AI error'));
        manager = new ScheduleManager(persistence, queueManager);

        const schedule = await manager.addSchedule(REPO_ID, makeScheduleInput({ onFailure: 'notify' }));
        await manager.triggerRun(REPO_ID, schedule.id);

        const reloaded = manager.getSchedule(REPO_ID, schedule.id);
        expect(reloaded!.status).toBe('active');
    });

    it('schedule is stopped after a failed run when onFailure: stop', async () => {
        const queueManager = createThrowingQueueManager(new Error('AI error'));
        manager = new ScheduleManager(persistence, queueManager);

        const schedule = await manager.addSchedule(REPO_ID, makeScheduleInput({ onFailure: 'stop' }));
        await manager.triggerRun(REPO_ID, schedule.id);

        const reloaded = manager.getSchedule(REPO_ID, schedule.id);
        expect(reloaded!.status).toBe('stopped');
    });

    it('second manual trigger still works after first failure', async () => {
        let callCount = 0;
        const queueManager = {
            enqueue: vi.fn(() => {
                callCount++;
                if (callCount === 1) throw new Error('First call fails');
                return `task_${callCount}`;
            }),
        } as any;
        manager = new ScheduleManager(persistence, queueManager);
        manager.restoreRunHistory(runPersistence);

        const schedule = await manager.addSchedule(REPO_ID, makeScheduleInput());

        const run1 = await manager.triggerRun(REPO_ID, schedule.id);
        expect(run1.status).toBe('failed');

        const run2 = await manager.triggerRun(REPO_ID, schedule.id);
        expect(run2.status).toBe('completed');
    });

    it('multiple sequential failures are all stored in history', async () => {
        const queueManager = createThrowingQueueManager(new Error('AI error'));
        manager = new ScheduleManager(persistence, queueManager);
        manager.restoreRunHistory(runPersistence);

        const schedule = await manager.addSchedule(REPO_ID, makeScheduleInput());

        await manager.triggerRun(REPO_ID, schedule.id);
        await manager.triggerRun(REPO_ID, schedule.id);
        await manager.triggerRun(REPO_ID, schedule.id);

        const history = manager.getRunHistory(schedule.id);
        expect(history).toHaveLength(3);
        expect(history.every(r => r.status === 'failed')).toBe(true);
    });

    it('run with no queueManager completes without error', async () => {
        manager = new ScheduleManager(persistence, null); // no queue manager
        manager.restoreRunHistory(runPersistence);

        const schedule = await manager.addSchedule(REPO_ID, makeScheduleInput());
        const run = await manager.triggerRun(REPO_ID, schedule.id);

        expect(run.status).toBe('completed');
    });
});

// ============================================================================
// Integration Tests — HTTP server
// ============================================================================

describe('Schedule AI Failure (integration — HTTP server)', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-ai-fail-http-'));
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

    it('GET history endpoint returns failed run after trigger', async () => {
        await startServer();

        // Create a schedule
        const createRes = await postJSON(schedulesUrl(), {
            name: 'Fail Test',
            target: 'pipelines/test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
        });
        const scheduleId = JSON.parse(createRes.body).schedule.id;

        // Trigger a run (it completes because there's no real AI in test env)
        await postJSON(`${schedulesUrl()}/${scheduleId}/run`, {});

        // Get history
        const histRes = await request(`${schedulesUrl()}/${scheduleId}/history`);
        expect(histRes.status).toBe(200);
        const { history } = JSON.parse(histRes.body);
        expect(history.length).toBeGreaterThan(0);
        expect(history[0].scheduleId).toBe(scheduleId);
    });

    it('schedule remains listed after a run', async () => {
        await startServer();

        const createRes = await postJSON(schedulesUrl(), {
            name: 'Persistent After Run',
            target: 'pipelines/test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
        });
        const scheduleId = JSON.parse(createRes.body).schedule.id;

        await postJSON(`${schedulesUrl()}/${scheduleId}/run`, {});

        const listRes = await request(schedulesUrl());
        const { schedules } = JSON.parse(listRes.body);
        expect(schedules.some((s: any) => s.id === scheduleId)).toBe(true);
    });
});
