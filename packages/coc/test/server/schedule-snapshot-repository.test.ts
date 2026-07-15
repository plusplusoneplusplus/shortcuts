/**
 * ScheduleSnapshotRepository Tests
 *
 * Direct coverage for the schedule-owned snapshot repository: collecting and
 * restoring per-repo `schedules/*.yaml` files plus `schedule_runs` SQLite rows,
 * and wiping both. Covers file-only, row-only, and mixed snapshots.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { FileProcessStore, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { ScheduleSnapshotRepository } from '../../src/server/schedule/schedule-snapshot-repository';
import type { ScheduleSnapshot } from '../../src/server/storage/export-import-types';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-snap-repo-test-'));
}

function writeYaml(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, yaml.dump(data), 'utf-8');
}

function writeJSON(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function insertScheduleRun(
    store: SqliteProcessStore,
    row: { id: string; scheduleId: string; repoId: string; startedAt?: string; status?: string; taskId?: string },
): void {
    store.getDatabase()
        .prepare('INSERT INTO schedule_runs (id, schedule_id, repo_id, started_at, completed_at, status, error, duration_ms, process_id, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(row.id, row.scheduleId, row.repoId, row.startedAt ?? '2024-01-01T00:00:00Z', null, row.status ?? 'completed', null, null, null, row.taskId ?? null);
}

// ============================================================================
// Tests
// ============================================================================

describe('ScheduleSnapshotRepository', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    let repo: ScheduleSnapshotRepository;

    beforeEach(() => {
        dataDir = createTempDir();
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        repo = new ScheduleSnapshotRepository();
    });

    afterEach(() => {
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    describe('collect', () => {
        it('collects file-only snapshots and resolves repoRootPath from queues.json', () => {
            writeYaml(path.join(dataDir, 'repos', 'repo-a', 'schedules', 's1.yaml'), { id: 's1', cron: '* * * * *' });
            writeJSON(path.join(dataDir, 'repos', 'repo-a', 'queues.json'), {
                version: 3, repoRootPath: '/projects/repo-a', repoId: 'repo-a', pending: [], history: [],
            });

            const { snapshots, warnings } = repo.collect(dataDir, store);

            expect(warnings).toEqual([]);
            expect(snapshots).toHaveLength(1);
            expect(snapshots[0].repoId).toBe('repo-a');
            expect(snapshots[0].repoRootPath).toBe('/projects/repo-a');
            expect(snapshots[0].schedules).toHaveLength(1);
            expect(snapshots[0].scheduleRuns).toHaveLength(0);
        });

        it('collects row-only snapshots for repos with only schedule_runs rows', () => {
            insertScheduleRun(store, { id: 'run-1', scheduleId: 's9', repoId: 'repo-rows' });

            const { snapshots } = repo.collect(dataDir, store);

            expect(snapshots).toHaveLength(1);
            expect(snapshots[0].repoId).toBe('repo-rows');
            expect(snapshots[0].schedules).toHaveLength(0);
            expect(snapshots[0].scheduleRuns).toHaveLength(1);
            expect((snapshots[0].scheduleRuns[0] as { id: string }).id).toBe('run-1');
        });

        it('collects mixed file + row snapshots and warns on corrupt YAML', () => {
            writeYaml(path.join(dataDir, 'repos', 'repo-mix', 'schedules', 'good.yaml'), { id: 'good' });
            fs.writeFileSync(path.join(dataDir, 'repos', 'repo-mix', 'schedules', 'bad.yaml'), 'this: : : not valid: [', 'utf-8');
            insertScheduleRun(store, { id: 'run-2', scheduleId: 'good', repoId: 'repo-mix' });

            const { snapshots, warnings } = repo.collect(dataDir, store);

            expect(snapshots).toHaveLength(1);
            expect(snapshots[0].schedules).toHaveLength(1);
            expect(snapshots[0].scheduleRuns).toHaveLength(1);
            expect(warnings.some(w => w.includes('Skipped schedule file') && w.includes('bad.yaml'))).toBe(true);
        });

        it('ignores schedule_runs for non-SQLite stores without throwing', () => {
            const fileStore = new FileProcessStore({ dataDir });
            writeYaml(path.join(dataDir, 'repos', 'repo-a', 'schedules', 's1.yaml'), { id: 's1' });

            const { snapshots } = repo.collect(dataDir, fileStore);

            expect(snapshots).toHaveLength(1);
            expect(snapshots[0].scheduleRuns).toHaveLength(0);
        });
    });

    describe('writeReplace / writeMerge', () => {
        const snapshot: ScheduleSnapshot = {
            repoId: 'repo-w',
            repoRootPath: '/projects/repo-w',
            schedules: [{ id: 's1', cron: '0 * * * *' }, { id: 's2' }],
            scheduleRuns: [{ id: 'r1', scheduleId: 's1', repoId: 'repo-w', startedAt: '2024-01-01T00:00:00Z', status: 'completed' }],
        };

        it('writeReplace writes every schedule YAML and run row', () => {
            const errors: string[] = [];
            const written = repo.writeReplace(dataDir, store, [snapshot], errors);

            expect(errors).toEqual([]);
            expect(written).toBe(1);
            expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-w', 'schedules', 's1.yaml'))).toBe(true);
            expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-w', 'schedules', 's2.yaml'))).toBe(true);
            expect(repo.countScheduleRuns(store)).toBe(1);
        });

        it('writeMerge keeps existing schedule files and only adds new ids', () => {
            writeYaml(path.join(dataDir, 'repos', 'repo-w', 'schedules', 's1.yaml'), { id: 's1', cron: 'EXISTING' });
            const errors: string[] = [];

            const written = repo.writeMerge(dataDir, store, [snapshot], errors);

            expect(errors).toEqual([]);
            expect(written).toBe(1);
            // Existing s1 is preserved (not overwritten), new s2 is added.
            const s1 = yaml.load(fs.readFileSync(path.join(dataDir, 'repos', 'repo-w', 'schedules', 's1.yaml'), 'utf-8')) as { cron: string };
            expect(s1.cron).toBe('EXISTING');
            expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-w', 'schedules', 's2.yaml'))).toBe(true);
        });

        it('skips snapshots without a repoId', () => {
            const errors: string[] = [];
            const written = repo.writeReplace(dataDir, store, [{ ...snapshot, repoId: '' }], errors);
            expect(written).toBe(0);
            expect(errors).toEqual([]);
        });
    });

    describe('planWipe / executeWipe', () => {
        it('lists then deletes schedule files and directories', () => {
            writeYaml(path.join(dataDir, 'repos', 'repo-a', 'schedules', 's1.yaml'), { id: 's1' });
            writeYaml(path.join(dataDir, 'repos', 'repo-b', 'schedules', 's2.yaml'), { id: 's2' });

            const plan = repo.planWipe(dataDir);
            expect(plan.scheduleFiles).toHaveLength(2);
            expect(plan.scheduleDirs).toHaveLength(2);

            const errors: string[] = [];
            repo.executeWipe(plan, errors);

            expect(errors).toEqual([]);
            expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-a', 'schedules'))).toBe(false);
            expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-b', 'schedules'))).toBe(false);
        });

        it('executeWipe tolerates an undefined plan', () => {
            const errors: string[] = [];
            expect(() => repo.executeWipe(undefined, errors)).not.toThrow();
            expect(errors).toEqual([]);
        });
    });

    describe('schedule_runs row helpers', () => {
        it('counts and deletes schedule_runs rows', () => {
            insertScheduleRun(store, { id: 'r1', scheduleId: 's1', repoId: 'repo-a' });
            insertScheduleRun(store, { id: 'r2', scheduleId: 's1', repoId: 'repo-a' });

            expect(repo.countScheduleRuns(store)).toBe(2);
            repo.deleteScheduleRuns(store);
            expect(repo.countScheduleRuns(store)).toBe(0);
        });

        it('returns 0 and is a no-op for non-SQLite stores', () => {
            const fileStore = new FileProcessStore({ dataDir });
            expect(repo.countScheduleRuns(fileStore)).toBe(0);
            expect(() => repo.deleteScheduleRuns(fileStore)).not.toThrow();
        });
    });
});
