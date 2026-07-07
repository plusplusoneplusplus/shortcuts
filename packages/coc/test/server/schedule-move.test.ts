/**
 * Tests for schedule move (drag-and-drop) between user and repo sections.
 *
 * Covers: moveSchedule manager method, slugifyName, and the POST .../move API route.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { slugifyName, ScheduleManager } from '../../src/server/schedule/schedule-manager';
import { ScheduleYamlPersistence } from '../../src/server/schedule/schedule-yaml-persistence';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

const WORKSPACE_ID = 'test-workspace-move';

// ============================================================================
// slugifyName unit tests
// ============================================================================

describe('slugifyName', () => {
    it('converts to lowercase and replaces non-alphanum with hyphens', async () => {
        expect(slugifyName('Daily Cleanup')).toBe('daily-cleanup');
    });

    it('trims leading/trailing hyphens', async () => {
        expect(slugifyName('  --Hello World--  ')).toBe('hello-world');
    });

    it('collapses consecutive non-alphanum chars', async () => {
        expect(slugifyName('test___multiple!!!chars')).toBe('test-multiple-chars');
    });

    it('returns "schedule" for empty/whitespace input', async () => {
        expect(slugifyName('')).toBe('schedule');
        expect(slugifyName('   ')).toBe('schedule');
        expect(slugifyName('---')).toBe('schedule');
    });
});

// ============================================================================
// ScheduleManager.moveSchedule unit tests
// ============================================================================

describe('ScheduleManager.moveSchedule', () => {
    let dataDir: string;
    let workspaceRoot: string;
    let manager: ScheduleManager;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-move-mgr-'));
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-move-ws-'));
        const persistence = new ScheduleYamlPersistence(dataDir);
        manager = new ScheduleManager(persistence);
    });

    afterEach(() => {
        manager.dispose();
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    function writeRepoSchedule(filename: string, content: string): void {
        const dir = path.join(workspaceRoot, '.github', 'schedules');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
    }

    it('moves a user schedule to repo (creates YAML, removes user entry)', async () => {
        const repoId = 'repo1';
        await manager.registerWorkspacePath(repoId, workspaceRoot);

        // Create a user schedule
        const sched = await manager.addSchedule(repoId, {
            name: 'My Schedule',
            target: 'test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });

        const result = await manager.moveSchedule(repoId, sched.id, 'repo');

        // Should now be a repo schedule
        expect(result.source).toBe('repo');
        expect(result.id).toBe('repo:my-schedule');

        // User schedule should be gone
        const allSchedules = manager.getSchedules(repoId);
        const userSchedules = allSchedules.filter(s => s.source !== 'repo');
        expect(userSchedules).toHaveLength(0);

        // YAML file should exist
        const yamlPath = path.join(workspaceRoot, '.github', 'schedules', 'my-schedule.yaml');
        expect(fs.existsSync(yamlPath)).toBe(true);
    });

    it('moves a repo schedule to user (creates user entry, deletes YAML)', async () => {
        const repoId = 'repo1';
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"\ntarget: tasks/daily.md');
        await manager.registerWorkspacePath(repoId, workspaceRoot);

        const result = await manager.moveSchedule(repoId, 'repo:daily', 'user');

        // Should be a user schedule (no source or source='user')
        expect(result.source).toBeUndefined();
        expect(result.id).toMatch(/^sch_/);
        expect(result.name).toBe('Daily');

        // YAML file should be gone
        const yamlPath = path.join(workspaceRoot, '.github', 'schedules', 'daily.yaml');
        expect(fs.existsSync(yamlPath)).toBe(false);
    });

    it('de-duplicates slug when YAML file already exists', async () => {
        const repoId = 'repo1';
        // Pre-create a repo schedule with the same slug
        writeRepoSchedule('my-schedule.yaml', 'name: Existing\ncron: "0 0 * * *"');
        await manager.registerWorkspacePath(repoId, workspaceRoot);

        const sched = await manager.addSchedule(repoId, {
            name: 'My Schedule',
            target: 'test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });

        const result = await manager.moveSchedule(repoId, sched.id, 'repo');
        expect(result.id).toBe('repo:my-schedule-1');
    });

    it('throws when moving user→repo without workspace path', async () => {
        const repoId = 'no-workspace';
        const sched = await manager.addSchedule(repoId, {
            name: 'Test',
            target: 'test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });

        await expect(manager.moveSchedule(repoId, sched.id, 'repo'))
            .rejects.toThrow('Workspace path not available');
    });

    it('throws when moving user schedule to user (already user)', async () => {
        const repoId = 'repo1';
        await manager.registerWorkspacePath(repoId, workspaceRoot);
        const sched = await manager.addSchedule(repoId, {
            name: 'Test',
            target: 'test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });

        await expect(manager.moveSchedule(repoId, sched.id, 'user'))
            .rejects.toThrow('already a user schedule');
    });

    it('throws when moving repo schedule to repo (already repo)', async () => {
        const repoId = 'repo1';
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        await manager.registerWorkspacePath(repoId, workspaceRoot);

        await expect(manager.moveSchedule(repoId, 'repo:daily', 'repo'))
            .rejects.toThrow('already a repo schedule');
    });

    it('moveUserToRepo YAML output does not contain a status field', async () => {
        const repoId = 'repo1';
        await manager.registerWorkspacePath(repoId, workspaceRoot);

        const sched = await manager.addSchedule(repoId, {
            name: 'No Status',
            target: 'test.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
        });

        await manager.moveSchedule(repoId, sched.id, 'repo');

        const yamlPath = path.join(workspaceRoot, '.github', 'schedules', 'no-status.yaml');
        const content = fs.readFileSync(yamlPath, 'utf-8');
        expect(content).not.toMatch(/^status:/m);
    });

    it('strips default outputFolder when moving user schedule to repo', async () => {
        const repoId = 'repo1';
        await manager.registerWorkspacePath(repoId, workspaceRoot);

        const sched = await manager.addSchedule(repoId, {
            name: 'Default Output',
            target: 'task.md',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
            outputFolder: `~/.coc/repos/${repoId}/tasks`,
        });

        await manager.moveSchedule(repoId, sched.id, 'repo');

        const yamlPath = path.join(workspaceRoot, '.github', 'schedules', 'default-output.yaml');
        const content = fs.readFileSync(yamlPath, 'utf-8');
        expect(content).not.toMatch(/outputFolder/);
    });

    it('preserves custom outputFolder when moving user schedule to repo', async () => {
        const repoId = 'repo1';
        await manager.registerWorkspacePath(repoId, workspaceRoot);

        const sched = await manager.addSchedule(repoId, {
            name: 'Custom Output',
            target: 'task.md',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
            outputFolder: '/my/custom/path',
        });

        await manager.moveSchedule(repoId, sched.id, 'repo');

        const yamlPath = path.join(workspaceRoot, '.github', 'schedules', 'custom-output.yaml');
        const content = fs.readFileSync(yamlPath, 'utf-8');
        expect(content).toMatch(/outputFolder: \/my\/custom\/path/);
    });

    it('getWorkspacePath returns registered path', async () => {
        await manager.registerWorkspacePath('r1', '/some/path');
        expect(manager.getWorkspacePath('r1')).toBe('/some/path');
        expect(manager.getWorkspacePath('nonexistent')).toBeUndefined();
    });
});

// ============================================================================
// POST .../move API route tests
// ============================================================================

describe('Schedule Handler — move route', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceRoot: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-move-handler-'));
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-move-ws-handler-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    function writeRepoSchedule(filename: string, content: string): void {
        const dir = path.join(workspaceRoot, '.github', 'schedules');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
    }

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        await store.registerWorkspace({ id: WORKSPACE_ID, rootPath: workspaceRoot, name: 'Test', addedAt: new Date().toISOString() });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    function schedulesUrl(): string {
        return `${server!.url}/api/workspaces/${encodeURIComponent(WORKSPACE_ID)}/schedules`;
    }

    function moveUrl(scheduleId: string): string {
        return `${server!.url}/api/workspaces/${encodeURIComponent(WORKSPACE_ID)}/schedules/${encodeURIComponent(scheduleId)}/move`;
    }

    it('moves user schedule to repo via POST /move', async () => {
        await startServer();

        // Ensure workspace loaded
        await request(schedulesUrl());

        // Create a user schedule
        const createRes = await postJSON(schedulesUrl(), {
            name: 'Movable',
            target: 'test.yaml',
            cron: '0 9 * * *',
            params: {},
        });
        expect(createRes.status).toBe(201);
        const created = JSON.parse(createRes.body).schedule;
        expect(created.source).toBe('user');

        // Move to repo
        const moveRes = await postJSON(moveUrl(created.id), { destination: 'repo' });
        expect(moveRes.status).toBe(200);
        const moved = JSON.parse(moveRes.body).schedule;
        expect(moved.source).toBe('repo');
        expect(moved.id).toBe('repo:movable');

        // Verify YAML exists
        const yamlPath = path.join(workspaceRoot, '.github', 'schedules', 'movable.yaml');
        expect(fs.existsSync(yamlPath)).toBe(true);
    });

    it('moves repo schedule to user via POST /move', async () => {
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"\ntarget: test.md');
        await startServer();

        // Ensure schedules are loaded
        await request(schedulesUrl());

        // Move to user
        const moveRes = await postJSON(moveUrl('repo:daily'), { destination: 'user' });
        expect(moveRes.status).toBe(200);
        const moved = JSON.parse(moveRes.body).schedule;
        expect(moved.source).toBe('user');
        expect(moved.name).toBe('Daily');

        // YAML file should be gone
        const yamlPath = path.join(workspaceRoot, '.github', 'schedules', 'daily.yaml');
        expect(fs.existsSync(yamlPath)).toBe(false);
    });

    it('returns 400 for invalid destination', async () => {
        await startServer();

        const createRes = await postJSON(schedulesUrl(), {
            name: 'Test',
            target: 'test.yaml',
            cron: '0 9 * * *',
            params: {},
        });
        const created = JSON.parse(createRes.body).schedule;

        const moveRes = await postJSON(moveUrl(created.id), { destination: 'invalid' });
        expect(moveRes.status).toBe(400);
        expect(moveRes.body).toContain('Invalid destination');
    });

    it('returns 400 when moving user schedule to user', async () => {
        await startServer();

        // Ensure workspace loaded
        await request(schedulesUrl());

        const createRes = await postJSON(schedulesUrl(), {
            name: 'Test',
            target: 'test.yaml',
            cron: '0 9 * * *',
            params: {},
        });
        const created = JSON.parse(createRes.body).schedule;

        const moveRes = await postJSON(moveUrl(created.id), { destination: 'user' });
        expect(moveRes.status).toBe(400);
        expect(moveRes.body).toContain('already a user schedule');
    });

    it('returns 400 for nonexistent schedule', async () => {
        await startServer();

        // Ensure workspace loaded
        await request(schedulesUrl());

        const moveRes = await postJSON(moveUrl('nonexistent'), { destination: 'repo' });
        expect(moveRes.status).toBe(400);
        expect(moveRes.body).toContain('not found');
    });
});
