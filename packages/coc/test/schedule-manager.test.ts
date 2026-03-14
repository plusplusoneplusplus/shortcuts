/**
 * Tests for ScheduleManager
 *
 * Tests for cron parsing, nextCronTime, describeCron, and core manager logic.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScheduleManager, parseCron, nextCronTime, describeCron } from '../src/server/schedule-manager';
import { SchedulePersistence } from '../src/server/schedule-persistence';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-mgr-test-'));
}

function cleanupDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
}

// ============================================================================
// Cron Parser Tests
// ============================================================================

describe('parseCron', () => {
    it('parses wildcard fields', () => {
        const fields = parseCron('* * * * *');
        expect(fields.minutes.size).toBe(60);
        expect(fields.hours.size).toBe(24);
        expect(fields.daysOfMonth.size).toBe(31);
        expect(fields.months.size).toBe(12);
        expect(fields.daysOfWeek.size).toBe(7);
    });

    it('parses specific values', () => {
        const fields = parseCron('30 9 15 6 1');
        expect(fields.minutes).toEqual(new Set([30]));
        expect(fields.hours).toEqual(new Set([9]));
        expect(fields.daysOfMonth).toEqual(new Set([15]));
        expect(fields.months).toEqual(new Set([6]));
        expect(fields.daysOfWeek).toEqual(new Set([1]));
    });

    it('parses comma-separated values', () => {
        const fields = parseCron('0,30 9,17 * * *');
        expect(fields.minutes).toEqual(new Set([0, 30]));
        expect(fields.hours).toEqual(new Set([9, 17]));
    });

    it('parses ranges', () => {
        const fields = parseCron('0 9-17 * * *');
        expect(fields.hours).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]));
    });

    it('parses step values', () => {
        const fields = parseCron('*/15 * * * *');
        expect(fields.minutes).toEqual(new Set([0, 15, 30, 45]));
    });

    it('parses range with step', () => {
        const fields = parseCron('0 0-12/3 * * *');
        expect(fields.hours).toEqual(new Set([0, 3, 6, 9, 12]));
    });

    it('throws on invalid expression', () => {
        expect(() => parseCron('* *')).toThrow('expected 5 fields');
        expect(() => parseCron('too many * * * * * *')).toThrow('expected 5 fields');
    });
});

// ============================================================================
// nextCronTime Tests
// ============================================================================

describe('nextCronTime', () => {
    it('returns next minute for * * * * *', () => {
        const now = new Date(2026, 1, 18, 10, 30, 0); // Feb 18 2026 10:30 local
        const next = nextCronTime('* * * * *', now);
        expect(next).not.toBeNull();
        expect(next!.getMinutes()).toBe(31);
    });

    it('returns correct time for 0 9 * * *', () => {
        const now = new Date('2026-02-18T08:00:00Z');
        const next = nextCronTime('0 9 * * *', now);
        expect(next).not.toBeNull();
        expect(next!.getHours()).toBe(9);
        expect(next!.getMinutes()).toBe(0);
    });

    it('returns next day when time has passed', () => {
        const now = new Date(2026, 1, 18, 10, 0, 0); // Feb 18 2026 10:00 local
        const next = nextCronTime('0 9 * * *', now);
        expect(next).not.toBeNull();
        expect(next!.getDate()).toBe(19);
        expect(next!.getHours()).toBe(9);
    });

    it('handles step expressions', () => {
        const now = new Date(2026, 1, 18, 10, 0, 0); // Feb 18 2026 10:00 local
        const next = nextCronTime('*/30 * * * *', now);
        expect(next).not.toBeNull();
        expect(next!.getMinutes() % 30).toBe(0);
    });
});

// ============================================================================
// describeCron Tests
// ============================================================================

