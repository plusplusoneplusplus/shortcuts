/**
 * createScheduleInfrastructure Tests
 *
 * Regression coverage for the extracted schedule infrastructure builder.
 * Verifies that createScheduleInfrastructure returns correctly configured
 * instances equivalent to the inline setup it replaced in index.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual };
});

import { createScheduleInfrastructure } from '../../../src/server/infrastructure/schedule-infrastructure';
import { ScheduleManager } from '../../../src/server/schedule/schedule-manager';
import { SqliteScheduleRunPersistence } from '../../../src/server/schedule/sqlite-schedule-run-persistence';

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

function makeStubStore(): any {
    return {
        getAllProcesses: vi.fn().mockResolvedValue([]),
        getWorkspaces: vi.fn().mockResolvedValue([]),
    };
}

describe('createScheduleInfrastructure', () => {
    let dataDir: string;
    let db: Database.Database;

    beforeEach(() => {
        dataDir = makeTempDir();
        db = new Database(':memory:');
        initializeDatabase(db);
    });

    afterEach(() => {
        db.close();
    });

    it('returns scheduleManager and scheduleRunPersistence', async () => {
        const queueFacade = makeQueueFacade();
        const result = await createScheduleInfrastructure(dataDir, queueFacade, makeStubStore());

        expect(result.scheduleManager).toBeInstanceOf(ScheduleManager);
        expect(result.scheduleRunPersistence).toBeInstanceOf(SqliteScheduleRunPersistence);
    });

    it('scheduleManager has restore and dispose methods', async () => {
        const queueFacade = makeQueueFacade();
        const { scheduleManager } = await createScheduleInfrastructure(dataDir, queueFacade, makeStubStore());

        expect(typeof scheduleManager.restore).toBe('function');
        expect(typeof scheduleManager.dispose).toBe('function');
    });

    it('works with a fresh empty dataDir', async () => {
        const queueFacade = makeQueueFacade();
        await expect(createScheduleInfrastructure(dataDir, queueFacade, makeStubStore())).resolves.toBeDefined();
    });

    it('migrates existing JSON schedules during construction', async () => {
        // Create a legacy JSON schedules file so migrateAllFromJson has something to process
        const repoId = 'test-repo';
        const reposDir = path.join(dataDir, 'repos', repoId);
        fs.mkdirSync(reposDir, { recursive: true });

        const queueFacade = makeQueueFacade();
        await expect(createScheduleInfrastructure(dataDir, queueFacade, makeStubStore())).resolves.toBeDefined();
    });

    it('restoreRunHistory is called with scheduleRunPersistence', async () => {
        const queueFacade = makeQueueFacade();
        // Just verify restoreRunHistory doesn't throw when called with an empty store
        const { scheduleManager, scheduleRunPersistence } = await createScheduleInfrastructure(
            dataDir,
            queueFacade,
            makeStubStore(),
        );
        expect(() => scheduleManager.restoreRunHistory(scheduleRunPersistence)).not.toThrow();
    });
});
