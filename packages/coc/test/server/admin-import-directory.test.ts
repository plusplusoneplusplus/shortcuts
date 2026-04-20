/**
 * Admin Directory Import API Tests
 *
 * Integration tests for the directory import endpoints:
 * - POST /api/admin/storage/scan-directory
 * - GET /api/admin/storage/import-directory-token
 * - POST /api/admin/storage/import-directory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { createExecutionServer } from '../../src/server/index';
import { resetDirectoryImportToken } from '../../src/server/admin-handler';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '../../src/server/types';
import type {
    ProcessIndexEntry,
    StoredProcessEntry,
    SerializedAIProcess,
} from '@plusplusoneplusplus/forge';

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

function writeJSON(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function makeProcess(id: string, workspaceId: string): { index: ProcessIndexEntry; stored: StoredProcessEntry } {
    const serialized: SerializedAIProcess = {
        id,
        type: 'clarification',
        promptPreview: `Preview for ${id}`,
        fullPrompt: `Full prompt for ${id}`,
        status: 'completed',
        startTime: '2024-01-15T10:00:00.000Z',
        endTime: '2024-01-15T10:05:00.000Z',
        conversationTurns: [],
        result: `Result for ${id}`,
    };

    return {
        index: {
            id,
            workspaceId,
            status: 'completed',
            type: 'clarification',
            startTime: '2024-01-15T10:00:00.000Z',
            endTime: '2024-01-15T10:05:00.000Z',
            promptPreview: `Preview for ${id}`,
            duration: 300000,
        },
        stored: { workspaceId, process: serialized },
    };
}

function parseSSEEvents(body: string): any[] {
    const events: any[] = [];
    for (const line of body.split('\n')) {
        if (line.startsWith('data: ')) {
            try {
                events.push(JSON.parse(line.slice(6)));
            } catch { /* ignore */ }
        }
    }
    return events;
}

// ============================================================================
// Tests
// ============================================================================

