/**
 * Pin & Archive Handler Tests
 *
 * Tests the REST API endpoints for pinning and archiving processes.
 * Uses a real SqliteProcessStore for integration testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';

// ============================================================================
// HTTP helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
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
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function getJSON(url: string) {
    return request(url);
}

function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Pin & Archive REST API', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;
    let store: SqliteProcessStore;

    const wsId = 'ws-pin-test';

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-pin-archive-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });

        await store.registerWorkspace({
            id: wsId,
            name: 'Test Workspace',
            rootPath: '/tmp/test-repo',
        });

        server = await createExecutionServer({ port: 0, dataDir: tmpDir, store });
        baseUrl = server.url;
    });

    afterEach(async () => {
        await server.close();
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function addProcess(id: string) {
        await store.addProcess({
            id,
            type: 'ai',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date('2024-01-01T00:00:00Z'),
            endTime: new Date('2024-01-01T00:01:00Z'),
            metadata: { type: 'ai', workspaceId: wsId },
        });
    }

    // ── Pin tests ──────────────────────────────────────────────────────

    describe('PATCH /api/processes/:id/pin', () => {
        it('pins a process and returns pinnedAt timestamp', async () => {
            await addProcess('p1');
            const res = await patchJSON(`${baseUrl}/api/processes/p1/pin`, { pinned: true });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.id).toBe('p1');
            expect(body.pinnedAt).toBeTruthy();

            // Verify in store
            const proc = await store.getProcess('p1');
            expect(proc!.pinnedAt).toBeTruthy();
        });

        it('auto-unarchives an archived process when pinning', async () => {
            await addProcess('p-arch');
            store.archiveProcess('p-arch');

            const res = await patchJSON(`${baseUrl}/api/processes/p-arch/pin`, { pinned: true });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.pinnedAt).toBeTruthy();
            expect(body.archived).toBe(false);

            // Verify in store: pinned and no longer archived
            const proc = await store.getProcess('p-arch');
            expect(proc!.pinnedAt).toBeTruthy();
            expect(proc!.archived).toBeUndefined();
        });

        it('unpins a process when pinned: false', async () => {
            await addProcess('p2');
            store.pinProcess('p2', new Date().toISOString());

            const res = await patchJSON(`${baseUrl}/api/processes/p2/pin`, { pinned: false });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.pinnedAt).toBeNull();

            const proc = await store.getProcess('p2');
            expect(proc!.pinnedAt).toBeUndefined();
        });
    });

    // ── Archive tests ──────────────────────────────────────────────────

    describe('PATCH /api/processes/:id/archive', () => {
        it('archives a process', async () => {
            await addProcess('a1');
            const res = await patchJSON(`${baseUrl}/api/processes/a1/archive`, { archived: true });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.archived).toBe(true);

            const proc = await store.getProcess('a1');
            expect(proc!.archived).toBe(true);
        });

        it('unarchives a process when archived: false', async () => {
            await addProcess('a2');
            store.archiveProcess('a2');

            const res = await patchJSON(`${baseUrl}/api/processes/a2/archive`, { archived: false });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.archived).toBe(false);
        });
    });

    // ── Batch archive tests ────────────────────────────────────────────

    describe('POST /api/processes/archive', () => {
        it('batch archives multiple processes', async () => {
            await addProcess('ba1');
            await addProcess('ba2');
            await addProcess('ba3');

            const res = await postJSON(`${baseUrl}/api/processes/archive`, { ids: ['ba1', 'ba2'] });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.archived).toEqual(['ba1', 'ba2']);

            const p1 = await store.getProcess('ba1');
            const p2 = await store.getProcess('ba2');
            const p3 = await store.getProcess('ba3');
            expect(p1!.archived).toBe(true);
            expect(p2!.archived).toBe(true);
            expect(p3!.archived).toBeUndefined();
        });

        it('returns 400 for invalid body', async () => {
            const res = await postJSON(`${baseUrl}/api/processes/archive`, { ids: 'not-array' });
            expect(res.status).toBe(400);
        });
    });

    // ── Batch unarchive tests ──────────────────────────────────────────

    describe('POST /api/processes/unarchive', () => {
        it('batch unarchives multiple processes', async () => {
            await addProcess('bu1');
            await addProcess('bu2');
            store.archiveProcesses(['bu1', 'bu2']);

            const res = await postJSON(`${baseUrl}/api/processes/unarchive`, { ids: ['bu1', 'bu2'] });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.unarchived).toEqual(['bu1', 'bu2']);

            const p1 = await store.getProcess('bu1');
            const p2 = await store.getProcess('bu2');
            expect(p1!.archived).toBeUndefined();
            expect(p2!.archived).toBeUndefined();
        });
    });

    // ── GET pinned processes ───────────────────────────────────────────

    describe('GET /api/workspaces/:id/pinned', () => {
        it('returns pinned processes for workspace', async () => {
            await addProcess('gp1');
            await addProcess('gp2');

            store.pinProcess('gp1', '2026-04-01T12:00:00.000Z');
            store.pinProcess('gp2', '2026-04-02T12:00:00.000Z');

            const res = await getJSON(`${baseUrl}/api/workspaces/${wsId}/pinned`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.entries).toHaveLength(2);
            // Newest first
            expect(body.entries[0].id).toBe('gp2');
            expect(body.entries[1].id).toBe('gp1');
        });

        it('returns empty array when nothing is pinned', async () => {
            const res = await getJSON(`${baseUrl}/api/workspaces/${wsId}/pinned`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.entries).toEqual([]);
        });
    });
});
