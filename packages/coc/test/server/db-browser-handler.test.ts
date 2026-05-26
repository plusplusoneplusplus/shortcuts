/**
 * DB Browser Handler Tests
 *
 * Tests for the database browser admin API endpoints (read + edit + delete).
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

    // ── GET /api/db-browser/sources ─────────────────────────────────────

    describe('GET /api/db-browser/sources', () => {
        it('should return allowlisted database sources and capabilities', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/db-browser/sources`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            const processDb = body.sources.find((s: any) => s.id === 'process-db');
            expect(processDb.capabilities.updateRows).toBe(true);
        });
    });

    // ── GET /api/db-browser/process-db/tables ─────────────────────────────────────────

    describe('GET /api/db-browser/process-db/tables', () => {
        it('should return list of tables with row counts', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/db-browser/process-db/tables`);
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
            const res = await request(`${srv.url}/api/db-browser/process-db/tables`);
            expect(res.status).toBe(501);

            const body = JSON.parse(res.body);
            expect(body.error).toContain('SQLite');
        });
    });

    // ── GET /api/db-browser/process-db/tables/:name ───────────────────────────────────

    describe('GET /api/db-browser/process-db/tables/:name', () => {
        it('should return table columns and paginated rows', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/db-browser/process-db/tables/processes`);
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
            const res = await request(`${srv.url}/api/db-browser/process-db/tables/processes?page=2&pageSize=10`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.page).toBe(2);
            expect(body.pageSize).toBe(10);
        });

        it('should clamp pageSize to max 200', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/db-browser/process-db/tables/processes?pageSize=999`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.pageSize).toBe(200);
        });

        it('should return 404 for table name with invalid characters', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/db-browser/process-db/tables/DROP%20TABLE`);
            // Route regex rejects names with spaces, so the router returns 404
            expect(res.status).toBe(404);
        });

        it('should return 400 for non-existent table', async () => {
            const srv = await startSqliteServer();
            const res = await request(`${srv.url}/api/db-browser/process-db/tables/nonexistent_table`);
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toBeDefined();
            expect(body.error).toMatch(/not found/i);
        });

        it('should return 501 when store is not SQLite', async () => {
            const srv = await startFileServer();
            const res = await request(`${srv.url}/api/db-browser/process-db/tables/processes`);
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

            const res = await request(`${srv.url}/api/db-browser/process-db/tables/workspaces`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.total).toBeGreaterThanOrEqual(1);
            expect(body.rows.length).toBeGreaterThanOrEqual(1);
            // Server may auto-register a global workspace, so check our workspace exists somewhere
            const wsIds = body.rows.map((r: any) => r.id);
            expect(wsIds).toContain('ws-test');
        });
    });

    // ── PUT /api/db-browser/process-db/tables/:name/rows ────────────────────────────

    describe('PUT /api/db-browser/process-db/tables/:name/rows', () => {
        /** Create a test table with known schema and seed data. */
        function seedTestTable(store: SqliteProcessStore): void {
            const db = store.getDatabase();
            db.exec(`
                CREATE TABLE IF NOT EXISTS test_items (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    status TEXT DEFAULT 'draft',
                    score INTEGER DEFAULT 0
                )
            `);
            db.prepare('INSERT OR IGNORE INTO test_items (id, name, status, score) VALUES (?, ?, ?, ?)').run(1, 'Alpha', 'active', 10);
            db.prepare('INSERT OR IGNORE INTO test_items (id, name, status, score) VALUES (?, ?, ?, ?)').run(2, 'Bravo', 'draft', 20);
            db.prepare('INSERT OR IGNORE INTO test_items (id, name, status, score) VALUES (?, ?, ?, ?)').run(3, 'Charlie', 'active', 30);
        }

        function putRows(url: string, tableName: string, body: object) {
            return request(`${url}/api/db-browser/process-db/tables/${tableName}/rows`, {
                method: 'PUT',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' },
            });
        }

        it('should update a row by PK and return the updated row', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await putRows(srv.url, 'test_items', {
                pkColumns: { id: 1 },
                updates: { name: 'Alpha Updated', status: 'archived' },
            });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.changes).toBe(1);
            expect(body.row).toBeDefined();
            expect(body.row.id).toBe(1);
            expect(body.row.name).toBe('Alpha Updated');
            expect(body.row.status).toBe('archived');
            expect(body.row.score).toBe(10); // unchanged
        });

        it('should return 404 when PK values do not match any row', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await putRows(srv.url, 'test_items', {
                pkColumns: { id: 999 },
                updates: { name: 'Ghost' },
            });
            expect(res.status).toBe(404);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/not found/i);
        });

        it('should return 400 when pkColumns references a non-PK column', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await putRows(srv.url, 'test_items', {
                pkColumns: { name: 'Alpha' },
                updates: { score: 99 },
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/not a primary key/i);
        });

        it('should return 400 when updates references a non-existent column', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await putRows(srv.url, 'test_items', {
                pkColumns: { id: 1 },
                updates: { nonexistent_col: 'value' },
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/does not exist/i);
        });

        it('should return 400 when attempting to update a PK column', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await putRows(srv.url, 'test_items', {
                pkColumns: { id: 1 },
                updates: { id: 100 },
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/primary key/i);
        });

        it('should return 400 when body is missing pkColumns', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await putRows(srv.url, 'test_items', {
                updates: { name: 'Missing PK' },
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/pkColumns/i);
        });

        it('should return 400 when body is missing updates', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await putRows(srv.url, 'test_items', {
                pkColumns: { id: 1 },
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/updates/i);
        });

        it('should return 400 for invalid table name', async () => {
            const srv = await startSqliteServer();

            // Route regex rejects names with invalid chars → 404 from router
            const res = await putRows(srv.url, 'DROP%20TABLE', {
                pkColumns: { id: 1 },
                updates: { name: 'Hacked' },
            });
            expect(res.status).toBe(404);
        });

        it('should return 501 for non-SQLite store', async () => {
            const srv = await startFileServer();

            const res = await putRows(srv.url, 'test_items', {
                pkColumns: { id: 1 },
                updates: { name: 'No SQLite' },
            });
            expect(res.status).toBe(501);

            const body = JSON.parse(res.body);
            expect(body.error).toContain('SQLite');
        });

        it('should return 400 for non-existent table', async () => {
            const srv = await startSqliteServer();

            const res = await putRows(srv.url, 'totally_fake_table', {
                pkColumns: { id: 1 },
                updates: { name: 'Nope' },
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/not found/i);
        });

        it('should prevent SQL injection via column name validation', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await putRows(srv.url, 'test_items', {
                pkColumns: { id: 1 },
                updates: { 'name; DROP TABLE test_items; --': 'hacked' },
            });
            expect(res.status).toBe(400);

            // Table should still be accessible
            const check = await request(`${srv.url}/api/db-browser/process-db/tables/test_items`);
            expect(check.status).toBe(200);
        });

        it('should handle composite primary keys', async () => {
            const srv = await startSqliteServer();
            const db = sqliteStore!.getDatabase();
            db.exec(`
                CREATE TABLE IF NOT EXISTS composite_pk (
                    org TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    role TEXT DEFAULT 'member',
                    PRIMARY KEY (org, user_id)
                )
            `);
            db.prepare('INSERT INTO composite_pk (org, user_id, role) VALUES (?, ?, ?)').run('acme', 'u1', 'member');
            db.prepare('INSERT INTO composite_pk (org, user_id, role) VALUES (?, ?, ?)').run('acme', 'u2', 'admin');

            const res = await putRows(srv.url, 'composite_pk', {
                pkColumns: { org: 'acme', user_id: 'u1' },
                updates: { role: 'admin' },
            });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.changes).toBe(1);
            expect(body.row.org).toBe('acme');
            expect(body.row.user_id).toBe('u1');
            expect(body.row.role).toBe('admin');
        });

        it('should return 400 when pkColumns is an empty object', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await putRows(srv.url, 'test_items', {
                pkColumns: {},
                updates: { name: 'Empty PK' },
            });
            expect(res.status).toBe(400);
        });

        it('should return 400 when updates is an empty object', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await putRows(srv.url, 'test_items', {
                pkColumns: { id: 1 },
                updates: {},
            });
            expect(res.status).toBe(400);
        });
    });

    // ── DELETE /api/db-browser/process-db/tables/:name/rows ─────────────────────────

    describe('DELETE /api/db-browser/process-db/tables/:name/rows', () => {
        function seedTestTable(store: SqliteProcessStore): void {
            const db = store.getDatabase();
            db.exec(`
                CREATE TABLE IF NOT EXISTS test_items (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    status TEXT DEFAULT 'draft',
                    score INTEGER DEFAULT 0
                )
            `);
            db.prepare('INSERT OR IGNORE INTO test_items (id, name, status, score) VALUES (?, ?, ?, ?)').run(1, 'Alpha', 'active', 10);
            db.prepare('INSERT OR IGNORE INTO test_items (id, name, status, score) VALUES (?, ?, ?, ?)').run(2, 'Bravo', 'draft', 20);
            db.prepare('INSERT OR IGNORE INTO test_items (id, name, status, score) VALUES (?, ?, ?, ?)').run(3, 'Charlie', 'active', 30);
        }

        function deleteRows(url: string, tableName: string, body: object) {
            const bodyStr = JSON.stringify(body);
            return request(`${url}/api/db-browser/process-db/tables/${tableName}/rows`, {
                method: 'DELETE',
                body: bodyStr,
                headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(bodyStr)) },
            });
        }

        it('should delete a row by PK and return deleted count', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await deleteRows(srv.url, 'test_items', {
                pkColumns: { id: 1 },
            });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.deleted).toBe(1);
        });

        it('should verify row is actually removed from table after delete', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            // Delete row with id=2
            const res = await deleteRows(srv.url, 'test_items', {
                pkColumns: { id: 2 },
            });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).deleted).toBe(1);

            // Verify row is gone by fetching table data
            const tableRes = await request(`${srv.url}/api/db-browser/process-db/tables/test_items`);
            expect(tableRes.status).toBe(200);
            const tableBody = JSON.parse(tableRes.body);
            const ids = tableBody.rows.map((r: any) => r.id);
            expect(ids).not.toContain(2);
            expect(ids).toContain(1);
            expect(ids).toContain(3);
        });

        it('should return 404 when PK values do not match any row', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await deleteRows(srv.url, 'test_items', {
                pkColumns: { id: 999 },
            });
            expect(res.status).toBe(404);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/not found/i);
        });

        it('should return 400 when pkColumns references a non-PK column', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await deleteRows(srv.url, 'test_items', {
                pkColumns: { name: 'Alpha' },
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/not a primary key/i);
        });

        it('should return 400 when body is missing pkColumns', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await deleteRows(srv.url, 'test_items', {});
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/pkColumns/i);
        });

        it('should return 400 for invalid table name', async () => {
            const srv = await startSqliteServer();

            // Route regex rejects names with invalid chars → 404 from router
            const res = await deleteRows(srv.url, 'DROP%20TABLE', {
                pkColumns: { id: 1 },
            });
            expect(res.status).toBe(404);
        });

        it('should return 501 for non-SQLite store', async () => {
            const srv = await startFileServer();

            const res = await deleteRows(srv.url, 'test_items', {
                pkColumns: { id: 1 },
            });
            expect(res.status).toBe(501);

            const body = JSON.parse(res.body);
            expect(body.error).toContain('SQLite');
        });

        it('should return 404 on second delete of same row', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            // First delete succeeds
            const res1 = await deleteRows(srv.url, 'test_items', {
                pkColumns: { id: 1 },
            });
            expect(res1.status).toBe(200);
            expect(JSON.parse(res1.body).deleted).toBe(1);

            // Second delete returns 404
            const res2 = await deleteRows(srv.url, 'test_items', {
                pkColumns: { id: 1 },
            });
            expect(res2.status).toBe(404);

            const body = JSON.parse(res2.body);
            expect(body.error).toMatch(/not found/i);
        });

        it('should handle composite primary keys', async () => {
            const srv = await startSqliteServer();
            const db = sqliteStore!.getDatabase();
            db.exec(`
                CREATE TABLE IF NOT EXISTS composite_pk_del (
                    org TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    role TEXT DEFAULT 'member',
                    PRIMARY KEY (org, user_id)
                )
            `);
            db.prepare('INSERT INTO composite_pk_del (org, user_id, role) VALUES (?, ?, ?)').run('acme', 'u1', 'member');
            db.prepare('INSERT INTO composite_pk_del (org, user_id, role) VALUES (?, ?, ?)').run('acme', 'u2', 'admin');

            const res = await deleteRows(srv.url, 'composite_pk_del', {
                pkColumns: { org: 'acme', user_id: 'u1' },
            });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).deleted).toBe(1);

            // Verify only u1 was deleted
            const tableRes = await request(`${srv.url}/api/db-browser/process-db/tables/composite_pk_del`);
            const tableBody = JSON.parse(tableRes.body);
            expect(tableBody.rows.length).toBe(1);
            expect(tableBody.rows[0].user_id).toBe('u2');
        });

        it('should return 400 when pkColumns is an empty object', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await deleteRows(srv.url, 'test_items', {
                pkColumns: {},
            });
            expect(res.status).toBe(400);
        });

        it('should return 400 for non-existent table', async () => {
            const srv = await startSqliteServer();

            const res = await deleteRows(srv.url, 'totally_fake_table', {
                pkColumns: { id: 1 },
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/not found/i);
        });
    });

    // ── Sorting ─────────────────────────────────────────────────────────

    describe('GET /api/db-browser/process-db/tables/:name — sorting', () => {
        it('should sort rows ascending by a valid column', async () => {
            const srv = await startSqliteServer();

            // Insert multiple workspaces to have sortable data
            await sqliteStore!.registerWorkspace({ id: 'ws-b', name: 'Bravo', rootPath: '/tmp/b' });
            await sqliteStore!.registerWorkspace({ id: 'ws-a', name: 'Alpha', rootPath: '/tmp/a' });
            await sqliteStore!.registerWorkspace({ id: 'ws-c', name: 'Charlie', rootPath: '/tmp/c' });

            const res = await request(`${srv.url}/api/db-browser/process-db/tables/workspaces?sort=id&order=asc`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            const ids = body.rows.map((r: any) => r.id);
            const sorted = [...ids].sort();
            expect(ids).toEqual(sorted);
        });

        it('should sort rows descending when order=desc', async () => {
            const srv = await startSqliteServer();

            await sqliteStore!.registerWorkspace({ id: 'ws-b', name: 'Bravo', rootPath: '/tmp/b' });
            await sqliteStore!.registerWorkspace({ id: 'ws-a', name: 'Alpha', rootPath: '/tmp/a' });
            await sqliteStore!.registerWorkspace({ id: 'ws-c', name: 'Charlie', rootPath: '/tmp/c' });

            const res = await request(`${srv.url}/api/db-browser/process-db/tables/workspaces?sort=id&order=desc`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            const ids = body.rows.map((r: any) => r.id);
            const sorted = [...ids].sort().reverse();
            expect(ids).toEqual(sorted);
        });

        it('should default to descending when order param is missing', async () => {
            const srv = await startSqliteServer();

            await sqliteStore!.registerWorkspace({ id: 'ws-b', name: 'Bravo', rootPath: '/tmp/b' });
            await sqliteStore!.registerWorkspace({ id: 'ws-a', name: 'Alpha', rootPath: '/tmp/a' });

            const res = await request(`${srv.url}/api/db-browser/process-db/tables/workspaces?sort=id`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            const ids = body.rows.map((r: any) => r.id);
            const sorted = [...ids].sort().reverse();
            expect(ids).toEqual(sorted);
        });

        it('should ignore invalid sort column (SQL injection prevention)', async () => {
            const srv = await startSqliteServer();

            // Attempt SQL injection via sort column
            const res = await request(`${srv.url}/api/db-browser/process-db/tables/workspaces?sort=id;DROP%20TABLE%20workspaces&order=asc`);
            expect(res.status).toBe(200);

            // Table should still be accessible (no injection happened)
            const body = JSON.parse(res.body);
            expect(body.table).toBe('workspaces');
            expect(Array.isArray(body.rows)).toBe(true);
        });

        it('should ignore non-existent column name', async () => {
            const srv = await startSqliteServer();

            const res = await request(`${srv.url}/api/db-browser/process-db/tables/workspaces?sort=nonexistent_column&order=asc`);
            expect(res.status).toBe(200);

            // Should return rows without sorting (no error)
            const body = JSON.parse(res.body);
            expect(body.table).toBe('workspaces');
            expect(Array.isArray(body.rows)).toBe(true);
        });

        it('should treat invalid order value as descending', async () => {
            const srv = await startSqliteServer();

            await sqliteStore!.registerWorkspace({ id: 'ws-b', name: 'Bravo', rootPath: '/tmp/b' });
            await sqliteStore!.registerWorkspace({ id: 'ws-a', name: 'Alpha', rootPath: '/tmp/a' });

            const res = await request(`${srv.url}/api/db-browser/process-db/tables/workspaces?sort=id&order=INVALID`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            const ids = body.rows.map((r: any) => r.id);
            const sorted = [...ids].sort().reverse();
            expect(ids).toEqual(sorted);
        });

        it('should work with sorting and pagination together', async () => {
            const srv = await startSqliteServer();

            await sqliteStore!.registerWorkspace({ id: 'ws-b', name: 'Bravo', rootPath: '/tmp/b' });
            await sqliteStore!.registerWorkspace({ id: 'ws-a', name: 'Alpha', rootPath: '/tmp/a' });
            await sqliteStore!.registerWorkspace({ id: 'ws-c', name: 'Charlie', rootPath: '/tmp/c' });

            // Page 1, size 2, sorted desc by id
            const res = await request(`${srv.url}/api/db-browser/process-db/tables/workspaces?sort=id&order=desc&page=1&pageSize=2`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.pageSize).toBe(2);
            expect(body.rows.length).toBeLessThanOrEqual(2);
            // First rows should be the highest IDs
            const ids = body.rows.map((r: any) => r.id);
            for (let i = 1; i < ids.length; i++) {
                expect(ids[i - 1] >= ids[i]).toBe(true);
            }
        });
    });

    // ── POST /api/db-browser/process-db/tables/:name/rows/delete-bulk ────────────────

    describe('POST /api/db-browser/process-db/tables/:name/rows/delete-bulk', () => {
        function seedTestTable(store: SqliteProcessStore): void {
            const db = store.getDatabase();
            db.exec(`
                CREATE TABLE IF NOT EXISTS test_items (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    status TEXT DEFAULT 'draft',
                    score INTEGER DEFAULT 0
                )
            `);
            db.prepare('INSERT OR IGNORE INTO test_items (id, name, status, score) VALUES (?, ?, ?, ?)').run(1, 'Alpha', 'active', 10);
            db.prepare('INSERT OR IGNORE INTO test_items (id, name, status, score) VALUES (?, ?, ?, ?)').run(2, 'Bravo', 'draft', 20);
            db.prepare('INSERT OR IGNORE INTO test_items (id, name, status, score) VALUES (?, ?, ?, ?)').run(3, 'Charlie', 'active', 30);
            db.prepare('INSERT OR IGNORE INTO test_items (id, name, status, score) VALUES (?, ?, ?, ?)').run(4, 'Delta', 'draft', 40);
            db.prepare('INSERT OR IGNORE INTO test_items (id, name, status, score) VALUES (?, ?, ?, ?)').run(5, 'Echo', 'active', 50);
        }

        function bulkDelete(url: string, tableName: string, body: object) {
            return request(`${url}/api/db-browser/process-db/tables/${tableName}/rows/delete-bulk`, {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' },
            });
        }

        it('should bulk-delete multiple rows and return correct counts', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await bulkDelete(srv.url, 'test_items', {
                rows: [{ id: 1 }, { id: 3 }, { id: 5 }],
            });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.deleted).toBe(3);
            expect(body.requested).toBe(3);

            // Verify remaining rows
            const tableRes = await request(`${srv.url}/api/db-browser/process-db/tables/test_items`);
            const tableBody = JSON.parse(tableRes.body);
            const ids = tableBody.rows.map((r: any) => r.id);
            expect(ids).toEqual(expect.arrayContaining([2, 4]));
            expect(ids).not.toContain(1);
            expect(ids).not.toContain(3);
            expect(ids).not.toContain(5);
        });

        it('should return correct deleted vs requested when some rows do not exist', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await bulkDelete(srv.url, 'test_items', {
                rows: [{ id: 1 }, { id: 999 }, { id: 2 }],
            });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.deleted).toBe(2);
            expect(body.requested).toBe(3);
        });

        it('should validate all rows before executing (all-or-nothing validation)', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            // Second row has an invalid PK column
            const res = await bulkDelete(srv.url, 'test_items', {
                rows: [{ id: 1 }, { name: 'Alpha' }],
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/not a primary key/i);

            // Verify NO rows were deleted (validation failed before execution)
            const tableRes = await request(`${srv.url}/api/db-browser/process-db/tables/test_items`);
            const tableBody = JSON.parse(tableRes.body);
            expect(tableBody.total).toBe(5);
        });

        it('should return 400 for empty rows array', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await bulkDelete(srv.url, 'test_items', {
                rows: [],
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/non-empty array/i);
        });

        it('should return 400 when rows is not an array', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await bulkDelete(srv.url, 'test_items', {
                rows: { id: 1 },
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/non-empty array/i);
        });

        it('should return 400 for rows exceeding max limit (1000)', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const tooMany = Array.from({ length: 1001 }, (_, i) => ({ id: i }));
            const res = await bulkDelete(srv.url, 'test_items', {
                rows: tooMany,
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/exceeds maximum/i);
        });

        it('should return 400 when row PK columns are invalid', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await bulkDelete(srv.url, 'test_items', {
                rows: [{ status: 'active' }],
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/not a primary key/i);
        });

        it('should return 400 when a row is an empty object', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await bulkDelete(srv.url, 'test_items', {
                rows: [{}],
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/non-empty object/i);
        });

        it('should return 400 for invalid table name', async () => {
            const srv = await startSqliteServer();

            // Route regex rejects names with invalid chars → 404 from router
            const res = await bulkDelete(srv.url, 'DROP%20TABLE', {
                rows: [{ id: 1 }],
            });
            expect(res.status).toBe(404);
        });

        it('should return 400 for non-existent table', async () => {
            const srv = await startSqliteServer();

            const res = await bulkDelete(srv.url, 'totally_fake_table', {
                rows: [{ id: 1 }],
            });
            expect(res.status).toBe(400);

            const body = JSON.parse(res.body);
            expect(body.error).toMatch(/not found/i);
        });

        it('should return 501 for non-SQLite store', async () => {
            const srv = await startFileServer();

            const res = await bulkDelete(srv.url, 'test_items', {
                rows: [{ id: 1 }],
            });
            expect(res.status).toBe(501);

            const body = JSON.parse(res.body);
            expect(body.error).toContain('SQLite');
        });

        it('should handle composite primary keys', async () => {
            const srv = await startSqliteServer();
            const db = sqliteStore!.getDatabase();
            db.exec(`
                CREATE TABLE IF NOT EXISTS composite_pk_bulk (
                    org TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    role TEXT DEFAULT 'member',
                    PRIMARY KEY (org, user_id)
                )
            `);
            db.prepare('INSERT INTO composite_pk_bulk (org, user_id, role) VALUES (?, ?, ?)').run('acme', 'u1', 'member');
            db.prepare('INSERT INTO composite_pk_bulk (org, user_id, role) VALUES (?, ?, ?)').run('acme', 'u2', 'admin');
            db.prepare('INSERT INTO composite_pk_bulk (org, user_id, role) VALUES (?, ?, ?)').run('acme', 'u3', 'member');

            const res = await bulkDelete(srv.url, 'composite_pk_bulk', {
                rows: [
                    { org: 'acme', user_id: 'u1' },
                    { org: 'acme', user_id: 'u3' },
                ],
            });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.deleted).toBe(2);
            expect(body.requested).toBe(2);

            // Verify only u2 remains
            const tableRes = await request(`${srv.url}/api/db-browser/process-db/tables/composite_pk_bulk`);
            const tableBody = JSON.parse(tableRes.body);
            expect(tableBody.rows.length).toBe(1);
            expect(tableBody.rows[0].user_id).toBe('u2');
        });

        it('should delete a single row via bulk endpoint', async () => {
            const srv = await startSqliteServer();
            seedTestTable(sqliteStore!);

            const res = await bulkDelete(srv.url, 'test_items', {
                rows: [{ id: 2 }],
            });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.deleted).toBe(1);
            expect(body.requested).toBe(1);
        });
    });

});
