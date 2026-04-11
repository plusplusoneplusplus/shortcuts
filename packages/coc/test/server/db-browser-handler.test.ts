/**
 * DB Browser Handler Tests
 *
 * Tests for the read-only database browser admin API endpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { SqliteProcessStore, FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '../../src/server/index';

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
                res.on('end', () => resolve({
                    status: res.statusCode || 0,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString('utf-8'),
                }));
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('DB Browser Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let sqliteStore: SqliteProcessStore | undefined;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-browser-handler-test-'));
    });

    afterEach(async () => {
        if (server) {
            const s = server.store;
            await server.close();
            if ('close' in s && typeof (s as any).close === 'function') {
                (s as any).close();
            }
            server = undefined;
        }
        if (sqliteStore) {
            try { sqliteStore.close(); } catch { /* already closed */ }
            sqliteStore = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startSqliteServer(): Promise<ExecutionServer> {
        sqliteStore = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        server = await createExecutionServer({ port: 0, host: 'localhost', store: sqliteStore, dataDir });
        return server;
    }

    async function startFileServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    // ── GET /api/admin/db/tables ─────────────────────────────────────────

    describe('GET /api/admin/db/tables', () => {
        it('should return list of tables with row counts', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/admin/db/tables`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.tables).toBeDefined();
            expect(Array.isArray(body.tables)).toBe(true);

            // Should have the known tables
            const tableNames = body.tables.map((t: any) => t.name);
            expect(tableNames).toContain('processes');
            expect(tableNames).toContain('conversation_turns');
            expect(tableNames).toContain('workspaces');
            expect(tableNames).toContain('wikis');
            expect(tableNames).toContain('queue_tasks');
            expect(tableNames).toContain('queue_repo_state');

            // Each table should have a numeric rowCount
            for (const table of body.tables) {
                expect(typeof table.name).toBe('string');
                expect(typeof table.rowCount).toBe('number');
                expect(table.rowCount).toBeGreaterThanOrEqual(0);
            }
        });

        it('should return 501 when store is not SQLite', async () => {
            const srv = await startFileServer();
            const res = await request(`${srv.url}/api/admin/db/tables`);
            expect(res.status).toBe(501);

            const body = JSON.parse(res.body);
            expect(body.error).toContain('SQLite');
        });
    });

    // ── GET /api/admin/db/tables/:name ───────────────────────────────────

    describe('GET /api/admin/db/tables/:name', () => {
        it('should return table columns and paginated rows', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/admin/db/tables/processes`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.table).toBe('processes');
            expect(Array.isArray(body.columns)).toBe(true);
            expect(Array.isArray(body.rows)).toBe(true);
            expect(typeof body.total).toBe('number');
            expect(body.page).toBe(1);
            expect(body.pageSize).toBe(50);
            expect(typeof body.totalPages).toBe('number');

            // Columns should have expected shape
            const colNames = body.columns.map((c: any) => c.name);
            expect(colNames).toContain('id');
            expect(colNames).toContain('workspace_id');
            expect(colNames).toContain('status');

            for (const col of body.columns) {
                expect(typeof col.name).toBe('string');
                expect(typeof col.type).toBe('string');
                expect(typeof col.notnull).toBe('boolean');
                expect(typeof col.pk).toBe('boolean');
            }
        });

        it('should respect page and pageSize query params', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/admin/db/tables/processes?page=2&pageSize=10`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.page).toBe(2);
            expect(body.pageSize).toBe(10);
        });

        it('should clamp pageSize to max 200', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/admin/db/tables/processes?pageSize=999`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.pageSize).toBe(200);
        });

        it('should return 404 for table name with invalid characters', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/admin/db/tables/DROP%20TABLE`);
            // Route regex rejects names with spaces, so the router returns 404
            expect(res.status).toBe(404);
        });

        it('should return 400 for non-existent table', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/admin/db/tables/nonexistent_table`);
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toBeDefined();
            expect(body.error).toMatch(/not found/i);
        });

        it('should return 501 when store is not SQLite', async () => {
            const srv = await startFileServer();
            const res = await request(`${srv.url}/api/admin/db/tables/processes`);
            expect(res.status).toBe(501);

            const body = JSON.parse(res.body);
            expect(body.error).toContain('SQLite');
        });

        it('should return rows when data exists', async () => {
            const srv = await startSqliteServer();

            // Register a workspace to have some data
            await sqliteStore!.registerWorkspace({
                id: 'ws-test',
                name: 'Test Workspace',
                rootPath: '/tmp/test',
            });

            const res = await request(`${srv.url}/api/admin/db/tables/workspaces`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.total).toBeGreaterThanOrEqual(1);
            expect(body.rows.length).toBeGreaterThanOrEqual(1);
            // Server may auto-register a global workspace, so check our workspace exists somewhere
            const wsIds = body.rows.map((r: any) => r.id);
            expect(wsIds).toContain('ws-test');
        });
    });
});
