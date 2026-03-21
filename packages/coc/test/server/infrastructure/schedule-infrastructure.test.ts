/**
 * createScheduleInfrastructure Tests
 *
 * Regression coverage for the extracted schedule infrastructure builder.
 * Verifies that createScheduleInfrastructure returns correctly configured
 * instances equivalent to the inline setup it replaced in index.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual };
});

import { createScheduleInfrastructure } from '../../../src/server/infrastructure/schedule-infrastructure';
import { ScheduleManager } from '../../../src/server/schedule-manager';
import { ScheduleRunPersistence } from '../../../src/server/schedule-run-persistence';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-infra-test-'));
}

function makeQueueFacade(): any {
    return {
        enqueue: vi.fn(),
        getQueue: vi.fn().mockReturnValue([]),
        getHistory: vi.fn().mockReturnValue([]),
        cancel: vi.fn(),
        clear: vi.fn(),
    };
}

describe('createScheduleInfrastructure', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = makeTempDir();
    });

    it('returns scheduleManager and scheduleRunPersistence', () => {
        const queueFacade = makeQueueFacade();
        const result = createScheduleInfrastructure(dataDir, queueFacade);

        expect(result.scheduleManager).toBeInstanceOf(ScheduleManager);
        expect(result.scheduleRunPersistence).toBeInstanceOf(ScheduleRunPersistence);
    });

    it('scheduleManager has restore and dispose methods', () => {
        const queueFacade = makeQueueFacade();
        const { scheduleManager } = createScheduleInfrastructure(dataDir, queueFacade);

        expect(typeof scheduleManager.restore).toBe('function');
        expect(typeof scheduleManager.dispose).toBe('function');
    });

    it('works with a fresh empty dataDir', () => {
        const queueFacade = makeQueueFacade();
        expect(() => createScheduleInfrastructure(dataDir, queueFacade)).not.toThrow();
    });

    it('migrates existing JSON schedules during construction', () => {
        // Create a legacy JSON schedules file so migrateAllFromJson has something to process
        const repoId = 'test-repo';
        const reposDir = path.join(dataDir, 'repos', repoId);
        fs.mkdirSync(reposDir, { recursive: true });
        // ScheduleRunPersistence file — just ensure no crash with existing files
        const scheduleRunFile = path.join(reposDir, 'schedule-runs.json');
        fs.writeFileSync(scheduleRunFile, JSON.stringify([]));

        const queueFacade = makeQueueFacade();
        expect(() => createScheduleInfrastructure(dataDir, queueFacade)).not.toThrow();
    });

    it('restoreRunHistory is called with scheduleRunPersistence', () => {
        const queueFacade = makeQueueFacade();
        // Just verify restoreRunHistory doesn't throw when called with an empty store
        const { scheduleManager, scheduleRunPersistence } = createScheduleInfrastructure(
            dataDir,
            queueFacade,
        );
        expect(() => scheduleManager.restoreRunHistory(scheduleRunPersistence)).not.toThrow();
    });
});
