/**
 * Repo-Group Handler Tests
 *
 * Tests for the repo-group REST API endpoints:
 * - POST /api/repo-groups — create a group from registered repo workspaces
 * - GET /api/repo-groups/:id — membership file + registry-resolved members
 * - PATCH /api/repo-groups/:id — rename and/or replace membership
 * - DELETE /api/repo-groups/:id — deregister without wiping data on disk
 *
 * Uses direct handler registration without full server startup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerRepoGroupRoutes } from '../../src/server/workspaces/repo-group-handler';
import { createRequestHandler } from '../../src/server/router';
import type { Route } from '../../src/server/types';
import { FileProcessStore, type WorkspaceInfo } from '@plusplusoneplusplus/forge';

// ============================================================================
// Test Helpers
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
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
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

function sendJSONBody(method: string) {
    return (url: string, data?: unknown) => request(url, {
        method,
        body: data !== undefined ? JSON.stringify(data) : undefined,
        headers: data !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    });
}

const postJSON = sendJSONBody('POST');
const patchJSON = sendJSONBody('PATCH');

// ============================================================================
// Tests
// ============================================================================

describe('Repo Group Handler', () => {
    let dataDir: string;
    let store: FileProcessStore;
    let server: http.Server;
    let baseUrl: string;
    let repoA: WorkspaceInfo;
    let repoB: WorkspaceInfo;
    let broadcastEvents: Array<{ type: string; workspaceId: string; action: string }>;
    let registeredGroups: WorkspaceInfo[];

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-group-handler-test-'));
        store = new FileProcessStore({ dataDir });

        repoA = { id: 'repo-a', name: 'Repo A', rootPath: path.join(dataDir, 'checkouts', 'repo-a') };
        repoB = { id: 'repo-b', name: 'Repo B', rootPath: path.join(dataDir, 'checkouts', 'repo-b') };
        for (const ws of [repoA, repoB]) {
            fs.mkdirSync(ws.rootPath, { recursive: true });
            await store.registerWorkspace(ws);
        }

        broadcastEvents = [];
        registeredGroups = [];
        const routes: Route[] = [];
        registerRepoGroupRoutes(routes, store, dataDir, {
            getWsServer: () => ({
                broadcastProcessEvent: (event) => { broadcastEvents.push(event); },
            }),
            onGroupRegistered: async (ws) => { registeredGroups.push(ws); },
        });
        const handler = createRequestHandler({ routes, spaHtml: () => '<html></html>' });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(dataDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    async function createGroup(name = 'Platform', members = [repoA.id, repoB.id]) {
        const res = await postJSON(`${baseUrl}/api/repo-groups`, { name, members });
        expect(res.status).toBe(201);
        return JSON.parse(res.body) as { workspace: WorkspaceInfo; members: any[] };
    }

    // ------------------------------------------------------------------
    // POST /api/repo-groups
    // ------------------------------------------------------------------

    describe('POST /api/repo-groups', () => {
        it('creates a group, registers the workspace, and resolves members', async () => {
            const { workspace, members } = await createGroup();

            expect(workspace.id).toBe('group-platform');
            expect(workspace.virtual).toBe(true);
            expect(members.map(m => m.workspaceId)).toEqual([repoA.id, repoB.id]);
            expect(members.every(m => m.stale === false)).toBe(true);

            const registered = await store.getWorkspaces();
            expect(registered.some(w => w.id === 'group-platform')).toBe(true);

            const file = JSON.parse(fs.readFileSync(
                path.join(dataDir, 'repos', 'group-platform', 'group.json'), 'utf-8'));
            expect(file).toEqual({ name: 'Platform', members: [repoA.id, repoB.id] });
        });

        it('invokes onGroupRegistered and broadcasts an added topology event', async () => {
            const { workspace } = await createGroup();
            expect(registeredGroups.map(w => w.id)).toEqual([workspace.id]);
            expect(broadcastEvents).toEqual([
                expect.objectContaining({
                    type: 'workspace-topology-changed',
                    action: 'added',
                    workspaceId: workspace.id,
                }),
            ]);
        });

        it('rejects an unregistered member with 400 and registers nothing', async () => {
            const res = await postJSON(`${baseUrl}/api/repo-groups`, {
                name: 'Bad', members: ['/tmp/arbitrary-path'],
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('not a registered workspace');
            expect((await store.getWorkspaces()).every(w => !w.id.startsWith('group-'))).toBe(true);
            expect(broadcastEvents).toEqual([]);
        });

        it('rejects a virtual-workspace member with 400', async () => {
            await store.registerWorkspace({ id: 'my_work', name: 'My Work', rootPath: dataDir, virtual: true });
            const res = await postJSON(`${baseUrl}/api/repo-groups`, { name: 'Bad', members: ['my_work'] });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('not a repo workspace');
        });

        it('rejects missing name/members with 400', async () => {
            expect((await postJSON(`${baseUrl}/api/repo-groups`, { members: [] })).status).toBe(400);
            expect((await postJSON(`${baseUrl}/api/repo-groups`, { name: 'X' })).status).toBe(400);
            expect((await postJSON(`${baseUrl}/api/repo-groups`, { name: '   ', members: [] })).status).toBe(400);
        });

        it('rejects non-string member entries with 400', async () => {
            const res = await postJSON(`${baseUrl}/api/repo-groups`, { name: 'X', members: [42] });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('array of workspace IDs');
        });

        it('rejects an invalid JSON body with 400', async () => {
            const res = await request(`${baseUrl}/api/repo-groups`, {
                method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });
    });

    // ------------------------------------------------------------------
    // GET /api/repo-groups/:id
    // ------------------------------------------------------------------

    describe('GET /api/repo-groups/:id', () => {
        it('returns the group with resolved members', async () => {
            const { workspace } = await createGroup();
            const res = await request(`${baseUrl}/api/repo-groups/${workspace.id}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.id).toBe(workspace.id);
            expect(body.name).toBe('Platform');
            expect(body.members).toEqual([
                { workspaceId: repoA.id, stale: false, name: 'Repo A', rootPath: repoA.rootPath },
                { workspaceId: repoB.id, stale: false, name: 'Repo B', rootPath: repoB.rootPath },
            ]);
        });

        it('marks removed-workspace and missing-path members stale', async () => {
            const { workspace } = await createGroup();
            await store.removeWorkspace(repoA.id);
            fs.rmSync(repoB.rootPath, { recursive: true, force: true });

            const res = await request(`${baseUrl}/api/repo-groups/${workspace.id}`);
            const body = JSON.parse(res.body);
            expect(body.members).toEqual([
                { workspaceId: repoA.id, stale: true, staleReason: 'workspace-removed' },
                { workspaceId: repoB.id, stale: true, staleReason: 'path-missing', name: 'Repo B', rootPath: repoB.rootPath },
            ]);
        });

        it('returns 404 for an unknown or non-group id', async () => {
            expect((await request(`${baseUrl}/api/repo-groups/group-nope`)).status).toBe(404);
            expect((await request(`${baseUrl}/api/repo-groups/repo-a`)).status).toBe(404);
        });
    });

    // ------------------------------------------------------------------
    // PATCH /api/repo-groups/:id
    // ------------------------------------------------------------------

    describe('PATCH /api/repo-groups/:id', () => {
        it('renames the group and keeps the registered workspace name in sync', async () => {
            const { workspace } = await createGroup();
            const res = await patchJSON(`${baseUrl}/api/repo-groups/${workspace.id}`, { name: 'Platform Core' });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).name).toBe('Platform Core');

            const registered = (await store.getWorkspaces()).find(w => w.id === workspace.id);
            expect(registered?.name).toBe('Platform Core');
            expect(broadcastEvents.at(-1)).toEqual(expect.objectContaining({
                action: 'updated', workspaceId: workspace.id,
            }));
        });

        it('replaces membership and persists it', async () => {
            const { workspace } = await createGroup();
            const res = await patchJSON(`${baseUrl}/api/repo-groups/${workspace.id}`, { members: [repoB.id] });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).members.map((m: any) => m.workspaceId)).toEqual([repoB.id]);

            const file = JSON.parse(fs.readFileSync(
                path.join(dataDir, 'repos', workspace.id, 'group.json'), 'utf-8'));
            expect(file.members).toEqual([repoB.id]);
        });

        it('rejects an unregistered member with 400 and leaves the file untouched', async () => {
            const { workspace } = await createGroup();
            const res = await patchJSON(`${baseUrl}/api/repo-groups/${workspace.id}`, { members: ['nope'] });
            expect(res.status).toBe(400);

            const file = JSON.parse(fs.readFileSync(
                path.join(dataDir, 'repos', workspace.id, 'group.json'), 'utf-8'));
            expect(file.members).toEqual([repoA.id, repoB.id]);
        });

        it('rejects malformed name/members with 400', async () => {
            const { workspace } = await createGroup();
            expect((await patchJSON(`${baseUrl}/api/repo-groups/${workspace.id}`, { name: 42 })).status).toBe(400);
            expect((await patchJSON(`${baseUrl}/api/repo-groups/${workspace.id}`, { members: 'repo-a' })).status).toBe(400);
        });

        it('returns 404 for an unknown group', async () => {
            expect((await patchJSON(`${baseUrl}/api/repo-groups/group-nope`, { name: 'X' })).status).toBe(404);
        });
    });

    // ------------------------------------------------------------------
    // DELETE /api/repo-groups/:id
    // ------------------------------------------------------------------

    describe('DELETE /api/repo-groups/:id', () => {
        it('deregisters the workspace but leaves the group directory on disk', async () => {
            const { workspace } = await createGroup();
            const res = await request(`${baseUrl}/api/repo-groups/${workspace.id}`, { method: 'DELETE' });
            expect(res.status).toBe(204);

            expect((await store.getWorkspaces()).some(w => w.id === workspace.id)).toBe(false);
            expect(fs.existsSync(path.join(dataDir, 'repos', workspace.id, 'group.json'))).toBe(true);
            expect(broadcastEvents.at(-1)).toEqual(expect.objectContaining({
                action: 'removed', workspaceId: workspace.id,
            }));
        });

        it('returns 404 for an unknown or non-group id', async () => {
            expect((await request(`${baseUrl}/api/repo-groups/group-nope`, { method: 'DELETE' })).status).toBe(404);
            expect((await request(`${baseUrl}/api/repo-groups/repo-a`, { method: 'DELETE' })).status).toBe(404);
        });
    });

    // ------------------------------------------------------------------
    // Handler resilience
    // ------------------------------------------------------------------

    it('works without optional deps (no ws server, no registration hook)', async () => {
        const routes: Route[] = [];
        registerRepoGroupRoutes(routes, store, dataDir);
        const handler = createRequestHandler({ routes, spaHtml: () => '<html></html>' });
        const bareServer = http.createServer(handler);
        await new Promise<void>((resolve) => bareServer.listen(0, '127.0.0.1', resolve));
        const addr = bareServer.address() as { port: number };
        try {
            const res = await postJSON(`http://127.0.0.1:${addr.port}/api/repo-groups`, {
                name: 'Bare', members: [repoA.id],
            });
            expect(res.status).toBe(201);
        } finally {
            await new Promise<void>((resolve) => bareServer.close(() => resolve()));
        }
    });

    it('maps unexpected store failures to 500', async () => {
        vi.spyOn(store, 'getWorkspaces').mockRejectedValue(new Error('disk on fire'));
        const res = await postJSON(`${baseUrl}/api/repo-groups`, { name: 'X', members: [repoA.id] });
        expect(res.status).toBe(500);
    });
});
