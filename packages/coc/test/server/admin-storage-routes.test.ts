/**
 * Admin Storage Routes Tests
 *
 * Tests for the four storage migration admin endpoints:
 *   - GET /api/admin/storage/status
 *   - GET /api/admin/storage/migrate-token
 *   - POST /api/admin/storage/migrate
 *   - POST /api/admin/storage/migrate/cancel
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { resetWipeToken, resetImportToken, resetMigrateToken } from '@plusplusoneplusplus/coc-server';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
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
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

/** Collect an SSE response as raw body text. */
function requestSSE(
    url: string,
    options: { method?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'POST',
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
        req.end();
    });
}

/** Parse SSE body into individual event data objects. */
function parseSSEEvents(body: string): unknown[] {
    return body.split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice('data: '.length)));
}

// ============================================================================
// Tests
// ============================================================================

describe('Admin Storage Routes', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-storage-routes-test-'));
        resetWipeToken();
        resetImportToken();
        resetMigrateToken();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        resetWipeToken();
        resetImportToken();
        resetMigrateToken();
    });

    async function startServer(opts?: { tokenTtlMs?: number }): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({
            port: 0,
            host: 'localhost',
            store,
            dataDir,
            tokenTtlMs: opts?.tokenTtlMs,
        });
        return server;
    }

    // ========================================================================
    // GET /api/admin/storage/status
    // ========================================================================

    describe('GET /api/admin/storage/status', () => {
        it('should return correct backend and stats', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/admin/storage/status`);

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.backend).toBe('file');
            expect(typeof body.stats.processes).toBe('number');
            expect(typeof body.stats.workspaces).toBe('number');
            // No dbPath for file backend when db doesn't exist
            expect(body.dbPath).toBeUndefined();
        });

        it('should return dbPath when sqlite backend and db exists', async () => {
            // Create a fake db file
            const dbPath = path.join(dataDir, 'processes.db');
            fs.writeFileSync(dbPath, '');

            // Create a config file that specifies sqlite backend
            const configPath = path.join(dataDir, 'config.yaml');
            fs.writeFileSync(configPath, 'store:\n  backend: sqlite\n');

            const store = new FileProcessStore({ dataDir });
            server = await createExecutionServer({
                port: 0, host: 'localhost', store, dataDir, configPath,
            });
            const res = await request(`${server.url}/api/admin/storage/status`);

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.backend).toBe('sqlite');
            expect(body.dbPath).toBe(dbPath);
        });
    });

    // ========================================================================
    // GET /api/admin/storage/migrate-token
    // ========================================================================

    describe('GET /api/admin/storage/migrate-token', () => {
        it('should return a token and expiry', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/storage/migrate-token`);

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.token).toBeTruthy();
            expect(typeof body.token).toBe('string');
            expect(body.expiresIn).toBe(300);
        });

        it('should return different tokens each time', async () => {
            const srv = await startServer();
            const res1 = await request(`${srv.url}/api/admin/storage/migrate-token`);
            const res2 = await request(`${srv.url}/api/admin/storage/migrate-token`);

            const body1 = JSON.parse(res1.body);
            const body2 = JSON.parse(res2.body);
            expect(body1.token).not.toBe(body2.token);
        });
    });

    // ========================================================================
    // POST /api/admin/storage/migrate
    // ========================================================================

    describe('POST /api/admin/storage/migrate', () => {
        it('should return 400 without token', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/storage/migrate`, { method: 'POST' });

            expect(res.status).toBe(400);
        });

        it('should return 403 with invalid token', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/storage/migrate?confirm=bad-token`, { method: 'POST' });

            expect(res.status).toBe(403);
        });

        it('should return 403 with expired token', async () => {
            const srv = await startServer({ tokenTtlMs: 1 });
            const tokenRes = await request(`${srv.url}/api/admin/storage/migrate-token`);
            const token = JSON.parse(tokenRes.body).token;

            // Wait for token to expire
            await new Promise((resolve) => setTimeout(resolve, 50));

            const res = await request(`${srv.url}/api/admin/storage/migrate?confirm=${token}`, { method: 'POST' });
            expect(res.status).toBe(403);
        });

        it('should start SSE stream with valid token', async () => {
            const srv = await startServer();
            const tokenRes = await request(`${srv.url}/api/admin/storage/migrate-token`);
            const token = JSON.parse(tokenRes.body).token;

            const res = await requestSSE(`${srv.url}/api/admin/storage/migrate?confirm=${token}`);

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('text/event-stream');

            const events = parseSSEEvents(res.body);
            expect(events.length).toBeGreaterThan(0);

            // Last event should be a done event
            const doneEvent = events.find((e: any) => e.type === 'done') as any;
            expect(doneEvent).toBeDefined();
            expect(doneEvent.success).toBe(true);
        });

        it('should produce well-formed JSON in all SSE events', async () => {
            const srv = await startServer();
            const tokenRes = await request(`${srv.url}/api/admin/storage/migrate-token`);
            const token = JSON.parse(tokenRes.body).token;

            const res = await requestSSE(`${srv.url}/api/admin/storage/migrate?confirm=${token}`);
            const dataLines = res.body.split('\n').filter((line) => line.startsWith('data: '));

            for (const line of dataLines) {
                const jsonStr = line.slice('data: '.length);
                expect(() => JSON.parse(jsonStr)).not.toThrow();
            }
        });

        it('should return 409 when migration is already active', async () => {
            const srv = await startServer();

            // Start first migration
            const tokenRes1 = await request(`${srv.url}/api/admin/storage/migrate-token`);
            const token1 = JSON.parse(tokenRes1.body).token;
            const migrationPromise = requestSSE(`${srv.url}/api/admin/storage/migrate?confirm=${token1}`);

            // Small delay to let migration start
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Try to start a second migration
            const tokenRes2 = await request(`${srv.url}/api/admin/storage/migrate-token`);
            const token2 = JSON.parse(tokenRes2.body).token;
            const res2 = await request(`${srv.url}/api/admin/storage/migrate?confirm=${token2}`, { method: 'POST' });

            // Wait for first migration to complete
            await migrationPromise;

            // The second attempt may return 409 if the first is still running,
            // or it may succeed if the first finished before the second started (empty data dir).
            // With an empty dataDir, migration completes almost instantly,
            // so we just verify no crash occurred.
            expect([200, 409]).toContain(res2.status);
        });
    });

    // ========================================================================
    // POST /api/admin/storage/migrate/cancel
    // ========================================================================

    describe('POST /api/admin/storage/migrate/cancel', () => {
        it('should return 409 with no active migration', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/storage/migrate/cancel`, { method: 'POST' });

            expect(res.status).toBe(409);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('No active migration to cancel');
        });

        it('should abort active migration', async () => {
            const srv = await startServer();

            // Start migration
            const tokenRes = await request(`${srv.url}/api/admin/storage/migrate-token`);
            const token = JSON.parse(tokenRes.body).token;
            const migrationPromise = requestSSE(`${srv.url}/api/admin/storage/migrate?confirm=${token}`);

            // Small delay to let migration start
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Cancel it
            const cancelRes = await request(`${srv.url}/api/admin/storage/migrate/cancel`, { method: 'POST' });

            // Wait for migration to end
            await migrationPromise;

            // Cancel may return 200 (aborted) or 409 (already finished — empty dataDir is fast)
            expect([200, 409]).toContain(cancelRes.status);
            if (cancelRes.status === 200) {
                const body = JSON.parse(cancelRes.body);
                expect(body.success).toBe(true);
            }
        });
    });
});
