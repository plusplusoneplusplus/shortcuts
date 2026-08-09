/**
 * GET /api/processes/:id — synthesized queued-process metadata for commit chats.
 *
 * While a commit chat is queued no AIProcess row exists yet, so the route
 * synthesizes one from the QueuedTask. The commit association must be present
 * there too, otherwise the i menu briefly omits the Commit row before the
 * executor creates the real process record.
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

const FULL_HASH = '5fdf6cd18f978b84fb02b7ac82c740a4d2d7d5e3';
const SUBJECT = '[MoE] Single-launch moe_align for tiny batches with many experts (#32395)';

function makeTask(id: string, context?: Record<string, unknown>): QueuedTask {
    return {
        id,
        type: 'chat',
        status: 'queued',
        displayName: 'Explain this commit',
        priority: 'normal',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            prompt: 'Explain this commit',
            workspaceId: 'ws-queued',
            mode: 'ask',
            ...(context ? { context } : {}),
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

describe('GET /api/processes/:id — queued commit chat', () => {
    let server: http.Server;
    let port: number;

    const tasks = new Map<string, QueuedTask>([
        ['commit-task', makeTask('commit-task', { commitChat: { commitHash: FULL_HASH, commitMessage: SUBJECT } })],
        ['hash-only-task', makeTask('hash-only-task', { commitChat: { commitHash: FULL_HASH } })],
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

    it('includes the commit hash and message while the chat is queued', async () => {
        const res = await get('queue_commit-task');
        expect(res.status).toBe(200);
        expect(res.json().process.metadata.commitChat).toEqual({
            commitHash: FULL_HASH,
            commitMessage: SUBJECT,
        });
    });

    it('includes the hash alone when the task carries no commit message', async () => {
        const res = await get('queue_hash-only-task');
        expect(res.json().process.metadata.commitChat).toEqual({ commitHash: FULL_HASH });
    });

    it('omits commitChat for a queued ordinary chat', async () => {
        const res = await get('queue_plain-task');
        expect(res.json().process.metadata.commitChat).toBeUndefined();
    });
});
