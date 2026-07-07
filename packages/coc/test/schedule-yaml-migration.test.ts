/**
 * Tests for ScheduleYamlPersistence.migrateAllFromJson()
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScheduleYamlPersistence } from '../src/server/schedule/schedule-yaml-persistence';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-yaml-migration-test-'));
}

function cleanupDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
}

function writeSchedulesJson(dataDir: string, repoId: string, state: object): void {
    const repoDir = path.join(dataDir, 'repos', repoId);
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'schedules.json'), JSON.stringify(state), 'utf-8');
}

function makeEntry(id: string, extra: object = {}): object {
    return {
        id,
        name: `Schedule ${id}`,
        target: 'pipelines/test.yaml',
        cron: '0 9 * * *',
        params: {},
        onFailure: 'notify',
        status: 'active',
        createdAt: new Date().toISOString(),
        ...extra,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('ScheduleYamlPersistence.migrateAllFromJson', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = createTempDir();
    });

    afterEach(() => {
        cleanupDir(dataDir);
    });

    it('migrates a v3 schedules.json to YAML files', async () => {
        writeSchedulesJson(dataDir, 'repo-a', {
            version: 3,
            savedAt: new Date().toISOString(),
            repoId: 'repo-a',
            schedules: [makeEntry('sch_001'), makeEntry('sch_002')],
        });

        await new ScheduleYamlPersistence(dataDir).migrateAllFromJson();

        const schedDir = path.join(dataDir, 'repos', 'repo-a', 'schedules');
        expect(fs.existsSync(schedDir)).toBe(true);
        const yamlFiles = fs.readdirSync(schedDir).filter(f => f.endsWith('.yaml'));
        expect(yamlFiles).toHaveLength(2);

        // schedules.json removed
        expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-a', 'schedules.json'))).toBe(false);

        // loadAll() returns the same two entries
        const loaded = await new ScheduleYamlPersistence(dataDir).loadAll();
        expect(loaded.get('repo-a')).toHaveLength(2);
    });

    it('migrates a v1 schedules.json and back-fills targetType + mode', async () => {
        const entry = makeEntry('sch_v1');
        // v1 entries have no targetType or mode
        delete (entry as any).targetType;
        delete (entry as any).mode;

        writeSchedulesJson(dataDir, 'repo-v1', {
            version: 1,
            savedAt: new Date().toISOString(),
            repoId: 'repo-v1',
            schedules: [entry],
        });

        await new ScheduleYamlPersistence(dataDir).migrateAllFromJson();

        const loaded = await new ScheduleYamlPersistence(dataDir).loadAll();
        const entries = loaded.get('repo-v1');
        expect(entries).toHaveLength(1);
        expect(entries![0].targetType).toBe('prompt');
        expect(entries![0].mode).toBe('autopilot');
    });

    it('migrates a v2 schedules.json and back-fills mode', async () => {
        const entry = makeEntry('sch_v2', { targetType: 'prompt' });
        delete (entry as any).mode;

        writeSchedulesJson(dataDir, 'repo-v2', {
            version: 2,
            savedAt: new Date().toISOString(),
            repoId: 'repo-v2',
            schedules: [entry],
        });

        await new ScheduleYamlPersistence(dataDir).migrateAllFromJson();

        const loaded = await new ScheduleYamlPersistence(dataDir).loadAll();
        const entries = loaded.get('repo-v2');
        expect(entries).toHaveLength(1);
        expect(entries![0].mode).toBe('autopilot');
    });

    it('migration is idempotent (safe to run twice)', async () => {
        const state = {
            version: 3,
            savedAt: new Date().toISOString(),
            repoId: 'repo-idem',
            schedules: [makeEntry('sch_idem')],
        };

        // First run
        writeSchedulesJson(dataDir, 'repo-idem', state);
        await new ScheduleYamlPersistence(dataDir).migrateAllFromJson();

        // Simulate retry: write JSON again
        writeSchedulesJson(dataDir, 'repo-idem', state);
        await new ScheduleYamlPersistence(dataDir).migrateAllFromJson();

        const loaded = await new ScheduleYamlPersistence(dataDir).loadAll();
        expect(loaded.get('repo-idem')).toHaveLength(1);
    });

    it('only deletes schedules.json after all YAML writes succeed', async () => {
        writeSchedulesJson(dataDir, 'repo-b', {
            version: 3,
            savedAt: new Date().toISOString(),
            repoId: 'repo-b',
            schedules: [makeEntry('sch_b1')],
        });

        await new ScheduleYamlPersistence(dataDir).migrateAllFromJson();

        // schedules.json is gone after success
        expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-b', 'schedules.json'))).toBe(false);

        // YAML file written
        const schedDir = path.join(dataDir, 'repos', 'repo-b', 'schedules');
        expect(fs.readdirSync(schedDir).filter(f => f.endsWith('.yaml'))).toHaveLength(1);
    });

    it('skips repos with no schedules.json', async () => {
        // Create repo with a YAML file already (no schedules.json)
        const schedDir = path.join(dataDir, 'repos', 'repo-yaml-only', 'schedules');
        fs.mkdirSync(schedDir, { recursive: true });
        const entry = makeEntry('sch_existing');
        const yaml = `id: sch_existing\nname: "Schedule sch_existing"\ntarget: pipelines/test.yaml\ncron: "0 9 * * *"\nparams: {}\nonFailure: notify\nstatus: active\ncreatedAt: "2024-01-01T00:00:00.000Z"\n`;
        fs.writeFileSync(path.join(schedDir, 'sch_existing.yaml'), yaml, 'utf-8');

        // Should not reject
        await expect(new ScheduleYamlPersistence(dataDir).migrateAllFromJson()).resolves.toBeUndefined();

        // Existing YAML unchanged
        expect(fs.existsSync(path.join(schedDir, 'sch_existing.yaml'))).toBe(true);
    });

    it('handles corrupt schedules.json gracefully', async () => {
        const repoDir = path.join(dataDir, 'repos', 'repo-corrupt');
        fs.mkdirSync(repoDir, { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'schedules.json'), '{ not valid json }', 'utf-8');

        // Should not reject
        await expect(new ScheduleYamlPersistence(dataDir).migrateAllFromJson()).resolves.toBeUndefined();

        // schedules.json still present (not deleted on failure)
        expect(fs.existsSync(path.join(repoDir, 'schedules.json'))).toBe(true);
    });

    it('skips schedules.json with unknown version', async () => {
        writeSchedulesJson(dataDir, 'repo-future', {
            version: 99,
            savedAt: new Date().toISOString(),
            repoId: 'repo-future',
            schedules: [makeEntry('sch_future')],
        });

        await expect(new ScheduleYamlPersistence(dataDir).migrateAllFromJson()).resolves.toBeUndefined();

        // schedules.json still present
        expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-future', 'schedules.json'))).toBe(true);

        // No YAML files written
        const schedDir = path.join(dataDir, 'repos', 'repo-future', 'schedules');
        expect(fs.existsSync(schedDir)).toBe(false);
    });

    it('handles multiple repos in one pass', async () => {
        writeSchedulesJson(dataDir, 'repo-x', {
            version: 3,
            savedAt: new Date().toISOString(),
            repoId: 'repo-x',
            schedules: [makeEntry('sch_x1'), makeEntry('sch_x2')],
        });
        writeSchedulesJson(dataDir, 'repo-y', {
            version: 3,
            savedAt: new Date().toISOString(),
            repoId: 'repo-y',
            schedules: [makeEntry('sch_y1')],
        });

        await new ScheduleYamlPersistence(dataDir).migrateAllFromJson();

        // Both repos migrated
        expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-x', 'schedules.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-y', 'schedules.json'))).toBe(false);

        const loaded = await new ScheduleYamlPersistence(dataDir).loadAll();
        expect(loaded.get('repo-x')).toHaveLength(2);
        expect(loaded.get('repo-y')).toHaveLength(1);
    });
});
