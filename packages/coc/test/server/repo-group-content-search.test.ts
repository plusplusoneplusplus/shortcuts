/**
 * Tests for repo-group content search:
 * - GET /api/repo-groups/:id/search/content over real temporary Git repos
 * - fair apportionment of the group-wide match cap
 * - partial success, stale membership, cancellation and input validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerRepoGroupRoutes } from '../../src/server/workspaces/repo-group-handler';
import {
    apportionMatchQuota,
    searchRepoGroupContent,
    RepoGroupContentSearchAbortedError,
    REPO_GROUP_CONTENT_SEARCH_MAX_RESULTS,
} from '../../src/server/workspaces/repo-group-content-search';
import { TrackedContentSearchUnavailableError } from '../../src/server/repos/tree-service';
import { createRequestHandler } from '../../src/server/router';
import { RepoTreeService } from '../../src/server/repos/tree-service';
import type { Route } from '../../src/server/types';
import type { ContentMatch } from '../../src/server/repos/types';
import type { RepoGroupMember } from '../../src/server/workspaces/repo-group-workspace';
import { FileProcessStore, type WorkspaceInfo } from '@plusplusoneplusplus/forge';

const GIT = (() => {
    try {
        childProcess.execSync('git --version', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
})();

function request(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({
                    status: res.statusCode || 0,
                    body: Buffer.concat(chunks).toString('utf-8'),
                }));
            },
        );
        req.on('error', reject);
        req.end();
    });
}

function member(workspaceId: string, name: string): RepoGroupMember {
    return { workspaceId, name, rootPath: `/tmp/${workspaceId}`, stale: false, readOnly: false };
}

function match(pathName: string, line: number): ContentMatch {
    return { path: pathName, line, text: 'needle', startColumn: 0, endColumn: 6, before: [], after: [] };
}

function stubService(byRepo: Record<string, ContentMatch[] | Error>) {
    return {
        searchContent: vi.fn(async (repoId: string) => {
            const entry = byRepo[repoId];
            if (entry instanceof Error) throw entry;
            return { matches: entry ?? [], truncated: false };
        }),
    };
}

// ============================================================================
// apportionMatchQuota
// ============================================================================

describe('apportionMatchQuota', () => {
    it('gives every member an equal share when all can use it', () => {
        expect(apportionMatchQuota([500, 500], 500)).toEqual([250, 250]);
        expect(apportionMatchQuota([300, 300, 300, 300], 500)).toEqual([125, 125, 125, 125]);
    });

    it('redistributes the share a small member could not use', () => {
        // 500/2 = 250 each; the first wants 10, so the other gets the rest.
        expect(apportionMatchQuota([10, 900], 500)).toEqual([10, 490]);
        expect(apportionMatchQuota([1, 2, 900], 500)).toEqual([1, 2, 497]);
    });

    it('never exceeds a member demand or the cap', () => {
        expect(apportionMatchQuota([3, 4], 500)).toEqual([3, 4]);
        expect(apportionMatchQuota([0, 0], 500)).toEqual([0, 0]);
        const allocated = apportionMatchQuota([700, 700, 700], 500);
        expect(allocated.reduce((a, b) => a + b, 0)).toBe(500);
    });

    it('hands out indivisible remainder units in membership order', () => {
        expect(apportionMatchQuota([5, 5, 5], 2)).toEqual([1, 1, 0]);
        expect(apportionMatchQuota([5, 5, 5], 7)).toEqual([3, 2, 2]);
    });

    it('is deterministic for a given member order', () => {
        const counts = [12, 300, 7, 480, 1];
        const first = apportionMatchQuota(counts, 500);
        for (let i = 0; i < 5; i++) expect(apportionMatchQuota(counts, 500)).toEqual(first);
    });

    it('treats a non-positive cap as nothing to give', () => {
        expect(apportionMatchQuota([5, 5], 0)).toEqual([0, 0]);
        expect(apportionMatchQuota([5, 5], -3)).toEqual([0, 0]);
    });
});

// ============================================================================
// searchRepoGroupContent
// ============================================================================

describe('searchRepoGroupContent', () => {
    const options = { fileScope: 'tracked' as const };

    it('keeps group-membership order and labels each member', async () => {
        const service = stubService({
            'repo-b': [match('src/b.ts', 1)],
            'repo-a': [match('src/a.ts', 2)],
        });
        const result = await searchRepoGroupContent({
            members: [member('repo-a', 'Repo A'), member('repo-b', 'Repo B')],
            service,
            query: 'needle',
            options,
        });
        expect(result.status).toBe('complete');
        expect(result.members.map(m => [m.workspaceId, m.repoName])).toEqual([
            ['repo-a', 'Repo A'],
            ['repo-b', 'Repo B'],
        ]);
        expect(result.totalMatches).toBe(2);
        expect(result.truncated).toBe(false);
    });

    it('keeps duplicate relative paths distinct per member', async () => {
        const service = stubService({
            'repo-a': [match('README.md', 3)],
            'repo-b': [match('README.md', 9)],
        });
        const result = await searchRepoGroupContent({
            members: [member('repo-a', 'Repo A'), member('repo-b', 'Repo B')],
            service,
            query: 'needle',
            options,
        });
        expect(result.members.map(m => ({ id: m.workspaceId, line: m.matches[0].line }))).toEqual([
            { id: 'repo-a', line: 3 },
            { id: 'repo-b', line: 9 },
        ]);
    });

    it('caps the group fairly so one member cannot eat the budget', async () => {
        const hog = Array.from({ length: 900 }, (_, i) => match('big.ts', i + 1));
        const small = Array.from({ length: 12 }, (_, i) => match('small.ts', i + 1));
        const result = await searchRepoGroupContent({
            members: [member('repo-a', 'Repo A'), member('repo-b', 'Repo B')],
            service: stubService({ 'repo-a': hog, 'repo-b': small }),
            query: 'needle',
            options,
        });
        expect(result.totalMatches).toBe(REPO_GROUP_CONTENT_SEARCH_MAX_RESULTS);
        expect(result.members.map(m => m.matches.length)).toEqual([488, 12]);
        expect(result.members[0].truncated).toBe(true);
        expect(result.members[0].totalMatches).toBe(900);
        expect(result.members[1].truncated).toBe(false);
        expect(result.truncated).toBe(true);
    });

    it('reports a member failure without losing the healthy members', async () => {
        const result = await searchRepoGroupContent({
            members: [member('repo-a', 'Repo A'), member('repo-b', 'Repo B')],
            service: stubService({ 'repo-a': [match('a.ts', 1)], 'repo-b': new Error('disk on fire') }),
            query: 'needle',
            options,
        });
        expect(result.status).toBe('partial');
        expect(result.members.map(m => m.workspaceId)).toEqual(['repo-a']);
        expect(result.failures).toEqual([
            { workspaceId: 'repo-b', repoName: 'Repo B', reason: 'error', message: 'disk on fire' },
        ]);
        expect(result.searchedMemberCount).toBe(1);
        expect(result.failedMemberCount).toBe(1);
    });

    it('marks a non-Git member unavailable rather than failed', async () => {
        const result = await searchRepoGroupContent({
            members: [member('repo-a', 'Repo A')],
            service: stubService({ 'repo-a': new TrackedContentSearchUnavailableError('no git here') }),
            query: 'needle',
            options,
        });
        expect(result.status).toBe('failed');
        expect(result.failures[0]).toMatchObject({ workspaceId: 'repo-a', reason: 'unavailable' });
    });

    it('reports every member failing as a failed query', async () => {
        const result = await searchRepoGroupContent({
            members: [member('repo-a', 'Repo A'), member('repo-b', 'Repo B')],
            service: stubService({ 'repo-a': new Error('x'), 'repo-b': new Error('y') }),
            query: 'needle',
            options,
        });
        expect(result.status).toBe('failed');
        expect(result.members).toEqual([]);
        expect(result.failures).toHaveLength(2);
    });

    it('names stale members and never searches them', async () => {
        const service = stubService({ 'repo-a': [match('a.ts', 1)] });
        const result = await searchRepoGroupContent({
            members: [
                member('repo-a', 'Repo A'),
                { workspaceId: 'repo-gone', stale: true, staleReason: 'workspace-removed', readOnly: false },
                { workspaceId: 'repo-moved', stale: true, staleReason: 'path-missing', name: 'Repo Moved', readOnly: false },
            ],
            service,
            query: 'needle',
            options,
        });
        expect(service.searchContent).toHaveBeenCalledTimes(1);
        expect(result.status).toBe('partial');
        expect(result.unavailableMemberCount).toBe(2);
        expect(result.failures.map(f => [f.workspaceId, f.reason])).toEqual([
            ['repo-gone', 'stale'],
            ['repo-moved', 'stale'],
        ]);
        expect(result.failures[1].repoName).toBe('Repo Moved');
    });

    it('distinguishes a group with no live member from a failed search', async () => {
        const service = stubService({});
        const result = await searchRepoGroupContent({
            members: [{ workspaceId: 'repo-gone', stale: true, staleReason: 'workspace-removed', readOnly: false }],
            service,
            query: 'needle',
            options,
        });
        expect(result.status).toBe('no-searchable-members');
        expect(service.searchContent).not.toHaveBeenCalled();
    });

    it('bounds member-search concurrency', async () => {
        let active = 0;
        let peak = 0;
        const service = {
            searchContent: vi.fn(async () => {
                active++;
                peak = Math.max(peak, active);
                await new Promise(resolve => setTimeout(resolve, 5));
                active--;
                return { matches: [], truncated: false };
            }),
        };
        await searchRepoGroupContent({
            members: Array.from({ length: 8 }, (_, i) => member(`repo-${i}`, `Repo ${i}`)),
            service,
            query: 'needle',
            options,
        });
        expect(peak).toBe(4);
    });

    it('throws rather than answering once the caller aborted', async () => {
        const signal = { aborted: false };
        const service = {
            searchContent: vi.fn(async () => {
                signal.aborted = true;
                return { matches: [match('a.ts', 1)], truncated: false };
            }),
        };
        await expect(searchRepoGroupContent({
            members: [member('repo-a', 'Repo A')],
            service,
            query: 'needle',
            options,
            signal,
        })).rejects.toBeInstanceOf(RepoGroupContentSearchAbortedError);
    });

    it('lets an invalid regex out so the route can answer once', async () => {
        const invalid = Object.assign(new Error('bad regex'), { code: 'InvalidArg' });
        await expect(searchRepoGroupContent({
            members: [member('repo-a', 'Repo A')],
            service: stubService({ 'repo-a': invalid }),
            query: '(',
            options: { ...options, regex: true },
        })).rejects.toThrow('bad regex');
    });

    it('propagates the member truncation the repo search itself reported', async () => {
        const service = {
            searchContent: vi.fn(async () => ({ matches: [match('a.ts', 1)], truncated: true })),
        };
        const result = await searchRepoGroupContent({
            members: [member('repo-a', 'Repo A')],
            service,
            query: 'needle',
            options,
        });
        expect(result.truncated).toBe(true);
        expect(result.members[0].truncated).toBe(true);
    });
});

// ============================================================================
// GET /api/repo-groups/:id/search/content
// ============================================================================

const suiteIfGit = GIT ? describe : describe.skip;

suiteIfGit('GET /api/repo-groups/:id/search/content', () => {
    let dataDir: string;
    let store: FileProcessStore;
    let server: http.Server;
    let baseUrl: string;
    let repoA: WorkspaceInfo;
    let repoB: WorkspaceInfo;
    let repoTreeService: RepoTreeService;
    let groupId: string;

    function write(workspace: WorkspaceInfo, relative: string, contents: string): void {
        const target = path.join(workspace.rootPath, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contents, 'utf-8');
    }

    function track(workspace: WorkspaceInfo): void {
        childProcess.execSync('git add -A', { cwd: workspace.rootPath, stdio: 'pipe' });
    }

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-group-content-search-'));
        store = new FileProcessStore({ dataDir });

        repoA = { id: 'repo-a', name: 'Repo A', rootPath: path.join(dataDir, 'checkouts', 'repo a') };
        repoB = { id: 'repo-b', name: 'Repo B', rootPath: path.join(dataDir, 'checkouts', 'repo-b') };
        for (const ws of [repoA, repoB]) {
            fs.mkdirSync(ws.rootPath, { recursive: true });
            childProcess.execSync('git init', { cwd: ws.rootPath, stdio: 'pipe' });
            await store.registerWorkspace(ws);
        }
        repoTreeService = new RepoTreeService(dataDir, { fileListCacheTtlMs: 60_000 }, store);

        const routes: Route[] = [];
        registerRepoGroupRoutes(routes, store, dataDir, { repoTreeService });
        server = http.createServer(createRequestHandler({ routes, spaHtml: () => '<html></html>' }));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

        fs.mkdirSync(path.join(dataDir, 'repos', 'group-platform'), { recursive: true });
        fs.writeFileSync(
            path.join(dataDir, 'repos', 'group-platform', 'group.json'),
            JSON.stringify({ name: 'Platform', members: [repoA.id, repoB.id] }),
            'utf-8',
        );
        groupId = 'group-platform';
        await store.registerWorkspace({
            id: groupId, name: 'Platform', rootPath: path.join(dataDir, 'repos', groupId), virtual: true,
        });
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(dataDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    function search(query: string, extra = ''): Promise<{ status: number; body: string }> {
        return request(`${baseUrl}/api/repo-groups/${groupId}/search/content?q=${encodeURIComponent(query)}&fileScope=tracked${extra}`);
    }

    it('searches tracked files in every live member and labels the results', async () => {
        write(repoA, 'src/alpha.ts', 'const needle = 1;\n');
        write(repoB, 'src/beta.ts', 'log("needle");\n');
        track(repoA);
        track(repoB);

        const res = await search('needle');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe('complete');
        expect(body.members.map((m: { workspaceId: string; repoName: string }) => [m.workspaceId, m.repoName]))
            .toEqual([['repo-a', 'Repo A'], ['repo-b', 'Repo B']]);
        expect(body.members[0].matches[0]).toMatchObject({ path: 'src/alpha.ts', line: 1 });
        expect(body.members[1].matches[0]).toMatchObject({ path: 'src/beta.ts', line: 1 });
        expect(body.totalMatches).toBe(2);
        expect(JSON.stringify(body)).not.toContain(dataDir);
    });

    it('handles spaces and non-ASCII paths', async () => {
        write(repoA, 'docs/my notes/тема.md', 'needle here\n');
        write(repoB, 'ünïcode/ファイル.txt', 'needle there\n');
        track(repoA);
        track(repoB);

        const body = JSON.parse((await search('needle')).body);
        expect(body.members[0].matches[0].path).toBe('docs/my notes/тема.md');
        expect(body.members[1].matches[0].path).toBe('ünïcode/ファイル.txt');
    });

    it('excludes untracked files unless the caller opts in', async () => {
        write(repoA, 'tracked.ts', 'needle\n');
        track(repoA);
        write(repoA, 'fresh.ts', 'needle\n');

        const tracked = JSON.parse((await search('needle')).body);
        expect(tracked.members[0].matches.map((m: ContentMatch) => m.path)).toEqual(['tracked.ts']);

        const withUntracked = JSON.parse((await search('needle', '&includeUntracked=true')).body);
        expect(withUntracked.members[0].matches.map((m: ContentMatch) => m.path).sort())
            .toEqual(['fresh.ts', 'tracked.ts']);
    });

    it('keeps duplicate relative paths separated by member', async () => {
        write(repoA, 'README.md', 'needle in A\n');
        write(repoB, 'README.md', 'other\nneedle in B\n');
        track(repoA);
        track(repoB);

        const body = JSON.parse((await search('needle')).body);
        expect(body.members.map((m: { workspaceId: string; matches: ContentMatch[] }) => ({
            id: m.workspaceId, path: m.matches[0].path, line: m.matches[0].line,
        }))).toEqual([
            { id: 'repo-a', path: 'README.md', line: 1 },
            { id: 'repo-b', path: 'README.md', line: 2 },
        ]);
    });

    it('composes modes and globs with the Git candidate set', async () => {
        write(repoA, 'src/case.ts', 'Needle\nneedle\n');
        write(repoA, 'docs/case.md', 'needle\n');
        track(repoA);
        write(repoB, 'src/other.ts', 'needleish\n');
        track(repoB);

        const sensitive = JSON.parse((await search('Needle', '&caseSensitive=true')).body);
        expect(sensitive.totalMatches).toBe(1);

        const word = JSON.parse((await search('needle', '&wholeWord=true')).body);
        expect(word.members.every((m: { matches: ContentMatch[] }) =>
            m.matches.every(match => match.path !== 'src/other.ts'))).toBe(true);

        const included = JSON.parse((await search('needle', '&include=src/**')).body);
        expect(included.members.flatMap((m: { matches: ContentMatch[] }) => m.matches)
            .every((match: ContentMatch) => match.path.startsWith('src/'))).toBe(true);

        const excluded = JSON.parse((await search('needle', '&exclude=docs/**')).body);
        expect(excluded.members.flatMap((m: { matches: ContentMatch[] }) => m.matches)
            .some((match: ContentMatch) => match.path.startsWith('docs/'))).toBe(false);

        const regex = JSON.parse((await search('n[e]+dle', '&regex=true')).body);
        expect(regex.totalMatches).toBeGreaterThan(0);
    });

    it('returns an empty complete answer when nothing matches', async () => {
        write(repoA, 'a.ts', 'nothing\n');
        track(repoA);
        const body = JSON.parse((await search('needle')).body);
        expect(body).toMatchObject({ status: 'complete', members: [], totalMatches: 0, truncated: false });
    });

    it('keeps healthy members when one is not a Git repository', async () => {
        write(repoA, 'a.ts', 'needle\n');
        track(repoA);
        fs.rmSync(path.join(repoB.rootPath, '.git'), { recursive: true, force: true });

        const body = JSON.parse((await search('needle')).body);
        expect(body.status).toBe('partial');
        expect(body.members.map((m: { workspaceId: string }) => m.workspaceId)).toEqual(['repo-a']);
        expect(body.failures).toEqual([
            expect.objectContaining({ workspaceId: 'repo-b', repoName: 'Repo B', reason: 'unavailable' }),
        ]);
    });

    it('reports a member removed from the registry as stale and searches the rest', async () => {
        write(repoA, 'a.ts', 'needle\n');
        track(repoA);
        await store.removeWorkspace(repoB.id);

        const body = JSON.parse((await search('needle')).body);
        expect(body.status).toBe('partial');
        expect(body.unavailableMemberCount).toBe(1);
        expect(body.failures).toEqual([
            expect.objectContaining({ workspaceId: 'repo-b', reason: 'stale' }),
        ]);
    });

    it('caps the whole group at 500 matches, apportioned fairly', async () => {
        // Spread across files: the single-repo engine also caps matches per
        // file, so one enormous file cannot reach the group cap on its own.
        const block = Array.from({ length: 10 }, () => 'needle').join('\n') + '\n';
        for (let i = 0; i < 80; i++) write(repoA, `big/file-${i}.ts`, block);
        write(repoB, 'small.ts', Array.from({ length: 10 }, () => 'needle').join('\n') + '\n');
        track(repoA);
        track(repoB);

        const body = JSON.parse((await search('needle')).body);
        expect(body.totalMatches).toBe(500);
        expect(body.members.map((m: { matches: ContentMatch[] }) => m.matches.length)).toEqual([490, 10]);
        expect(body.truncated).toBe(true);
        expect(body.members[1].truncated).toBe(false);
    });

    it('honours an explicit smaller limit', async () => {
        write(repoA, 'a.ts', 'needle\nneedle\nneedle\n');
        write(repoB, 'b.ts', 'needle\nneedle\nneedle\n');
        track(repoA);
        track(repoB);

        const body = JSON.parse((await search('needle', '&limit=4')).body);
        expect(body.limit).toBe(4);
        expect(body.totalMatches).toBe(4);
        expect(body.members.map((m: { matches: ContentMatch[] }) => m.matches.length)).toEqual([2, 2]);
    });

    it('rejects a missing query, a malformed flag and a bad fileScope with 400', async () => {
        expect((await request(`${baseUrl}/api/repo-groups/${groupId}/search/content`)).status).toBe(400);
        expect((await request(`${baseUrl}/api/repo-groups/${groupId}/search/content?q=`)).status).toBe(400);
        expect((await search('x', '&caseSensitive=maybe')).status).toBe(400);
        expect((await search('x', '&limit=abc')).status).toBe(400);
        expect((await request(
            `${baseUrl}/api/repo-groups/${groupId}/search/content?q=x&fileScope=all`)).status).toBe(400);
    });

    it('rejects an invalid regex with 400 rather than a per-member failure', async () => {
        write(repoA, 'a.ts', 'needle\n');
        track(repoA);
        const res = await search('(unclosed', '&regex=true');
        expect(res.status).toBe(400);
    });

    it('returns 404 for a missing or non-group id', async () => {
        expect((await request(`${baseUrl}/api/repo-groups/group-nope/search/content?q=x`)).status).toBe(404);
        expect((await request(`${baseUrl}/api/repo-groups/repo-a/search/content?q=x`)).status).toBe(404);
    });

    it('never exposes a filesystem root in a failure message', async () => {
        fs.rmSync(path.join(repoB.rootPath, '.git'), { recursive: true, force: true });
        write(repoA, 'a.ts', 'needle\n');
        track(repoA);
        const body = JSON.parse((await search('needle')).body);
        expect(JSON.stringify(body.failures)).not.toContain(repoB.rootPath);
    });
});
