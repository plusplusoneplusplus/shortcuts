/**
 * Tests for ScheduleRunPersistence
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScheduleRunPersistence } from '../src/server/schedule-run-persistence';
import type { ScheduleRunRecord } from '../src/server/schedule-manager';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-run-persist-test-'));
}

function cleanupDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
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

describe('ScheduleRunPersistence', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = createTempDir();
    });

    afterEach(() => {
        cleanupDir(dataDir);
    });

    // ========================================================================
    // 1. Save and load round-trip
    // ========================================================================

    describe('save and load round-trip', () => {
        it('saves runs and loads them back via loadAll grouped by scheduleId', () => {
            const persistence = new ScheduleRunPersistence(dataDir);
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
            const persistence = new ScheduleRunPersistence(dataDir);
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
            const persistence = new ScheduleRunPersistence(dataDir);
            const run = createRun({ id: 'run_x', repoId: 'repo_x' });
            persistence.save('repo_x', [run]);

            const runs = persistence.load('repo_x');
            expect(runs).toHaveLength(1);
            expect(runs[0].id).toBe('run_x');
        });

        it('load() returns [] for missing repo', () => {
            const persistence = new ScheduleRunPersistence(dataDir);
            expect(persistence.load('nonexistent')).toEqual([]);
        });
    });

    // ========================================================================
    // 2. Multiple repos
    // ========================================================================

    describe('multiple repos', () => {
        it('stores runs for different repos in separate files', () => {
            const persistence = new ScheduleRunPersistence(dataDir);
            const runA = createRun({ id: 'run_a', repoId: 'repo_a', scheduleId: 'sch_1' });
            const runB = createRun({ id: 'run_b', repoId: 'repo_b', scheduleId: 'sch_2' });

            persistence.save('repo_a', [runA]);
            persistence.save('repo_b', [runB]);

            const schedulesDir = path.join(dataDir, 'schedules');
            const runFiles = fs.readdirSync(schedulesDir).filter(f => f.startsWith('runs-'));
            expect(runFiles).toHaveLength(2);

            const loaded = persistence.loadAll();
            expect(loaded.get('sch_1')![0].id).toBe('run_a');
            expect(loaded.get('sch_2')![0].id).toBe('run_b');
        });
    });

    // ========================================================================
    // 3. Trimming logic
    // ========================================================================

    describe('trimming', () => {
        it('trims terminal entries beyond maxRuns', () => {
            const persistence = new ScheduleRunPersistence(dataDir, 5);
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
            const persistence = new ScheduleRunPersistence(dataDir, 3);
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
            const persistence = new ScheduleRunPersistence(dataDir, 3);
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
            const persistence = new ScheduleRunPersistence(dataDir, 2);
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
    });

    // ========================================================================
    // 4. Empty state
    // ========================================================================

    describe('empty state', () => {
        it('loadAll returns empty map when no files exist', () => {
            const persistence = new ScheduleRunPersistence(dataDir);
            expect(persistence.loadAll().size).toBe(0);
        });

        it('save with empty runs array produces file with empty runs', () => {
            const persistence = new ScheduleRunPersistence(dataDir);
            persistence.save('repo_empty', []);
            const loaded = persistence.load('repo_empty');
            expect(loaded).toEqual([]);
        });
    });

    // ========================================================================
    // 5. Delete repo
    // ========================================================================

    describe('deleteRepo', () => {
        it('removes the run history file for a repo', () => {
            const persistence = new ScheduleRunPersistence(dataDir);
            persistence.save('repo_del', [createRun()]);

            const filePath = path.join(dataDir, 'schedules', 'runs-repo_del.json');
            expect(fs.existsSync(filePath)).toBe(true);

            persistence.deleteRepo('repo_del');
            expect(fs.existsSync(filePath)).toBe(false);
        });

        it('handles deleting non-existent repo gracefully', () => {
            const persistence = new ScheduleRunPersistence(dataDir);
            expect(() => persistence.deleteRepo('nonexistent')).not.toThrow();
        });
    });

    // ========================================================================
    // 6. Corrupt file handling
    // ========================================================================

    describe('corrupt file handling', () => {
        it('returns [] for corrupt JSON on load()', () => {
            const persistence = new ScheduleRunPersistence(dataDir);
            const schedulesDir = path.join(dataDir, 'schedules');
            fs.writeFileSync(path.join(schedulesDir, 'runs-corrupt.json'), '{ not valid !!!', 'utf-8');

            expect(persistence.load('corrupt')).toEqual([]);
        });

        it('skips corrupt files in loadAll()', () => {
            const persistence = new ScheduleRunPersistence(dataDir);
            const schedulesDir = path.join(dataDir, 'schedules');
            fs.writeFileSync(path.join(schedulesDir, 'runs-corrupt2.json'), '{ broken', 'utf-8');
            persistence.save('repo_good', [createRun({ id: 'run_good', scheduleId: 'sch_good' })]);

            const loaded = persistence.loadAll();
            expect(loaded.has('sch_good')).toBe(true);
        });
    });

    // ========================================================================
    // 7. Atomic write safety
    // ========================================================================

    describe('atomic write safety', () => {
        it('leaves no .tmp file after save', () => {
            const persistence = new ScheduleRunPersistence(dataDir);
            persistence.save('repo_atomic', [createRun()]);

            const schedulesDir = path.join(dataDir, 'schedules');
            const tmpFiles = fs.readdirSync(schedulesDir).filter(f => f.endsWith('.tmp'));
            expect(tmpFiles).toHaveLength(0);
        });
    });

    // ========================================================================
    // 8. File format
    // ========================================================================

    describe('file format', () => {
        it('saves with version 1 and correct structure', () => {
            const persistence = new ScheduleRunPersistence(dataDir);
            persistence.save('repo_fmt', [createRun()]);

            const filePath = path.join(dataDir, 'schedules', 'runs-repo_fmt.json');
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(raw.version).toBe(1);
            expect(raw.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(raw.repoId).toBe('repo_fmt');
            expect(Array.isArray(raw.runs)).toBe(true);
        });
    });

    // ========================================================================
    // 9. Directory creation
    // ========================================================================

    describe('directory creation', () => {
        it('creates schedules directory if it does not exist', () => {
            const freshDir = createTempDir();
            const schedulesDir = path.join(freshDir, 'schedules');
            expect(fs.existsSync(schedulesDir)).toBe(false);

            const persistence = new ScheduleRunPersistence(freshDir);
            expect(fs.existsSync(schedulesDir)).toBe(true);

            cleanupDir(freshDir);
        });
    });
});
