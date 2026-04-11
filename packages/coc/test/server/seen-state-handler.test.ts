/**
 * Seen State Handler Tests
 *
 * Tests the REST API endpoints for read/unread (seen/unseen) state.
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

function deleteJSON(url: string) {
    return request(url, { method: 'DELETE' });
}

// ============================================================================
// Tests
// ============================================================================

describe('Seen State REST API', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;
    let store: SqliteProcessStore;

    const wsId = 'ws-test-1';

    function seenUrl(id: string = wsId) {
        return `${baseUrl}/api/workspaces/${encodeURIComponent(id)}/seen-state`;
    }

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-seen-api-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });

        // Register a workspace so processes can reference it
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

    async function addProcess(id: string, status: string, endTime?: string) {
        await store.addProcess({
            id,
            type: 'ai',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: status as any,
            startTime: new Date('2024-01-01T00:00:00Z'),
            endTime: endTime ? new Date(endTime) : undefined,
            metadata: { type: 'ai', workspaceId: wsId },
        });
    }

    it('GET returns empty map for workspace with no seen processes', async () => {
        const res = await getJSON(seenUrl());
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({});
    });

    it('PATCH updates entries and returns updated map', async () => {
        const t1 = '2024-06-01T12:00:00.000Z';
        const t2 = '2024-06-01T13:00:00.000Z';
        await addProcess('p1', 'completed', t1);
        await addProcess('p2', 'completed', t2);

        const res = await patchJSON(seenUrl(), {
            entries: [
                { processId: 'p1', seenAt: t1 },
                { processId: 'p2', seenAt: t2 },
            ],
        });

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual({ p1: t1, p2: t2 });
    });

    it('DELETE clears seen_at for specific process', async () => {
        const t1 = '2024-06-01T12:00:00.000Z';
        await addProcess('p1', 'completed', t1);
        store.markSeen('p1', t1);

        const res = await deleteJSON(`${seenUrl()}/${encodeURIComponent('p1')}`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ ok: true });

        // Verify it's gone
        const getRes = await getJSON(seenUrl());
        expect(JSON.parse(getRes.body)).toEqual({});
    });

    it('GET .../count returns correct unseen count', async () => {
        const t1 = '2024-06-01T12:00:00.000Z';
        const t2 = '2024-06-01T13:00:00.000Z';
        await addProcess('p1', 'completed', t1);
        await addProcess('p2', 'completed', t2);
        store.markSeen('p1', t1);

        const res = await getJSON(`${seenUrl()}/count`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ unseenCount: 1 });
    });

    it('PATCH with malformed body returns 400', async () => {
        const res = await request(seenUrl(), {
            method: 'PATCH',
            body: '{"entries": "not-an-array"}',
            headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain('entries');
    });

    it('PATCH with invalid entries returns 400', async () => {
        const res = await patchJSON(seenUrl(), {
            entries: [{ processId: 123, seenAt: 'timestamp' }],
        });

        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain('processId');
    });

    it('PATCH with invalid JSON returns 400', async () => {
        const res = await request(seenUrl(), {
            method: 'PATCH',
            body: 'not-json{{{',
            headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(400);
    });

    it('multiple workspaces are isolated', async () => {
        const ws2 = 'ws-test-2';
        await store.registerWorkspace({ id: ws2, name: 'WS2', rootPath: '/tmp/ws2' });

        const t1 = '2024-06-01T12:00:00.000Z';
        const t2 = '2024-06-01T13:00:00.000Z';
        await addProcess('p1', 'completed', t1);
        await store.addProcess({
            id: 'p2',
            type: 'ai',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed' as any,
            startTime: new Date('2024-01-01T00:00:00Z'),
            endTime: new Date(t2),
            metadata: { type: 'ai', workspaceId: ws2 },
        });

        store.markSeen('p1', t1);
        store.markSeen('p2', t2);

        const res1 = await getJSON(seenUrl(wsId));
        expect(JSON.parse(res1.body)).toEqual({ p1: t1 });

        const res2 = await getJSON(seenUrl(ws2));
        expect(JSON.parse(res2.body)).toEqual({ p2: t2 });
    });
});
