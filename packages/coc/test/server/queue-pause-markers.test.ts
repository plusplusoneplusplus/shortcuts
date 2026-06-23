/**
 * Queue Pause Markers Tests
 *
 * Covers Section 7 of test-plan-queue-advanced.md:
 * - Create pause marker → appears in GET /api/queue queued list
 * - Delete pause marker → gone from queue, returns 200
 * - GET /api/queue shows active markers
 * - POST /api/queue/pause-marker twice → two independent markers
 * - Queue with two markers → both appear in queued list
 * - Pause marker persists across server restart, including timed durations
 *
 * Note on "queue drains up to but not past the marked position": requires
 * AI execution and is covered by executor-level tests; not re-tested here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
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
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') })
                );
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function post(url: string, data: unknown) {
    return request(url, { method: 'POST', body: JSON.stringify(data) });
}

// ============================================================================
// Tests
// ============================================================================

describe('Queue Pause Markers', () => {
    let server: ExecutionServer | undefined;
    let store: SqliteProcessStore | undefined;
    let dataDir: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-pause-marker-'));
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        server = await createExecutionServer({ port: 0, host: 'localhost', dataDir, store, queue: { autoStart: false } });
        await post(`${server.url}/api/queue/pause`, {});
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        if (store) {
            store.close();
            store = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function enqueueTask(displayName = 'Task') {
        const res = await post(`${server!.url}/api/queue`, {
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
            config: {},
            displayName,
        });
        return JSON.parse(res.body).task.id;
    }

    async function insertMarker(afterIndex: number, durationHours?: 1 | 2 | 3 | 4 | 8) {
        const res = await post(`${server!.url}/api/queue/pause-marker`, {
            afterIndex,
            ...(durationHours !== undefined ? { durationHours } : {}),
        });
        expect(res.status).toBe(201);
        return JSON.parse(res.body).markerId;
    }

    // ========================================================================
    // Create pause marker
    // ========================================================================

    it('POST /api/queue/pause-marker → 201 with markerId', async () => {
        await enqueueTask('T1');
        const res = await post(`${server!.url}/api/queue/pause-marker`, { afterIndex: 0 });
        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(typeof body.markerId).toBe('string');
        expect(body.markerId.length).toBeGreaterThan(0);
    });

    it('GET /api/queue returns active markers in queued list', async () => {
        await enqueueTask('T1');
        await enqueueTask('T2');
        const markerId = await insertMarker(0);

        const listRes = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        const marker = queued.find((i: any) => i.kind === 'pause-marker');
        expect(marker).toBeDefined();
        expect(marker.id).toBe(markerId);
        expect(marker.durationHours).toBeUndefined();
    });

    it('POST /api/queue/pause-marker accepts preset durationHours and serializes it', async () => {
        await enqueueTask('T1');
        await enqueueTask('T2');
        const res = await post(`${server!.url}/api/queue/pause-marker`, { afterIndex: 0, durationHours: 2 });

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.durationHours).toBe(2);

        const listRes = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        const marker = queued.find((i: any) => i.kind === 'pause-marker');
        expect(marker).toMatchObject({
            id: body.markerId,
            durationHours: 2,
        });
    });

    it('POST /api/queue/pause-marker rejects non-preset durationHours and inserts nothing', async () => {
        await enqueueTask('T1');
        const res = await post(`${server!.url}/api/queue/pause-marker`, { afterIndex: 0, durationHours: 5 });

        expect(res.status).toBe(400);

        const listRes = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        expect(queued.some((i: any) => i.kind === 'pause-marker')).toBe(false);
    });

    // ========================================================================
    // Delete pause marker
    // ========================================================================

    it('DELETE /api/queue/pause-marker/:markerId → 200, marker removed', async () => {
        await enqueueTask('T1');
        const markerId = await insertMarker(0);

        const delRes = await request(`${server!.url}/api/queue/pause-marker/${markerId}`, { method: 'DELETE' });
        expect(delRes.status).toBe(200);
        expect(JSON.parse(delRes.body).removed).toBe(true);

        // Verify marker is gone
        const listRes = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        expect(queued.some((i: any) => i.kind === 'pause-marker' && i.id === markerId)).toBe(false);
    });

    it('DELETE /api/queue/pause-marker/:markerId for nonexistent → 404', async () => {
        const res = await request(`${server!.url}/api/queue/pause-marker/no-such-marker`, { method: 'DELETE' });
        expect(res.status).toBe(404);
    });

    // ========================================================================
    // Two markers
    // ========================================================================

    it('POST /api/queue/pause-marker twice → two independent markers', async () => {
        await enqueueTask('T1');
        await enqueueTask('T2');
        await enqueueTask('T3');

        const marker1 = await insertMarker(0);
        const marker2 = await insertMarker(2);

        expect(marker1).not.toBe(marker2);

        const listRes = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        const markers = queued.filter((i: any) => i.kind === 'pause-marker');
        expect(markers).toHaveLength(2);
        const markerIds = markers.map((m: any) => m.id);
        expect(markerIds).toContain(marker1);
        expect(markerIds).toContain(marker2);
    });

    // ========================================================================
    // Marker insertion position
    // ========================================================================

    it('marker inserted afterIndex=0 appears after first task', async () => {
        await enqueueTask('First');
        await enqueueTask('Second');
        const markerId = await insertMarker(0);

        const listRes = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        // Queue: [First, marker, Second]
        expect(queued[0].displayName).toBe('First');
        expect(queued[1].kind).toBe('pause-marker');
        expect(queued[1].id).toBe(markerId);
        expect(queued[2].displayName).toBe('Second');
    });

    it('marker inserted afterIndex=-1 appears at beginning of queue', async () => {
        await enqueueTask('Alpha');
        await enqueueTask('Beta');
        const markerId = await insertMarker(-1);

        const listRes = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(listRes.body).queued;
        expect(queued[0].kind).toBe('pause-marker');
        expect(queued[0].id).toBe(markerId);
    });

    // ========================================================================
    // Persistence
    // ========================================================================

    it('pause marker is present after server restart with durationHours', async () => {
        await enqueueTask('T1');
        const markerId = await insertMarker(0, 4);

        // Verify marker is present before restart
        const before = await request(`${server!.url}/api/queue`);
        expect(JSON.parse(before.body).queued.find((i: any) => i.kind === 'pause-marker')).toMatchObject({
            id: markerId,
            durationHours: 4,
        });

        // Close and restart
        await server!.close();
        server = undefined;
        store!.close();
        store = undefined;

        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        server = await createExecutionServer({ port: 0, host: 'localhost', dataDir, store, queue: { autoStart: false } });

        // After restart, marker should still be present
        const after = await request(`${server.url}/api/queue`);
        const queued = JSON.parse(after.body).queued;
        expect(queued.find((i: any) => i.kind === 'pause-marker')).toMatchObject({
            id: markerId,
            durationHours: 4,
        });
    });
});
