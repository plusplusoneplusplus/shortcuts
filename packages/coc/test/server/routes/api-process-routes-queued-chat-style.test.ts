/**
 * GET /api/processes/:id — synthesized queued-process metadata for chat style.
 *
 * While a chat is queued no AIProcess row exists yet, so the route synthesizes
 * one from the QueuedTask. The style must be mirrored there too, otherwise the
 * composer (and the i menu) reads Default for a chat that will actually run
 * with a non-default style.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiRoutes } from '../../../src/server/core/api-handler';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';

vi.mock('child_process', function () { return ({
    execSync: vi.fn(() => ''),
    execFileSync: vi.fn(() => ''),
}); });

function makeTask(id: string, chatStyle?: unknown): QueuedTask {
    return {
        id,
        type: 'chat',
        status: 'queued',
        displayName: 'Write the release notes',
        priority: 'normal',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            prompt: 'Write the release notes',
            workspaceId: 'ws-queued',
            mode: 'ask',
            ...(chatStyle === undefined ? {} : { chatStyle }),
        },
    } as unknown as QueuedTask;
}

function request(url: string): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'GET' },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode || 0, json: () => JSON.parse(body) });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

describe('GET /api/processes/:id — queued chat style', () => {
    let server: http.Server;
    let port: number;

    const tasks = new Map<string, QueuedTask>([
        ['human-task', makeTask('human-task', 'human')],
        ['bogus-task', makeTask('bogus-task', 'friendly')],
        ['plain-task', makeTask('plain-task')],
    ]);

    beforeAll(async () => {
        const store = createMockProcessStore();
        const bridge = { getTask: (id: string) => tasks.get(id) } as any;
        const routes: Route[] = [];
        registerApiRoutes(routes, store as any, bridge);
        server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const get = (id: string) => request(`http://127.0.0.1:${port}/api/processes/${id}`);

    it('mirrors the enqueued style while the chat is queued', async () => {
        const res = await get('queue_human-task');
        expect(res.status).toBe(200);
        expect(res.json().process.metadata.chatStyle).toBe('human');
    });

    it('omits an unrecognised style instead of passing it through', async () => {
        const res = await get('queue_bogus-task');
        expect(res.json().process.metadata).not.toHaveProperty('chatStyle');
    });

    it('omits chatStyle for a queued chat that carries none', async () => {
        const res = await get('queue_plain-task');
        expect(res.json().process.metadata).not.toHaveProperty('chatStyle');
    });
});
