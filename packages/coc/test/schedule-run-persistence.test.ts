/**
 * Tests for SqliteScheduleRunPersistence
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { SqliteScheduleRunPersistence } from '../src/server/sqlite-schedule-run-persistence';
import type { ScheduleRunRecord } from '../src/server/schedule-manager';

// ============================================================================
// Helpers
// ============================================================================

function createDb(): Database.Database {
    const db = new Database(':memory:');
    initializeDatabase(db);
    return db;
}

function createRun(overrides: Partial<ScheduleRunRecord> = {}): ScheduleRunRecord {
    return {
        id: 'run_test001',
        scheduleId: 'sch_test123',
        repoId: 'repo_abc',
        startedAt: '2026-03-01T09:00:00Z',
        status: 'completed',
        completedAt: '2026-03-01T09:01:00Z',
        durationMs: 60000,
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('SqliteScheduleRunPersistence', () => {
    let db: Database.Database;

    beforeEach(() => {
        db = createDb();
    });

    afterEach(() => {
        db.close();
    });

    // ========================================================================
    // 1. Save and load round-trip
    // ========================================================================

    describe('save and load round-trip', () => {
        it('saves runs and loads them back via loadAll grouped by scheduleId', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            const run1 = createRun({ id: 'run_1', scheduleId: 'sch_a' });
            const run2 = createRun({ id: 'run_2', scheduleId: 'sch_b' });

            persistence.save('repo_abc', [run1, run2]);

            const loaded = persistence.loadAll();
            expect(loaded.has('sch_a')).toBe(true);
            expect(loaded.has('sch_b')).toBe(true);
            expect(loaded.get('sch_a')![0].id).toBe('run_1');
            expect(loaded.get('sch_b')![0].id).toBe('run_2');
        });

        it('preserves all fields on round-trip', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            const run = createRun({
                id: 'run_full',
                processId: 'queue_task123',
                taskId: 'task123',
                error: 'some error',
            });

            persistence.save('repo_abc', [run]);

            const loaded = persistence.loadAll();
            const restored = loaded.get('sch_test123')![0];
            expect(restored.processId).toBe('queue_task123');
            expect(restored.taskId).toBe('task123');
            expect(restored.error).toBe('some error');
            expect(restored.durationMs).toBe(60000);
        });

        it('load() returns runs for specific repo', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            const run = createRun({ id: 'run_x', repoId: 'repo_x' });
            persistence.save('repo_x', [run]);

            const runs = persistence.load('repo_x');
            expect(runs).toHaveLength(1);
            expect(runs[0].id).toBe('run_x');
        });

        it('load() returns [] for missing repo', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            expect(persistence.load('nonexistent')).toEqual([]);
        });
    });

    // ========================================================================
    // 2. Multiple repos
    // ========================================================================

    describe('multiple repos', () => {
        it('stores runs for different repos in the same table', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            const runA = createRun({ id: 'run_a', repoId: 'repo_a', scheduleId: 'sch_1' });
            const runB = createRun({ id: 'run_b', repoId: 'repo_b', scheduleId: 'sch_2' });

            persistence.save('repo_a', [runA]);
            persistence.save('repo_b', [runB]);

            const loaded = persistence.loadAll();
            expect(loaded.get('sch_1')![0].id).toBe('run_a');
            expect(loaded.get('sch_2')![0].id).toBe('run_b');
        });
    });

    // ========================================================================
    // 3. Trimming logic
    // ========================================================================

    describe('trimming', () => {
        it('trims terminal entries beyond maxRuns via save()', () => {
            const persistence = new SqliteScheduleRunPersistence(db, 5);
            const runs: ScheduleRunRecord[] = [];
            for (let i = 0; i < 7; i++) {
                runs.push(createRun({
                    id: `run_${i}`,
                    startedAt: `2026-03-0${i + 1}T09:00:00Z`,
                    status: 'completed',
                }));
            }

            persistence.save('repo_abc', runs);

            const loaded = persistence.load('repo_abc');
            expect(loaded.length).toBeLessThanOrEqual(5);
        });

        it('protects running entries from trimming', () => {
            const persistence = new SqliteScheduleRunPersistence(db, 3);
            const runs: ScheduleRunRecord[] = [
                createRun({ id: 'run_running', status: 'running', startedAt: '2026-03-01T09:00:00Z' }),
                createRun({ id: 'run_c1', status: 'completed', startedAt: '2026-02-01T09:00:00Z' }),
                createRun({ id: 'run_c2', status: 'completed', startedAt: '2026-02-02T09:00:00Z' }),
                createRun({ id: 'run_c3', status: 'completed', startedAt: '2026-02-03T09:00:00Z' }),
            ];

            persistence.save('repo_abc', runs);

            const loaded = persistence.load('repo_abc');
            expect(loaded.length).toBeLessThanOrEqual(3);
            expect(loaded.some(r => r.id === 'run_running')).toBe(true);
        });

        it('protects missed entries from trimming', () => {
            const persistence = new SqliteScheduleRunPersistence(db, 3);
            const runs: ScheduleRunRecord[] = [
                createRun({ id: 'run_missed', status: 'missed', startedAt: '2026-03-01T09:00:00Z' }),
                createRun({ id: 'run_c1', status: 'completed', startedAt: '2026-02-01T09:00:00Z' }),
                createRun({ id: 'run_c2', status: 'completed', startedAt: '2026-02-02T09:00:00Z' }),
                createRun({ id: 'run_c3', status: 'completed', startedAt: '2026-02-03T09:00:00Z' }),
            ];

            persistence.save('repo_abc', runs);

            const loaded = persistence.load('repo_abc');
            expect(loaded.length).toBeLessThanOrEqual(3);
            expect(loaded.some(r => r.id === 'run_missed')).toBe(true);
        });

        it('keeps newest terminal entries when trimming', () => {
            const persistence = new SqliteScheduleRunPersistence(db, 2);
            const runs: ScheduleRunRecord[] = [
                createRun({ id: 'run_old', status: 'completed', startedAt: '2026-01-01T09:00:00Z' }),
                createRun({ id: 'run_new', status: 'completed', startedAt: '2026-03-01T09:00:00Z' }),
                createRun({ id: 'run_mid', status: 'completed', startedAt: '2026-02-01T09:00:00Z' }),
            ];

            persistence.save('repo_abc', runs);

            const loaded = persistence.load('repo_abc');
            expect(loaded).toHaveLength(2);
            expect(loaded.some(r => r.id === 'run_new')).toBe(true);
            expect(loaded.some(r => r.id === 'run_mid')).toBe(true);
            expect(loaded.some(r => r.id === 'run_old')).toBe(false);
        });

        it('trim() removes old terminal entries after upserts', () => {
            const persistence = new SqliteScheduleRunPersistence(db, 3);
            // Insert 5 runs via upsert
            for (let i = 0; i < 5; i++) {
                persistence.upsert(createRun({
                    id: `run_${i}`,
                    startedAt: `2026-03-0${i + 1}T09:00:00Z`,
                    status: 'completed',
                }));
            }
            expect(persistence.load('repo_abc').length).toBe(5);

            persistence.trim('repo_abc');

            const loaded = persistence.load('repo_abc');
            expect(loaded.length).toBe(3);
        });
    });

    // ========================================================================
    // 4. Upsert
    // ========================================================================

    describe('upsert', () => {
        it('inserts a new record', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            const run = createRun();
            persistence.upsert(run);

            const loaded = persistence.load('repo_abc');
            expect(loaded).toHaveLength(1);
            expect(loaded[0].id).toBe('run_test001');
        });

        it('updates an existing record', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            const run = createRun({ status: 'running' });
            persistence.upsert(run);

            run.status = 'completed';
            run.completedAt = '2026-03-01T09:02:00Z';
            persistence.upsert(run);

            const loaded = persistence.load('repo_abc');
            expect(loaded).toHaveLength(1);
            expect(loaded[0].status).toBe('completed');
            expect(loaded[0].completedAt).toBe('2026-03-01T09:02:00Z');
        });

        it('handles optional fields as null', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            const run: ScheduleRunRecord = {
                id: 'run_minimal',
                scheduleId: 'sch_1',
                repoId: 'repo_abc',
                startedAt: '2026-03-01T09:00:00Z',
                status: 'running',
            };
            persistence.upsert(run);

            const loaded = persistence.load('repo_abc');
            expect(loaded).toHaveLength(1);
            expect(loaded[0].completedAt).toBeUndefined();
            expect(loaded[0].error).toBeUndefined();
            expect(loaded[0].durationMs).toBeUndefined();
            expect(loaded[0].processId).toBeUndefined();
            expect(loaded[0].taskId).toBeUndefined();
        });
    });

    // ========================================================================
    // 5. Empty state
    // ========================================================================

    describe('empty state', () => {
        it('loadAll returns empty map when no rows exist', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            expect(persistence.loadAll().size).toBe(0);
        });

        it('save with empty runs array results in no rows', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            persistence.save('repo_empty', []);
            const loaded = persistence.load('repo_empty');
            expect(loaded).toEqual([]);
        });
    });

    // ========================================================================
    // 6. Delete repo
    // ========================================================================

    describe('deleteRepo', () => {
        it('removes all run history for a repo', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            persistence.save('repo_del', [createRun({ repoId: 'repo_del' })]);

            expect(persistence.load('repo_del')).toHaveLength(1);

            persistence.deleteRepo('repo_del');
            expect(persistence.load('repo_del')).toEqual([]);
        });

        it('handles deleting non-existent repo gracefully', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            expect(() => persistence.deleteRepo('nonexistent')).not.toThrow();
        });

        it('does not affect other repos', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            persistence.save('repo_a', [createRun({ id: 'r1', repoId: 'repo_a' })]);
            persistence.save('repo_b', [createRun({ id: 'r2', repoId: 'repo_b' })]);

            persistence.deleteRepo('repo_a');

            expect(persistence.load('repo_a')).toEqual([]);
            expect(persistence.load('repo_b')).toHaveLength(1);
        });
    });

    // ========================================================================
    // 7. Count and deleteAll
    // ========================================================================

    describe('count and deleteAll', () => {
        it('count returns the total number of rows', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            persistence.upsert(createRun({ id: 'r1' }));
            persistence.upsert(createRun({ id: 'r2' }));
            expect(persistence.count()).toBe(2);
        });

        it('deleteAll removes all rows', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            persistence.upsert(createRun({ id: 'r1' }));
            persistence.upsert(createRun({ id: 'r2' }));
            persistence.deleteAll();
            expect(persistence.count()).toBe(0);
        });
    });

    // ========================================================================
    // 8. No eager side effects
    // ========================================================================

    describe('constructor', () => {
        it('does not write data on construction', () => {
            const persistence = new SqliteScheduleRunPersistence(db);
            expect(persistence.count()).toBe(0);
        });
    });
});
