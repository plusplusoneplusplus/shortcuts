/**
 * Queue Position Manipulation Tests
 *
 * Covers Section 3 of test-plan-queue-advanced.md:
 * - move-to/:position (0-based index, clamped)
 * - move-to-top / move-up / move-down edge cases
 * - Position changes reflected in GET /api/queue
 *
 * Note on current behavior (0-based indexing):
 *   move-to/0  → moves to first position (index 0), returns position: 1
 *   move-to/1  → moves to second position (index 1), returns position: 2
 *   move-to/-1 → route regex \d+ does not match negative numbers → 404
 *   move-to/abc → route regex \d+ does not match → 404
 *   move-up at position 1 → 404 (already at top)
 *   move-down at last position → 404 (already at bottom)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
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

function makeTask(displayName: string) {
    return {
        type: 'chat',
        priority: 'normal',
        payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
        config: {},
        displayName,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Queue Position Manipulation', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-position-'));
        server = await createExecutionServer({ port: 0, host: 'localhost', dataDir });
        // Pause to prevent auto-execution
        await post(`${server.url}/api/queue/pause`, {});
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function enqueueTask(displayName: string): Promise<string> {
        const res = await post(`${server!.url}/api/queue`, makeTask(displayName));
        return JSON.parse(res.body).task.id;
    }

    async function getQueueOrder(): Promise<string[]> {
        const res = await request(`${server!.url}/api/queue`);
        return JSON.parse(res.body).queued.map((t: any) => t.displayName);
    }

    // ========================================================================
    // move-to/:position
    // ========================================================================

    it('move-to/0 → moves item to first position, returns 200 and position: 1', async () => {
        const id1 = await enqueueTask('First');
        const id2 = await enqueueTask('Second');
        const id3 = await enqueueTask('Third');

        const res = await post(`${server!.url}/api/queue/${id3}/move-to/0`, {});
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).position).toBe(1);

        const order = await getQueueOrder();
        expect(order[0]).toBe('Third');
    });

    it('move-to/1 → moves item to second position (0-based index 1), returns 200 and position: 2', async () => {
        const id1 = await enqueueTask('First');
        const id2 = await enqueueTask('Second');
        const id3 = await enqueueTask('Third');

        // Move id1 to index 1 (position 2)
        const res = await post(`${server!.url}/api/queue/${id1}/move-to/1`, {});
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.moved).toBe(true);
        expect(body.position).toBe(2);
    });

    it('move-to/:length → item moved to last position', async () => {
        const id1 = await enqueueTask('First');
        const id2 = await enqueueTask('Second');
        const id3 = await enqueueTask('Third');
        const queueLength = 3;

        // move-to/2 (last index for 3 items) → last position
        const res = await post(`${server!.url}/api/queue/${id1}/move-to/2`, {});
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.position).toBe(3);

        const order = await getQueueOrder();
        expect(order[order.length - 1]).toBe('First');
    });

    it('move-to/9999 (> queue length) → clamped to last position, 200', async () => {
        const id1 = await enqueueTask('First');
        const id2 = await enqueueTask('Second');
        const id3 = await enqueueTask('Third');

        const res = await post(`${server!.url}/api/queue/${id1}/move-to/9999`, {});
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.moved).toBe(true);
        // Clamped to last position (3 items → position 3)
        expect(body.position).toBe(3);
    });

    it('move-to/-1 → route regex does not match, returns 404', async () => {
        const id1 = await enqueueTask('First');
        // Regex \d+ requires non-negative integer; negative numbers don't match
        const res = await request(`${server!.url}/api/queue/${id1}/move-to/-1`, { method: 'POST' });
        expect(res.status).toBe(404);
    });

    it('move-to/abc → route regex does not match, returns 404', async () => {
        const id1 = await enqueueTask('First');
        const res = await request(`${server!.url}/api/queue/${id1}/move-to/abc`, { method: 'POST' });
        expect(res.status).toBe(404);
    });

    it('move-to/:position for unknown task → 404', async () => {
        await enqueueTask('First');
        const res = await post(`${server!.url}/api/queue/nonexistent/move-to/0`, {});
        expect(res.status).toBe(404);
    });

    // ========================================================================
    // move-to-top
    // ========================================================================

    it('move-to-top → equivalent to move-to/0 (moves to front)', async () => {
        const id1 = await enqueueTask('First');
        const id2 = await enqueueTask('Second');
        const id3 = await enqueueTask('Third');

        const res = await post(`${server!.url}/api/queue/${id3}/move-to-top`, {});
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).position).toBe(1);

        const order = await getQueueOrder();
        expect(order[0]).toBe('Third');
    });

    // ========================================================================
    // move-up edge cases
    // ========================================================================

    it('move-up on item at position 1 (top) → 404 (already at top)', async () => {
        const id1 = await enqueueTask('First');
        await enqueueTask('Second');

        const res = await post(`${server!.url}/api/queue/${id1}/move-up`, {});
        expect(res.status).toBe(404);
    });

    it('move-up on item at position 2 → swapped to position 1', async () => {
        const id1 = await enqueueTask('First');
        const id2 = await enqueueTask('Second');

        const res = await post(`${server!.url}/api/queue/${id2}/move-up`, {});
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).position).toBe(1);

        const order = await getQueueOrder();
        expect(order[0]).toBe('Second');
        expect(order[1]).toBe('First');
    });

    // ========================================================================
    // move-down edge cases
    // ========================================================================

    it('move-down on item at last position → 404 (already at bottom)', async () => {
        await enqueueTask('First');
        const id2 = await enqueueTask('Second');

        const res = await post(`${server!.url}/api/queue/${id2}/move-down`, {});
        expect(res.status).toBe(404);
    });

    it('move-down on item at position 1 with 3 items → moves to position 2', async () => {
        const id1 = await enqueueTask('First');
        await enqueueTask('Second');
        await enqueueTask('Third');

        const res = await post(`${server!.url}/api/queue/${id1}/move-down`, {});
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).position).toBe(2);

        const order = await getQueueOrder();
        expect(order[0]).toBe('Second');
        expect(order[1]).toBe('First');
    });

    // ========================================================================
    // Position changes reflected in GET /api/queue
    // ========================================================================

    it('position changes reflected immediately in GET /api/queue response', async () => {
        const id1 = await enqueueTask('Alpha');
        const id2 = await enqueueTask('Beta');
        const id3 = await enqueueTask('Gamma');

        // Move Gamma to front
        await post(`${server!.url}/api/queue/${id3}/move-to-top`, {});

        const res = await request(`${server!.url}/api/queue`);
        const queued = JSON.parse(res.body).queued;
        expect(queued[0].id).toBe(id3);
        expect(queued[0].displayName).toBe('Gamma');
    });
});
