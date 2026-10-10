import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { registerGitBranchRangeRoutes } from '../../src/server/routes/api-git-branch-range-routes';
import { DIFF_LINE_LIMIT, type ApiRouteContext } from '../../src/server/routes/api-shared';
import { createRouter } from '../../src/server/shared/router';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { Route } from '../../src/server/types';

const roots: string[] = [];
let server: http.Server | undefined;
afterEach(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise<void>(resolve => server!.close(() => resolve()));
        server = undefined;
    }
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

function fixture(lines: number, marker: string) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'range-route-')));
    roots.push(root);
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trimEnd();
    git('init', '--initial-branch=main');
    for (const [key, value] of [
        ['user.name', 'Test'], ['user.email', 'test@example.com'],
        ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'],
    ]) git('config', key, value);
    fs.writeFileSync(path.join(root, '[ab].txt'), '');
    fs.writeFileSync(path.join(root, 'a.txt'), 'unchanged\n');
    git('add', '.');
    git('commit', '-qm', 'initial');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    fs.writeFileSync(path.join(root, '[ab].txt'), Array.from({ length: lines }, (_, i) => `${marker} ${i}\n`).join(''));
    fs.writeFileSync(path.join(root, 'a.txt'), 'glob result\n');
    git('add', '.');
    git('commit', '-qm', 'changed');
    return { root, git };
}

it('uses Rust truncation and literal range paths across workspaces, retaining full reads', async () => {
    const one = fixture(DIFF_LINE_LIMIT + 10, 'one'), two = fixture(1, 'two');
    const routes: Route[] = [];
    const store = createMockProcessStore({ initialWorkspaces: [
        { id: 'one', name: 'One', rootPath: one.root }, { id: 'two', name: 'Two', rootPath: two.root },
    ] });
    registerGitBranchRangeRoutes({ routes, store } as ApiRouteContext);
    server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const endpoint = (id: string, full = false) =>
        `http://127.0.0.1:${address.port}/api/workspaces/${id}/git/branch-range/files/${encodeURIComponent('[ab].txt')}/diff${full ? '?full=true' : ''}`;
    const [limited, other] = await Promise.all([fetch(endpoint('one')), fetch(endpoint('two'))]);
    expect(limited.status).toBe(200);
    expect(other.status).toBe(200);
    const expected = one.git('--literal-pathspecs', 'diff', '-M', '-C', '-U99999', 'origin/main...HEAD', '--', '[ab].txt');
    const limitedBody = await limited.json();
    expect(limitedBody).toEqual({
        diff: expected.split('\n').slice(0, DIFF_LINE_LIMIT).join('\n'),
        truncated: true, totalLines: expected.split('\n').length, path: '[ab].txt',
    });
    expect(limitedBody.diff).not.toContain('+glob result');
    expect(await other.json()).toEqual({
        diff: two.git('--literal-pathspecs', 'diff', '-M', '-C', '-U99999', 'origin/main...HEAD', '--', '[ab].txt'),
        path: '[ab].txt',
    });
    const full = await fetch(endpoint('one', true));
    expect(await full.json()).toEqual({ diff: expected, path: '[ab].txt' });
}, 20000);
