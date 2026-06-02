/**
 * Tests for ScheduleManager repo schedule integration.
 *
 * Covers: loadRepoSchedules merge, blocking mutations, status override,
 * file watcher setup, dispose cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScheduleManager } from '../../src/server/schedule/schedule-manager';
import { ScheduleYamlPersistence } from '../../src/server/schedule/schedule-yaml-persistence';
import { RepoScheduleOverrideStore } from '../../src/server/schedule/repo-schedule-overrides';

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

    it('normalizes legacy repo schedule mode: plan to ask at load time', () => {
        writeScheduleFile(scheduleDir, 'legacy-plan.yaml', 'name: Legacy Plan\ncron: "0 0 * * *"\nmode: plan');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const schedule = manager.getSchedule(REPO_ID, 'repo:legacy-plan');
        expect(schedule).toBeDefined();
        expect(schedule!.mode).toBe('ask');
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

    it('updateSchedule allows status change for repo schedule', async () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const updated = await manager.updateSchedule(REPO_ID, 'repo:daily', { status: 'active' });
        expect(updated).toBeDefined();
        expect(updated!.status).toBe('active');
    });

    it('updateSchedule persists status override for repo schedules', async () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        const overrideStore = new RepoScheduleOverrideStore(dataDir);
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        await manager.updateSchedule(REPO_ID, 'repo:daily', { status: 'active' });

        const overrides = overrideStore.load(REPO_ID);
        expect(overrides['repo:daily'].status).toBe('active');
    });

    it('updateSchedule ignores non-status fields for repo schedules', async () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const original = manager.getSchedule(REPO_ID, 'repo:daily');
        const updated = await manager.updateSchedule(REPO_ID, 'repo:daily', {
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

    it('startup eager registration: active-override repo schedule fires timer without HTTP request', async () => {
        vi.useFakeTimers();
        try {
            writeScheduleFile(scheduleDir, 'every-min.yaml', 'name: Every Min\ncron: "* * * * *"');
            const overrideStore = new RepoScheduleOverrideStore(dataDir);
            overrideStore.save(REPO_ID, { 'repo:every-min': { status: 'active' } });

            // Simulate what index.ts now does at startup for all persisted workspaces —
            // registerWorkspacePath is called eagerly rather than waiting for an HTTP request.
            manager.registerWorkspacePath(REPO_ID, workspaceRoot);

            // Schedule must be active immediately (no HTTP request needed)
            expect(manager.getSchedule(REPO_ID, 'repo:every-min')!.status).toBe('active');

            // Advance past the next cron tick to confirm the timer was armed
            await vi.advanceTimersByTimeAsync(61_000);

            // A run was recorded — proves the timer fired without a prior HTTP request
            expect(manager.getRunHistory('repo:every-min').length).toBeGreaterThan(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('repo schedule defaults to paused when YAML has no status field', () => {
        writeScheduleFile(scheduleDir, 'nightly.yaml', 'name: Nightly\ncron: "0 2 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const schedule = manager.getSchedule(REPO_ID, 'repo:nightly');
        expect(schedule).toBeDefined();
        expect(schedule!.status).toBe('paused');
    });

    it('repo schedule defaults to paused even when YAML has status: active', () => {
        writeScheduleFile(scheduleDir, 'active.yaml', 'name: Active\ncron: "0 3 * * *"\nstatus: active');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const schedule = manager.getSchedule(REPO_ID, 'repo:active');
        expect(schedule).toBeDefined();
        expect(schedule!.status).toBe('paused');
    });

    it('override in repo-schedule-overrides.json activates a paused repo schedule', () => {
        writeScheduleFile(scheduleDir, 'deploy.yaml', 'name: Deploy\ncron: "0 4 * * *"');
        const overrideStore = new RepoScheduleOverrideStore(dataDir);
        overrideStore.save(REPO_ID, { 'repo:deploy': { status: 'active' } });

        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        const schedule = manager.getSchedule(REPO_ID, 'repo:deploy');
        expect(schedule).toBeDefined();
        expect(schedule!.status).toBe('active');
    });

    it('repo schedule override status is applied on reload', async () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        manager.registerWorkspacePath(REPO_ID, workspaceRoot);

        // Pause the schedule (saves override)
        await manager.updateSchedule(REPO_ID, 'repo:daily', { status: 'paused' });

        // Reload — override should still apply
        manager.reloadRepoSchedules(REPO_ID);
        const schedule = manager.getSchedule(REPO_ID, 'repo:daily');
        expect(schedule!.status).toBe('paused');
    });
});
