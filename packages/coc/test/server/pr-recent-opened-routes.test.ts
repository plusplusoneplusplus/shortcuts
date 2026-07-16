/**
 * Tests for the recent-opened pull-request HTTP routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerPrRoutes } from '../../src/server/repos/pr-routes';
import { recentOpenedPullRequestsPaths } from '../../src/server/repos/recent-opened-pr-store';
import type { Route } from '../../src/server/types';
import { resolveCanonicalOriginId } from '@plusplusoneplusplus/forge';

vi.mock('../../src/server/providers/provider-factory', () => ({
    ProviderFactory: {
        detectProviderType: vi.fn().mockReturnValue('github'),
        createPullRequestsService: vi.fn(),
    },
}));

vi.mock('../../src/server/repos/tree-service', () => ({
    RepoTreeService: vi.fn().mockImplementation(function () {
        return { resolveRepo: vi.fn() };
    }),
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

function legacyRecentUrl(repoId = REPO_ID): string {
    return `${baseUrl}/api/repos/${encodeURIComponent(repoId)}/pull-requests/recent-opened`;
}

function originRecentUrl(originId: string, workspaceId?: string, repoId?: string): string {
    const params = new URLSearchParams();
    if (workspaceId) params.set('workspaceId', workspaceId);
    if (repoId) params.set('repoId', repoId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return `${baseUrl}/api/origins/${encodeURIComponent(originId)}/pull-requests/recent-opened${suffix}`;
}

function originRecentDeleteUrl(originId: string, prNumber: string | number, workspaceId?: string, repoId?: string): string {
    const params = new URLSearchParams();
    if (workspaceId) params.set('workspaceId', workspaceId);
    if (repoId) params.set('repoId', repoId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return `${baseUrl}/api/origins/${encodeURIComponent(originId)}/pull-requests/recent-opened/${encodeURIComponent(String(prNumber))}${suffix}`;
}

function originScopeForRepo(repoId = REPO_ID): string {
    return resolveCanonicalOriginId({ remoteUrl: `https://github.com/org/${repoId}.git`, workspaceId: 'ws-1' });
}

async function recordRecent(
    number: number,
    title: string,
    workspaceId = 'ws-1',
    repoId = REPO_ID,
    extra: Record<string, unknown> = {},
): Promise<Response> {
    return fetch(originRecentUrl(originScopeForRepo(repoId)), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, repoId, number, title, ...extra }),
    });
}

async function listRecent(workspaceId = 'ws-1', repoId = REPO_ID): Promise<Array<{ number: number; title: string; webUrl?: string }>> {
    const res = await fetch(originRecentUrl(originScopeForRepo(repoId), workspaceId, repoId));
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: Array<{ number: number; title: string; webUrl?: string }> };
    return body.entries;
}

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-recent-opened-routes-test-'));
    dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    (RepoTreeService as ReturnType<typeof vi.fn>).mockImplementation(function () {
        return {
            resolveRepo: mockResolveRepo = vi.fn().mockImplementation((repoId: string) => Promise.resolve({
                id: repoId,
                name: repoId,
                localPath: path.join(tmpDir, repoId),
                headSha: 'abc1234',
                clonedAt: new Date().toISOString(),
                remoteUrl: `https://github.com/org/${repoId}.git`,
            })),
        };
    });

    server = makeServer(dataDir);
    await startServer();
});

afterEach(async () => {
    vi.clearAllMocks();
    await stopServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/origins/:originId/pull-requests/recent-opened', () => {
    it('returns an empty list when no recent PRs are stored', async () => {
        const entries = await listRecent('ws-1');
        expect(entries).toEqual([]);
    });

    it('404s the removed repo-scoped recent-opened alias', async () => {
        const res = await fetch(legacyRecentUrl('missing-repo'));
        expect(res.status).toBe(404);
        expect(mockResolveRepo).not.toHaveBeenCalled();
    });
});

describe('POST /api/origins/:originId/pull-requests/recent-opened', () => {
    it('records and persists a recent PR entry under the origin-scoped data layout', async () => {
        const res = await recordRecent(42, '  Add feature X  ', 'ws-1', REPO_ID, {
            webUrl: 'https://github.com/org/repo/pull/42?notification_secret=drop#files',
        });
        expect(res.status).toBe(200);

        const body = await res.json() as { entries: Array<{ workspaceId: string; repoId: string; number: number; title: string; webUrl?: string; openedAt: string }> };
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0]).toMatchObject({
            workspaceId: 'ws-1',
            repoId: REPO_ID,
            number: 42,
            title: 'Add feature X',
            webUrl: 'https://github.com/org/repo/pull/42',
        });
        expect(new Date(body.entries[0].openedAt).toString()).not.toBe('Invalid Date');

        const paths = recentOpenedPullRequestsPaths(dataDir, 'ws-1', REPO_ID, originScopeForRepo());
        expect(fs.existsSync(paths.filePath)).toBe(true);
        expect(paths.filePath.endsWith(path.join('repos', originScopeForRepo(), 'recent-opened-pull-requests', 'index.json'))).toBe(true);
        expect(fs.readdirSync(dataDir)).toEqual(['repos']);
    });

    it('dedupes by PR number and moves reopened entries to the top', async () => {
        await recordRecent(1, 'First');
        await recordRecent(2, 'Second');
        await recordRecent(1, 'First updated');

        const entries = await listRecent();
        expect(entries.map(entry => entry.number)).toEqual([1, 2]);
        expect(entries[0].title).toBe('First updated');
    });

    it('keeps the 10 most recent entries', async () => {
        for (let i = 1; i <= 12; i++) {
            const res = await recordRecent(i, `PR ${i}`);
            expect(res.status).toBe(200);
        }

        const entries = await listRecent();
        expect(entries).toHaveLength(10);
        expect(entries.map(entry => entry.number)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    });

    it('shares same-origin workspace records and isolates distinct origins', async () => {
        await recordRecent(7, 'Workspace A', 'ws-a', REPO_ID);
        await recordRecent(8, 'Workspace B', 'ws-b', REPO_ID);
        await recordRecent(7, 'Other repo', 'ws-a', OTHER_REPO_ID);

        expect(await listRecent('ws-a', REPO_ID)).toMatchObject([{ title: 'Workspace B' }, { title: 'Workspace A' }]);
        expect(await listRecent('ws-b', REPO_ID)).toMatchObject([{ title: 'Workspace B' }, { title: 'Workspace A' }]);
        expect(await listRecent('ws-a', OTHER_REPO_ID)).toMatchObject([{ title: 'Other repo' }]);
    });

    it('migrates a legacy workspace/repo recent file into the origin list on access', async () => {
        const legacyPaths = recentOpenedPullRequestsPaths(dataDir, 'ws-a', REPO_ID);
        fs.mkdirSync(legacyPaths.dir, { recursive: true });
        fs.writeFileSync(legacyPaths.filePath, JSON.stringify({
            entries: [{
                workspaceId: 'ws-a',
                repoId: REPO_ID,
                number: 99,
                title: 'Legacy recent PR',
                openedAt: '2026-06-05T00:00:00.000Z',
            }],
        }), 'utf-8');

        expect(await listRecent('ws-a', REPO_ID)).toMatchObject([{ number: 99, title: 'Legacy recent PR' }]);
        const originPaths = recentOpenedPullRequestsPaths(dataDir, 'ws-a', REPO_ID, originScopeForRepo());
        expect(fs.existsSync(originPaths.filePath)).toBe(true);
    });

    it('does not create entries for invalid bodies', async () => {
        const res = await fetch(originRecentUrl(originScopeForRepo(), 'ws-1', REPO_ID), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId: 'ws-1', repoId: REPO_ID, number: 42 }),
        });

        expect(res.status).toBe(400);
        expect(await listRecent('ws-1')).toEqual([]);
    });

    it('rejects web URLs that contain credentials', async () => {
        const res = await recordRecent(42, 'Secret URL', 'ws-1', REPO_ID, {
            webUrl: 'https://token:secret@github.com/org/repo/pull/42',
        });

        expect(res.status).toBe(400);
        expect(await listRecent('ws-1')).toEqual([]);
    });
});

describe('DELETE /api/origins/:originId/pull-requests/recent-opened/:prNumber', () => {
    it('removes a stale recent entry after confirmed 404 handling', async () => {
        await recordRecent(42, 'Stale PR');

        const res = await fetch(originRecentDeleteUrl(originScopeForRepo(), 42, 'ws-1', REPO_ID), { method: 'DELETE' });
        expect(res.status).toBe(200);
        const body = await res.json() as { entries: unknown[] };
        expect(body.entries).toEqual([]);
        expect(await listRecent('ws-1')).toEqual([]);
    });

    it('400s on invalid PR numbers and keeps existing entries', async () => {
        await recordRecent(42, 'Keep PR');

        const res = await fetch(originRecentDeleteUrl(originScopeForRepo(), 'not-a-number', 'ws-1', REPO_ID), { method: 'DELETE' });
        expect(res.status).toBe(400);
        expect(await listRecent('ws-1')).toMatchObject([{ number: 42 }]);
    });
});

describe('origin-scoped recent-opened pull-request routes', () => {
    it('round-trips entries directly under /api/origins/:originId without resolving a repo', async () => {
        const originId = originScopeForRepo();

        const post = await fetch(originRecentUrl(originId), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: 42, title: 'Origin recent PR' }),
        });
        expect(post.status).toBe(200);
        expect(mockResolveRepo).not.toHaveBeenCalled();

        const created = await post.json() as { entries: Array<{ workspaceId: string; repoId: string; number: number; title: string }> };
        expect(created.entries).toMatchObject([{
            workspaceId: originId,
            repoId: originId,
            number: 42,
            title: 'Origin recent PR',
        }]);

        const paths = recentOpenedPullRequestsPaths(dataDir, originId, originId, { storageOriginId: originId });
        expect(paths.filePath.endsWith(path.join('repos', originId, 'recent-opened-pull-requests', 'index.json'))).toBe(true);
        expect(fs.existsSync(paths.filePath)).toBe(true);

        const get = await fetch(originRecentUrl(originId));
        expect(get.status).toBe(200);
        expect(await get.json()).toMatchObject({ entries: [{ number: 42, title: 'Origin recent PR' }] });

        const del = await fetch(originRecentDeleteUrl(originId, 42), { method: 'DELETE' });
        expect(del.status).toBe(200);
        expect(await del.json()).toEqual({ entries: [] });
    });

    it('uses optional workspace/repo metadata only to migrate legacy files into the origin list', async () => {
        const legacyPaths = recentOpenedPullRequestsPaths(dataDir, 'ws-a', REPO_ID);
        fs.mkdirSync(legacyPaths.dir, { recursive: true });
        fs.writeFileSync(legacyPaths.filePath, JSON.stringify({
            entries: [{
                workspaceId: 'ws-a',
                repoId: REPO_ID,
                number: 77,
                title: 'Legacy origin recent PR',
                openedAt: '2026-06-05T00:00:00.000Z',
            }],
        }), 'utf-8');

        const res = await fetch(originRecentUrl(originScopeForRepo(), 'ws-a', REPO_ID));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ entries: [{ number: 77, title: 'Legacy origin recent PR' }] });
        expect(mockResolveRepo).not.toHaveBeenCalled();
    });
});
