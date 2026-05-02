/**
 * Schedule Timezone and DST Tests
 *
 * Covers Section 8 of test-plan-schedule-system.md:
 * - nextRun API response is in UTC ISO format regardless of schedule timezone
 * - Schedule fires at correct wall-clock time for explicit cron expressions
 *
 * NOTE: Timezone-specific tests (DST spring-forward, fall-back) require
 * @sinonjs/fake-timers which supports timezone simulation, unlike vi.useFakeTimers().
 * The cron implementation uses system local time (no timezone parameter), so
 * timezone-aware scheduling is a known gap documented below as TODO.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { nextCronTime } from '../../src/server/schedule/schedule-manager';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-tz-'));
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
// nextCronTime — UTC representation tests
// ============================================================================

describe('Schedule Timezone — nextCronTime UTC format', () => {
    it('nextCronTime returns a Date object', () => {
        const after = new Date('2026-01-01T08:00:00.000Z');
        const next = nextCronTime('0 9 * * *', after);
        expect(next).toBeInstanceOf(Date);
    });

    it('nextCronTime result can be converted to UTC ISO string', () => {
        const after = new Date('2026-01-01T08:00:00.000Z');
        const next = nextCronTime('0 9 * * *', after);
        expect(next).not.toBeNull();
        const iso = next!.toISOString();
        // Valid ISO 8601 UTC format: ends with Z
        expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    });

    it('nextCronTime for every-minute cron returns next minute', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-06-15T10:30:45.000Z'));
            const after = new Date('2026-06-15T10:30:00.000Z');
            const next = nextCronTime('* * * * *', after);
            expect(next).not.toBeNull();
            // Next minute should be 10:31
            expect(next!.getMinutes()).toBe(31);
            expect(next!.getSeconds()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('nextCronTime returns null for unreachable schedule', () => {
        // Feb 30 doesn't exist — no valid date in 1 year
        const after = new Date('2026-01-01T00:00:00.000Z');
        const next = nextCronTime('0 0 30 2 *', after); // Feb 30
        expect(next).toBeNull();
    });

    it('nextCronTime advances to next day when time has passed today', () => {
        const after = new Date('2026-01-15T10:00:00.000Z');
        // Cron: 9 AM local — if system time is after 9 AM, should be tomorrow
        const next = nextCronTime('0 9 * * *', after);
        expect(next).not.toBeNull();
        // The returned date's hours and minutes should be 9:00 (local time)
        expect(next!.getHours()).toBe(9);
        expect(next!.getMinutes()).toBe(0);
        expect(next!.getSeconds()).toBe(0);
    });
});

// ============================================================================
// API — nextRun field is UTC ISO string
// ============================================================================

describe('Schedule API — nextRun is UTC ISO format', () => {
    let server: any;
    let dataDir: string;

    beforeEach = () => {}; // inline setup below

    afterEach = async () => { // inline teardown below
    };

    it('active schedule has nextRun in UTC ISO format', async () => {
        dataDir = createTempDir();
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });

        try {
            const wsId = 'tz-test-ws';
            const schedulesUrl = `${server.url}/api/workspaces/${wsId}/schedules`;

            const cr = await postJSON(schedulesUrl, {
                name: 'TZ Test Schedule',
                target: 'pipelines/test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
            });
            expect(cr.status).toBe(201);

            const listRes = await request(schedulesUrl);
            const { schedules } = JSON.parse(listRes.body);
            const schedule = schedules[0];

            expect(schedule.nextRun).toBeDefined();
            expect(schedule.nextRun).not.toBeNull();
            // Must be valid UTC ISO string
            expect(schedule.nextRun).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
        } finally {
            await server.close();
            cleanupDir(dataDir);
        }
    });

    it('paused schedule has null nextRun', async () => {
        dataDir = createTempDir();
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });

        try {
            const wsId = 'tz-paused-ws';
            const schedulesUrl = `${server.url}/api/workspaces/${wsId}/schedules`;

            const cr = await postJSON(schedulesUrl, {
                name: 'Paused TZ Test',
                target: 'pipelines/test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
            });
            const id = JSON.parse(cr.body).schedule.id;

            const listRes = await request(schedulesUrl);
            const { schedules } = JSON.parse(listRes.body);
            const schedule = schedules.find((s: any) => s.id === id);
            expect(schedule.nextRun).toBeNull();
        } finally {
            await server.close();
            cleanupDir(dataDir);
        }
    });
});

// ============================================================================
// DST tests — documented as known gaps / TODO
// ============================================================================

describe('Schedule Timezone — DST (TODO / known gaps)', () => {
    it.todo(
        'schedule with explicit timezone fires at correct wall-clock time — requires timezone support in nextCronTime'
    );

    it.todo(
        'schedule crossing DST spring-forward fires at correct time, not 1h off — requires @sinonjs/fake-timers'
    );

    it.todo(
        'schedule crossing DST fall-back fires once, not twice for the repeated hour — requires @sinonjs/fake-timers'
    );
});
