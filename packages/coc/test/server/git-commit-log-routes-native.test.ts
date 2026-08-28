/**
 * The two commit-log routes, against a real repository.
 *
 * `GET /git/commits` and `GET /git/commits/:hash` run their own
 * `git log --format=%H%n%h%n%s%n%an%n%ae%n%aI%n%P%n%b -z` through
 * `execGitArgsAsync` and parse it by splitting on NUL and newlines. Everything
 * that used to test them mocked that command and asserted on its argv, so
 * nothing checked what the routes actually put on the wire — and the argv is
 * the part least worth pinning. This file drives real repositories and compares
 * each field against what `git log` itself prints.
 *
 * The routes are deliberately **not** collapsed onto `GitLogService`, which
 * answers the same question natively. Measured on this repo (569 refs, 7 packs,
 * 2-core arm64): the route's single `git log` costs 4.31 ms for a 50-commit
 * page and `GitLogService.getCommits` costs 9.44 ms, because `gix` pays ~4.7 ms
 * per repository open to abbreviate the first `%h` where git pays nothing
 * measurable. The child the collapse would remove is spawned from Rust on a
 * libuv worker, not on the event-loop thread, so it is not the kind of spawn
 * this move exists to delete. The duplication is real; paying 2.2x for the Git
 * tab's main list to remove it is not. See `coc-native/AGENTS.md`.
 *
 * The one mock rejects `execGitAsync` with a real `NativeAddonLoadError`, so the
 * guard that keeps a broken binary from reading as an empty history can be
 * driven. The route reaches git through `execGitArgsAsync` in
 * `core/api-handler`, which delegates to the `@plusplusoneplusplus/forge` root
 * barrel — so that is the specifier mocked, spread over the real module because
 * the guard narrows with `instanceof`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';

const state = vi.hoisted(() => ({ failWith: undefined as Error | undefined }));

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        // Forwards to the real git unless a failure is armed, so every other
        // case in this file drives a real repository.
        execGitAsync: (...args: Parameters<typeof actual.execGitAsync>) => {
            if (state.failWith) { return Promise.reject(state.failWith); }
            return actual.execGitAsync(...args);
        },
    };
});

import { execGitAsync } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';
import { gitCache } from '../../src/server/git/git-cache';

const REBUILD = 'npm run build:native -w packages/coc-native';
const WORKSPACE_ID = 'ws-commit-log-native';

let tmpDir: string;
let repoRoot: string;
let server: http.Server;
let port: number;
let store: MockProcessStore;

const base = () => `http://127.0.0.1:${port}`;

function request(url: string): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode || 0, body, json: () => JSON.parse(body) });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

/** Ask the real git, so the assertions compare against git rather than a belief. */
async function git(args: string[]): Promise<string> {
    const armed = state.failWith;
    state.failWith = undefined;
    try {
        return await execGitAsync(args, repoRoot);
    } finally {
        state.failWith = armed;
    }
}

async function commit(name: string, message: string): Promise<void> {
    fs.writeFileSync(path.join(repoRoot, name), `${name}\n`);
    await git(['add', '.']);
    await git(['commit', '-q', '-m', message]);
}

/**
 * A repository covering the shapes the two routes render differently: a root
 * commit (no parents), a multi-line body, a merge (two parents) and a non-ASCII
 * author.
 */
async function buildRepo(): Promise<void> {
    fs.mkdirSync(repoRoot, { recursive: true });
    await git(['init', '-q', '-b', 'main', '.']);
    await git(['config', 'user.email', 'ralph@example.com']);
    await git(['config', 'user.name', 'Ralph']);
    await git(['config', 'commit.gpgsign', 'false']);
    await git(['config', 'core.autocrlf', 'false']);

    await commit('one.txt', 'first commit');
    await commit('two.txt', 'second commit\n\nwith a body paragraph\nand a second line');
    await git(['checkout', '-q', '-b', 'feature']);
    await commit('feature.txt', 'a feature');
    await git(['checkout', '-q', 'main']);
    // `--author`, not `git config user.name`: the coc test setup exports
    // `GIT_AUTHOR_NAME`, and the environment beats the config file.
    fs.writeFileSync(path.join(repoRoot, 'three.txt'), 'three\n');
    await git(['add', '.']);
    await git(['commit', '-q', '--author=Renée Ünicode <renée@example.com>', '-m', 'third commit']);
    await git(['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature']);
}

beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-log-routes-'));
    repoRoot = path.join(tmpDir, 'repo');
    await buildRepo();

    store = createMockProcessStore();
    (store.getWorkspaces as any).mockResolvedValue([
        { id: WORKSPACE_ID, name: 'Repo', rootPath: repoRoot, isGitRepo: true },
    ]);

    const routes: Route[] = [];
    registerApiRoutes(routes, store, undefined, tmpDir);
    const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
    server = http.createServer(handleRequest);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as any).port;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
    state.failWith = undefined;
    gitCache.clear();
});

