import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createTaskQueueManager, MemoryCandidateStore } from '@plusplusoneplusplus/forge';
import { AutoPromoteScheduler, getAutoPromoteScheduleId } from '../../../src/server/memory/auto-promote';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { ScheduleManager } from '../../../src/server/schedule/schedule-manager';
import { ScheduleYamlPersistence } from '../../../src/server/schedule/schedule-yaml-persistence';

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'auto-promote-test-'));
}

describe('AutoPromoteScheduler', () => {
    let dataDir: string;
    let queueManager: ReturnType<typeof createTaskQueueManager>;
    let scheduleManager: ScheduleManager;
    let scheduler: AutoPromoteScheduler;

    beforeEach(() => {
        dataDir = makeTmpDir();
        queueManager = createTaskQueueManager();
        scheduleManager = new ScheduleManager(new ScheduleYamlPersistence(dataDir), queueManager);
        scheduler = new AutoPromoteScheduler({
            dataDir,
            queueManager,
            scheduleManager,
            enabled: true,
            reconcileIntervalMs: 60_000,
        });
    });

    afterEach(() => {
        scheduler.dispose();
        scheduleManager.dispose();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function captureCandidate(workspaceId: string, content: string) {
        const store = new MemoryCandidateStore({
            dbPath: path.join(dataDir, 'repos', workspaceId, 'memory', 'raw-memory.db'),
        });
        const candidate = await store.upsertCandidate({
            target: 'repo',
            content,
            source: 'test',
            workspaceId,
            score: 1,
            explicitMemoryIntent: true,
        });
        store.close();
        await scheduler.handleCandidateCaptured({ target: 'repo', candidate });
    }

    it('does nothing by default when auto-promotion is off', async () => {
        writeRepoPreferences(dataDir, 'ws-off', {
            boundedMemory: { enabled: true },
        });

        await captureCandidate('ws-off', 'Fact that should wait for manual promotion');

        expect(queueManager.getAll()).toHaveLength(0);
    });

    it('enqueues exactly one threshold promotion and dedupes while queued', async () => {
        writeRepoPreferences(dataDir, 'ws-threshold', {
            boundedMemory: {
                enabled: true,
                autoPromote: {
                    mode: 'threshold',
                    thresholdCount: 2,
                    minIntervalMs: 0,
                },
            },
        });

        await captureCandidate('ws-threshold', 'First candidate');
        expect(queueManager.getAll()).toHaveLength(0);

        await captureCandidate('ws-threshold', 'Second candidate');
        await captureCandidate('ws-threshold', 'Third candidate');

        const tasks = queueManager.getAll();
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
            type: 'memory-promote',
            repoId: 'ws-threshold',
            payload: {
                kind: 'memory-promote',
                workspaceId: 'ws-threshold',
                target: 'memory',
                trigger: 'auto-threshold',
            },
        });
    });

    it('keeps threshold decisions isolated per repo', async () => {
        writeRepoPreferences(dataDir, 'ws-a', {
            boundedMemory: {
                enabled: true,
                autoPromote: { mode: 'threshold', thresholdCount: 1, minIntervalMs: 0 },
            },
        });
        writeRepoPreferences(dataDir, 'ws-b', {
            boundedMemory: {
                enabled: true,
                autoPromote: { mode: 'off' },
            },
        });

        await captureCandidate('ws-a', 'Repo A candidate');
        await captureCandidate('ws-b', 'Repo B candidate');

        expect(queueManager.getAll().map(task => (task.payload as any).workspaceId)).toEqual(['ws-a']);
    });

    it('registers, restores, and removes the managed cron schedule', () => {
        writeRepoPreferences(dataDir, 'ws-cron', {
            boundedMemory: {
                enabled: true,
                autoPromote: {
                    mode: 'cron',
                    cron: '0 3 * * *',
                },
            },
        });

        scheduler.reconcileWorkspace('ws-cron');
        const scheduleId = getAutoPromoteScheduleId('ws-cron');
        expect(scheduleManager.getSchedule('ws-cron', scheduleId)).toMatchObject({
            id: scheduleId,
            targetType: 'memory-promote',
            cron: '0 3 * * *',
        });

        const restored = new ScheduleManager(new ScheduleYamlPersistence(dataDir), queueManager);
        restored.restore();
        expect(restored.getSchedule('ws-cron', scheduleId)).toMatchObject({
            id: scheduleId,
            targetType: 'memory-promote',
        });
        restored.dispose();

        writeRepoPreferences(dataDir, 'ws-cron', {
            boundedMemory: {
                enabled: true,
                autoPromote: { mode: 'off' },
            },
        });
        scheduler.reconcileWorkspace('ws-cron');

        expect(scheduleManager.getSchedule('ws-cron', scheduleId)).toBeUndefined();
    });
});
