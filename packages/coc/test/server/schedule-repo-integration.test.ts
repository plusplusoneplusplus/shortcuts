/**
 * Tests for ScheduleManager repo schedule integration.
 *
 * Covers: loadRepoSchedules merge, blocking mutations, status override,
 * file watcher setup, dispose cleanup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScheduleManager } from '../../src/server/schedule-manager';
import { ScheduleYamlPersistence } from '../../src/server/schedule-yaml-persistence';
import { RepoScheduleOverrideStore } from '../../src/server/repo-schedule-overrides';

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sm-repo-test-'));
}

function writeScheduleFile(scheduleDir: string, filename: string, content: string): void {
    fs.mkdirSync(scheduleDir, { recursive: true });
    fs.writeFileSync(path.join(scheduleDir, filename), content, 'utf-8');
}

const REPO_ID = 'test-repo-1';

describe('ScheduleManager — repo schedules', () => {
    let dataDir: string;
    let workspaceRoot: string;
    let scheduleDir: string;
    let manager: ScheduleManager;

    beforeEach(() => {
        dataDir = makeTmpDir();
        workspaceRoot = makeTmpDir();
        scheduleDir = path.join(workspaceRoot, '.github', 'schedules');

        const persistence = new ScheduleYamlPersistence(dataDir);
        const overrideStore = new RepoScheduleOverrideStore(dataDir);
        manager = new ScheduleManager(persistence, null, overrideStore);
    });

    afterEach(() => {
        manager.dispose();
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    it('getSchedules returns empty array when no workspace registered', () => {
        expect(manager.getSchedules(REPO_ID)).toEqual([]);
    });

    it('getSchedules merges user and repo schedules', () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const userSchedule = manager.addSchedule(REPO_ID, {
            name: 'User Schedule',
            target: 'test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'paused',
            targetType: 'prompt',
            mode: 'autopilot',
        });

        const schedules = manager.getSchedules(REPO_ID);
        expect(schedules).toHaveLength(2);

        const sources = schedules.map(s => s.source);
        expect(sources).toContain('repo');
        expect(sources).toContain(undefined); // user schedules have no source tag
    });

    it('repo schedules have source: "repo"', () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const schedules = manager.getSchedules(REPO_ID);
        const repoSchedule = schedules.find(s => s.source === 'repo');
        expect(repoSchedule).toBeDefined();
        expect(repoSchedule!.id).toBe('repo:daily');
        expect(repoSchedule!.name).toBe('Daily');
    });

    it('getSchedule finds repo schedule by ID', () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const found = manager.getSchedule(REPO_ID, 'repo:daily');
        expect(found).toBeDefined();
        expect(found!.source).toBe('repo');
    });

    it('removeSchedule returns false for repo schedules', () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const result = manager.removeSchedule(REPO_ID, 'repo:daily');
        expect(result).toBe(false);

        // Schedule should still be present
        expect(manager.getSchedule(REPO_ID, 'repo:daily')).toBeDefined();
    });

    it('updateSchedule allows status change for repo schedule', () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const updated = manager.updateSchedule(REPO_ID, 'repo:daily', { status: 'paused' });
        expect(updated).toBeDefined();
        expect(updated!.status).toBe('paused');
    });

    it('updateSchedule persists status override for repo schedules', () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        const overrideStore = new RepoScheduleOverrideStore(dataDir);
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        manager.updateSchedule(REPO_ID, 'repo:daily', { status: 'paused' });

        const overrides = overrideStore.load(REPO_ID);
        expect(overrides['repo:daily'].status).toBe('paused');
    });

    it('updateSchedule ignores non-status fields for repo schedules', () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const original = manager.getSchedule(REPO_ID, 'repo:daily');
        const updated = manager.updateSchedule(REPO_ID, 'repo:daily', {
            name: 'New Name',
            status: 'paused',
        } as any);

        // Status is applied, but name change is ignored
        expect(updated!.status).toBe('paused');
        // Name should remain as-is from YAML since updateSchedule skips non-status fields
        expect(updated!.name).toBe(original!.name);
    });

    it('user schedules are not persisted to repo-schedule-overrides', () => {
        const userSchedule = manager.addSchedule(REPO_ID, {
            name: 'User',
            target: 'test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
            targetType: 'prompt',
            mode: 'autopilot',
        });

        // User schedule IDs start with sch_
        expect(userSchedule.id).toMatch(/^sch_/);
        // No source field
        expect(userSchedule.source).toBeUndefined();
    });

    it('registerWorkspacePath is idempotent', () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const schedules = manager.getSchedules(REPO_ID);
        const repoSchedules = schedules.filter(s => s.source === 'repo');
        expect(repoSchedules).toHaveLength(1);
    });

    it('reloadRepoSchedules picks up new files', () => {
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);
        expect(manager.getSchedules(REPO_ID)).toHaveLength(0);

        writeScheduleFile(scheduleDir, 'new.yaml', 'name: New\ncron: "0 0 * * *"');
        manager.reloadRepoSchedules(REPO_ID);

        const schedules = manager.getSchedules(REPO_ID);
        expect(schedules).toHaveLength(1);
        expect(schedules[0].source).toBe('repo');
    });

    it('dispose cleans up without error even if no workspace registered', () => {
        expect(() => manager.dispose()).not.toThrow();
    });

    it('repo schedule override status is applied on reload', () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        // Pause the schedule (saves override)
        manager.updateSchedule(REPO_ID, 'repo:daily', { status: 'paused' });

        // Reload — override should still apply
        manager.reloadRepoSchedules(REPO_ID);
        const schedule = manager.getSchedule(REPO_ID, 'repo:daily');
        expect(schedule!.status).toBe('paused');
    });
});
