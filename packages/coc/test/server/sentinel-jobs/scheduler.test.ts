import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SentinelJobStore } from '../../../src/server/sentinel-jobs/job-store';
import { SentinelJobScheduler } from '../../../src/server/sentinel-jobs/job-scheduler';
import { createTodoTestDatabase } from '../sentinel-todos/test-db';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const other = { workspaceId: 'ws-b', processId: 'queue_other' };
const input = { name: 'Review', instructions: 'Check evidence', provider: 'copilot' as const, model: 'model', cron: '0 * * * *' };
let fixture: ReturnType<typeof createTodoTestDatabase>;
let jobs: SentinelJobStore;
let scheduler: SentinelJobScheduler;
let enabled: boolean;
let exists: boolean;
const tick = vi.fn();
const assertOwner = vi.fn();
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 10, 30));
    const directory = path.resolve('.sentinel-jobs-tests', randomUUID());
    fs.mkdirSync(directory, { recursive: true });
    fixture = createTodoTestDatabase(directory);
    jobs = new SentinelJobStore(fixture.db);
    enabled = true;
    exists = true;
    tick.mockReset().mockResolvedValue({});
    assertOwner.mockReset().mockImplementation(async () => { if (!exists) throw new Error('Missing owner'); });
    scheduler = new SentinelJobScheduler({ jobs, service: { assertOwner, tick }, getEnabled: () => enabled });
});
afterEach(() => {
    scheduler.dispose();
    fixture.dispose();
    vi.useRealTimers();
});

describe('SentinelJobScheduler', () => {
    it('is future-only: no catch-up fire for a cron whose time has already passed', async () => {
        const job = jobs.create(owner, input);
        scheduler.refreshAll();
        await settle();
        // Next hourly boundary from 10:30 is 11:00 — nothing fires immediately or on an earlier replay.
        await vi.advanceTimersByTimeAsync(29 * 60_000);
        expect(tick).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(tick).toHaveBeenCalledExactlyOnceWith(owner, job.id, expect.any(Function));
    });

    it('arms only enabled jobs with a cron and keeps independent jobs on independent timers', async () => {
        const withCron = jobs.create(owner, input);
        jobs.create(owner, { ...input, cron: undefined });
        jobs.create(owner, { ...input, enabled: false });
        const otherJob = jobs.create(other, input);
        scheduler.refreshAll();
        await settle();
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(tick).toHaveBeenCalledTimes(2);
        expect(tick.mock.calls.map(call => [call[0], call[1]]).sort((a, b) => a[0].workspaceId.localeCompare(b[0].workspaceId)))
            .toEqual([[owner, withCron.id], [other, otherJob.id]]);
    });

    it('invalidates the previous generation on config refresh and re-arms a changed cron', async () => {
        const job = jobs.create(owner, input);
        scheduler.refreshAll();
        await settle();
        jobs.update(owner, job.id, { cron: '15 * * * *' }, job.revision);
        scheduler.refreshAll();
        await settle();
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        // Old boundary (11:00) must not fire; only the new 11:15 boundary does.
        expect(tick).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(15 * 60_000);
        expect(tick).toHaveBeenCalledOnce();
    });

    it('disposes cleanly: clears timers, stops future arming, and tolerates refreshAll after disposal', async () => {
        jobs.create(owner, input);
        scheduler.refreshAll();
        await settle();
        expect(vi.getTimerCount()).toBe(1);
        scheduler.dispose();
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(tick).not.toHaveBeenCalled();
        scheduler.refreshAll();
        await settle();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('never auto-pauses: repeated schedule-run failures do not stop future ticks', async () => {
        const job = jobs.create(owner, input);
        scheduler.refreshAll();
        await settle();
        for (let i = 0; i < 5; i++) {
            const run = jobs.createRun(owner, job.id, 'schedule', 'queue_x', new Date().toISOString());
            jobs.patchRun(owner, job.id, run.id, { status: 'failed' }, ['queued', 'running']);
        }
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(tick).toHaveBeenCalledTimes(1);
        expect(jobs.get(owner, job.id).enabled).toBe(true);
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(tick).toHaveBeenCalledTimes(2);
    });

    it('re-arms independently of run completion, so an overlap tick still fires on schedule', async () => {
        const job = jobs.create(owner, input);
        scheduler.refreshAll();
        await settle();
        // Simulate a still-running run at the moment the next tick fires.
        jobs.createRun(owner, job.id, 'manual', 'queue_x', new Date().toISOString());
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(tick).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(tick).toHaveBeenCalledTimes(2);
    });

    it('rechecks live owner and enabled flag at the tick, without rearming after owner removal', async () => {
        jobs.create(owner, input);
        scheduler.refreshAll();
        await settle();
        exists = false;
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        // The already-armed tick still fires once; the owner is only rechecked on (re-)arm.
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(tick).toHaveBeenCalledOnce();
        // Re-arm after that tick sees the missing owner and gives up — no further timer.
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(tick).toHaveBeenCalledOnce();
        exists = true;
        scheduler.refreshAll();
        await settle();
        enabled = false;
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(tick).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        error.mockRestore();
    });

    it('does nothing when the feature flag is off, and refreshAll tolerates a disabled job store', async () => {
        enabled = false;
        jobs.create(owner, input);
        scheduler.refreshAll();
        await settle();
        await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
        expect(tick).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
