/**
 * Process History Handler Tests
 *
 * Integration tests for GET /api/workspaces/:id/history endpoint.
 * Uses a real SqliteProcessStore for accurate behavior.
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

// ============================================================================
// Tests
// ============================================================================

describe('Process History REST API', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;
    let store: SqliteProcessStore;

    const wsId = 'ws-hist-1';

    function historyUrl(id: string = wsId, query = '') {
        const base = `${baseUrl}/api/workspaces/${encodeURIComponent(id)}/history`;
        return query ? `${base}?${query}` : base;
    }

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-history-api-'));
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

    async function addProcess(
        id: string,
        opts: {
            status?: string;
            type?: string;
            title?: string;
            startTime?: string;
            endTime?: string;
            workspaceId?: string;
            metadata?: Record<string, unknown>;
        } = {}
    ) {
        await store.addProcess({
            id,
            type: (opts.type ?? 'pipeline-execution') as any,
            promptPreview: `preview-${id}`,
            fullPrompt: `full-${id}`,
            status: (opts.status ?? 'completed') as any,
            title: opts.title,
            startTime: new Date(opts.startTime ?? '2024-06-01T10:00:00Z'),
            endTime: opts.endTime ? new Date(opts.endTime) : undefined,
            metadata: {
                type: (opts.type ?? 'pipeline-execution') as any,
                workspaceId: opts.workspaceId ?? wsId,
                ...opts.metadata,
            },
        });
    }

    it('returns 200 with empty history for workspace with no processes', async () => {
        const res = await getJSON(historyUrl());
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual({ history: [], hasMore: false, offset: 0, limit: 100 });
    });

    it('returns completed processes in history', async () => {
        await addProcess('p1', { status: 'completed', endTime: '2024-06-01T10:05:00Z' });
        await addProcess('p2', { status: 'failed', endTime: '2024-06-01T10:06:00Z' });

        const res = await getJSON(historyUrl());
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.history).toHaveLength(2);
        expect(body.hasMore).toBe(false);

        const ids = body.history.map((h: any) => h.id);
        expect(ids).toContain('p1');
        expect(ids).toContain('p2');
    });

    it('excludes running/pending processes', async () => {
        await addProcess('p-completed', { status: 'completed', endTime: '2024-06-01T10:05:00Z' });
        await addProcess('p-running', { status: 'running' });

        const res = await getJSON(historyUrl());
        const body = JSON.parse(res.body);
        const ids = body.history.map((h: any) => h.id);
        expect(ids).toContain('p-completed');
        expect(ids).not.toContain('p-running');
    });

    it('includes cancelled processes', async () => {
        await addProcess('p-cancelled', { status: 'cancelled', endTime: '2024-06-01T10:05:00Z' });

        const res = await getJSON(historyUrl());
        const body = JSON.parse(res.body);
        expect(body.history).toHaveLength(1);
        expect(body.history[0].id).toBe('p-cancelled');
        expect(body.history[0].status).toBe('cancelled');
    });

    it('filters by workspace ID from path', async () => {
        const ws2 = 'ws-hist-2';
        await store.registerWorkspace({ id: ws2, name: 'WS2', rootPath: '/tmp/ws2' });
        await addProcess('p-ws1', { status: 'completed', endTime: '2024-06-01T10:05:00Z', workspaceId: wsId });
        await addProcess('p-ws2', { status: 'completed', endTime: '2024-06-01T10:06:00Z', workspaceId: ws2 });

        const res1 = await getJSON(historyUrl(wsId));
        const body1 = JSON.parse(res1.body);
        expect(body1.history.map((h: any) => h.id)).toContain('p-ws1');
        expect(body1.history.map((h: any) => h.id)).not.toContain('p-ws2');

        const res2 = await getJSON(historyUrl(ws2));
        const body2 = JSON.parse(res2.body);
        expect(body2.history.map((h: any) => h.id)).toContain('p-ws2');
        expect(body2.history.map((h: any) => h.id)).not.toContain('p-ws1');
    });

    it('filters by type query param', async () => {
        await addProcess('p-pipe', { status: 'completed', type: 'pipeline-execution', endTime: '2024-06-01T10:05:00Z' });
        await addProcess('p-review', { status: 'completed', type: 'code-review', endTime: '2024-06-01T10:06:00Z' });

        const res = await getJSON(historyUrl(wsId, 'type=code-review'));
        const body = JSON.parse(res.body);
        expect(body.history.every((h: any) => h.type === 'code-review')).toBe(true);
    });

    it('respects limit parameter', async () => {
        for (let i = 0; i < 5; i++) {
            await addProcess(`p-${i}`, {
                status: 'completed',
                endTime: `2024-06-01T10:0${i}:00Z`,
            });
        }

        const res = await getJSON(historyUrl(wsId, 'limit=3'));
        const body = JSON.parse(res.body);
        expect(body.history).toHaveLength(3);
        expect(body.hasMore).toBe(true);
        expect(body.limit).toBe(3);
        expect(body.offset).toBe(0);
    });

    it('hasMore is false when results fit within limit', async () => {
        await addProcess('p1', { status: 'completed', endTime: '2024-06-01T10:05:00Z' });
        await addProcess('p2', { status: 'completed', endTime: '2024-06-01T10:06:00Z' });

        const res = await getJSON(historyUrl(wsId, 'limit=10'));
        const body = JSON.parse(res.body);
        expect(body.history).toHaveLength(2);
        expect(body.hasMore).toBe(false);
        expect(body.limit).toBe(10);
        expect(body.offset).toBe(0);
    });

    it('defaults limit to 100', async () => {
        const res = await getJSON(historyUrl());
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.limit).toBe(100);
        expect(body.offset).toBe(0);
    });

    it('clamps limit to 200', async () => {
        const res = await getJSON(historyUrl(wsId, 'limit=500'));
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.limit).toBe(200);
    });

    it('respects offset parameter', async () => {
        for (let i = 0; i < 5; i++) {
            await addProcess(`p-${i}`, {
                status: 'completed',
                endTime: `2024-06-01T10:0${i}:00Z`,
            });
        }

        const res = await getJSON(historyUrl(wsId, 'limit=2&offset=2'));
        const body = JSON.parse(res.body);
        expect(body.history).toHaveLength(2);
        expect(body.offset).toBe(2);
        expect(body.limit).toBe(2);
    });

    it('returns 400 for invalid offset (non-numeric)', async () => {
        const res = await getJSON(historyUrl(wsId, 'offset=abc'));
        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('offset');
    });

    it('returns 400 for invalid limit (non-numeric)', async () => {
        const res = await getJSON(historyUrl(wsId, 'limit=xyz'));
        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('limit');
    });

    it('injects seenAt from getSeenMap', async () => {
        await addProcess('p-seen', { status: 'completed', endTime: '2024-06-01T10:05:00Z' });
        await addProcess('p-unseen', { status: 'completed', endTime: '2024-06-01T10:06:00Z' });

        const seenAt = '2024-06-01T12:00:00.000Z';
        store.markSeen('p-seen', seenAt);

        const res = await getJSON(historyUrl());
        const body = JSON.parse(res.body);

        const seenItem = body.history.find((h: any) => h.id === 'p-seen');
        const unseenItem = body.history.find((h: any) => h.id === 'p-unseen');

        expect(seenItem.seenAt).toBe(seenAt);
        expect(unseenItem.seenAt).toBeUndefined();
    });

    it('returns correct ProcessHistoryItem shape', async () => {
        await addProcess('p-shape', {
            status: 'completed',
            title: 'My Process',
            type: 'pipeline-execution',
            endTime: '2024-06-01T10:05:00Z',
        });

        const res = await getJSON(historyUrl());
        const body = JSON.parse(res.body);
        const item = body.history.find((h: any) => h.id === 'p-shape');

        expect(item).toBeDefined();
        expect(item.id).toBe('p-shape');
        expect(item.type).toBe('pipeline-execution');
        expect(item.status).toBe('completed');
        expect(item.title).toBe('My Process');
        expect(typeof item.startTime).toBe('number');
        expect(typeof item.endTime).toBe('number');
        expect(typeof item.turnCount).toBe('number');
        expect(item.workspaceId).toBe(wsId);
    });

    it('returns persisted For Each child metadata in ProcessHistoryItem shape', async () => {
        await addProcess('p-for-each-child', {
            status: 'completed',
            title: 'For Each child',
            type: 'chat',
            endTime: '2024-06-01T10:05:00Z',
            metadata: {
                mode: 'ask',
                forEach: {
                    kind: 'child',
                    workspaceId: wsId,
                    runId: 'for-each-run-1',
                    itemId: 'item-2',
                    childMode: 'ask',
                },
            },
        });

        const res = await getJSON(historyUrl());
        const body = JSON.parse(res.body);
        const item = body.history.find((h: any) => h.id === 'p-for-each-child');

        expect(item).toMatchObject({
            id: 'p-for-each-child',
            type: 'chat',
            mode: 'ask',
            workspaceId: wsId,
            forEach: {
                kind: 'child',
                workspaceId: wsId,
                runId: 'for-each-run-1',
                itemId: 'item-2',
                childMode: 'ask',
            },
        });
    });

    it('handles URL-encoded workspace ID', async () => {
        const wsSpecial = 'ws/special chars';
        await store.registerWorkspace({ id: wsSpecial, name: 'Special', rootPath: '/tmp/special' });
        await addProcess('p-special', {
            status: 'completed',
            endTime: '2024-06-01T10:05:00Z',
            workspaceId: wsSpecial,
        });

        const res = await getJSON(historyUrl(wsSpecial));
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.history.map((h: any) => h.id)).toContain('p-special');
    });
});
