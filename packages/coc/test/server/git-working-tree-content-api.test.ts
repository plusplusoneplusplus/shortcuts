/**
 * Tests for:
 * - GET /api/workspaces/:id/git/changes/files/{path}/content?stage=staged|unstaged|untracked
 *
 * Two real temporary repositories are registered as separate workspaces so
 * the route is exercised end to end, including multi-repo routing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import { gitCache } from '../../src/server/git/git-cache';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

function get(url: string): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf-8');
                resolve({ status: res.statusCode || 0, json: () => JSON.parse(body) });
            });
        }).on('error', reject);
    });
}

function makeRepo(prefix: string): { root: string; git: (...a: string[]) => string; write: (rel: string, c: string | Buffer) => void } {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf-8' });
    const write = (rel: string, content: string | Buffer) => {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
    };
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'core.autocrlf', 'false');
    git('config', 'commit.gpgsign', 'false');
    return { root, git, write };
}

const WS_A = 'ws-content-a';
const WS_B = 'ws-content-b';

describe('GET /api/workspaces/:id/git/changes/files/*/content', () => {
    let server: http.Server;
    let port: number;
    const repoA = makeRepo('coc-wt-content-a-');
    const repoB = makeRepo('coc-wt-content-b-');
    const url = (ws: string, filePath: string, stage?: string) =>
        `http://127.0.0.1:${port}/api/workspaces/${ws}/git/changes/files/${encodeURIComponent(filePath)}/content`
        + (stage === undefined ? '' : `?stage=${stage}`);

    beforeAll(async () => {
        // Repo A: modified (unstaged + partially staged), CRLF, binary, rename, untracked.
        repoA.write('src/foo.ts', 'const a = 1;\n');
        repoA.write('crlf.txt', 'one\r\ntwo\r\n');
        repoA.write('img.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]));
        repoA.write('old.ts', 'renamed body\n');
        repoA.git('add', '-A');
        repoA.git('commit', '-q', '-m', 'init');
        repoA.write('src/foo.ts', 'const a = 2;\n');
        repoA.git('add', 'src/foo.ts');
        repoA.write('src/foo.ts', 'const a = 3;\n');
        repoA.write('crlf.txt', 'one\r\ntwo\r\nthree\r\n');
        repoA.write('img.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
        repoA.git('mv', 'old.ts', 'new.ts');
        repoA.write('untracked.md', '# new\n');

        // Repo B: same relative path, different content.
        repoB.write('src/foo.ts', 'repo b base\n');
        repoB.git('add', '-A');
        repoB.git('commit', '-q', '-m', 'init');
        repoB.write('src/foo.ts', 'repo b disk\n');

        const store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WS_A, name: 'A', rootPath: repoA.root },
            { id: WS_B, name: 'B', rootPath: repoB.root },
        ]);
        const routes: Route[] = [];
        registerApiRoutes(routes, store);
        server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(repoA.root, { recursive: true, force: true });
        fs.rmSync(repoB.root, { recursive: true, force: true });
    });

    beforeEach(() => gitCache.clear());

    it('returns both sides of an unstaged file with head.ref WORKTREE', async () => {
        const res = await get(url(WS_A, 'src/foo.ts', 'unstaged'));
        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.path).toBe('src/foo.ts');
        expect(data.fileName).toBe('foo.ts');
        expect(data.language).toBe('ts');
        expect(data.base).toEqual({ content: 'const a = 1;\n', ref: repoA.git('rev-parse', 'HEAD').trim(), exists: true });
        expect(data.head).toEqual({ content: 'const a = 3;\n', ref: 'WORKTREE', exists: true });
        expect(data.binary).toBe(false);
        expect(data.tooLarge).toBe(false);
    });

    it('returns the index as head for stage=staged', async () => {
        const data = (await get(url(WS_A, 'src/foo.ts', 'staged'))).json();
        expect(data.head).toEqual({ content: 'const a = 2;\n', ref: 'INDEX', exists: true });
        expect(data.base.content).toBe('const a = 1;\n');
    });

    it('accepts the absolute path the change list reports', async () => {
        const abs = path.join(repoA.root, 'src', 'foo.ts');
        const res = await get(url(WS_A, abs, 'unstaged'));
        expect(res.status).toBe(200);
        expect(res.json().path).toBe(abs);
        expect(res.json().head.content).toBe('const a = 3;\n');
    });

    it('keeps CRLF bytes intact', async () => {
        const data = (await get(url(WS_A, 'crlf.txt', 'unstaged'))).json();
        expect(data.base.content).toBe('one\r\ntwo\r\n');
        expect(data.head.content).toBe('one\r\ntwo\r\nthree\r\n');
    });

    it('flags a binary file with no content body', async () => {
        const data = (await get(url(WS_A, 'img.png', 'unstaged'))).json();
        expect(data.binary).toBe(true);
        expect(data.base.content).toBe('');
        expect(data.head.content).toBe('');
    });

    it('reads a staged rename base from the original path', async () => {
        const data = (await get(url(WS_A, 'new.ts', 'staged'))).json();
        expect(data.base).toMatchObject({ content: 'renamed body\n', exists: true });
        expect(data.head).toMatchObject({ content: 'renamed body\n', exists: true, ref: 'INDEX' });
    });

    it('serves an untracked file against an empty base', async () => {
        const data = (await get(url(WS_A, 'untracked.md', 'untracked'))).json();
        expect(data.base).toEqual({ content: '', ref: '', exists: false });
        expect(data.head).toEqual({ content: '# new\n', ref: 'WORKTREE', exists: true });
    });

    it('routes the same relative path to each workspace\'s own repository', async () => {
        const a = (await get(url(WS_A, 'src/foo.ts', 'unstaged'))).json();
        const b = (await get(url(WS_B, 'src/foo.ts', 'unstaged'))).json();
        expect(a.head.content).toBe('const a = 3;\n');
        expect(b.base.content).toBe('repo b base\n');
        expect(b.head.content).toBe('repo b disk\n');
    });

    it('picks up a disk edit made after the first request', async () => {
        const first = (await get(url(WS_B, 'src/foo.ts', 'unstaged'))).json();
        expect(first.head.content).toBe('repo b disk\n');
        repoB.write('src/foo.ts', 'repo b disk, edited again\n');
        const second = (await get(url(WS_B, 'src/foo.ts', 'unstaged'))).json();
        expect(second.head.content).toBe('repo b disk, edited again\n');
    });

    it('returns 404 for a path not in the change list', async () => {
        repoA.write('clean.txt', 'x\n');
        repoA.git('add', 'clean.txt');
        repoA.git('commit', '-q', '-m', 'clean', '--', 'clean.txt');
        expect((await get(url(WS_A, 'clean.txt', 'unstaged'))).status).toBe(404);
        expect((await get(url(WS_A, 'does/not/exist.ts', 'unstaged'))).status).toBe(404);
    });

    it('returns 404 when the file is changed only in another stage', async () => {
        expect((await get(url(WS_A, 'untracked.md', 'staged'))).status).toBe(404);
        expect((await get(url(WS_A, 'new.ts', 'unstaged'))).status).toBe(404);
    });

    it('returns 400 for a missing or unknown stage', async () => {
        expect((await get(url(WS_A, 'src/foo.ts'))).status).toBe(400);
        expect((await get(url(WS_A, 'src/foo.ts', 'bogus'))).status).toBe(400);
    });

    it('returns 400 for a path outside the workspace', async () => {
        expect((await get(url(WS_A, '../escape.txt', 'unstaged'))).status).toBe(400);
        expect((await get(url(WS_A, path.join(repoB.root, 'src', 'foo.ts'), 'unstaged'))).status).toBe(400);
    });

    it('returns 404 for an unknown workspace', async () => {
        expect((await get(url('ws-missing', 'src/foo.ts', 'unstaged'))).status).toBe(404);
    });
});