describe('GET /api/workspaces/:id/git/commits against a real repository', () => {
    it('renders every field the way git does', async () => {
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
        expect(res.status).toBe(200);
        const { commits } = res.json();
        expect(commits).toHaveLength(5);

        for (const row of commits) {
            expect(row.shortHash).toBe(await git(['rev-parse', '--short', row.hash]));
            expect(row.subject).toBe(await git(['log', '-1', '--format=%s', row.hash]));
            // `author`, not `authorName` — the rename the wire contract needs.
            expect(row.author).toBe(await git(['log', '-1', '--format=%an', row.hash]));
            expect(row.authorEmail).toBe(await git(['log', '-1', '--format=%ae', row.hash]));
            expect(row.date).toBe(await git(['log', '-1', '--format=%aI', row.hash]));
            expect(row.body).toBe((await git(['log', '-1', '--format=%b', row.hash])).trim());
            const parents = (await git(['log', '-1', '--format=%P', row.hash])).split(' ').filter(Boolean);
            expect(row.parentHashes).toEqual(parents);
        }
    });

    it('gives a root commit an empty parent list rather than one empty string', async () => {
        const rootHash = (await git(['rev-list', '--max-parents=0', 'HEAD'])).trim();
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`);
        const root = res.json().commits.find((c: any) => c.hash === rootHash);
        expect(root).toBeDefined();
        expect(root.parentHashes).toEqual([]);
    });

    it('lists both parents of a merge commit', async () => {
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`);
        const merge = res.json().commits.find((c: any) => c.subject === 'merge feature');
        expect(merge.parentHashes).toHaveLength(2);
        expect(merge.parentHashes).toEqual(
            (await git(['log', '-1', '--format=%P', merge.hash])).split(' '),
        );
    });

    it('carries a multi-line body across the wire', async () => {
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`);
        const row = res.json().commits.find((c: any) => c.subject === 'second commit');
        expect(row.body).toBe('with a body paragraph\nand a second line');
    });

    it('keeps a non-ASCII author intact', async () => {
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`);
        const row = res.json().commits.find((c: any) => c.subject === 'third commit');
        expect(row.author).toBe('Renée Ünicode');
        expect(row.authorEmail).toBe('renée@example.com');
    });

    it('paginates with limit and skip', async () => {
        const all = (await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`)).json().commits;
        const page = (await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=2&skip=1`)).json().commits;
        expect(page.map((c: any) => c.hash)).toEqual(all.slice(1, 3).map((c: any) => c.hash));
    });

    it('resolves a full hash search to that one commit', async () => {
        const hash = (await git(['rev-parse', 'HEAD~1'])).trim();
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?search=${hash}`);
        expect(res.json().commits.map((c: any) => c.hash)).toEqual([hash]);
    });

    it('resolves a short hash search to that one commit', async () => {
        const hash = (await git(['rev-parse', 'HEAD~1'])).trim();
        const short = (await git(['rev-parse', '--short', 'HEAD~1'])).trim();
        // The route's hash test needs at least seven hex characters; a shorter
        // abbreviation would be searched for as text instead.
        expect(short.length).toBeGreaterThanOrEqual(7);
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?search=${short}`);
        expect(res.json().commits.map((c: any) => c.hash)).toEqual([hash]);
    });

    it('reports no commits for a hash-shaped search that resolves to nothing', async () => {
        const res = await request(
            `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?search=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef`,
        );
        expect(res.status).toBe(200);
        expect(res.json().commits).toEqual([]);
    });

    it('filters by message text, ignoring case', async () => {
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?search=FEATURE`);
        expect(res.json().commits.map((c: any) => c.subject)).toEqual(['merge feature', 'a feature']);
    });

    it('matches on the body as well as the subject', async () => {
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?search=body+paragraph`);
        expect(res.json().commits.map((c: any) => c.subject)).toEqual(['second commit']);
    });

    it('reports an empty history for a directory that is not a repository', async () => {
        const plain = path.join(tmpDir, 'not-a-repo');
        fs.mkdirSync(plain, { recursive: true });
        (store.getWorkspaces as any).mockResolvedValueOnce([
            { id: WORKSPACE_ID, name: 'Plain', rootPath: plain, isGitRepo: false },
        ]);

        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`);
        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ commits: [], unpushedCount: 0 });
    });
});

describe('GET /api/workspaces/:id/git/commits/:hash against a real repository', () => {
    it('returns the same row the list returns', async () => {
        const listed = (await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`)).json().commits;
        for (const row of listed) {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/${row.hash}`);
            expect(res.status).toBe(200);
            expect(res.json()).toEqual(row);
        }
    });

    it('accepts an abbreviated hash', async () => {
        const hash = (await git(['rev-parse', 'HEAD'])).trim();
        const short = (await git(['rev-parse', '--short', 'HEAD'])).trim();
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/${short}`);
        expect(res.status).toBe(200);
        expect(res.json().hash).toBe(hash);
    });

    it('404s for a hash that resolves to nothing', async () => {
        const res = await request(
            `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/deadbeefdeadbeefdeadbeefdeadbeefdeadbeef`,
        );
        expect(res.status).toBe(404);
    });
});

describe('the commit-log routes without a usable addon', () => {
    // Both routes answer a failure with silence — an empty list and a 404 — so
    // a binary that cannot be loaded has to be loud, or the Git tab reports an
    // empty repository for a repository with five commits in it.
    beforeEach(() => {
        state.failWith = new NativeAddonLoadError(
            `coc-native.node is missing the git capability — rebuild it with \`${REBUILD}\`.`,
        );
    });

    it('the list route says so at 500 rather than reporting no history', async () => {
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`);
        expect(res.status).toBe(500);
        expect(res.body).toContain(REBUILD);
    });

    it('the single-commit route says so at 500 rather than 404', async () => {
        const hash = (await git(['rev-parse', 'HEAD'])).trim();
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/${hash}`);
        expect(res.status).toBe(500);
        expect(res.body).toContain(REBUILD);
    });

    it('a hash-shaped search says so too, rather than reporting no such commit', async () => {
        // The hash-lookup branch has a `catch` of its own that turns any
        // failure into an empty result, and it runs before the handler's.
        const hash = (await git(['rev-parse', 'HEAD'])).trim();
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?search=${hash}`);
        expect(res.status).toBe(500);
        expect(res.body).toContain(REBUILD);
    });
});