describe('describeCron', () => {
    it('describes every minute', () => {
        expect(describeCron('* * * * *')).toBe('Every minute');
    });

    it('describes minute intervals', () => {
        expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    });

    it('describes hour intervals', () => {
        expect(describeCron('0 */2 * * *')).toBe('Every 2 hours');
    });

    it('describes daily at time', () => {
        expect(describeCron('0 9 * * *')).toBe('Every day at 09:00');
    });

    it('describes weekly', () => {
        expect(describeCron('0 10 * * 1')).toBe('Mon at 10:00');
    });

    it('returns raw expr for complex expressions', () => {
        expect(describeCron('0 9-17 * * 1-5')).toBe('0 9-17 * * 1-5');
    });

    it('describes multiple hours daily', () => {
        expect(describeCron('0 1,13 * * *')).toBe('Every day at 01:00, 13:00');
    });

    it('describes multiple hours daily (four times)', () => {
        expect(describeCron('0 0,6,12,18 * * *')).toBe('Every day at 00:00, 06:00, 12:00, 18:00');
    });

    it('describes multiple hours on specific days of week', () => {
        expect(describeCron('30 8,17 * * 1,5')).toBe('Mon, Fri at 08:30, 17:30');
    });

    it('sorts hours numerically in output', () => {
        expect(describeCron('0 13,1 * * *')).toBe('Every day at 01:00, 13:00');
    });
});

// ============================================================================
// ScheduleManager Tests
// ============================================================================

