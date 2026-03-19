/**
 * Tests for SchedulePersistence
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SchedulePersistence, getRepoScheduleFilePath } from '../src/server/schedule-persistence';
import type { ScheduleEntry } from '../src/server/schedule-manager';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-persist-test-'));
}

function cleanupDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
}

function createSchedule(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
    return {
        id: 'sch_test123',
        name: 'Test Schedule',
        target: 'pipelines/test/pipeline.yaml',
        cron: '0 9 * * *',
        params: {},
        onFailure: 'notify',
        status: 'active',
        createdAt: '2026-02-18T09:00:00Z',
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('SchedulePersistence', () => {
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
        it('persists schedules for a repo and loads them back', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoId = 'abc123def456';
            const schedules = [
                createSchedule({ id: 'sch_1', name: 'Schedule A' }),
                createSchedule({ id: 'sch_2', name: 'Schedule B', status: 'paused' }),
            ];

            persistence.saveRepo(repoId, schedules);

            const loaded = persistence.loadAll();
            expect(loaded.size).toBe(1);
            expect(loaded.has(repoId)).toBe(true);

            const loadedSchedules = loaded.get(repoId)!;
            expect(loadedSchedules).toHaveLength(2);
            expect(loadedSchedules[0].id).toBe('sch_1');
            expect(loadedSchedules[0].name).toBe('Schedule A');
            expect(loadedSchedules[0].status).toBe('active');
            expect(loadedSchedules[1].id).toBe('sch_2');
            expect(loadedSchedules[1].name).toBe('Schedule B');
            expect(loadedSchedules[1].status).toBe('paused');
        });

        it('persists all schedule fields correctly', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoId = 'repo123';
            const schedule = createSchedule({
                params: { env: 'production', region: 'us-west' },
                onFailure: 'stop',
            });

            persistence.saveRepo(repoId, [schedule]);

            const loaded = persistence.loadAll();
            const result = loaded.get(repoId)![0];
            expect(result.target).toBe('pipelines/test/pipeline.yaml');
            expect(result.cron).toBe('0 9 * * *');
            expect(result.params).toEqual({ env: 'production', region: 'us-west' });
            expect(result.onFailure).toBe('stop');
            expect(result.createdAt).toBe('2026-02-18T09:00:00Z');
        });
    });

    // ========================================================================
    // 2. Multiple repos
    // ========================================================================

    describe('multiple repos', () => {
        it('saves and loads schedules for multiple repos independently', () => {
            const persistence = new SchedulePersistence(dataDir);

            persistence.saveRepo('repo-aaa', [createSchedule({ id: 'sch_a', name: 'Repo A Schedule' })]);
            persistence.saveRepo('repo-bbb', [
                createSchedule({ id: 'sch_b1', name: 'Repo B Schedule 1' }),
                createSchedule({ id: 'sch_b2', name: 'Repo B Schedule 2' }),
            ]);

            const loaded = persistence.loadAll();
            expect(loaded.size).toBe(2);
            expect(loaded.get('repo-aaa')!).toHaveLength(1);
            expect(loaded.get('repo-bbb')!).toHaveLength(2);
        });
    });

    // ========================================================================
    // 3. Empty state
    // ========================================================================

    describe('empty state', () => {
        it('returns empty map when no files exist', () => {
            const persistence = new SchedulePersistence(dataDir);
            const loaded = persistence.loadAll();
            expect(loaded.size).toBe(0);
        });

        it('skips repos with empty schedule arrays', () => {
            const persistence = new SchedulePersistence(dataDir);
            persistence.saveRepo('repo-empty', []);
            const loaded = persistence.loadAll();
            expect(loaded.size).toBe(0);
        });
    });

    // ========================================================================
    // 4. Delete repo
    // ========================================================================

    describe('delete repo', () => {
        it('removes the schedule file for a repo', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoId = 'repo-to-delete';
            persistence.saveRepo(repoId, [createSchedule()]);

            // Verify file exists
            const filePath = getRepoScheduleFilePath(dataDir, repoId);
            expect(fs.existsSync(filePath)).toBe(true);

            persistence.deleteRepo(repoId);
            expect(fs.existsSync(filePath)).toBe(false);
        });

        it('handles deleting non-existent repo gracefully', () => {
            const persistence = new SchedulePersistence(dataDir);
            expect(() => persistence.deleteRepo('nonexistent')).not.toThrow();
        });
    });

    // ========================================================================
    // 5. Corrupt file handling
    // ========================================================================

    describe('corrupt file handling', () => {
        it('skips invalid JSON files', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoDir = path.join(dataDir, 'repos', 'corrupt');
            fs.mkdirSync(repoDir, { recursive: true });
            fs.writeFileSync(path.join(repoDir, 'schedules.json'), '{ not valid json !!!', 'utf-8');

            const loaded = persistence.loadAll();
            expect(loaded.size).toBe(0);
        });

        it('skips files with unknown version', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoDir = path.join(dataDir, 'repos', 'unknown');
            fs.mkdirSync(repoDir, { recursive: true });
            fs.writeFileSync(
                path.join(repoDir, 'schedules.json'),
                JSON.stringify({ version: 99, schedules: [createSchedule()] }),
                'utf-8'
            );

            const loaded = persistence.loadAll();
            expect(loaded.size).toBe(0);
        });
    });

    // ========================================================================
    // 6. Atomic write safety
    // ========================================================================

    describe('atomic write safety', () => {
        it('leaves no .tmp file after save', () => {
            const persistence = new SchedulePersistence(dataDir);
            persistence.saveRepo('repo-atomic', [createSchedule()]);

            const repoDir = path.join(dataDir, 'repos', 'repo-atomic');
            const tmpFiles = fs.readdirSync(repoDir).filter(f => f.endsWith('.tmp'));
            expect(tmpFiles).toHaveLength(0);
            const scheduleFiles = fs.readdirSync(repoDir).filter(f => f === 'schedules.json');
            expect(scheduleFiles.length).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // 7. File format correctness
    // ========================================================================

    describe('file format', () => {
        it('saves with correct version and structure', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoId = 'repo-format';
            persistence.saveRepo(repoId, [createSchedule()]);

            const filePath = getRepoScheduleFilePath(dataDir, repoId);
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(raw.version).toBe(3);
            expect(raw.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(raw.repoId).toBe(repoId);
            expect(raw.schedules).toHaveLength(1);
        });
    });

    // ========================================================================
    // 8. Overwrite existing
    // ========================================================================

    describe('overwrite existing', () => {
        it('overwrites previous schedules for the same repo', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoId = 'repo-overwrite';

            persistence.saveRepo(repoId, [createSchedule({ id: 'sch_old', name: 'Old' })]);
            persistence.saveRepo(repoId, [createSchedule({ id: 'sch_new', name: 'New' })]);

            const loaded = persistence.loadAll();
            const schedules = loaded.get(repoId)!;
            expect(schedules).toHaveLength(1);
            expect(schedules[0].name).toBe('New');
        });
    });

    // ========================================================================
    // 9. Directory creation
    // ========================================================================

    describe('directory creation', () => {
        it('does not eagerly create directories in constructor', () => {
            const freshDir = createTempDir();
            const reposDir = path.join(freshDir, 'repos');
            expect(fs.existsSync(reposDir)).toBe(false);

            new SchedulePersistence(freshDir);
            expect(fs.existsSync(reposDir)).toBe(false);

            cleanupDir(freshDir);
        });

        it('creates repo directory on first saveRepo call', () => {
            const freshDir = createTempDir();
            const persistence = new SchedulePersistence(freshDir);
            persistence.saveRepo('new-repo', [createSchedule()]);

            const repoDir = path.join(freshDir, 'repos', 'new-repo');
            expect(fs.existsSync(repoDir)).toBe(true);
            expect(fs.existsSync(path.join(repoDir, 'schedules.json'))).toBe(true);

            cleanupDir(freshDir);
        });
    });

    // ========================================================================
    // 10. Version migration
    // ========================================================================

    describe('version migration', () => {
        it('loads v1 files and back-fills targetType: prompt on all entries', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoDir = path.join(dataDir, 'repos', 'repo-v1');
            fs.mkdirSync(repoDir, { recursive: true });
            const v1State = {
                version: 1,
                savedAt: '2026-01-01T00:00:00Z',
                repoId: 'repo-v1',
                schedules: [
                    createSchedule({ id: 'sch_a', name: 'Old A' }),
                    createSchedule({ id: 'sch_b', name: 'Old B' }),
                ],
            };
            fs.writeFileSync(
                path.join(repoDir, 'schedules.json'),
                JSON.stringify(v1State),
                'utf-8'
            );

            const loaded = persistence.loadAll();
            expect(loaded.has('repo-v1')).toBe(true);
            const schedules = loaded.get('repo-v1')!;
            expect(schedules).toHaveLength(2);
            expect(schedules[0].targetType).toBe('prompt');
            expect(schedules[1].targetType).toBe('prompt');
        });

        it('loads v1 files and back-fills mode: autopilot on all entries', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoDir = path.join(dataDir, 'repos', 'repo-v1-mode');
            fs.mkdirSync(repoDir, { recursive: true });
            const v1State = {
                version: 1,
                savedAt: '2026-01-01T00:00:00Z',
                repoId: 'repo-v1-mode',
                schedules: [
                    createSchedule({ id: 'sch_a', name: 'Old A' }),
                ],
            };
            fs.writeFileSync(
                path.join(repoDir, 'schedules.json'),
                JSON.stringify(v1State),
                'utf-8'
            );

            const loaded = persistence.loadAll();
            const schedules = loaded.get('repo-v1-mode')!;
            expect(schedules[0].mode).toBe('autopilot');
        });

        it('loads v2 files and back-fills mode: autopilot on all entries', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoDir = path.join(dataDir, 'repos', 'repo-v2-mode');
            fs.mkdirSync(repoDir, { recursive: true });
            const v2State = {
                version: 2,
                savedAt: '2026-01-01T00:00:00Z',
                repoId: 'repo-v2-mode',
                schedules: [
                    createSchedule({ id: 'sch_c', name: 'Script', targetType: 'script' as any }),
                    createSchedule({ id: 'sch_d', name: 'Prompt' }),
                ],
            };
            fs.writeFileSync(
                path.join(repoDir, 'schedules.json'),
                JSON.stringify(v2State),
                'utf-8'
            );

            const loaded = persistence.loadAll();
            expect(loaded.has('repo-v2-mode')).toBe(true);
            const schedules = loaded.get('repo-v2-mode')!;
            expect(schedules[0].mode).toBe('autopilot');
            expect(schedules[1].mode).toBe('autopilot');
        });

        it('does not overwrite existing mode field during v2 migration', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoDir = path.join(dataDir, 'repos', 'repo-v2-existing-mode');
            fs.mkdirSync(repoDir, { recursive: true });
            const v2State = {
                version: 2,
                savedAt: '2026-01-01T00:00:00Z',
                repoId: 'repo-v2-existing-mode',
                schedules: [
                    { ...createSchedule({ id: 'sch_e', name: 'Already Has Mode' }), mode: 'ask' },
                ],
            };
            fs.writeFileSync(
                path.join(repoDir, 'schedules.json'),
                JSON.stringify(v2State),
                'utf-8'
            );

            const loaded = persistence.loadAll();
            const schedules = loaded.get('repo-v2-existing-mode')!;
            expect(schedules[0].mode).toBe('ask');
        });

        it('skips files with unknown future version (e.g. 99)', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoDir = path.join(dataDir, 'repos', 'future');
            fs.mkdirSync(repoDir, { recursive: true });
            fs.writeFileSync(
                path.join(repoDir, 'schedules.json'),
                JSON.stringify({ version: 99, repoId: 'repo-future', schedules: [createSchedule()] }),
                'utf-8'
            );

            const loaded = persistence.loadAll();
            expect(loaded.has('repo-future')).toBe(false);
        });
    });

    // ========================================================================
    // 11. mode field round-trip
    // ========================================================================

    describe('mode field round-trip', () => {
        it('saves and loads mode: ask correctly', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoId = 'repo-mode-roundtrip';
            const schedule = createSchedule({ mode: 'ask' as any });
            persistence.saveRepo(repoId, [schedule]);

            const loaded = persistence.loadAll();
            expect(loaded.get(repoId)![0].mode).toBe('ask');
        });

        it('saves and loads mode: plan correctly', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoId = 'repo-mode-plan';
            const schedule = createSchedule({ mode: 'plan' as any });
            persistence.saveRepo(repoId, [schedule]);

            const loaded = persistence.loadAll();
            expect(loaded.get(repoId)![0].mode).toBe('plan');
        });

        it('saves with version 3', () => {
            const persistence = new SchedulePersistence(dataDir);
            const repoId = 'repo-v3-format';
            persistence.saveRepo(repoId, [createSchedule()]);

            const filePath = getRepoScheduleFilePath(dataDir, repoId);
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(raw.version).toBe(3);
        });
    });
});
