/**
 * Turn Actions Handler Tests
 *
 * Tests the REST API endpoints for per-message delete, pin, and archive on conversation turns.
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

function deleteReq(url: string) {
    return request(url, { method: 'DELETE' });
}

// ============================================================================
// Tests
// ============================================================================

describe('Turn Actions REST API', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;
    let store: SqliteProcessStore;

    const wsId = 'ws-turn-test';

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-turn-actions-'));
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

    async function addProcessWithTurns(id: string, turnCount: number = 3) {
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
        for (let i = 0; i < turnCount; i++) {
            await store.appendConversationTurn(id, (idx) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: `message-${idx}`,
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            }));
        }
    }

    // ── Delete tests ───────────────────────────────────────────────────

    describe('DELETE /api/processes/:id/turns/:turnIndex', () => {
        it('soft-deletes a turn and returns deletedAt', async () => {
            await addProcessWithTurns('p1');

            const res = await deleteReq(`${baseUrl}/api/processes/p1/turns/0`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.id).toBe('p1');
            expect(body.turnIndex).toBe(0);
            expect(body.deletedAt).toBeTruthy();

            // Verify in store
            const proc = await store.getProcess('p1');
            const turn0 = proc!.conversationTurns!.find(t => t.turnIndex === 0);
            expect(turn0?.deletedAt).toBeInstanceOf(Date);
        });

        it('returns 404 for non-existent process', async () => {
            const res = await deleteReq(`${baseUrl}/api/processes/nonexistent/turns/0`);
            expect(res.status).toBe(404);
        });
    });

    // ── Restore tests ──────────────────────────────────────────────────

    describe('PATCH /api/processes/:id/turns/:turnIndex/restore', () => {
        it('restores a soft-deleted turn', async () => {
            await addProcessWithTurns('p1');
            store.softDeleteTurn('p1', 0);

            const res = await patchJSON(`${baseUrl}/api/processes/p1/turns/0/restore`, {});
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.deletedAt).toBeNull();

            // Verify in store
            const proc = await store.getProcess('p1');
            const turn0 = proc!.conversationTurns!.find(t => t.turnIndex === 0);
            expect(turn0?.deletedAt).toBeUndefined();
        });
    });

    // ── Pin tests ──────────────────────────────────────────────────────

    describe('PATCH /api/processes/:id/turns/:turnIndex/pin', () => {
        it('pins a turn and returns pinnedAt', async () => {
            await addProcessWithTurns('p1');

            const res = await patchJSON(`${baseUrl}/api/processes/p1/turns/1/pin`, { pinned: true });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.id).toBe('p1');
            expect(body.turnIndex).toBe(1);
            expect(body.pinnedAt).toBeTruthy();
        });

        it('unpins a turn when pinned: false', async () => {
            await addProcessWithTurns('p1');
            store.pinTurn('p1', 1, new Date().toISOString());

            const res = await patchJSON(`${baseUrl}/api/processes/p1/turns/1/pin`, { pinned: false });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.pinnedAt).toBeNull();
        });

        it('returns 404 for non-existent process', async () => {
            const res = await patchJSON(`${baseUrl}/api/processes/nonexistent/turns/0/pin`, { pinned: true });
            expect(res.status).toBe(404);
        });
    });

    // ── Archive tests ──────────────────────────────────────────────────

    describe('PATCH /api/processes/:id/turns/:turnIndex/archive', () => {
        it('archives a turn', async () => {
            await addProcessWithTurns('p1');

            const res = await patchJSON(`${baseUrl}/api/processes/p1/turns/0/archive`, { archived: true });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.archived).toBe(true);
        });

        it('unarchives a turn when archived: false', async () => {
            await addProcessWithTurns('p1');
            store.archiveTurn('p1', 0);

            const res = await patchJSON(`${baseUrl}/api/processes/p1/turns/0/archive`, { archived: false });
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.archived).toBe(false);
        });

        it('returns 404 for non-existent process', async () => {
            const res = await patchJSON(`${baseUrl}/api/processes/nonexistent/turns/0/archive`, { archived: true });
            expect(res.status).toBe(404);
        });
    });

    // ── GET pinned turns ───────────────────────────────────────────────

    describe('GET /api/processes/:id/turns/pinned', () => {
        it('returns pinned turns for a process', async () => {
            await addProcessWithTurns('p1');
            store.pinTurn('p1', 0, '2026-04-01T12:00:00.000Z');
            store.pinTurn('p1', 2, '2026-04-02T12:00:00.000Z');

            const res = await getJSON(`${baseUrl}/api/processes/p1/turns/pinned`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.turns).toHaveLength(2);
            // Newest pinned first
            expect(body.turns[0].turnIndex).toBe(2);
            expect(body.turns[1].turnIndex).toBe(0);
        });

        it('returns empty array when nothing is pinned', async () => {
            await addProcessWithTurns('p1');

            const res = await getJSON(`${baseUrl}/api/processes/p1/turns/pinned`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.turns).toEqual([]);
        });

        it('returns 404 for non-existent process', async () => {
            const res = await getJSON(`${baseUrl}/api/processes/nonexistent/turns/pinned`);
            expect(res.status).toBe(404);
        });
    });
});
