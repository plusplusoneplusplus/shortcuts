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

    it('DELETE repo schedule returns 403', async () => {
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        await startServer();

        // Ensure schedules are loaded
        await request(schedulesUrl());

        const res = await deleteRequest(scheduleUrl('repo:daily'));
        expect(res.status).toBe(403);
        expect(res.body).toContain('cannot be deleted');
    });

    it('PATCH repo schedule with non-status fields returns 403', async () => {
        writeRepoSchedule('daily.yaml', 'name: Daily\ncron: "0 0 * * *"');
        await startServer();

        // Ensure schedules are loaded
        await request(schedulesUrl());

        const res = await patchJSON(scheduleUrl('repo:daily'), { name: 'New Name' });
        expect(res.status).toBe(403);
        expect(res.body).toContain('read-only');
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
