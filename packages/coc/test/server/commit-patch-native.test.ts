import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { registerGitCommitRoutes } from '../../src/server/routes/api-git-commit-routes';
import type { ApiRouteContext } from '../../src/server/routes/api-shared';
import type { Route } from '../../src/server/types';
import { createRouter } from '../../src/server/shared/router';
import { createMockProcessStore } from './helpers/mock-process-store';
import { gitCache } from '../../src/server/git/git-cache';

const roots: string[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
    gitCache.clear();
});
function git(root: string, ...args: string[]) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).replace(/\r?\n$/, '');
}
function fixture(marker: string) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'commit-route-')));
    roots.push(root);
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'commit.gpgsign', 'false');
    git(root, 'config', 'core.autocrlf', 'false');
    git(root, 'config', 'core.quotePath', 'true');
    fs.writeFileSync(path.join(root, '[ab].txt'), `${marker}\n`);
    fs.writeFileSync(path.join(root, 'a.txt'), 'glob\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'root');
    return { root, head: git(root, 'rev-parse', 'HEAD') };
}
async function serve(workspaces: Array<{ id: string; rootPath: string }>) {
    const store = createMockProcessStore({ initialWorkspaces: workspaces.map(ws => ({ ...ws, name: ws.id })) });
    const routes: Route[] = [];
    registerGitCommitRoutes({ routes, store } as unknown as ApiRouteContext);
    const server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return async (url: string) => {
        const response = await fetch(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}${url}`, { signal: AbortSignal.timeout(10000) });
        return { status: response.status, body: await response.json() };
    };
}

describe('production commit routes with real Rust/Git processing', () => {
    it('preserves root/ordinary/merge git-show behavior and literal file selection across workspaces', async () => {
        const one = fixture('one'), two = fixture('two');
        expect(git(one.root, 'show', '--format=', '--patch', one.head, '--', '[ab].txt')).toContain('+glob');
        // A workspace can point at another clone while retaining its ID.
        // Patch requests must not consume entries keyed only by workspace/hash/path.
        gitCache.set(`one:commit-file-diff:${one.head}:[ab].txt`, { diff: 'other clone' });
        gitCache.set(`one:commit-diff:${one.head}`, { diff: 'other clone' });
        const request = await serve([{ id: 'one', rootPath: one.root }, { id: 'two', rootPath: two.root }]);
        const results = await Promise.all([one, two].map((repo, index) => request(`/api/workspaces/${index ? 'two' : 'one'}/git/commits/${repo.head}/files/${encodeURIComponent('[ab].txt')}/diff`)));
        results.forEach((result, index) => {
            expect(result.status).toBe(200);
            expect(result.body).toEqual({ diff: git(index ? two.root : one.root, '--literal-pathspecs', 'show', '--format=', '--patch', '-M', '-C', '-U99999', index ? two.head : one.head, '--', '[ab].txt') });
            expect(result.body.diff).not.toContain('+glob');
        });
        fs.writeFileSync(path.join(one.root, '[ab].txt'), 'ordinary\n');
        git(one.root, 'add', '.');
        git(one.root, 'commit', '-qm', 'ordinary');
        const head = git(one.root, 'rev-parse', 'HEAD');
        const side = git(one.root, 'commit-tree', 'HEAD^{tree}', '-p', one.head, '-m', 'side');
        const merge = git(one.root, 'commit-tree', 'HEAD^{tree}', '-p', one.head, '-p', side, '-m', 'merge');
        for (const commit of [one.head, head, merge]) {
            const result = await request(`/api/workspaces/one/git/commits/${commit}/diff`);
            expect(result).toEqual({ status: 200, body: { diff: git(one.root, 'show', '--format=', '--patch', '-M', '-C', commit) } });
        }
        expect(git(one.root, 'show', '--format=', '--patch', merge)).toBe('');
    });

    it('lists root/merge metadata and literal rename paths without stale workspace caches', async () => {
        const one = fixture('one'), two = fixture('two');
        const request = await serve([{ id: 'one', rootPath: one.root }, { id: 'two', rootPath: two.root }]);
        // Before: diff-tree without --root returned no files despite a nonempty patch.
        expect(git(one.root, 'diff-tree', '--no-commit-id', '-r', '--name-status', one.head)).toBe('');
        gitCache.set(`one:commit-files:${one.head}`, { files: [{ path: 'other clone' }] });
        const initial = await Promise.all([one, two].map((repo, index) => request(`/api/workspaces/${index ? 'two' : 'one'}/git/commits/${repo.head}/files`)));
        initial.forEach(result => expect(result).toEqual({ status: 200, body: { files: [
            { status: 'A', path: '[ab].txt', additions: 1, deletions: 0 },
            { status: 'A', path: 'a.txt', additions: 1, deletions: 0 },
        ] } }));
        const literal = process.platform === 'win32' ? 'café arrow => name.txt' : 'café\tline\n => name.txt';
        fs.renameSync(path.join(one.root, '[ab].txt'), path.join(one.root, literal));
        fs.writeFileSync(path.join(one.root, 'empty.txt'), '');
        fs.writeFileSync(path.join(one.root, 'binary.bin'), Buffer.from([0, 1, 2]));
        git(one.root, 'add', '.');
        git(one.root, 'commit', '-qm', 'metadata');
        const head = git(one.root, 'rev-parse', 'HEAD');
        // Before: Git C quoting was sent as the path rather than decoded bytes.
        expect(git(one.root, 'diff-tree', '--no-commit-id', '-r', '--name-status', '-M', '-C', head)).not.toContain(literal);
        const side = git(one.root, 'commit-tree', 'HEAD^{tree}', '-p', one.head, '-m', 'side');
        const merge = git(one.root, 'commit-tree', 'HEAD^{tree}', '-p', one.head, '-p', side, '-m', 'merge');
        for (const commit of [head, merge]) {
            const result = await request(`/api/workspaces/one/git/commits/${commit}/files`);
            expect(result.status).toBe(200);
            expect(result.body.files).toEqual([
                { status: 'A', path: 'binary.bin' },
                { status: 'R', path: literal, oldPath: '[ab].txt', additions: 0, deletions: 0 },
                { status: 'A', path: 'empty.txt', additions: 0, deletions: 0 },
            ]);
        }
        expect(git(one.root, 'diff-tree', '--no-commit-id', '-r', '--name-status', merge)).toBe('');
    });

    it('returns native truncation metadata and full patches with the existing wire shape', async () => {
        const repo = fixture('initial');
        fs.writeFileSync(path.join(repo.root, 'large.txt'), 'line\n'.repeat(100010));
        git(repo.root, 'add', '.');
        git(repo.root, 'commit', '-qm', 'large');
        const head = git(repo.root, 'rev-parse', 'HEAD');
        const request = await serve([{ id: 'one', rootPath: repo.root }]);
        const url = `/api/workspaces/one/git/commits/${head}/files/large.txt/diff`;
        const full = await request(`${url}?full=true`);
        const limited = await request(url);
        expect(full.status).toBe(200);
        expect(Object.keys(full.body)).toEqual(['diff']);
        expect(limited).toEqual({ status: 200, body: {
            diff: full.body.diff.split('\n').slice(0, 100000).join('\n'),
            truncated: true, totalLines: full.body.diff.split('\n').length,
        } });
    });
});
