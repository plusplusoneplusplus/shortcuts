/**
 * Tests for the Team coworker roster HTTP routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerPrRoutes } from '../../src/server/repos/pr-routes';
import { pullRequestCoworkerRosterPaths } from '../../src/server/repos/pr-coworker-roster-store';
import type { Route } from '../../src/server/types';
import { resolveCanonicalOriginId } from '@plusplusoneplusplus/forge';

vi.mock('../../src/server/providers/provider-factory', () => ({
    ProviderFactory: {
        detectProviderType: vi.fn().mockReturnValue('github'),
        createPullRequestsService: vi.fn(),
    },
}));

vi.mock('../../src/server/repos/tree-service', () => ({
    RepoTreeService: vi.fn().mockImplementation(() => ({ resolveRepo: vi.fn() })),
}));

vi.mock('../../src/server/providers/providers-config', () => ({
    readProvidersConfig: vi.fn().mockResolvedValue({ providers: {} }),
}));

import { RepoTreeService } from '../../src/server/repos/tree-service';

const REPO_ID = 'repo-abc';
const OTHER_REPO_ID = 'repo-other';

let tmpDir: string;
let dataDir: string;
let server: http.Server;
let baseUrl: string;
let mockResolveRepo: ReturnType<typeof vi.fn>;

function makeServer(dir: string): http.Server {
    const routes: Route[] = [];
    registerPrRoutes(routes, dir);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

function rosterUrl(repoId: string, workspaceId: string): string {
    return `${baseUrl}/api/repos/${encodeURIComponent(repoId)}/pull-requests/coworker-roster?workspaceId=${encodeURIComponent(workspaceId)}`;
}

function rosterDeleteUrl(repoId: string, workspaceId: string, coworkerKey: string): string {
    return `${baseUrl}/api/repos/${encodeURIComponent(repoId)}/pull-requests/coworker-roster/${encodeURIComponent(coworkerKey)}?workspaceId=${encodeURIComponent(workspaceId)}`;
}

function originScopeForRepo(repoId = REPO_ID): string {
    return resolveCanonicalOriginId({ remoteUrl: `https://github.com/org/${repoId}.git`, workspaceId: 'ws-1' });
}

async function addCoworker(
    entry: Record<string, unknown>,
    workspaceId = 'ws-1',
    repoId = REPO_ID,
): Promise<Response> {
    return fetch(`${baseUrl}/api/repos/${encodeURIComponent(repoId)}/pull-requests/coworker-roster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, ...entry }),
    });
}

async function listRoster(workspaceId = 'ws-1', repoId = REPO_ID): Promise<Array<{ id: string; displayName: string; email?: string; avatarUrl?: string }>> {
    const res = await fetch(rosterUrl(repoId, workspaceId));
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: Array<{ id: string; displayName: string; email?: string; avatarUrl?: string }> };
    return body.entries;
}

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-coworker-roster-routes-test-'));
    dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    (RepoTreeService as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        resolveRepo: mockResolveRepo = vi.fn().mockImplementation((repoId: string) => Promise.resolve({
            id: repoId,
            name: repoId,
            localPath: path.join(tmpDir, repoId),
            headSha: 'abc1234',
            clonedAt: new Date().toISOString(),
            remoteUrl: `https://github.com/org/${repoId}.git`,
        })),
    }));

    server = makeServer(dataDir);
    await startServer();
});

afterEach(async () => {
    vi.clearAllMocks();
    await stopServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/repos/:repoId/pull-requests/coworker-roster', () => {
    it('returns an empty roster when none is stored', async () => {
        expect(await listRoster()).toEqual([]);
    });

    it('404s when the repo cannot be resolved', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(rosterUrl('missing-repo', 'ws-1'));
        expect(res.status).toBe(404);
    });
});

describe('POST /api/repos/:repoId/pull-requests/coworker-roster', () => {
    it('round-trips add, list, and delete while updating the roster file', async () => {
        const add = await addCoworker({
            id: '123',
            displayName: '  Mona Dev  ',
            email: 'mona@example.invalid',
            avatarUrl: 'https://avatars.example.invalid/u/123?token=drop#frag',
        });
        expect(add.status).toBe(200);

        const addBody = await add.json() as { entries: Array<{ id: string; displayName: string; email?: string; avatarUrl?: string; addedAt: string }> };
        expect(addBody.entries).toHaveLength(1);
        expect(addBody.entries[0]).toMatchObject({
            id: '123',
            displayName: 'Mona Dev',
            email: 'mona@example.invalid',
            avatarUrl: 'https://avatars.example.invalid/u/123',
        });
        expect(new Date(addBody.entries[0].addedAt).toString()).not.toBe('Invalid Date');

        const paths = pullRequestCoworkerRosterPaths(dataDir, 'ws-1', REPO_ID, originScopeForRepo());
        expect(fs.existsSync(paths.filePath)).toBe(true);
        expect(paths.filePath.endsWith(path.join('repos', originScopeForRepo(), 'pr-coworker-roster', 'index.json'))).toBe(true);
        expect(fs.readdirSync(dataDir)).toEqual(['repos']);
        expect(await listRoster()).toMatchObject([{ id: '123', displayName: 'Mona Dev' }]);

        const remove = await fetch(rosterDeleteUrl(REPO_ID, 'ws-1', '123'), { method: 'DELETE' });
        expect(remove.status).toBe(200);
        expect(await remove.json()).toEqual({ entries: [] });
        expect(JSON.parse(fs.readFileSync(paths.filePath, 'utf-8'))).toEqual({ entries: [] });
    });

    it('dedupes provider-id and displayName-keyed adds', async () => {
        await addCoworker({ id: 'ABC', displayName: 'Old Name' });
        await addCoworker({ id: 'abc', displayName: 'New Name' });
        await addCoworker({ id: '', displayName: 'Pat Dev' });
        await addCoworker({ displayName: 'pat dev', email: 'pat@example.invalid' });

        expect(await listRoster()).toMatchObject([
            { id: 'abc', displayName: 'New Name' },
            { id: '', displayName: 'pat dev', email: 'pat@example.invalid' },
        ]);

        const remove = await fetch(rosterDeleteUrl(REPO_ID, 'ws-1', 'pat dev'), { method: 'DELETE' });
        expect(remove.status).toBe(200);
        expect(await listRoster()).toMatchObject([{ id: 'abc', displayName: 'New Name' }]);
    });

    it('shares same-origin workspace rosters and isolates distinct origins', async () => {
        await addCoworker({ id: '1', displayName: 'Workspace A' }, 'ws-a', REPO_ID);
        await addCoworker({ id: '2', displayName: 'Workspace B' }, 'ws-b', REPO_ID);
        await addCoworker({ id: '1', displayName: 'Other Repo' }, 'ws-a', OTHER_REPO_ID);

        expect(await listRoster('ws-a', REPO_ID)).toMatchObject([{ displayName: 'Workspace A' }, { displayName: 'Workspace B' }]);
        expect(await listRoster('ws-b', REPO_ID)).toMatchObject([{ displayName: 'Workspace A' }, { displayName: 'Workspace B' }]);
        expect(await listRoster('ws-a', OTHER_REPO_ID)).toMatchObject([{ displayName: 'Other Repo' }]);
    });

    it('migrates a legacy workspace/repo roster file into the origin roster on access', async () => {
        const legacyPaths = pullRequestCoworkerRosterPaths(dataDir, 'ws-a', REPO_ID);
        fs.mkdirSync(legacyPaths.dir, { recursive: true });
        fs.writeFileSync(legacyPaths.filePath, JSON.stringify({
            entries: [{
                id: 'legacy',
                displayName: 'Legacy Teammate',
                addedAt: '2026-06-05T00:00:00.000Z',
            }],
        }), 'utf-8');

        expect(await listRoster('ws-a', REPO_ID)).toMatchObject([{ id: 'legacy', displayName: 'Legacy Teammate' }]);
        const originPaths = pullRequestCoworkerRosterPaths(dataDir, 'ws-a', REPO_ID, originScopeForRepo());
        expect(fs.existsSync(originPaths.filePath)).toBe(true);
    });

    it('does not create entries for invalid bodies', async () => {
        const res = await addCoworker({ id: '1', displayName: '' });

        expect(res.status).toBe(400);
        expect(await listRoster()).toEqual([]);
    });

    it('rejects avatar URLs that contain credentials', async () => {
        const res = await addCoworker({
            id: '1',
            displayName: 'Secret Avatar',
            avatarUrl: 'https://user:token@avatars.example.invalid/u/1',
        });

        expect(res.status).toBe(400);
        expect(await listRoster()).toEqual([]);
    });
});

describe('DELETE /api/repos/:repoId/pull-requests/coworker-roster/:coworkerKey', () => {
    it('400s on empty coworker keys and keeps existing entries', async () => {
        await addCoworker({ id: '1', displayName: 'Keep Dev' });

        const res = await fetch(rosterDeleteUrl(REPO_ID, 'ws-1', '   '), { method: 'DELETE' });
        expect(res.status).toBe(400);
        expect(await listRoster()).toMatchObject([{ id: '1', displayName: 'Keep Dev' }]);
    });
});
