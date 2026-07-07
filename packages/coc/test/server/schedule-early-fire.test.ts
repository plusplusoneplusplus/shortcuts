/**
 * Schedule Early-Fire Guard Tests
 *
 * Verifies that JavaScript timer imprecision (setTimeout firing ~1s early)
 * does not cause cron-scheduled jobs to double-fire.
 *
 * Uses fake timers with Date.now mocking to simulate early-fire conditions.
 * All tests use '* * * * *' cron to avoid timezone-dependent behavior
 * (nextCronTime operates in local time).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScheduleManager } from '../../src/server/schedule/schedule-manager';
import { ScheduleYamlPersistence } from '../../src/server/schedule/schedule-yaml-persistence';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-early-fire-'));
}

function cleanupDir(dir: string): void {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

const SCHEDULE_OPTS = {
    target: 'pipelines/test.yaml',
    cron: '* * * * *',
    params: {},
    onFailure: 'notify' as const,
    status: 'active' as const,
};

// ============================================================================
// Tests
// ============================================================================

describe('Schedule Early-Fire Guard', () => {
    let dataDir: string;
    let persistence: ScheduleYamlPersistence;
    let manager: ScheduleManager;

    const REPO_ID = 'test-repo';

    beforeEach(() => {
        dataDir = createTempDir();
        persistence = new ScheduleYamlPersistence(dataDir);
    });

    afterEach(() => {
        manager?.dispose();
        cleanupDir(dataDir);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should reschedule without executing when timer fires before target', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T08:00:00.000Z'));

        const enqueueSpy = vi.fn(() => 'task_1');
        manager = new ScheduleManager(persistence, { enqueue: enqueueSpy } as any);

        await manager.addSchedule(REPO_ID, { name: 'Job', ...SCHEDULE_OPTS });

        // Next fire at +60s. Mock Date.now to return 500ms before target
        // so the early-fire guard triggers inside the timer callback.
        const target = Date.now() + 60_000;
        const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(target - 500);

        // Advance past the timer — callback fires but guard blocks execution
        await vi.advanceTimersByTimeAsync(60_001);
        expect(enqueueSpy).not.toHaveBeenCalled();

        // Restore Date.now. The rescheduled timer has a ~60s delay
        // (because new Date() used the internal clock while Date.now was mocked).
        // Advance past a full minute to let it fire.
        dateNowSpy.mockRestore();
        await vi.advanceTimersByTimeAsync(65_000);

        expect(enqueueSpy).toHaveBeenCalledTimes(1);
    });

    it('should execute normally when timer fires at target time', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T08:00:00.000Z'));

        const enqueueSpy = vi.fn(() => 'task_1');
        manager = new ScheduleManager(persistence, { enqueue: enqueueSpy } as any);

        await manager.addSchedule(REPO_ID, { name: 'Job', ...SCHEDULE_OPTS });

        // Advance past the next minute boundary
        await vi.advanceTimersByTimeAsync(65_000);

        expect(enqueueSpy).toHaveBeenCalledTimes(1);
    });

    it('should execute normally when timer fires well after target time', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T08:00:00.000Z'));

        const enqueueSpy = vi.fn(() => 'task_1');
        manager = new ScheduleManager(persistence, { enqueue: enqueueSpy } as any);

        await manager.addSchedule(REPO_ID, { name: 'Job', ...SCHEDULE_OPTS });

        // Advance well past the target (2 minutes; fires once at +60s)
        await vi.advanceTimersByTimeAsync(120_000);

        // Should execute at least once (exact count depends on reschedule)
        expect(enqueueSpy).toHaveBeenCalledTimes(2);
    });

    it('rescheduled timer after early-fire should execute exactly once', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T08:00:00.000Z'));

        const enqueueSpy = vi.fn(() => 'task_1');
        manager = new ScheduleManager(persistence, { enqueue: enqueueSpy } as any);

        await manager.addSchedule(REPO_ID, { name: 'Job', ...SCHEDULE_OPTS });

        // Simulate early fire: mock Date.now to be 1s before target
        const target = Date.now() + 60_000;
        const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(target - 1000);

        // Fire the timer — guard blocks execution
        await vi.advanceTimersByTimeAsync(60_001);
        expect(enqueueSpy).not.toHaveBeenCalled();

        // Restore and advance past the rescheduled timer (~60s delay)
        dateNowSpy.mockRestore();
        await vi.advanceTimersByTimeAsync(65_000);

        // Exactly one execution — the rescheduled timer
        expect(enqueueSpy).toHaveBeenCalledTimes(1);
    });

    it('should not double-fire across multiple minute boundaries', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T08:00:00.000Z'));

        const enqueueSpy = vi.fn(() => `task_${Date.now()}`);
        manager = new ScheduleManager(persistence, { enqueue: enqueueSpy } as any);

        await manager.addSchedule(REPO_ID, { name: 'Every Minute', ...SCHEDULE_OPTS });

        // Advance 5 minutes — should fire exactly 5 times (once per minute)
        await vi.advanceTimersByTimeAsync(5 * 60_000);

        expect(enqueueSpy).toHaveBeenCalledTimes(5);
    });
});
