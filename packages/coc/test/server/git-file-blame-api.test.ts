import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import { parseFileBlame } from '../../src/server/git/file-blame';
import type { FileBlame } from '../../src/server/git/file-blame';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

describe('parseFileBlame', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);

    it('maps each line to its commit and reads commit details once', () => {
        const output = [
            `${a} 1 1 2`, 'author Ann', 'author-mail <ann@example.invalid>', 'author-time 1700000000', 'author-tz +0100',
            'summary First change', `previous ${b} lib/old.ts`, 'filename lib/old.ts', '\tone\r',
            `${a} 2 2`, '\ttwo',
            `${b} 3 3 1`, 'author Bob', 'author-mail <bob@example.invalid>', 'author-time 1700003600',
            'summary Second', 'boundary', 'filename src/new.ts', '\t',
        ].join('\n');
        const blame = parseFileBlame(output, 'src/new.ts');
        expect(blame.lines).toEqual([{ hash: a, text: 'one' }, { hash: a, text: 'two' }, { hash: b, text: '' }]);
        expect(blame.commits[a]).toEqual({
            hash: a, shortHash: 'aaaaaaa', subject: 'First change', author: 'Ann', authorEmail: 'ann@example.invalid',
            date: '2023-11-14T22:13:20.000Z', path: 'lib/old.ts',
        });
        expect(blame.commits[b]).toMatchObject({ subject: 'Second', author: 'Bob', path: 'src/new.ts' });
    });

    it('accepts SHA-256 hashes and returns nothing for empty output', () => {
        const hash = 'c'.repeat(64);
        expect(parseFileBlame(`${hash} 1 1 1\nsummary S\n\tx`, 'f').lines).toEqual([{ hash, text: 'x' }]);
        expect(parseFileBlame('', 'f')).toEqual({ lines: [], commits: {} });
    });
});

describe('GET /api/workspaces/:id/git/file-blame', () => {
    const roots: string[] = [];
    function repo() {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-file-blame-')));
        roots.push(root);
        const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
        const write = (name: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
            fs.writeFileSync(path.join(root, name), content);
        };
        git('init', '-q');
        git('config', 'user.name', 'Test Author');
        git('config', 'user.email', 'test@example.invalid');
        git('config', 'core.autocrlf', 'false');
        git('config', 'commit.gpgsign', 'false');
        return { root, git, write };
    }
    const main = repo();
    const other = repo();
    const empty = repo();
    const hashes: Record<string, string> = {};
    let server: http.Server | undefined;
    let baseUrl: string;
    const body = 'one\ntwo\nthree\nfour\nfive\nsix\n';

    async function blame(query: string, workspace = 'ws-main') {
        const res = await fetch(`${baseUrl}/api/workspaces/${workspace}/git/file-blame?${query}`);
        return { status: res.status, data: await res.json() as FileBlame & { error?: string } };
    }

    beforeAll(async () => {
        main.write('lib/old name.txt', body);
        main.git('add', '-A');
        main.git('commit', '-qm', 'Root');
        hashes.root = main.git('rev-parse', 'HEAD');
        fs.mkdirSync(path.join(main.root, 'src'));
        main.git('mv', 'lib/old name.txt', 'src/new name.txt');
        main.git('commit', '-qm', 'Move');
        main.write('src/new name.txt', body.replace('three', 'THREE') + 'seven\n');
        main.git('commit', '-qam', 'Edit');
        hashes.edit = main.git('rev-parse', 'HEAD');
        // Uncommitted edits never change the HEAD blame.
        main.write('src/new name.txt', 'draft\n');

        other.write('src/new name.txt', 'other workspace\n');
        other.git('add', '-A');
        other.git('commit', '-qm', 'Other root');

        const store = createMockProcessStore();
        store.getWorkspaces.mockResolvedValue([
            { id: 'ws-main', name: 'Main', rootPath: main.root },
            { id: 'ws-other', name: 'Other', rootPath: other.root },
            { id: 'ws-empty', name: 'Empty', rootPath: empty.root },
        ]);
        const routes: Route[] = [];
        registerApiRoutes(routes, store);
        server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        if (server?.listening) {
            const activeServer = server;
            await new Promise<void>(resolve => activeServer.close(() => resolve()));
        }
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    });

    it('attributes each HEAD line, following the rename back to the root commit', async () => {
        const { status, data } = await blame(`path=${encodeURIComponent('src/new name.txt')}`);
        expect(status).toBe(200);
        expect(data.lines.map(l => [l.text, data.commits[l.hash].subject])).toEqual([
            ['one', 'Root'], ['two', 'Root'], ['THREE', 'Edit'], ['four', 'Root'], ['five', 'Root'], ['six', 'Root'], ['seven', 'Edit'],
        ]);
        expect(data.commits[hashes.root]).toMatchObject({ path: 'lib/old name.txt', shortHash: hashes.root.slice(0, 7) });
        expect(data.commits[hashes.edit]).toMatchObject({
            path: 'src/new name.txt',
            author: main.git('log', '-1', '--format=%an', hashes.edit),
            authorEmail: main.git('log', '-1', '--format=%ae', hashes.edit),
        });
        expect(Number.isNaN(Date.parse(data.commits[hashes.edit].date))).toBe(false);
    });

    it('reads the requested workspace only', async () => {
        const { data } = await blame(`path=${encodeURIComponent('src/new name.txt')}`, 'ws-other');
        expect(data.lines.map(l => [l.text, data.commits[l.hash].subject])).toEqual([['other workspace', 'Other root']]);
    });

    it('returns no lines for an untracked file and a repository without commits', async () => {
        main.write('untracked.txt', 'u\n');
        expect((await blame('path=untracked.txt')).data).toEqual({ lines: [], commits: {} });
        expect((await blame('path=a.txt', 'ws-empty')).data).toEqual({ lines: [], commits: {} });
    });

    it('rejects a missing path and a path outside the workspace', async () => {
        expect((await blame('')).status).toBe(400);
        expect((await blame(`path=${encodeURIComponent('../escape.txt')}`)).status).toBe(400);
    });
});
