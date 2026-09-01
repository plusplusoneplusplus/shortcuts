/**
 * Repo schedules derive deterministic IDs from their filename, so two clones
 * that both ship `.github/schedules/daily.yaml` produce the same `repo:daily`
 * ID. Every piece of runtime state — timers, in-flight runs, run history —
 * must therefore be keyed by `(repoId, scheduleId)`.
 *
 * These tests drive two workspaces that share a schedule ID and assert that
 * operating on one never touches the other.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScheduleManager } from '../../src/server/schedule/schedule-manager';
import { ScheduleYamlPersistence } from '../../src/server/schedule/schedule-yaml-persistence';
import { RepoScheduleOverrideStore } from '../../src/server/schedule/repo-schedule-overrides';
import { SqliteScheduleRunPersistence } from '../../src/server/schedule/sqlite-schedule-run-persistence';
import type { ScheduleRunRecord } from '../../src/server/schedule/schedule-manager-types';

const REPO_A = 'ws-clone-a';
const REPO_B = 'ws-clone-b';
/** Both clones ship the same filename, so both derive this ID. */
const SHARED_ID = 'repo:daily';

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-scope-'));
}

function writeSharedSchedule(workspaceRoot: string, cron: string): void {
    const dir = path.join(workspaceRoot, '.github', 'schedules');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'daily.yaml'), `name: Daily\ncron: "${cron}"\ntarget: daily.md\n`, 'utf-8');
}

describe('repo schedule runtime scope isolation', () => {
    let dataDir: string;
    let rootA: string;
    let rootB: string;
    let manager: ScheduleManager;

    beforeEach(() => {
        dataDir = makeTmpDir();
        rootA = makeTmpDir();
        rootB = makeTmpDir();
        manager = new ScheduleManager(
            new ScheduleYamlPersistence(dataDir),
            null,
            new RepoScheduleOverrideStore(dataDir),
        );
    });

    afterEach(() => {
        manager.dispose();
        for (const dir of [dataDir, rootA, rootB]) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('loads the same repo schedule ID independently in both workspaces', async () => {
        writeSharedSchedule(rootA, '0 0 * * *');
        writeSharedSchedule(rootB, '0 0 * * *');

        await manager.registerWorkspacePath(REPO_A, rootA);
        await manager.registerWorkspacePath(REPO_B, rootB);

        expect(manager.getSchedule(REPO_A, SHARED_ID)).toBeDefined();
        expect(manager.getSchedule(REPO_B, SHARED_ID)).toBeDefined();
    });

    it('pausing the shared schedule in A leaves B active and armed', async () => {
        const overrides = new RepoScheduleOverrideStore(dataDir);
        overrides.save(REPO_A, { [SHARED_ID]: { status: 'active' } });
        overrides.save(REPO_B, { [SHARED_ID]: { status: 'active' } });

        vi.useFakeTimers();
        try {
            writeSharedSchedule(rootA, '* * * * *');
            writeSharedSchedule(rootB, '* * * * *');
            await manager.registerWorkspacePath(REPO_A, rootA);
            await manager.registerWorkspacePath(REPO_B, rootB);

            // Pausing A cancels A's timer. If timers were keyed by bare
            // schedule ID this would silently disarm B as well.
            await manager.updateSchedule(REPO_A, SHARED_ID, { status: 'paused' });
            expect(manager.getSchedule(REPO_B, SHARED_ID)!.status).toBe('active');

            await vi.advanceTimersByTimeAsync(61_000);

            expect(manager.getRunHistory(REPO_A, SHARED_ID)).toHaveLength(0);
            expect(manager.getRunHistory(REPO_B, SHARED_ID).length).toBeGreaterThan(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('deleting the shared schedule in A keeps B loaded and running', async () => {
        const overrides = new RepoScheduleOverrideStore(dataDir);
        overrides.save(REPO_B, { [SHARED_ID]: { status: 'active' } });

        vi.useFakeTimers();
        try {
            writeSharedSchedule(rootA, '* * * * *');
            writeSharedSchedule(rootB, '* * * * *');
            await manager.registerWorkspacePath(REPO_A, rootA);
            await manager.registerWorkspacePath(REPO_B, rootB);

            await manager.removeRepoSchedule(REPO_A, SHARED_ID);

            expect(manager.getSchedule(REPO_A, SHARED_ID)).toBeUndefined();
            expect(manager.getSchedule(REPO_B, SHARED_ID)).toBeDefined();

            await vi.advanceTimersByTimeAsync(61_000);
            expect(manager.getRunHistory(REPO_B, SHARED_ID).length).toBeGreaterThan(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('run history for the shared ID does not bleed between workspaces', async () => {
        const overrides = new RepoScheduleOverrideStore(dataDir);
        overrides.save(REPO_A, { [SHARED_ID]: { status: 'active' } });

        vi.useFakeTimers();
        try {
            writeSharedSchedule(rootA, '* * * * *');
            writeSharedSchedule(rootB, '* * * * *');
            await manager.registerWorkspacePath(REPO_A, rootA);
            await manager.registerWorkspacePath(REPO_B, rootB);

            await vi.advanceTimersByTimeAsync(61_000);

            const historyA = manager.getRunHistory(REPO_A, SHARED_ID);
            expect(historyA.length).toBeGreaterThan(0);
            expect(historyA.every(run => run.repoId === REPO_A)).toBe(true);
            // B is paused, so it must have no runs of its own.
            expect(manager.getRunHistory(REPO_B, SHARED_ID)).toHaveLength(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('deleting the shared schedule in A does not drop B\'s run history', async () => {
        const overrides = new RepoScheduleOverrideStore(dataDir);
        overrides.save(REPO_B, { [SHARED_ID]: { status: 'active' } });

        vi.useFakeTimers();
        try {
            writeSharedSchedule(rootA, '* * * * *');
            writeSharedSchedule(rootB, '* * * * *');
            await manager.registerWorkspacePath(REPO_A, rootA);
            await manager.registerWorkspacePath(REPO_B, rootB);

            await vi.advanceTimersByTimeAsync(61_000);
            const before = manager.getRunHistory(REPO_B, SHARED_ID).length;
            expect(before).toBeGreaterThan(0);

            await manager.removeRepoSchedule(REPO_A, SHARED_ID);

            expect(manager.getRunHistory(REPO_B, SHARED_ID)).toHaveLength(before);
        } finally {
            vi.useRealTimers();
        }
    });

    it('restores run history separately per workspace for a shared schedule ID', async () => {
        const Database = (await import('better-sqlite3')).default;
        const { initializeDatabase } = await import('@plusplusoneplusplus/forge');
        const db = new Database(':memory:');
        try {
            initializeDatabase(db);
            const persistence = new SqliteScheduleRunPersistence(db);
            const run = (id: string, repoId: string): ScheduleRunRecord => ({
                id,
                scheduleId: SHARED_ID,
                repoId,
                startedAt: '2026-03-01T09:00:00Z',
                completedAt: '2026-03-01T09:01:00Z',
                status: 'completed',
                durationMs: 60_000,
            });
            persistence.save(REPO_A, [run('run_a', REPO_A)]);
            persistence.save(REPO_B, [run('run_b', REPO_B)]);

            manager.restoreRunHistory(persistence);

            expect(manager.getRunHistory(REPO_A, SHARED_ID).map(r => r.id)).toEqual(['run_a']);
            expect(manager.getRunHistory(REPO_B, SHARED_ID).map(r => r.id)).toEqual(['run_b']);
        } finally {
            db.close();
        }
    });
});
