import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerDashboardActiveWorkspaceRoutes } from '../../src/server/routes/dashboard-active-workspace-routes';
import { ActiveWorkspaceTracker } from '../../src/server/dashboard/active-workspace-tracker';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { Route } from '../../src/server/types';

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        GitOpsStore: vi.fn().mockImplementation(function () {
            return {
                markStaleRunningJobs: vi.fn().mockResolvedValue(undefined),
            };
        }),
    };
});

function request(handler: ReturnType<typeof createRouter>, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Server did not bind')));
                return;
            }

            const payload = body === undefined ? undefined : JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: address.port,
                path,
                method,
                headers: payload ? {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                } : undefined,
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    server.close(() => {
                        const text = Buffer.concat(chunks).toString('utf8');
                        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined });
                    });
                });
            });
            req.on('error', error => server.close(() => reject(error)));
            if (payload) req.write(payload);
            req.end();
        });
    });
}

describe('dashboard active workspace routes', () => {
    let handler: ReturnType<typeof createRouter>;
    let tracker: ActiveWorkspaceTracker;

    beforeEach(() => {
        const routes: Route[] = [];
        const store = createMockProcessStore({
            initialWorkspaces: [
                { id: 'ws-one', name: 'One', rootPath: '/repo/one' },
                { id: 'ws-two', name: 'Two', rootPath: '/repo/two' },
            ],
        });
        tracker = new ActiveWorkspaceTracker();
        registerDashboardActiveWorkspaceRoutes({
            routes,
            store,
            activeWorkspaceTracker: tracker,
            gitOpsStore: {} as any,
        });
        handler = createRouter({ routes, spaHtml: '' });
    });

    it('tracks the latest active workspace per dashboard client across two workspace IDs', async () => {
        await request(handler, 'POST', '/api/workspaces/active', { clientId: 'tab-a', workspaceId: 'ws-one' });
        let response = await request(handler, 'POST', '/api/workspaces/active', { clientId: 'tab-a', workspaceId: 'ws-two' });

        expect(response.status).toBe(200);
        expect(response.body.activeWorkspaceIds).toEqual(['ws-two']);
        expect(response.body.clients).toHaveLength(1);
        expect(response.body.clients[0]).toMatchObject({ clientId: 'tab-a', workspaceId: 'ws-two' });

        response = await request(handler, 'POST', '/api/workspaces/active', { clientId: 'tab-b', workspaceId: 'ws-one' });

        expect(response.status).toBe(200);
        expect(response.body.activeWorkspaceIds).toEqual(['ws-one', 'ws-two']);
        expect(response.body.clients.map((client: any) => client.clientId)).toEqual(['tab-a', 'tab-b']);
    });

    it('clears a dashboard client without clearing other active workspace state', async () => {
        await request(handler, 'POST', '/api/workspaces/active', { clientId: 'tab-a', workspaceId: 'ws-one' });
        await request(handler, 'POST', '/api/workspaces/active', { clientId: 'tab-b', workspaceId: 'ws-two' });

        const response = await request(handler, 'POST', '/api/workspaces/active', { clientId: 'tab-a', workspaceId: null });

        expect(response.status).toBe(200);
        expect(response.body.activeWorkspaceIds).toEqual(['ws-two']);
        expect(response.body.clients).toEqual([
            expect.objectContaining({ clientId: 'tab-b', workspaceId: 'ws-two' }),
        ]);
    });

    it('rejects unknown workspace IDs and preserves stale active state', async () => {
        await request(handler, 'POST', '/api/workspaces/active', { clientId: 'tab-a', workspaceId: 'ws-one' });

        const rejected = await request(handler, 'POST', '/api/workspaces/active', { clientId: 'tab-a', workspaceId: 'missing' });
        const snapshot = await request(handler, 'GET', '/api/workspaces/active');

        expect(rejected.status).toBe(404);
        expect(snapshot.status).toBe(200);
        expect(snapshot.body.activeWorkspaceIds).toEqual(['ws-one']);
    });

    it('validates required report fields', async () => {
        const missingClient = await request(handler, 'POST', '/api/workspaces/active', { workspaceId: 'ws-one' });
        const missingWorkspace = await request(handler, 'POST', '/api/workspaces/active', { clientId: 'tab-a' });
        const blankWorkspace = await request(handler, 'POST', '/api/workspaces/active', { clientId: 'tab-a', workspaceId: '' });

        expect(missingClient.status).toBe(400);
        expect(missingWorkspace.status).toBe(400);
        expect(blankWorkspace.status).toBe(400);
    });
});
