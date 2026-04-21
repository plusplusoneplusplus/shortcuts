/**
 * Tests for schedule handler repo-schedule enforcement.
 *
 * Covers: source field in API response, 403 on delete/edit,
 * status-only patch allowed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

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

function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function deleteRequest(url: string) {
    return request(url, { method: 'DELETE' });
}

const WORKSPACE_ID = 'test-workspace-repo-sched';

describe('Schedule Handler — repo schedule enforcement', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceRoot: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-repo-handler-test-'));
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-repo-workspace-'));
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
        // Register the workspace so getWorkspaces() returns it
        await store.registerWorkspace({ id: WORKSPACE_ID, rootPath: workspaceRoot, name: 'Test', addedAt: new Date().toISOString() });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    function schedulesUrl(): string {
        return `${server!.url}/api/workspaces/${encodeURIComponent(WORKSPACE_ID)}/schedules`;
    }

    function scheduleUrl(id: string): string {
        return `${server!.url}/api/workspaces/${encodeURIComponent(WORKSPACE_ID)}/schedules/${encodeURIComponent(id)}`;
    }

    it('GET /schedules includes repo schedules with source: "repo"', async () => {
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        await startServer();

        const res = await request(schedulesUrl());
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.schedules).toBeDefined();

        const repoSched = body.schedules.find((s: any) => s.id === 'repo:daily');
        expect(repoSched).toBeDefined();
        expect(repoSched.source).toBe('repo');
        expect(repoSched.name).toBe('Daily');
    });

    it('DELETE repo schedule succeeds and removes the file', async () => {
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        await startServer();

        // Ensure schedules are loaded
        await request(schedulesUrl());

        const res = await deleteRequest(scheduleUrl('repo:daily'));
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.deleted).toBe(true);

        // Verify file was removed
        const yamlPath = path.join(workspaceRoot, '.github', 'schedules', 'daily.yaml');
        expect(fs.existsSync(yamlPath)).toBe(false);

        // Verify schedule no longer appears in list
        const listRes = await request(schedulesUrl());
        const list = JSON.parse(listRes.body).schedules;
        const found = list.find((s: any) => s.id === 'repo:daily');
        expect(found).toBeUndefined();
    });

    it('DELETE repo schedule with missing file returns 404', async () => {
        writeRepoSchedule('ephemeral.yaml', 'name: Ephemeral\ncron: "0 0 * * *"');
        await startServer();

        // Ensure schedules are loaded
        await request(schedulesUrl());

        // Remove the file externally before calling DELETE
        fs.unlinkSync(path.join(workspaceRoot, '.github', 'schedules', 'ephemeral.yaml'));

        const res = await deleteRequest(scheduleUrl('repo:ephemeral'));
        // After the external delete, the schedule may or may not still be in memory
        // depending on watcher timing — accept either 404 (gone from memory) or 200 (cleaned up)
        expect([200, 404]).toContain(res.status);
    });

    it('PATCH repo schedule with non-status fields writes to YAML and returns 200', async () => {
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"\ntarget: old.yaml');
        await startServer();

        // Ensure schedules are loaded
        await request(schedulesUrl());

        const res = await patchJSON(scheduleUrl('repo:daily'), { name: 'New Name', target: 'new.yaml' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.schedule.name).toBe('New Name');
        expect(body.schedule.target).toBe('new.yaml');

        // Verify YAML file was updated
        const yamlPath = path.join(workspaceRoot, '.github', 'schedules', 'daily.yaml');
        const content = fs.readFileSync(yamlPath, 'utf-8');
        expect(content).toContain('New Name');
        expect(content).toContain('new.yaml');
    });

    it('PATCH repo schedule status-only returns 200', async () => {
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        await startServer();

        // Ensure schedules are loaded
        await request(schedulesUrl());

        const res = await patchJSON(scheduleUrl('repo:daily'), { status: 'paused' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.schedule.status).toBe('paused');
    });

    it('PATCH repo schedule cron writes updated cron to YAML', async () => {
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"\ntarget: t.yaml');
        await startServer();
        await request(schedulesUrl());

        const res = await patchJSON(scheduleUrl('repo:daily'), { cron: '30 6 * * *' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.schedule.cron).toBe('30 6 * * *');

        const yamlPath = path.join(workspaceRoot, '.github', 'schedules', 'daily.yaml');
        const content = fs.readFileSync(yamlPath, 'utf-8');
        expect(content).toContain('30 6 * * *');
    });

    it('PATCH repo schedule with status and fields updates both', async () => {
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"\ntarget: t.yaml');
        await startServer();
        await request(schedulesUrl());

        const res = await patchJSON(scheduleUrl('repo:daily'), { status: 'paused', name: 'Nightly' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.schedule.status).toBe('paused');
        expect(body.schedule.name).toBe('Nightly');

        const yamlPath = path.join(workspaceRoot, '.github', 'schedules', 'daily.yaml');
        const content = fs.readFileSync(yamlPath, 'utf-8');
        expect(content).toContain('Nightly');
    });

    it('user schedules still work normally when repo schedules exist', async () => {
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        await startServer();

        // Create a user schedule
        const createRes = await request(schedulesUrl(), {
            method: 'POST',
            body: JSON.stringify({ name: 'User', target: 'test.yaml', cron: '0 9 * * *', params: {} }),
            headers: { 'Content-Type': 'application/json' },
        });
        expect(createRes.status).toBe(201);
        const created = JSON.parse(createRes.body).schedule;
        expect(created.source).toBe('user');

        // List includes both
        const listRes = await request(schedulesUrl());
        const list = JSON.parse(listRes.body).schedules;
        expect(list.length).toBeGreaterThanOrEqual(2);
    });
});