describe('ScheduleManager', () => {
    let dataDir: string;
    let persistence: SchedulePersistence;
    let manager: ScheduleManager;

    beforeEach(() => {
        dataDir = createTempDir();
        persistence = new SchedulePersistence(dataDir);
        manager = new ScheduleManager(persistence);
    });

    afterEach(() => {
        manager.dispose();
        cleanupDir(dataDir);
    });

    const REPO_ID = 'test-repo-id';

    describe('addSchedule', () => {
        it('creates a schedule with generated ID', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Test',
                target: 'pipelines/test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            expect(schedule.id).toMatch(/^sch_/);
            expect(schedule.name).toBe('Test');
            expect(schedule.createdAt).toBeDefined();
        });

        it('persists the schedule', () => {
            manager.addSchedule(REPO_ID, {
                name: 'Persistent',
                target: 'pipelines/test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            const loaded = persistence.loadAll();
            expect(loaded.get(REPO_ID)).toHaveLength(1);
            expect(loaded.get(REPO_ID)![0].name).toBe('Persistent');
        });

        it('emits schedule-added event', () => {
            const events: any[] = [];
            manager.on('change', (e: any) => events.push(e));

            manager.addSchedule(REPO_ID, {
                name: 'Test',
                target: 'test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('schedule-added');
            expect(events[0].repoId).toBe(REPO_ID);
        });

        it('rejects invalid cron', () => {
            expect(() => manager.addSchedule(REPO_ID, {
                name: 'Test',
                target: 'test.yaml',
                cron: 'invalid',
                params: {},
                onFailure: 'notify',
                status: 'active',
            })).toThrow();
        });
    });

    describe('getSchedules', () => {
        it('returns empty array for unknown repo', () => {
            expect(manager.getSchedules('unknown')).toEqual([]);
        });

        it('returns all schedules for a repo', () => {
            manager.addSchedule(REPO_ID, { name: 'A', target: 'a.yaml', cron: '0 9 * * *', params: {}, onFailure: 'notify', status: 'active' });
            manager.addSchedule(REPO_ID, { name: 'B', target: 'b.yaml', cron: '0 10 * * *', params: {}, onFailure: 'notify', status: 'active' });

            expect(manager.getSchedules(REPO_ID)).toHaveLength(2);
        });
    });

    describe('updateSchedule', () => {
        it('updates schedule properties', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Original',
                target: 'test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            const updated = manager.updateSchedule(REPO_ID, schedule.id, { name: 'Updated', status: 'paused' });
            expect(updated).toBeDefined();
            expect(updated!.name).toBe('Updated');
            expect(updated!.status).toBe('paused');
        });

        it('returns undefined for non-existent schedule', () => {
            const result = manager.updateSchedule(REPO_ID, 'nonexistent', { name: 'X' });
            expect(result).toBeUndefined();
        });

        it('emits schedule-updated event', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Test',
                target: 'test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            const events: any[] = [];
            manager.on('change', (e: any) => events.push(e));

            manager.updateSchedule(REPO_ID, schedule.id, { status: 'paused' });

            expect(events.some(e => e.type === 'schedule-updated')).toBe(true);
        });
    });

    describe('removeSchedule', () => {
        it('removes a schedule', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'To Remove',
                target: 'test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            const result = manager.removeSchedule(REPO_ID, schedule.id);
            expect(result).toBe(true);
            expect(manager.getSchedules(REPO_ID)).toHaveLength(0);
        });

        it('returns false for non-existent schedule', () => {
            expect(manager.removeSchedule(REPO_ID, 'nonexistent')).toBe(false);
        });

        it('emits schedule-removed event', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Test',
                target: 'test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            const events: any[] = [];
            manager.on('change', (e: any) => events.push(e));

            manager.removeSchedule(REPO_ID, schedule.id);
            expect(events.some(e => e.type === 'schedule-removed')).toBe(true);
        });
    });

    describe('triggerRun', () => {
        it('creates a run record', async () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Trigger Test',
                target: 'test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            const run = await manager.triggerRun(REPO_ID, schedule.id);
            expect(run.scheduleId).toBe(schedule.id);
            expect(run.repoId).toBe(REPO_ID);
            expect(run.startedAt).toBeDefined();
        });

        it('adds to run history', async () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'History Test',
                target: 'test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            await manager.triggerRun(REPO_ID, schedule.id);
            const history = manager.getRunHistory(schedule.id);
            expect(history.length).toBeGreaterThan(0);
        });

        it('throws for non-existent schedule', async () => {
            await expect(manager.triggerRun(REPO_ID, 'nonexistent')).rejects.toThrow('Schedule not found');
        });

        it('emits schedule-triggered and schedule-run-complete events', async () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Event Test',
                target: 'test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            const events: any[] = [];
            manager.on('change', (e: any) => events.push(e));

            await manager.triggerRun(REPO_ID, schedule.id);
            expect(events.some(e => e.type === 'schedule-triggered')).toBe(true);
            expect(events.some(e => e.type === 'schedule-run-complete')).toBe(true);
        });
    });

    describe('restore', () => {
        it('restores schedules from persistence', () => {
            // Create a schedule, save, dispose, then restore in a new manager
            manager.addSchedule(REPO_ID, {
                name: 'Restored Schedule',
                target: 'test.yaml',
                cron: '0 9 * * *',
                params: { env: 'prod' },
                onFailure: 'stop',
                status: 'paused',
            });

            manager.dispose();

            const newManager = new ScheduleManager(persistence);
            newManager.restore();

            const schedules = newManager.getSchedules(REPO_ID);
            expect(schedules).toHaveLength(1);
            expect(schedules[0].name).toBe('Restored Schedule');
            expect(schedules[0].params).toEqual({ env: 'prod' });
            expect(schedules[0].onFailure).toBe('stop');
            expect(schedules[0].status).toBe('paused');

            newManager.dispose();
        });
    });

    describe('dispose', () => {
        it('cancels all timers', () => {
            manager.addSchedule(REPO_ID, {
                name: 'Timed',
                target: 'test.yaml',
                cron: '* * * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            // Should not throw
            expect(() => manager.dispose()).not.toThrow();
        });
    });

    describe('run history limit', () => {
        it('caps run history at 10 entries', async () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'History Limit',
                target: 'test.yaml',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            for (let i = 0; i < 15; i++) {
                await manager.triggerRun(REPO_ID, schedule.id);
            }

            const history = manager.getRunHistory(schedule.id);
            expect(history.length).toBeLessThanOrEqual(10);
        });
    });

    describe('executeRun dispatch by targetType', () => {
        it('enqueues chat task with autopilot mode when targetType is undefined', async () => {
            const enqueued: any[] = [];
            const mockQueue = { enqueue: (task: any) => { enqueued.push(task); return 'tid_1'; } };
            const mgr = new ScheduleManager(persistence, mockQueue as any);

            const schedule = mgr.addSchedule(REPO_ID, {
                name: 'Prompt Schedule',
                target: 'my-prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            await mgr.triggerRun(REPO_ID, schedule.id);

            expect(enqueued).toHaveLength(1);
            expect(enqueued[0].type).toBe('chat');
            expect(enqueued[0].payload.kind).toBe('chat');
            expect(enqueued[0].payload.mode).toBe('autopilot');
            expect(enqueued[0].payload.context.files).toContain('my-prompt.md');
            expect(enqueued[0].payload.context.scheduleId).toBe(schedule.id);
            expect(enqueued[0].displayName).toBe('[Schedule] Prompt Schedule');

            mgr.dispose();
        });

        it('enqueues chat task with autopilot mode when targetType is prompt', async () => {
            const enqueued: any[] = [];
            const mockQueue = { enqueue: (task: any) => { enqueued.push(task); return 'tid_2'; } };
            const mgr = new ScheduleManager(persistence, mockQueue as any);

            const schedule = mgr.addSchedule(REPO_ID, {
                name: 'Explicit Prompt',
                target: 'prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
                targetType: 'prompt',
            });

            await mgr.triggerRun(REPO_ID, schedule.id);

            expect(enqueued).toHaveLength(1);
            expect(enqueued[0].type).toBe('chat');
            expect(enqueued[0].payload.kind).toBe('chat');
            expect(enqueued[0].payload.mode).toBe('autopilot');
            expect(enqueued[0].displayName).toBe('[Schedule] Explicit Prompt');

            mgr.dispose();
        });

        it('enqueues run-script task when targetType is script', async () => {
            const enqueued: any[] = [];
            const mockQueue = { enqueue: (task: any) => { enqueued.push(task); return 'tid_3'; } };
            const mgr = new ScheduleManager(persistence, mockQueue as any);

            const schedule = mgr.addSchedule(REPO_ID, {
                name: 'My Script',
                target: 'echo hello',
                cron: '0 9 * * *',
                params: { workingDirectory: '/tmp/work' },
                onFailure: 'notify',
                status: 'active',
                targetType: 'script',
            });

            await mgr.triggerRun(REPO_ID, schedule.id);

            expect(enqueued).toHaveLength(1);
            expect(enqueued[0].type).toBe('run-script');
            expect(enqueued[0].payload.kind).toBe('run-script');
            expect(enqueued[0].payload.script).toBe('echo hello');
            expect(enqueued[0].payload.workingDirectory).toBe('/tmp/work');
            expect(enqueued[0].payload.scheduleId).toBe(schedule.id);

            mgr.dispose();
        });

        it('displayName for script schedule is [Schedule:script] <name>', async () => {
            const enqueued: any[] = [];
            const mockQueue = { enqueue: (task: any) => { enqueued.push(task); return 'tid_4'; } };
            const mgr = new ScheduleManager(persistence, mockQueue as any);

            const schedule = mgr.addSchedule(REPO_ID, {
                name: 'My Script Job',
                target: 'echo abc',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
                targetType: 'script',
            });

            await mgr.triggerRun(REPO_ID, schedule.id);

            expect(enqueued[0].displayName).toBe('[Schedule:script] My Script Job');

            mgr.dispose();
        });

        it('workingDirectory falls back to empty string when params.workingDirectory is absent', async () => {
            const enqueued: any[] = [];
            const mockQueue = { enqueue: (task: any) => { enqueued.push(task); return 'tid_5'; } };
            const mgr = new ScheduleManager(persistence, mockQueue as any);

            const schedule = mgr.addSchedule(REPO_ID, {
                name: 'No WorkDir',
                target: 'node -e "1"',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
                targetType: 'script',
            });

            await mgr.triggerRun(REPO_ID, schedule.id);

            expect(enqueued[0].payload.workingDirectory).toBe('');

            mgr.dispose();
        });

        it('sets run.processId to queue_<taskId> for script schedules', async () => {
            const mockQueue = { enqueue: (_task: any) => 'mytaskid' };
            const mgr = new ScheduleManager(persistence, mockQueue as any);

            const schedule = mgr.addSchedule(REPO_ID, {
                name: 'Script PID',
                target: 'echo x',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
                targetType: 'script',
            });

            const run = await mgr.triggerRun(REPO_ID, schedule.id);
            expect(run.processId).toBe('queue_mytaskid');

            mgr.dispose();
        });
    });

    describe('targetType field', () => {
        it('targetType is undefined when not provided (treated as prompt)', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'No TargetType',
                target: 'prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
            });

            expect(schedule.targetType).toBeUndefined();
        });

        it('accepts targetType: prompt explicitly', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Explicit Prompt',
                target: 'prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
                targetType: 'prompt',
            });

            expect(schedule.targetType).toBe('prompt');
        });

        it('accepts targetType: script', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Script Schedule',
                target: 'echo hello',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
                targetType: 'script',
            });

            expect(schedule.targetType).toBe('script');
        });

        it('persists and restores targetType correctly', () => {
            manager.addSchedule(REPO_ID, {
                name: 'Script Persisted',
                target: 'echo hi',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
                targetType: 'script',
            });

            manager.dispose();

            const newManager = new ScheduleManager(persistence);
            newManager.restore();

            const schedules = newManager.getSchedules(REPO_ID);
            expect(schedules).toHaveLength(1);
            expect(schedules[0].targetType).toBe('script');

            newManager.dispose();
        });
    });

    describe('outputFolder field', () => {
        it('is undefined when not provided', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'No Output Folder',
                target: 'prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
            });

            expect(schedule.outputFolder).toBeUndefined();
        });

        it('stores and returns outputFolder when provided', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'With Output Folder',
                target: 'prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
                outputFolder: '~/.coc/repos/myrepo/tasks',
            });

            expect(schedule.outputFolder).toBe('~/.coc/repos/myrepo/tasks');
        });

        it('can be updated via updateSchedule', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Update Output Folder',
                target: 'prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
            });

            const updated = manager.updateSchedule(REPO_ID, schedule.id, { outputFolder: '/new/output' });
            expect(updated!.outputFolder).toBe('/new/output');
        });

        it('persists and restores outputFolder', () => {
            manager.addSchedule(REPO_ID, {
                name: 'Persisted Output Folder',
                target: 'prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
                outputFolder: '~/.coc/repos/test/tasks',
            });

            manager.dispose();

            const newManager = new ScheduleManager(persistence);
            newManager.restore();

            const schedules = newManager.getSchedules(REPO_ID);
            expect(schedules[0].outputFolder).toBe('~/.coc/repos/test/tasks');

            newManager.dispose();
        });

        it('prepends output folder to prompt when outputFolder is set', async () => {
            const enqueued: any[] = [];
            const mockQueue = { enqueue: (task: any) => { enqueued.push(task); return 'tid_of'; } };
            const mgr = new ScheduleManager(persistence, mockQueue as any);

            const schedule = mgr.addSchedule(REPO_ID, {
                name: 'Output Folder Prompt',
                target: 'my-task.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
                outputFolder: '~/.coc/repos/myrepo/tasks',
            });

            await mgr.triggerRun(REPO_ID, schedule.id);

            expect(enqueued).toHaveLength(1);
            expect(enqueued[0].payload.prompt).toBe(
                'Output folder: ~/.coc/repos/myrepo/tasks\n\nFollow the instruction my-task.md.'
            );

            mgr.dispose();
        });

        it('does not prepend output folder prefix when outputFolder is absent', async () => {
            const enqueued: any[] = [];
            const mockQueue = { enqueue: (task: any) => { enqueued.push(task); return 'tid_nof'; } };
            const mgr = new ScheduleManager(persistence, mockQueue as any);

            const schedule = mgr.addSchedule(REPO_ID, {
                name: 'No Output Folder Prompt',
                target: 'my-task.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            await mgr.triggerRun(REPO_ID, schedule.id);

            expect(enqueued[0].payload.prompt).toBe('Follow the instruction my-task.md.');

            mgr.dispose();
        });

        it('does not prepend output folder for script-type schedules', async () => {
            const enqueued: any[] = [];
            const mockQueue = { enqueue: (task: any) => { enqueued.push(task); return 'tid_script'; } };
            const mgr = new ScheduleManager(persistence, mockQueue as any);

            const schedule = mgr.addSchedule(REPO_ID, {
                name: 'Script With Output Folder',
                target: 'echo hello',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
                targetType: 'script',
                outputFolder: '~/.coc/repos/myrepo/tasks',
            });

            await mgr.triggerRun(REPO_ID, schedule.id);

            expect(enqueued[0].type).toBe('run-script');
            // script payload has no prompt field
            expect(enqueued[0].payload.prompt).toBeUndefined();

            mgr.dispose();
        });
    });

    describe('model field', () => {
        it('is undefined when not provided', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'No Model',
                target: 'prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
            });

            expect(schedule.model).toBeUndefined();
        });

        it('stores and returns model when provided', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'With Model',
                target: 'prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
                model: 'claude-opus-4.6',
            });

            expect(schedule.model).toBe('claude-opus-4.6');
        });

        it('can be updated via updateSchedule', () => {
            const schedule = manager.addSchedule(REPO_ID, {
                name: 'Update Model',
                target: 'prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
            });

            const updated = manager.updateSchedule(REPO_ID, schedule.id, { model: 'gpt-5.2' });
            expect(updated!.model).toBe('gpt-5.2');
        });

        it('persists and restores model', () => {
            manager.addSchedule(REPO_ID, {
                name: 'Persisted Model',
                target: 'prompt.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'paused',
                model: 'claude-sonnet-4.6',
            });

            manager.dispose();

            const newManager = new ScheduleManager(persistence);
            newManager.restore();

            const schedules = newManager.getSchedules(REPO_ID);
            expect(schedules[0].model).toBe('claude-sonnet-4.6');

            newManager.dispose();
        });

        it('forwards model to config.model when enqueuing chat task', async () => {
            const enqueued: any[] = [];
            const mockQueue = { enqueue: (task: any) => { enqueued.push(task); return 'tid_model'; } };
            const mgr = new ScheduleManager(persistence, mockQueue as any);

            const schedule = mgr.addSchedule(REPO_ID, {
                name: 'Model Forwarded',
                target: 'my-task.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
                model: 'claude-opus-4.6',
            });

            await mgr.triggerRun(REPO_ID, schedule.id);

            expect(enqueued).toHaveLength(1);
            expect(enqueued[0].config.model).toBe('claude-opus-4.6');

            mgr.dispose();
        });

        it('does not set config.model when model is absent', async () => {
            const enqueued: any[] = [];
            const mockQueue = { enqueue: (task: any) => { enqueued.push(task); return 'tid_nomodel'; } };
            const mgr = new ScheduleManager(persistence, mockQueue as any);

            const schedule = mgr.addSchedule(REPO_ID, {
                name: 'No Model Forwarded',
                target: 'my-task.md',
                cron: '0 9 * * *',
                params: {},
                onFailure: 'notify',
                status: 'active',
            });

            await mgr.triggerRun(REPO_ID, schedule.id);

            expect(enqueued[0].config.model).toBeUndefined();

            mgr.dispose();
        });
    });
});