describe('Admin Directory Import API', () => {
    let server: ExecutionServer | undefined;
    let activeStore: SqliteProcessStore | undefined;
    let dataDir: string;
    let fixtureDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-dir-import-test-'));
        fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-dir-import-fixtures-'));
        resetDirectoryImportToken();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        if (activeStore) {
            activeStore.close();
            activeStore = undefined;
        }
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows lock */ }
        try { fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* Windows lock */ }
        resetDirectoryImportToken();
    });

    async function startSqliteServer(): Promise<ExecutionServer> {
        const dbPath = path.join(dataDir, 'processes.db');
        const store = new SqliteProcessStore({ dbPath });
        activeStore = store;
        server = await createExecutionServer({
            port: 0,
            host: 'localhost',
            store,
            dataDir,
            tokenTtlMs: 60_000, skipNonEssentialInit: true,
        });
        return server;
    }

    function buildFixtureData(wsId: string, processIds: string[]): void {
        const reposDir = path.join(fixtureDir, 'repos');
        const processesDir = path.join(reposDir, wsId, 'processes');

        const indexEntries: ProcessIndexEntry[] = [];
        for (const id of processIds) {
            const { index, stored } = makeProcess(id, wsId);
            indexEntries.push(index);
            writeJSON(path.join(processesDir, `${id}.json`), stored);
        }
        writeJSON(path.join(processesDir, 'index.json'), indexEntries);
    }

    // ========================================================================
    // POST /api/admin/storage/scan-directory
    // ========================================================================

    describe('POST /api/admin/storage/scan-directory', () => {
        it('should scan a valid directory and return match result', async () => {
            const srv = await startSqliteServer();

            // Register a workspace
            await srv.store.registerWorkspace({
                id: 'ws-test1',
                name: 'Test Workspace',
                rootPath: '/tmp/test',
            });

            buildFixtureData('ws-test1', ['proc-1', 'proc-2']);

            const res = await request(`${srv.url}/api/admin/storage/scan-directory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: fixtureDir }),
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.matched).toHaveLength(1);
            expect(body.matched[0].workspaceId).toBe('ws-test1');
            expect(body.matched[0].registeredName).toBe('Test Workspace');
            expect(body.totalMatchedProcesses).toBe(2);
        });

        it('should return 400 for non-existent path', async () => {
            const srv = await startSqliteServer();

            const res = await request(`${srv.url}/api/admin/storage/scan-directory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path.join(fixtureDir, 'does-not-exist') }),
            });

            expect(res.status).toBe(400);
        });

        it('should return 400 for relative path', async () => {
            const srv = await startSqliteServer();

            const res = await request(`${srv.url}/api/admin/storage/scan-directory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'relative/path' }),
            });

            expect(res.status).toBe(400);
        });

        it('should return 400 for missing path', async () => {
            const srv = await startSqliteServer();

            const res = await request(`${srv.url}/api/admin/storage/scan-directory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // GET /api/admin/storage/import-directory-token
    // ========================================================================

    describe('GET /api/admin/storage/import-directory-token', () => {
        it('should return a token and expiry', async () => {
            const srv = await startSqliteServer();

            const res = await request(`${srv.url}/api/admin/storage/import-directory-token`);

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.token).toBeDefined();
            expect(typeof body.token).toBe('string');
            expect(body.expiresIn).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // POST /api/admin/storage/import-directory
    // ========================================================================

    describe('POST /api/admin/storage/import-directory', () => {
        it('should return 400 without token', async () => {
            const srv = await startSqliteServer();

            const res = await request(`${srv.url}/api/admin/storage/import-directory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: fixtureDir }),
            });

            expect(res.status).toBe(400);
        });

        it('should return 403 with invalid token', async () => {
            const srv = await startSqliteServer();

            const res = await request(`${srv.url}/api/admin/storage/import-directory?confirm=invalid-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: fixtureDir }),
            });

            expect(res.status).toBe(403);
        });

        it('should import processes end-to-end', async () => {
            const srv = await startSqliteServer();

            // Register workspace
            await srv.store.registerWorkspace({
                id: 'ws-e2e',
                name: 'E2E Workspace',
                rootPath: '/tmp/e2e',
            });

            buildFixtureData('ws-e2e', ['proc-a', 'proc-b']);

            // Get token
            const tokenRes = await request(`${srv.url}/api/admin/storage/import-directory-token`);
            const { token } = JSON.parse(tokenRes.body);

            // Import
            const importRes = await request(
                `${srv.url}/api/admin/storage/import-directory?confirm=${encodeURIComponent(token)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: fixtureDir }),
                },
            );

            expect(importRes.status).toBe(200);
            expect(importRes.headers['content-type']).toContain('text/event-stream');

            const events = parseSSEEvents(importRes.body);
            const doneEvent = events.find(e => e.type === 'done');
            expect(doneEvent).toBeDefined();
            expect(doneEvent.success).toBe(true);
            expect(doneEvent.summary.imported).toBe(2);

            // Verify in store
            const db = new Database(path.join(dataDir, 'processes.db'));
            const count = (db.prepare('SELECT COUNT(*) AS cnt FROM processes WHERE workspace_id = ?').get('ws-e2e') as { cnt: number }).cnt;
            expect(count).toBe(2);
            db.close();
        });

        it('should handle empty matched result gracefully', async () => {
            const srv = await startSqliteServer();

            // Build fixture data for a workspace that is NOT registered
            buildFixtureData('ws-unregistered', ['proc-x']);

            const tokenRes = await request(`${srv.url}/api/admin/storage/import-directory-token`);
            const { token } = JSON.parse(tokenRes.body);

            const importRes = await request(
                `${srv.url}/api/admin/storage/import-directory?confirm=${encodeURIComponent(token)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: fixtureDir }),
                },
            );

            expect(importRes.status).toBe(200);
            const events = parseSSEEvents(importRes.body);
            const doneEvent = events.find(e => e.type === 'done');
            expect(doneEvent).toBeDefined();
            expect(doneEvent.success).toBe(true);
            expect(doneEvent.summary.imported).toBe(0);
        });
    });
});
