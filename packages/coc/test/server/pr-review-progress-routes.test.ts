/**
 * Tests for the PR review-progress HTTP routes (AC-04).
 *
 * Verifies GET/PUT semantics, headSha stale-head behavior, validation, and
 * origin-scoped multi-workspace storage isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerPrRoutes, clearPrListCache, clearPrDetailCache } from '../../src/server/repos/pr-routes';
import type { Route } from '../../src/server/types';
import { reviewProgressPaths } from '../../src/server/repos/review-progress-store';
import { resolveCanonicalOriginId } from '@plusplusoneplusplus/forge';

// pr-routes pulls in ProviderFactory / RepoTreeService / providers-config at
// module load; the review-progress endpoints do not exercise any of them so
// we can mock them out to keep the test self-contained.
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
const PR_ID = '42';

let tmpDir: string;
let dataDir: string;
let server: http.Server;
let baseUrl: string;

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

beforeEach(async () => {
    clearPrListCache();
    clearPrDetailCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-progress-routes-test-'));
    dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    (RepoTreeService as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        resolveRepo: vi.fn().mockImplementation((repoId: string) => Promise.resolve({
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

const progressUrl = (workspaceId: string, headSha: string) =>
    originProgressUrl(originScopeForRepo(), headSha, workspaceId, REPO_ID);
const progressUrlFor = (repoId: string, workspaceId: string, headSha: string) =>
    originProgressUrl(originScopeForRepo(repoId), headSha, workspaceId, repoId);
const legacyProgressUrl = (headSha?: string) => {
    const query = headSha ? `?headSha=${encodeURIComponent(headSha)}` : '';
    return `${baseUrl}/api/repos/${REPO_ID}/pull-requests/${PR_ID}/review-progress${query}`;
};
const originProgressUrl = (originId: string, headSha: string, workspaceId = 'ws-1', repoId = REPO_ID) =>
    `${baseUrl}/api/origins/${encodeURIComponent(originId)}/pull-requests/${PR_ID}/review-progress?workspaceId=${encodeURIComponent(workspaceId)}&repoId=${encodeURIComponent(repoId)}&headSha=${encodeURIComponent(headSha)}`;
function originScopeForRepo(repoId = REPO_ID): string {
    return resolveCanonicalOriginId({ remoteUrl: `https://github.com/org/${repoId}.git`, workspaceId: 'ws-1' });
}

describe('GET /api/origins/:originId/pull-requests/:prId/review-progress', () => {
    it('returns an empty record when no progress is stored', async () => {
        const res = await fetch(progressUrl('ws-1', 'sha-aaa'));
        expect(res.status).toBe(200);
        const body = await res.json() as { reviewedFiles: string[]; visitedFiles: string[]; headSha: string };
        expect(body.reviewedFiles).toEqual([]);
        expect(body.visitedFiles).toEqual([]);
        expect(body.headSha).toBe('sha-aaa');
    });

    it('400s when headSha query parameter is missing', async () => {
        const res = await fetch(`${baseUrl}/api/origins/${encodeURIComponent(originScopeForRepo())}/pull-requests/${PR_ID}/review-progress?workspaceId=ws-1&repoId=${REPO_ID}`);
        expect(res.status).toBe(400);
    });

    it('404s the removed repo-scoped review-progress alias', async () => {
        const res = await fetch(legacyProgressUrl('sha-aaa'));
        expect(res.status).toBe(404);
    });

    it('returns empty record when stored headSha differs (stale-head reset)', async () => {
        // Round-trip a write under headSha=sha-old.
        await fetch(`${baseUrl}/api/origins/${encodeURIComponent(originScopeForRepo())}/pull-requests/${PR_ID}/review-progress`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspaceId: 'ws-1', repoId: REPO_ID, headSha: 'sha-old',
                reviewedFiles: ['a.ts'], visitedFiles: ['a.ts'], lastSelectedFile: null,
            }),
        });

        const res = await fetch(progressUrl('ws-1', 'sha-new'));
        const body = await res.json() as { reviewedFiles: string[]; headSha: string };
        expect(body.reviewedFiles).toEqual([]);
        expect(body.headSha).toBe('sha-new');
    });
});

describe('origin-scoped PR review-progress routes', () => {
    it('persists and reads review progress directly under the canonical origin', async () => {
        const originId = originScopeForRepo();
        const putRes = await fetch(`${baseUrl}/api/origins/${encodeURIComponent(originId)}/pull-requests/${PR_ID}/review-progress`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspaceId: 'ws-a',
                repoId: REPO_ID,
                headSha: 'sha-aaa',
                reviewedFiles: ['a.ts'],
                visitedFiles: ['a.ts', 'b.ts'],
                lastSelectedFile: 'b.ts',
            }),
        });
        expect(putRes.status).toBe(200);

        const getRes = await fetch(originProgressUrl(originId, 'sha-aaa', 'ws-b', REPO_ID));
        expect(getRes.status).toBe(200);
        const body = await getRes.json() as { reviewedFiles: string[]; visitedFiles: string[]; lastSelectedFile: string };
        expect(body.reviewedFiles).toEqual(['a.ts']);
        expect(body.visitedFiles).toEqual(['a.ts', 'b.ts']);
        expect(body.lastSelectedFile).toBe('b.ts');

        const expected = path.join(dataDir, 'repos', originId, 'review-progress', `${PR_ID}.json`);
        expect(fs.existsSync(expected)).toBe(true);
    });

    it('isolates distinct explicit origins', async () => {
        await fetch(`${baseUrl}/api/origins/gh_org_repo_one/pull-requests/${PR_ID}/review-progress`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspaceId: 'ws-a',
                repoId: 'repo-one',
                headSha: 'sha-aaa',
                reviewedFiles: ['one.ts'],
                visitedFiles: ['one.ts'],
                lastSelectedFile: null,
            }),
        });
        await fetch(`${baseUrl}/api/origins/gh_org_repo_two/pull-requests/${PR_ID}/review-progress`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspaceId: 'ws-b',
                repoId: 'repo-two',
                headSha: 'sha-aaa',
                reviewedFiles: ['two.ts'],
                visitedFiles: ['two.ts'],
                lastSelectedFile: null,
            }),
        });

        const one = await (await fetch(originProgressUrl('gh_org_repo_one', 'sha-aaa', 'ws-c', 'repo-one'))).json() as { reviewedFiles: string[] };
        const two = await (await fetch(originProgressUrl('gh_org_repo_two', 'sha-aaa', 'ws-c', 'repo-two'))).json() as { reviewedFiles: string[] };
        expect(one.reviewedFiles).toEqual(['one.ts']);
        expect(two.reviewedFiles).toEqual(['two.ts']);
    });

    it('migrates legacy workspace/repo progress into the origin file on origin access', async () => {
        const originId = originScopeForRepo();
        const legacyPaths = reviewProgressPaths(dataDir, 'ws-a', REPO_ID, PR_ID);
        fs.mkdirSync(legacyPaths.dir, { recursive: true });
        fs.writeFileSync(legacyPaths.filePath, JSON.stringify({
            repoId: REPO_ID,
            prId: PR_ID,
            headSha: 'sha-aaa',
            reviewedFiles: ['legacy.ts'],
            visitedFiles: ['legacy.ts'],
            lastSelectedFile: 'legacy.ts',
            updatedAt: '2026-06-05T00:00:00.000Z',
        }), 'utf-8');

        const res = await fetch(originProgressUrl(originId, 'sha-aaa', 'ws-a', REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { reviewedFiles: string[]; lastSelectedFile: string };
        expect(body.reviewedFiles).toEqual(['legacy.ts']);
        expect(body.lastSelectedFile).toBe('legacy.ts');

        const originPaths = reviewProgressPaths(dataDir, 'ws-a', REPO_ID, PR_ID, originId);
        expect(fs.existsSync(originPaths.filePath)).toBe(true);
    });

    it('400s when origin-scoped GET omits headSha', async () => {
        const res = await fetch(`${baseUrl}/api/origins/${encodeURIComponent(originScopeForRepo())}/pull-requests/${PR_ID}/review-progress?workspaceId=ws-1&repoId=${REPO_ID}`);
        expect(res.status).toBe(400);
    });
});

describe('PUT /api/origins/:originId/pull-requests/:prId/review-progress', () => {
    it('persists the body and round-trips via GET', async () => {
        const putRes = await fetch(`${baseUrl}/api/origins/${encodeURIComponent(originScopeForRepo())}/pull-requests/${PR_ID}/review-progress`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspaceId: 'ws-1', repoId: REPO_ID, headSha: 'sha-aaa',
                reviewedFiles: ['a.ts'], visitedFiles: ['a.ts', 'b.ts'], lastSelectedFile: 'a.ts',
            }),
        });
        expect(putRes.status).toBe(200);

        const getRes = await fetch(progressUrl('ws-1', 'sha-aaa'));
        const body = await getRes.json() as { reviewedFiles: string[]; visitedFiles: string[]; lastSelectedFile: string };
        expect(body.reviewedFiles).toEqual(['a.ts']);
        expect(body.visitedFiles).toEqual(['a.ts', 'b.ts']);
        expect(body.lastSelectedFile).toBe('a.ts');
    });

    it('400s on invalid JSON', async () => {
        const res = await fetch(`${baseUrl}/api/origins/${encodeURIComponent(originScopeForRepo())}/pull-requests/${PR_ID}/review-progress`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: '{ not json',
        });
        expect(res.status).toBe(400);
    });

    it('400s when headSha is missing', async () => {
        const res = await fetch(`${baseUrl}/api/origins/${encodeURIComponent(originScopeForRepo())}/pull-requests/${PR_ID}/review-progress`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId: 'ws-1', repoId: REPO_ID, reviewedFiles: [] }),
        });
        expect(res.status).toBe(400);
    });

    it('400s when reviewedFiles contains non-strings', async () => {
        const res = await fetch(`${baseUrl}/api/origins/${encodeURIComponent(originScopeForRepo())}/pull-requests/${PR_ID}/review-progress`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId: 'ws-1', repoId: REPO_ID, headSha: 'sha', reviewedFiles: [42] }),
        });
        expect(res.status).toBe(400);
    });

    it('stores under <dataDir>/repos/<originId>/review-progress/<prId>.json', async () => {
        await fetch(`${baseUrl}/api/origins/${encodeURIComponent(originScopeForRepo())}/pull-requests/${PR_ID}/review-progress`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspaceId: 'ws-1', repoId: REPO_ID, headSha: 'sha-aaa',
                reviewedFiles: ['a.ts'], visitedFiles: ['a.ts'], lastSelectedFile: null,
            }),
        });
        const expected = path.join(dataDir, 'repos', originScopeForRepo(), 'review-progress', `${PR_ID}.json`);
        expect(fs.existsSync(expected)).toBe(true);
    });

    it('does not create any new top-level directory under <dataDir>', async () => {
        await fetch(`${baseUrl}/api/origins/${encodeURIComponent(originScopeForRepo())}/pull-requests/${PR_ID}/review-progress`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspaceId: 'ws-1', repoId: REPO_ID, headSha: 'sha-aaa',
                reviewedFiles: ['a.ts'], visitedFiles: ['a.ts'], lastSelectedFile: null,
            }),
        });
        const entries = fs.readdirSync(dataDir);
        // Only `repos/` (the repo-scoped root) should appear. Any other
        // top-level dir is a regression of the multi-repo invariant.
        expect(entries).toEqual(['repos']);
    });

    it('shares same-origin workspace progress and isolates distinct origins', async () => {
        const writeFor = (workspaceId: string, reviewed: string[], repoId = REPO_ID) => fetch(`${baseUrl}/api/origins/${encodeURIComponent(originScopeForRepo(repoId))}/pull-requests/${PR_ID}/review-progress`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspaceId, repoId, headSha: 'sha-aaa',
                reviewedFiles: reviewed, visitedFiles: reviewed, lastSelectedFile: null,
            }),
        });
        await writeFor('ws-a', ['a-only.ts']);
        await writeFor('ws-b', ['b-only.ts']);
        await writeFor('ws-a', ['other-only.ts'], OTHER_REPO_ID);

        const wsA = await (await fetch(progressUrl('ws-a', 'sha-aaa'))).json() as { reviewedFiles: string[] };
        const wsB = await (await fetch(progressUrl('ws-b', 'sha-aaa'))).json() as { reviewedFiles: string[] };
        const otherRepo = await (await fetch(progressUrlFor(OTHER_REPO_ID, 'ws-a', 'sha-aaa'))).json() as { reviewedFiles: string[] };
        expect(wsA.reviewedFiles).toEqual(['b-only.ts']);
        expect(wsB.reviewedFiles).toEqual(['b-only.ts']);
        expect(otherRepo.reviewedFiles).toEqual(['other-only.ts']);
    });

    it('accepts workspaceId via query when body does not contain it', async () => {
        await fetch(`${baseUrl}/api/origins/${encodeURIComponent(originScopeForRepo())}/pull-requests/${PR_ID}/review-progress?workspaceId=ws-1&repoId=${REPO_ID}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                headSha: 'sha-aaa',
                reviewedFiles: ['a.ts'], visitedFiles: ['a.ts'], lastSelectedFile: null,
            }),
        });
        const expected = path.join(dataDir, 'repos', originScopeForRepo(), 'review-progress', `${PR_ID}.json`);
        expect(fs.existsSync(expected)).toBe(true);
    });

    it('migrates a legacy workspace/repo progress file into the origin progress file on access', async () => {
        const legacyPaths = reviewProgressPaths(dataDir, 'ws-a', REPO_ID, PR_ID);
        fs.mkdirSync(legacyPaths.dir, { recursive: true });
        fs.writeFileSync(legacyPaths.filePath, JSON.stringify({
            repoId: REPO_ID,
            prId: PR_ID,
            headSha: 'sha-aaa',
            reviewedFiles: ['legacy.ts'],
            visitedFiles: ['legacy.ts'],
            lastSelectedFile: 'legacy.ts',
            updatedAt: '2026-06-05T00:00:00.000Z',
        }), 'utf-8');

        const res = await fetch(progressUrl('ws-a', 'sha-aaa'));
        expect(res.status).toBe(200);
        const body = await res.json() as { reviewedFiles: string[]; lastSelectedFile: string };
        expect(body.reviewedFiles).toEqual(['legacy.ts']);
        expect(body.lastSelectedFile).toBe('legacy.ts');
        const originPaths = reviewProgressPaths(dataDir, 'ws-a', REPO_ID, PR_ID, originScopeForRepo());
        expect(fs.existsSync(originPaths.filePath)).toBe(true);
    });
});
