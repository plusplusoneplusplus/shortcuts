import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import { parseFileHistory } from '../../src/server/git/file-history';
import type { FileHistoryPage } from '../../src/server/git/file-history';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

describe('parseFileHistory', () => {
    const record = (hash: string, subject: string, ...changes: string[]) =>
        '\x1e' + [hash, hash.slice(0, 7), 'Ann', 'ann@example.invalid', '2026-01-02T03:04:05+00:00', subject, `\n${changes.join('\0')}`].join('\0') + '\0';

    it('tracks the older name below a rename and keeps it for commits without a file diff', () => {
        const output = [
            record('a'.repeat(40), 'edit', 'M', 'src/new.ts'),
            record('b'.repeat(40), 'merge'),
            record('c'.repeat(40), 'move', 'R087', 'lib/old.ts', 'src/new.ts'),
            record('d'.repeat(40), 'merge 2'),
            record('e'.repeat(40), 'root', 'A', 'lib/old.ts'),
        ].join('');
        expect(parseFileHistory(output, 'src/new.ts').map(c => [c.subject, c.status, c.path, c.oldPath])).toEqual([
            ['edit', 'M', 'src/new.ts', undefined],
            ['merge', '', 'src/new.ts', undefined],
            ['move', 'R', 'src/new.ts', 'lib/old.ts'],
            ['merge 2', '', 'lib/old.ts', undefined],
            ['root', 'A', 'lib/old.ts', undefined],
        ]);
    });

    it('returns no commits for empty output', () => {
        expect(parseFileHistory('', 'a.txt')).toEqual([]);
    });
});

describe('GET /api/workspaces/:id/git/file-history', () => {
    const roots: string[] = [];
    function repo() {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-file-history-')));
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

    async function history(query: string, workspace = 'ws-main') {
        const res = await fetch(`${baseUrl}/api/workspaces/${workspace}/git/file-history?${query}`);
        return { status: res.status, data: await res.json() as FileHistoryPage & { error?: string } };
    }

    beforeAll(async () => {
        main.write('lib/old name.txt', body);
        main.write('other.txt', 'x\n');
        main.git('add', '-A');
        main.git('commit', '-qm', 'Root');
        hashes.root = main.git('rev-parse', 'HEAD');
        main.write('other.txt', 'y\n');
        main.git('commit', '-qam', 'Unrelated');
        fs.mkdirSync(path.join(main.root, 'src'));
        main.git('mv', 'lib/old name.txt', 'src/new name.txt');
        main.write('src/new name.txt', `${body}seven\n`);
        main.git('add', '-A');
        main.git('commit', '-qm', 'Move');
        hashes.move = main.git('rev-parse', 'HEAD');
        main.write('src/new name.txt', `${body}seven\neight\n`);
        main.git('commit', '-qam', 'Edit');
        hashes.edit = main.git('rev-parse', 'HEAD');
        // Commits on another branch are not reachable from HEAD.
        const branch = main.git('symbolic-ref', '--short', 'HEAD');
        main.git('checkout', '-qb', 'side');
        main.write('src/new name.txt', 'side\n');
        main.git('commit', '-qam', 'Side only');
        main.git('checkout', '-q', branch);
        // Uncommitted edits never show up as history.
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

    it('lists HEAD commits for the file newest first, following the rename to the root commit', async () => {
        const { status, data } = await history(`path=${encodeURIComponent('src/new name.txt')}`);
        expect(status).toBe(200);
        expect(data.hasMore).toBe(false);
        expect(data.commits.map(c => [c.subject, c.hash, c.path, c.oldPath, c.status])).toEqual([
            ['Edit', hashes.edit, 'src/new name.txt', undefined, 'M'],
            ['Move', hashes.move, 'src/new name.txt', 'lib/old name.txt', 'R'],
            ['Root', hashes.root, 'lib/old name.txt', undefined, 'A'],
        ]);
        expect(data.commits[0]).toMatchObject({
            shortHash: hashes.edit.slice(0, 7),
            author: main.git('log', '-1', '--format=%an', hashes.edit),
            authorEmail: main.git('log', '-1', '--format=%ae', hashes.edit),
        });
        expect(Number.isNaN(Date.parse(data.commits[0].date))).toBe(false);
    });

    it('pages with limit and skip', async () => {
        const path = encodeURIComponent('src/new name.txt');
        const first = await history(`path=${path}&limit=2`);
        expect(first.data.commits.map(c => c.subject)).toEqual(['Edit', 'Move']);
        expect(first.data.hasMore).toBe(true);
        const second = await history(`path=${path}&limit=2&skip=2`);
        expect(second.data.commits.map(c => [c.subject, c.path])).toEqual([['Root', 'lib/old name.txt']]);
        expect(second.data.hasMore).toBe(false);
    });

    it('reads the requested workspace only', async () => {
        const { data } = await history(`path=${encodeURIComponent('src/new name.txt')}`, 'ws-other');
        expect(data.commits.map(c => c.subject)).toEqual(['Other root']);
    });

    it('returns an empty page for an untracked file and a repository without commits', async () => {
        main.write('untracked.txt', 'u\n');
        expect((await history('path=untracked.txt')).data).toEqual({ commits: [], hasMore: false });
        expect((await history('path=a.txt', 'ws-empty')).data).toEqual({ commits: [], hasMore: false });
    });

    it('rejects a missing path and a path outside the workspace', async () => {
        expect((await history('')).status).toBe(400);
        expect((await history(`path=${encodeURIComponent('../escape.txt')}`)).status).toBe(400);
    });

    it('diffs a renamed revision against its old path and a root revision as an addition', async () => {
        const diffUrl = (hash: string, filePath: string, oldPath?: string) =>
            `${baseUrl}/api/workspaces/ws-main/git/commits/${hash}/files/${encodeURIComponent(filePath)}/diff`
            + (oldPath ? `?oldPath=${encodeURIComponent(oldPath)}` : '');

        const renamed = await (await fetch(diffUrl(hashes.move, 'src/new name.txt', 'lib/old name.txt'))).json() as { diff: string };
        expect(renamed.diff).toContain('rename from lib/old name.txt');
        expect(renamed.diff).toContain('rename to src/new name.txt');
        expect(renamed.diff).toContain('+seven');
        expect(renamed.diff).not.toContain('new file mode');

        const root = await (await fetch(diffUrl(hashes.root, 'lib/old name.txt'))).json() as { diff: string };
        expect(root.diff).toContain('new file mode');
        expect(root.diff).toContain('+one');

        const escape = await fetch(diffUrl(hashes.move, 'src/new name.txt', '../outside.txt'));
        expect(escape.status).toBe(400);
    });
});
