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
} from '../src/server/schedule/schedule-yaml-persistence';
import type { ScheduleEntry } from '../src/server/schedule/schedule-manager';

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
        it('saveSchedule + loadRepoSchedules returns same entry', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'abc123';
            const entry = createSchedule({ id: 'sch_aa1' });

            await persistence.saveSchedule(repoId, entry);
            const loaded = await persistence.loadRepoSchedules(repoId);

            expect(loaded).toHaveLength(1);
            expect(loaded[0]).toEqual(entry);
        });

        it('saveRepo + loadAll returns all entries', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'abc123def456';
            const schedules = [
                createSchedule({ id: 'sch_1', name: 'Schedule A' }),
                createSchedule({ id: 'sch_2', name: 'Schedule B', status: 'paused' }),
            ];

            await persistence.saveRepo(repoId, schedules);

            const loaded = await persistence.loadAll();
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
        it('YAML file is named <id>.yaml', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-naming';
            const entry = createSchedule({ id: 'sch_abc' });

            await persistence.saveSchedule(repoId, entry);

            const expectedPath = getScheduleYamlPath(dataDir, repoId, 'sch_abc');
            expect(fs.existsSync(expectedPath)).toBe(true);
            expect(path.basename(expectedPath)).toBe('sch_abc.yaml');
        });

        it('getScheduleYamlPath returns expected path', async () => {
            const result = getScheduleYamlPath(dataDir, 'my-repo', 'sch_123');
            const expected = path.join(dataDir, 'repos', 'my-repo', 'schedules', 'sch_123.yaml');
            expect(result).toBe(expected);
        });
    });

    // ========================================================================
    // 3. YAML file content
    // ========================================================================

    describe('YAML file content', () => {
        it('writes valid YAML with all ScheduleEntry fields', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-content';
            const entry = createSchedule({ id: 'sch_content' });

            await persistence.saveSchedule(repoId, entry);

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
        it('saves and loads schedules for multiple repos independently', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);

            await persistence.saveRepo('repo-aaa', [createSchedule({ id: 'sch_a', name: 'Repo A' })]);
            await persistence.saveRepo('repo-bbb', [
                createSchedule({ id: 'sch_b1', name: 'Repo B 1' }),
                createSchedule({ id: 'sch_b2', name: 'Repo B 2' }),
            ]);

            const loaded = await persistence.loadAll();
            expect(loaded.size).toBe(2);
            expect(loaded.get('repo-aaa')!).toHaveLength(1);
            expect(loaded.get('repo-bbb')!).toHaveLength(2);
        });
    });

    // ========================================================================
    // 5. Multiple schedules per repo
    // ========================================================================

    describe('multiple schedules per repo', () => {
        it('saves three entries, verifies three .yaml files and loadRepoSchedules returns all', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-multi';

            await persistence.saveRepo(repoId, [
                createSchedule({ id: 'sch_x1', name: 'X1' }),
                createSchedule({ id: 'sch_x2', name: 'X2' }),
                createSchedule({ id: 'sch_x3', name: 'X3' }),
            ]);

            const dir = getScheduleYamlDir(dataDir, repoId);
            const yamlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
            expect(yamlFiles).toHaveLength(3);

            const loaded = await persistence.loadRepoSchedules(repoId);
            expect(loaded).toHaveLength(3);
        });
    });

    // ========================================================================
    // 6. Empty state
    // ========================================================================

    describe('empty state', () => {
        it('loadAll on fresh dataDir returns empty map', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const loaded = await persistence.loadAll();
            expect(loaded.size).toBe(0);
        });

        it('loadRepoSchedules on missing dir returns []', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const result = await persistence.loadRepoSchedules('nonexistent-repo');
            expect(result).toEqual([]);
        });
    });

    // ========================================================================
    // 7. Empty schedules list
    // ========================================================================

    describe('empty schedules list', () => {
        it('saveRepo(repoId, []) removes all files', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-empty';

            await persistence.saveRepo(repoId, [createSchedule({ id: 'sch_del' })]);
            await persistence.saveRepo(repoId, []);

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
        it('removes file; loadRepoSchedules returns empty', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-del-single';
            const entry = createSchedule({ id: 'sch_gone' });

            await persistence.saveSchedule(repoId, entry);
            expect(await persistence.loadRepoSchedules(repoId)).toHaveLength(1);

            await persistence.deleteSchedule(repoId, 'sch_gone');

            const filePath = getScheduleYamlPath(dataDir, repoId, 'sch_gone');
            expect(fs.existsSync(filePath)).toBe(false);
            expect(await persistence.loadRepoSchedules(repoId)).toHaveLength(0);
        });
    });

    // ========================================================================
    // 9. deleteRepo
    // ========================================================================

    describe('deleteRepo', () => {
        it('removes all YAML files', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-del-all';

            await persistence.saveRepo(repoId, [
                createSchedule({ id: 'sch_r1' }),
                createSchedule({ id: 'sch_r2' }),
                createSchedule({ id: 'sch_r3' }),
            ]);

            await persistence.deleteRepo(repoId);

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
        it('saves A+B then saveRepo with only B; only B.yaml remains', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-orphan';
            const schedA = createSchedule({ id: 'sch_orphan_a', name: 'A' });
            const schedB = createSchedule({ id: 'sch_orphan_b', name: 'B' });

            await persistence.saveRepo(repoId, [schedA, schedB]);
            await persistence.saveRepo(repoId, [schedB]);

            const dir = getScheduleYamlDir(dataDir, repoId);
            const yamlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
            expect(yamlFiles).toHaveLength(1);
            expect(yamlFiles[0]).toBe('sch_orphan_b.yaml');
        });

        it('serializes concurrent saveRepo calls for the same repo', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-serialized';
            const schedA = createSchedule({ id: 'sch_serial_a', name: 'A' });
            const schedB = createSchedule({ id: 'sch_serial_b', name: 'B' });

            await Promise.all([
                persistence.saveRepo(repoId, [schedA]),
                persistence.saveRepo(repoId, [schedB]),
            ]);

            const loaded = await persistence.loadRepoSchedules(repoId);
            expect(loaded).toHaveLength(1);
            expect(loaded[0].id).toBe('sch_serial_b');
        });
    });

    // ========================================================================
    // 11. Corrupt file handling
    // ========================================================================

    describe('corrupt file handling', () => {
        it('skips invalid YAML and returns other valid entries', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-corrupt';

            // Save a valid entry
            await persistence.saveSchedule(repoId, createSchedule({ id: 'sch_valid', name: 'Valid' }));

            // Write a corrupt file directly
            const dir = getScheduleYamlDir(dataDir, repoId);
            fs.writeFileSync(path.join(dir, 'sch_corrupt.yaml'), ': invalid: yaml: [[[', 'utf-8');

            const loaded = await persistence.loadRepoSchedules(repoId);
            expect(loaded).toHaveLength(1);
            expect(loaded[0].id).toBe('sch_valid');
        });
    });

    // ========================================================================
    // 12. id mismatch guard
    // ========================================================================

    describe('id mismatch guard', () => {
        it('skips file where entry.id does not match filename stem', async () => {
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

            const loaded = await persistence.loadRepoSchedules(repoId);
            expect(loaded).toHaveLength(0);
        });
    });

    // ========================================================================
    // 13. Atomic write safety
    // ========================================================================

    describe('atomic write safety', () => {
        it('leaves no .tmp file after saveSchedule', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            const repoId = 'repo-atomic';

            await persistence.saveSchedule(repoId, createSchedule({ id: 'sch_atomic' }));

            const dir = getScheduleYamlDir(dataDir, repoId);
            const tmpFiles = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
            expect(tmpFiles).toHaveLength(0);
        });
    });

    // ========================================================================
    // 14. All ScheduleEntry fields round-trip
    // ========================================================================

    describe('all ScheduleEntry fields round-trip', () => {
        it('persists all optional fields correctly', async () => {
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

            await persistence.saveSchedule(repoId, entry);
            const loaded = await persistence.loadRepoSchedules(repoId);

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
        it('new ScheduleYamlPersistence does not create repos/ directory', async () => {
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
        it('returns <dataDir>/repos/<repoId>/schedules/<id>.yaml', async () => {
            const result = getScheduleYamlPath('/base', 'my-repo', 'sch_999');
            const expected = path.join('/base', 'repos', 'my-repo', 'schedules', 'sch_999.yaml');
            expect(result).toBe(expected);
        });
    });

    // ========================================================================
    // 17. deleteSchedule on non-existent id
    // ========================================================================

    describe('deleteSchedule on non-existent id', () => {
        it('does not throw', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            await expect(persistence.deleteSchedule('nonexistent-repo', 'sch_ghost')).resolves.toBeUndefined();
        });
    });

    // ========================================================================
    // 18. deleteRepo on non-existent repo
    // ========================================================================

    describe('deleteRepo on non-existent repo', () => {
        it('does not throw', async () => {
            const persistence = new ScheduleYamlPersistence(dataDir);
            await expect(persistence.deleteRepo('nonexistent-repo')).resolves.toBeUndefined();
        });
    });
});
