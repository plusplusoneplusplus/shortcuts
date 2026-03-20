/**
 * Tests for ScheduleYamlPersistence
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import {
    ScheduleYamlPersistence,
    getScheduleYamlDir,
    getScheduleYamlPath,
} from '../src/server/schedule-yaml-persistence';
import type { ScheduleEntry } from '../src/server/schedule-manager';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-yaml-persist-test-'));
}

function cleanupDir(dir: string): void {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
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

describe('ScheduleYamlPersistence', () => {
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
        it('saveSchedule + loadRepoSchedules returns same entry', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'abc123';
            const entry = createSchedule({ id: 'sch_aa1' });

            persistence.saveSchedule(repoId, entry);
            const loaded = persistence.loadRepoSchedules(repoId);

            expect(loaded).toHaveLength(1);
            expect(loaded[0]).toEqual(entry);
        });

        it('saveRepo + loadAll returns all entries', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
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
            expect(loadedSchedules[1].id).toBe('sch_2');
            expect(loadedSchedules[1].status).toBe('paused');
        });
    });

    // ========================================================================
    // 2. File naming
    // ========================================================================

    describe('file naming', () => {
        it('YAML file is named <id>.yaml', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-naming';
            const entry = createSchedule({ id: 'sch_abc' });

            persistence.saveSchedule(repoId, entry);

            const expectedPath = getScheduleYamlPath(dataDir, repoId, 'sch_abc');
            expect(fs.existsSync(expectedPath)).toBe(true);
            expect(path.basename(expectedPath)).toBe('sch_abc.yaml');
        });

        it('getScheduleYamlPath returns expected path', () => {
            const result = getScheduleYamlPath(dataDir, 'my-repo', 'sch_123');
            const expected = path.join(dataDir, 'repos', 'my-repo', 'schedules', 'sch_123.yaml');
            expect(result).toBe(expected);
        });
    });

    // ========================================================================
    // 3. YAML file content
    // ========================================================================

    describe('YAML file content', () => {
        it('writes valid YAML with all ScheduleEntry fields', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-content';
            const entry = createSchedule({ id: 'sch_content' });

            persistence.saveSchedule(repoId, entry);

            const filePath = getScheduleYamlPath(dataDir, repoId, 'sch_content');
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = yaml.load(raw) as ScheduleEntry;

            expect(parsed.id).toBe('sch_content');
            expect(parsed.name).toBe('Test Schedule');
            expect(parsed.target).toBe('pipelines/test/pipeline.yaml');
            expect(parsed.cron).toBe('0 9 * * *');
            expect(parsed.onFailure).toBe('notify');
            expect(parsed.status).toBe('active');
            expect(parsed.createdAt).toBe('2026-02-18T09:00:00Z');
        });
    });

    // ========================================================================
    // 4. Multiple repos
    // ========================================================================

    describe('multiple repos', () => {
        it('saves and loads schedules for multiple repos independently', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);

            persistence.saveRepo('repo-aaa', [createSchedule({ id: 'sch_a', name: 'Repo A' })]);
            persistence.saveRepo('repo-bbb', [
                createSchedule({ id: 'sch_b1', name: 'Repo B 1' }),
                createSchedule({ id: 'sch_b2', name: 'Repo B 2' }),
            ]);

            const loaded = persistence.loadAll();
            expect(loaded.size).toBe(2);
            expect(loaded.get('repo-aaa')!).toHaveLength(1);
            expect(loaded.get('repo-bbb')!).toHaveLength(2);
        });
    });

    // ========================================================================
    // 5. Multiple schedules per repo
    // ========================================================================

    describe('multiple schedules per repo', () => {
        it('saves three entries, verifies three .yaml files and loadRepoSchedules returns all', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-multi';

            persistence.saveRepo(repoId, [
                createSchedule({ id: 'sch_x1', name: 'X1' }),
                createSchedule({ id: 'sch_x2', name: 'X2' }),
                createSchedule({ id: 'sch_x3', name: 'X3' }),
            ]);

            const dir = getScheduleYamlDir(dataDir, repoId);
            const yamlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
            expect(yamlFiles).toHaveLength(3);

            const loaded = persistence.loadRepoSchedules(repoId);
            expect(loaded).toHaveLength(3);
        });
    });

    // ========================================================================
    // 6. Empty state
    // ========================================================================

    describe('empty state', () => {
        it('loadAll on fresh dataDir returns empty map', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const loaded = persistence.loadAll();
            expect(loaded.size).toBe(0);
        });

        it('loadRepoSchedules on missing dir returns []', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const result = persistence.loadRepoSchedules('nonexistent-repo');
            expect(result).toEqual([]);
        });
    });

    // ========================================================================
    // 7. Empty schedules list
    // ========================================================================

    describe('empty schedules list', () => {
        it('saveRepo(repoId, []) removes all files', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-empty';

            persistence.saveRepo(repoId, [createSchedule({ id: 'sch_del' })]);
            persistence.saveRepo(repoId, []);

            const dir = getScheduleYamlDir(dataDir, repoId);
            const yamlFiles = fs.existsSync(dir)
                ? fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))
                : [];
            expect(yamlFiles).toHaveLength(0);
        });
    });

    // ========================================================================
    // 8. deleteSchedule
    // ========================================================================

    describe('deleteSchedule', () => {
        it('removes file; loadRepoSchedules returns empty', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-del-single';
            const entry = createSchedule({ id: 'sch_gone' });

            persistence.saveSchedule(repoId, entry);
            expect(persistence.loadRepoSchedules(repoId)).toHaveLength(1);

            persistence.deleteSchedule(repoId, 'sch_gone');

            const filePath = getScheduleYamlPath(dataDir, repoId, 'sch_gone');
            expect(fs.existsSync(filePath)).toBe(false);
            expect(persistence.loadRepoSchedules(repoId)).toHaveLength(0);
        });
    });

    // ========================================================================
    // 9. deleteRepo
    // ========================================================================

    describe('deleteRepo', () => {
        it('removes all YAML files', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-del-all';

            persistence.saveRepo(repoId, [
                createSchedule({ id: 'sch_r1' }),
                createSchedule({ id: 'sch_r2' }),
                createSchedule({ id: 'sch_r3' }),
            ]);

            persistence.deleteRepo(repoId);

            const dir = getScheduleYamlDir(dataDir, repoId);
            const yamlFiles = fs.existsSync(dir)
                ? fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))
                : [];
            expect(yamlFiles).toHaveLength(0);
        });
    });

    // ========================================================================
    // 10. Orphan cleanup in saveRepo
    // ========================================================================

    describe('orphan cleanup in saveRepo', () => {
        it('saves A+B then saveRepo with only B; only B.yaml remains', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-orphan';
            const schedA = createSchedule({ id: 'sch_orphan_a', name: 'A' });
            const schedB = createSchedule({ id: 'sch_orphan_b', name: 'B' });

            persistence.saveRepo(repoId, [schedA, schedB]);
            persistence.saveRepo(repoId, [schedB]);

            const dir = getScheduleYamlDir(dataDir, repoId);
            const yamlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
            expect(yamlFiles).toHaveLength(1);
            expect(yamlFiles[0]).toBe('sch_orphan_b.yaml');
        });
    });

    // ========================================================================
    // 11. Corrupt file handling
    // ========================================================================

    describe('corrupt file handling', () => {
        it('skips invalid YAML and returns other valid entries', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-corrupt';

            // Save a valid entry
            persistence.saveSchedule(repoId, createSchedule({ id: 'sch_valid', name: 'Valid' }));

            // Write a corrupt file directly
            const dir = getScheduleYamlDir(dataDir, repoId);
            fs.writeFileSync(path.join(dir, 'sch_corrupt.yaml'), ': invalid: yaml: [[[', 'utf-8');

            const loaded = persistence.loadRepoSchedules(repoId);
            expect(loaded).toHaveLength(1);
            expect(loaded[0].id).toBe('sch_valid');
        });
    });

    // ========================================================================
    // 12. id mismatch guard
    // ========================================================================

    describe('id mismatch guard', () => {
        it('skips file where entry.id does not match filename stem', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-mismatch';

            // Write a file named sch_foo.yaml but entry.id = sch_bar
            const dir = getScheduleYamlDir(dataDir, repoId);
            fs.mkdirSync(dir, { recursive: true });
            const mismatchEntry = createSchedule({ id: 'sch_bar', name: 'Mismatch' });
            fs.writeFileSync(
                path.join(dir, 'sch_foo.yaml'),
                yaml.dump(mismatchEntry),
                'utf-8'
            );

            const loaded = persistence.loadRepoSchedules(repoId);
            expect(loaded).toHaveLength(0);
        });
    });

    // ========================================================================
    // 13. Atomic write safety
    // ========================================================================

    describe('atomic write safety', () => {
        it('leaves no .tmp file after saveSchedule', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-atomic';

            persistence.saveSchedule(repoId, createSchedule({ id: 'sch_atomic' }));

            const dir = getScheduleYamlDir(dataDir, repoId);
            const tmpFiles = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
            expect(tmpFiles).toHaveLength(0);
        });
    });

    // ========================================================================
    // 14. All ScheduleEntry fields round-trip
    // ========================================================================

    describe('all ScheduleEntry fields round-trip', () => {
        it('persists all optional fields correctly', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-full';
            const entry = createSchedule({
                id: 'sch_full',
                targetType: 'script' as any,
                mode: 'ask' as any,
                outputFolder: '/tmp/out',
                model: 'gpt-4o',
                params: { env: 'prod', region: 'us-west' },
            });

            persistence.saveSchedule(repoId, entry);
            const loaded = persistence.loadRepoSchedules(repoId);

            expect(loaded).toHaveLength(1);
            expect(loaded[0]).toEqual(entry);
            expect(loaded[0].targetType).toBe('script');
            expect(loaded[0].mode).toBe('ask');
            expect(loaded[0].outputFolder).toBe('/tmp/out');
            expect(loaded[0].model).toBe('gpt-4o');
            expect(loaded[0].params).toEqual({ env: 'prod', region: 'us-west' });
        });
    });

    // ========================================================================
    // 15. Does not eagerly create directories
    // ========================================================================

    describe('does not eagerly create directories', () => {
        it('new ScheduleYamlPersistence does not create repos/ directory', () => {
            const freshDir = createTempDir();
            const reposDir = path.join(freshDir, 'repos');
            expect(fs.existsSync(reposDir)).toBe(false);

            new ScheduleYamlPersistence(freshDir);
            expect(fs.existsSync(reposDir)).toBe(false);

            cleanupDir(freshDir);
        });
    });

    // ========================================================================
    // 16. getScheduleYamlPath helper
    // ========================================================================

    describe('getScheduleYamlPath helper', () => {
        it('returns <dataDir>/repos/<repoId>/schedules/<id>.yaml', () => {
            const result = getScheduleYamlPath('/base', 'my-repo', 'sch_999');
            const expected = path.join('/base', 'repos', 'my-repo', 'schedules', 'sch_999.yaml');
            expect(result).toBe(expected);
        });
    });

    // ========================================================================
    // 17. deleteSchedule on non-existent id
    // ========================================================================

    describe('deleteSchedule on non-existent id', () => {
        it('does not throw', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            expect(() => persistence.deleteSchedule('nonexistent-repo', 'sch_ghost')).not.toThrow();
        });
    });

    // ========================================================================
    // 18. deleteRepo on non-existent repo
    // ========================================================================

    describe('deleteRepo on non-existent repo', () => {
        it('does not throw', () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            expect(() => persistence.deleteRepo('nonexistent-repo')).not.toThrow();
        });
    });
});
