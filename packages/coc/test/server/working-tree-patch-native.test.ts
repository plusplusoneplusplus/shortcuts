import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { registerGitWorkingTreeRoutes } from '../../src/server/routes/api-git-working-tree-routes';
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
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'working-route-')));
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
    registerGitWorkingTreeRoutes({ routes, store } as unknown as ApiRouteContext);
    const server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return async (url: string) => {
        const response = await fetch(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}${url}`, { signal: AbortSignal.timeout(10000) });
        return { status: response.status, body: await response.json() };
    };
}

describe('production working-tree patch routes with real Rust/Git', () => {
    it('keeps staged/index/disk comparisons, literal paths and workspace isolation', async () => {
        const repos = [fixture('one'), fixture('two')];
        for (const [index, repo] of repos.entries()) {
            fs.writeFileSync(path.join(repo.root, '[ab].txt'), `stage${index}\n`);
            git(repo.root, 'add', '.');
            fs.writeFileSync(path.join(repo.root, '[ab].txt'), `disk${index}\n`);
            fs.writeFileSync(path.join(repo.root, 'a.txt'), 'wrong glob\n');
            expect(git(repo.root, 'diff', '--', '[ab].txt')).toContain('+wrong glob');
        }
        const request = await serve(repos.map((repo, index) => ({ id: String(index), rootPath: repo.root })));
        for (const stage of ['staged', 'unstaged']) {
            const results = await Promise.all(repos.map((repo, index) => request(`/api/workspaces/${index}/git/changes/files/${encodeURIComponent('[ab].txt')}/diff?stage=${stage}`)));
            results.forEach((result, index) => {
                const expected = git(repos[index].root, '--literal-pathspecs', 'diff', '-M', '-C', '-U99999', ...(stage === 'staged' ? ['--cached'] : []), '--', '[ab].txt');
                expect(result).toEqual({ status: 200, body: { diff: expected, path: '[ab].txt' } });
                expect(result.body.diff).not.toContain('+wrong glob');
                expect(result.body.diff).toContain(stage === 'staged' ? `+stage${index}` : `+disk${index}`);
            });
        }
        fs.writeFileSync(path.join(repos[0].root, '[ab].txt'), 'fresh\n');
        const fresh = await request(`/api/workspaces/0/git/changes/files/${encodeURIComponent('[ab].txt')}/diff`);
        expect(fresh.body.diff).toContain('+fresh');
        const missing = await request('/api/workspaces/0/git/changes/files/missing/diff');
        expect(missing).toEqual({ status: 200, body: { diff: '', path: 'missing' } });
    });

    it('preserves full context, native truncation and full=true wire contracts', async () => {
        const repo = fixture('initial');
        fs.writeFileSync(path.join(repo.root, 'large.txt'), 'line\n'.repeat(100010));
        git(repo.root, 'add', '.');
        const request = await serve([{ id: 'one', rootPath: repo.root }]);
        const url = '/api/workspaces/one/git/changes/files/large.txt/diff?stage=staged';
        const full = await request(`${url}&full=true`);
        const limited = await request(url);
        expect(full).toEqual({ status: 200, body: {
            diff: git(repo.root, 'diff', '-M', '-C', '-U99999', '--cached', '--', 'large.txt'), path: 'large.txt',
        } });
        expect(limited).toEqual({ status: 200, body: {
            diff: full.body.diff.split('\n').slice(0, 100000).join('\n'), path: 'large.txt',
            truncated: true, totalLines: full.body.diff.split('\n').length,
        } });
    });
});
