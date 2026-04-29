/**
 * Notes Git Auto-Commit Handler Tests
 *
 * Tests for the three REST API endpoints: enable/update (POST), disable (DELETE),
 * and status (GET).
 *
 * Uses a real HTTP server with OS-assigned port for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
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
    // POST — Enable / update
    // ========================================================================

    describe('POST /api/workspaces/:id/notes/git/auto-commit — Enable', () => {
        it('enables auto-commit with default interval, returns 200', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(autoCommitUrl(srv), {});
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.enabled).toBe(true);
            expect(body.intervalMs).toBe(1_800_000);
        });

        it('uses custom intervalMs when provided', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(autoCommitUrl(srv), { intervalMs: 300_000 });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.intervalMs).toBe(300_000);
        });

        it('is idempotent — calling POST twice updates the interval', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), { intervalMs: 600_000 });
            const second = await postJSON(autoCommitUrl(srv), { intervalMs: 900_000 });
            expect(second.status).toBe(200);
            expect(JSON.parse(second.body).intervalMs).toBe(900_000);
        });

        it('ignores invalid intervalMs (≤0) and falls back to default', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(autoCommitUrl(srv), { intervalMs: -1 });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).intervalMs).toBe(1_800_000);
        });

        it('persists preference so GET /status reflects enabled state', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), { intervalMs: 600_000 });

            const statusRes = await request(autoCommitUrl(srv, '/status'));
            const body = JSON.parse(statusRes.body);
            expect(body.enabled).toBe(true);
            expect(body.intervalMs).toBe(600_000);
        });
    });

    // ========================================================================
    // DELETE — Disable
    // ========================================================================

    describe('DELETE /api/workspaces/:id/notes/git/auto-commit — Disable', () => {
        it('disables auto-commit, returns 200', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), {});

            const deleteRes = await deleteRequest(autoCommitUrl(srv));
            expect(deleteRes.status).toBe(200);
            expect(JSON.parse(deleteRes.body).deleted).toBe(true);
        });

        it('GET /status returns enabled=false after disable', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), {});
            await deleteRequest(autoCommitUrl(srv));

            const statusRes = await request(autoCommitUrl(srv, '/status'));
            expect(JSON.parse(statusRes.body).enabled).toBe(false);
        });

        it('is idempotent — disable on never-enabled workspace returns 200', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await deleteRequest(autoCommitUrl(srv));
            expect(res.status).toBe(200);
        });
    });

    // ========================================================================
    // GET — Status
    // ========================================================================

    describe('GET /api/workspaces/:id/notes/git/auto-commit/status — Status', () => {
        it('returns enabled=false when never enabled', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await request(autoCommitUrl(srv, '/status'));
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).enabled).toBe(false);
        });

        it('returns enabled=true with intervalMs and nulled result fields when enabled', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), { intervalMs: 600_000 });

            const res = await request(autoCommitUrl(srv, '/status'));
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.enabled).toBe(true);
            expect(body.intervalMs).toBe(600_000);
            expect(body.lastCommittedAt).toBeNull();
            expect(body.lastError).toBeNull();
        });

        it('includes warning when notes git is not initialized', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(autoCommitUrl(srv), {});

            const res = await request(autoCommitUrl(srv, '/status'));
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.enabled).toBe(true);
            expect(body.warning).toContain('not initialized');
        });
    });
});
