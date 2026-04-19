/**
 * Notes Git Auto-Commit Handler Tests
 *
 * Tests for the four REST API endpoints: enable (POST), disable (DELETE),
 * update (PATCH), and status (GET).
 *
 * Uses a real HTTP server with OS-assigned port for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '../../src/server/types';

// ============================================================================
// Request Helpers
// ============================================================================

function request(
    reqUrl: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(reqUrl);
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
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(
    reqUrl: string,
    data: unknown,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return request(reqUrl, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function patchJSON(
    reqUrl: string,
    data: unknown,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return request(reqUrl, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function deleteRequest(
    reqUrl: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return request(reqUrl, { method: 'DELETE' });
}

// ============================================================================
// Tests
// ============================================================================

describe('Notes Git Auto-Commit Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    const wsId = 'autocommit-test-ws';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autocommit-handler-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autocommit-ws-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer): Promise<void> {
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id: wsId,
            name: 'Test Workspace',
            rootPath: workspaceDir,
        });
        expect(res.status).toBe(201);
    }

    function autoCommitUrl(srv: ExecutionServer, suffix: string = ''): string {
        return `${srv.url}/api/workspaces/${wsId}/notes/git/auto-commit${suffix}`;
    }

    // ========================================================================
    // POST — Enable
    // ========================================================================

    describe('POST /api/workspaces/:id/notes/git/auto-commit — Enable', () => {
        it('creates schedule and script, returns 201', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(autoCommitUrl(srv), {});
            expect(res.status).toBe(201);

            const body = JSON.parse(res.body);
            expect(body.schedule).toBeDefined();
            expect(body.schedule.id).toMatch(/^sch_/);
            expect(body.schedule.name).toBe('Notes Auto-Commit');
            expect(body.schedule.targetType).toBe('script');
            expect(body.schedule.cron).toBe('*/30 * * * *');
            expect(body.schedule.status).toBe('active');
            expect(body.scriptPath).toBeDefined();
            expect(typeof body.scriptPath).toBe('string');
        });

        it('uses custom cron when provided', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(autoCommitUrl(srv), { cron: '0 */2 * * *' });
            expect(res.status).toBe(201);

            const body = JSON.parse(res.body);
            expect(body.schedule.cron).toBe('0 */2 * * *');
        });

        it('returns 400 for invalid cron', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(autoCommitUrl(srv), { cron: 'not-a-cron' });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toContain('Invalid cron');
        });

        it('returns 409 when schedule already exists', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            // Enable once
            const first = await postJSON(autoCommitUrl(srv), {});
            expect(first.status).toBe(201);

            // Enable again — conflict
            const second = await postJSON(autoCommitUrl(srv), {});
            expect(second.status).toBe(409);
        });
    });

    // ========================================================================
    // DELETE — Disable
    // ========================================================================

    describe('DELETE /api/workspaces/:id/notes/git/auto-commit — Disable', () => {
        it('removes schedule and script, returns 200', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            // Enable first
            const enableRes = await postJSON(autoCommitUrl(srv), {});
            expect(enableRes.status).toBe(201);
            const scriptPath = JSON.parse(enableRes.body).scriptPath;
            expect(fs.existsSync(scriptPath)).toBe(true);

            // Disable
            const deleteRes = await deleteRequest(autoCommitUrl(srv));
            expect(deleteRes.status).toBe(200);
            const body = JSON.parse(deleteRes.body);
            expect(body.deleted).toBe(true);

            // Script should be cleaned up
            expect(fs.existsSync(scriptPath)).toBe(false);
        });

        it('returns 404 when no schedule exists', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await deleteRequest(autoCommitUrl(srv));
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // PATCH — Update
    // ========================================================================

    describe('PATCH /api/workspaces/:id/notes/git/auto-commit — Update', () => {
        it('updates cron on existing schedule', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), {});

            const res = await patchJSON(autoCommitUrl(srv), { cron: '0 * * * *' });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.schedule.cron).toBe('0 * * * *');
        });

        it('updates status to paused', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), {});

            const res = await patchJSON(autoCommitUrl(srv), { status: 'paused' });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.schedule.status).toBe('paused');
        });

        it('returns 404 when no schedule exists', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await patchJSON(autoCommitUrl(srv), { cron: '0 * * * *' });
            expect(res.status).toBe(404);
        });

        it('returns 400 for invalid cron', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), {});

            const res = await patchJSON(autoCommitUrl(srv), { cron: 'bad' });
            expect(res.status).toBe(400);
        });

        it('returns 400 for invalid status', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), {});

            const res = await patchJSON(autoCommitUrl(srv), { status: 'stopped' });
            expect(res.status).toBe(400);
        });

        it('returns 400 when no valid fields provided', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), {});

            const res = await patchJSON(autoCommitUrl(srv), { foo: 'bar' });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // GET — Status
    // ========================================================================

    describe('GET /api/workspaces/:id/notes/git/auto-commit/status — Status', () => {
        it('returns enabled=true with schedule when enabled', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), {});

            const res = await request(autoCommitUrl(srv, '/status'));
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.enabled).toBe(true);
            expect(body.schedule).toBeDefined();
            expect(body.schedule.name).toBe('Notes Auto-Commit');
            expect(body.lastRun).toBeNull();
        });

        it('returns enabled=false when no schedule exists', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await request(autoCommitUrl(srv, '/status'));
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.enabled).toBe(false);
        });

        it('includes warning when git is not initialized', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), {});

            const res = await request(autoCommitUrl(srv, '/status'));
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.enabled).toBe(true);
            // Notes dir exists but .git is not initialized
            expect(body.warning).toContain('not initialized');
        });
    });
});
