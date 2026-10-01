import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import { gitCache } from '../../src/server/git/git-cache';
import { parseRefFileChanges } from '../../src/server/git/ref-file-content';
import {
    loadGitBlobFileContent,
    MAX_WORKING_TREE_CONTENT_BYTES,
} from '../../src/server/git/working-tree-file-content';
import type { WorkingTreeContentIO, WorkingTreeFileContent } from '../../src/server/git/working-tree-file-content';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

describe('commit and branch-range full-text diff content', () => {
    const roots: string[] = [];
    function repo() {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-commit-content-')));
        roots.push(root);
        const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
        const write = (name: string, content: string | Buffer) => fs.writeFileSync(path.join(root, name), content);
        git('init', '-q');
        git('config', 'user.name', 'Test');
        git('config', 'user.email', 'test@example.invalid');
        git('config', 'core.autocrlf', 'false');
        git('config', 'commit.gpgsign', 'false');
        return { root, git, write };
    }
    const a = repo();
    const b = repo();
    const c = repo();
    let rootHash: string;
    let headHash: string;
    let otherHash: string;
    let rangeBase: string;
    let rangeUpstream: string;
    let rangeHead: string;
    let server: http.Server;
    let baseUrl: string;
    const unusualPath = 'literal [*]\tname.txt';

    async function request(hash: string, filePath: string, workspace = 'ws-a') {
        const url = `${baseUrl}/api/workspaces/${workspace}/git/commits/${encodeURIComponent(hash)}`
            + `/files/${encodeURIComponent(filePath)}/diff-content`;
        const res = await fetch(url);
        return { status: res.status, data: await res.json() as WorkingTreeFileContent };
    }

    async function rangeRequest(filePath: string, mode?: string) {
        const url = `${baseUrl}/api/workspaces/ws-c/git/branch-range/files/${encodeURIComponent(filePath)}/diff-content`
            + (mode ? `?base=${mode}` : '');
        const res = await fetch(url);
        return { status: res.status, data: await res.json() as WorkingTreeFileContent };
    }

    beforeAll(async () => {
        a.write('modified.txt', 'base\r\nlast\r\n');
        a.write('deleted.txt', 'deleted\n');
        a.write('old.txt', 'rename body\n');
        a.write('unchanged.txt', 'unchanged\n');
        a.write(unusualPath, 'literal old\n');
        a.git('add', '-A');
        a.git('commit', '-qm', 'Root');
        rootHash = a.git('rev-parse', 'HEAD');
        a.write('modified.txt', 'head\r\nlast\r\n');
        a.write('added.ts', 'export const value = 1;');
        a.git('rm', '-q', 'deleted.txt');
        a.git('mv', 'old.txt', 'new.txt');
        a.write('binary.bin', Buffer.from([1, 0, 2]));
        a.write('large.txt', Buffer.alloc(MAX_WORKING_TREE_CONTENT_BYTES + 1, 65));
        a.write(unusualPath, 'literal new\n');
        a.git('add', '-A');
        // Record unsupported git modes without platform-specific symlink creation.
        const linkBlob = a.git('hash-object', '-w', 'unchanged.txt');
        a.git('update-index', '--add', '--cacheinfo', `120000,${linkBlob},link.txt`);
        a.git('update-index', '--add', '--cacheinfo', `160000,${rootHash},module`);
        a.git('commit', '-qm', 'Changes');
        headHash = a.git('rev-parse', 'HEAD');
        // Requests must read git objects, never current disk or index contents.
        a.write('modified.txt', 'uncommitted disk\n');
        b.write('modified.txt', 'different workspace\n');
        b.git('add', '-A');
        b.git('commit', '-qm', 'Other root');
        otherHash = b.git('rev-parse', 'HEAD');
        c.write('range.txt', 'base\r\n');
        c.write('deleted.txt', 'delete me\n');
        c.write('old.txt', 'rename me\n');
        c.git('add', '-A');
        c.git('commit', '-qm', 'Range root');
        rangeBase = c.git('rev-parse', 'HEAD');
        c.write('range.txt', 'pushed\r\n');
        c.git('add', '-A');
        c.git('commit', '-qm', 'Pushed');
        rangeUpstream = c.git('rev-parse', 'HEAD');
        c.write('range.txt', 'local\r\n');
        c.write('added.txt', 'new\n');
        c.write('binary.bin', Buffer.from([0, 1, 2]));
        c.write('large.txt', Buffer.alloc(MAX_WORKING_TREE_CONTENT_BYTES + 1, 65));
        c.git('rm', '-q', 'deleted.txt');
        c.git('mv', 'old.txt', 'new.txt');
        c.git('add', '-A');
        c.git('commit', '-qm', 'Unpushed');
        rangeHead = c.git('rev-parse', 'HEAD');
        c.git('remote', 'add', 'origin', 'https://example.invalid/repo.git');
        // A divergent default branch must resolve to the merge-base, not its tip.
        const defaultTip = c.git('commit-tree', c.git('rev-parse', `${rangeBase}^{tree}`), '-p', rangeBase, '-m', 'Default tip');
        c.git('update-ref', 'refs/remotes/origin/main', defaultTip);
        c.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
        c.git('update-ref', 'refs/remotes/origin/topic', rangeUpstream);
        const branch = c.git('symbolic-ref', '--short', 'HEAD');
        c.git('config', `branch.${branch}.remote`, 'origin');
        c.git('config', `branch.${branch}.merge`, 'refs/heads/topic');
        c.write('range.txt', 'dirty disk\n');
        const store = createMockProcessStore();
        store.getWorkspaces.mockResolvedValue([
            { id: 'ws-a', name: 'A', rootPath: a.root },
            { id: 'ws-b', name: 'B', rootPath: b.root },
            { id: 'ws-c', name: 'C', rootPath: c.root },
        ]);
        const routes: Route[] = [];
        registerApiRoutes(routes, store);
        server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    beforeEach(() => gitCache.clear());
    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    });

    it('returns the first parent and commit snapshots with exact CRLF and trailing newline', async () => {
        const { status, data } = await request(headHash, 'modified.txt');
        expect(status).toBe(200);
        expect(data).toEqual({
            path: 'modified.txt', fileName: 'modified.txt', language: 'txt',
            base: { content: 'base\r\nlast\r\n', ref: rootHash, exists: true },
            head: { content: 'head\r\nlast\r\n', ref: headHash, exists: true },
            binary: false, tooLarge: false,
        });
    });

    it('uses an empty original side for a root commit', async () => {
        const { data } = await request(rootHash, 'modified.txt');
        expect(data.base).toEqual({ content: '', ref: '', exists: false });
        expect(data.head).toEqual({ content: 'base\r\nlast\r\n', ref: rootHash, exists: true });
    });

    it('uses the first parent of a merge commit', async () => {
        const merge = a.git('commit-tree', a.git('rev-parse', `${rootHash}^{tree}`),
            '-p', headHash, '-p', rootHash, '-m', 'Merge fixture');
        const { status, data } = await request(merge, 'modified.txt');
        expect(status).toBe(200);
        expect(data.base).toEqual({ content: 'head\r\nlast\r\n', ref: headHash, exists: true });
        expect(data.head).toEqual({ content: 'base\r\nlast\r\n', ref: merge, exists: true });
    });

    it('handles added and deleted sides, including a file without a final newline', async () => {
        const added = (await request(headHash, 'added.ts')).data;
        expect(added.base).toEqual({ content: '', ref: rootHash, exists: false });
        expect(added.head.content).toBe('export const value = 1;');
        const deleted = (await request(headHash, 'deleted.txt')).data;
        expect(deleted.base.content).toBe('deleted\n');
        expect(deleted.head).toEqual({ content: '', ref: headHash, exists: false });
    });

    it('finds the original path of a rename using the new path', async () => {
        const { status, data } = await request(headHash, 'new.txt');
        expect(status).toBe(200);
        expect(data.base).toEqual({ content: 'rename body\n', ref: rootHash, exists: true });
        expect(data.head).toEqual({ content: 'rename body\n', ref: headHash, exists: true });
    });

    it('treats unusual filenames as literal pathspecs', async () => {
        const { status, data } = await request(headHash, unusualPath);
        expect(status).toBe(200);
        expect(data.base.content).toBe('literal old\n');
        expect(data.head.content).toBe('literal new\n');
    });

    it.each(['binary.bin', 'link.txt', 'module'])('withholds both sides of unsupported content: %s', async file => {
        const { status, data } = await request(headHash, file);
        expect(status).toBe(200);
        expect(data.binary).toBe(true);
        expect(data.base.content).toBe('');
        expect(data.head.content).toBe('');
    });

    it('flags an oversized blob without sending either side', async () => {
        const { status, data } = await request(headHash, 'large.txt');
        expect(status).toBe(200);
        expect(data.tooLarge).toBe(true);
        expect(data.binary).toBe(false);
        expect(data.base.content).toBe('');
        expect(data.head.content).toBe('');
    });

    it('isolates cache entries by workspace, resolved hash, and path', async () => {
        await request(headHash.slice(0, 8), 'modified.txt');
        await request(headHash, 'added.ts');
        await request(rootHash, 'modified.txt');
        const other = await request(otherHash, 'modified.txt', 'ws-b');
        expect(other.data.head.content).toBe('different workspace\n');
        expect(gitCache.get(`ws-a:commit-file-diff-content:${headHash}:modified.txt`)).toBeDefined();
        expect(gitCache.get(`ws-a:commit-file-diff-content:${headHash}:added.ts`)).toBeDefined();
        expect(gitCache.get(`ws-a:commit-file-diff-content:${rootHash}:modified.txt`)).toBeDefined();
        expect(gitCache.get(`ws-b:commit-file-diff-content:${otherHash}:modified.txt`)).toBeDefined();
    });

    it('rejects invalid or unknown hashes, unchanged or missing paths, and unknown workspaces', async () => {
        expect((await request('--all', 'modified.txt')).status).toBe(400);
        expect((await request('deadbeef', 'modified.txt')).status).toBe(400);
        expect((await request(headHash, 'missing.txt')).status).toBe(404);
        expect((await request(headHash, 'unchanged.txt')).status).toBe(404);
        expect((await request(headHash, '../outside.txt')).status).toBe(400);
        expect((await request(headHash, 'invalid\0.txt')).status).toBe(400);
        expect((await request(headHash, 'modified.txt', 'unknown')).status).toBe(404);
    });

    it.each([undefined, 'default-branch', 'upstream'])('loads branch-range full files with base=%s', async mode => {
        const { status, data } = await rangeRequest('range.txt', mode);
        expect(status).toBe(200);
        expect(data.base).toEqual({
            content: mode === 'upstream' ? 'pushed\r\n' : 'base\r\n',
            ref: mode === 'upstream' ? rangeUpstream : rangeBase, exists: true,
        });
        expect(data.head).toEqual({ content: 'local\r\n', ref: rangeHead, exists: true });
    });

    it.each(['default-branch', 'upstream'])('handles add/delete/rename in branch-range base=%s', async mode => {
        const added = (await rangeRequest('added.txt', mode)).data;
        expect(added.base.exists).toBe(false);
        expect(added.head.content).toBe('new\n');
        const deleted = (await rangeRequest('deleted.txt', mode)).data;
        expect(deleted.base.content).toBe('delete me\n');
        expect(deleted.head.exists).toBe(false);
        const renamed = (await rangeRequest('new.txt', mode)).data;
        expect(renamed.base.content).toBe('rename me\n');
        expect(renamed.head.content).toBe('rename me\n');
    });

    it('withholds binary and oversized branch-range content', async () => {
        const binary = (await rangeRequest('binary.bin')).data;
        expect(binary.binary).toBe(true);
        expect(binary.base.content).toBe('');
        expect(binary.head.content).toBe('');
        const large = (await rangeRequest('large.txt')).data;
        expect(large.tooLarge).toBe(true);
        expect(large.base.content).toBe('');
        expect(large.head.content).toBe('');
    });

    it('keys branch-range content by workspace, base mode, path, and resolved range', async () => {
        await rangeRequest('range.txt');
        await rangeRequest('range.txt', 'upstream');
        expect(gitCache.get(`ws-c:branch-range-file-diff-content:default-branch:range.txt:${rangeBase}:${rangeHead}`)).toBeDefined();
        expect(gitCache.get(`ws-c:branch-range-file-diff-content:upstream:range.txt:${rangeUpstream}:${rangeHead}`)).toBeDefined();
    });

    it('rejects missing branch-range files and escaped paths', async () => {
        expect((await rangeRequest('missing.txt')).status).toBe(404);
        expect((await rangeRequest('../escape.txt')).status).toBe(400);
    });

    it('uses the default branch when the clone has no upstream', async () => {
        const branch = c.git('symbolic-ref', '--short', 'HEAD');
        c.git('config', '--unset', `branch.${branch}.merge`);
        try {
            const { status, data } = await rangeRequest('range.txt', 'upstream');
            expect(status).toBe(200);
            expect(data.base.ref).toBe(rangeBase);
            expect(data.base.content).toBe('base\r\n');
        } finally {
            c.git('config', `branch.${branch}.merge`, 'refs/heads/topic');
        }
    });

    it('refreshes the range cache when HEAD moves without a manual refresh', async () => {
        await rangeRequest('range.txt');
        c.write('range.txt', 'new HEAD\r\n');
        c.git('add', 'range.txt');
        c.git('commit', '-qm', 'Next head');
        const result = (await rangeRequest('range.txt')).data;
        expect(result.head.content).toBe('new HEAD\r\n');
        expect(result.head.ref).toBe(c.git('rev-parse', 'HEAD'));
        expect(gitCache.get(`ws-c:branch-range-file-diff-content:default-branch:range.txt:${rangeBase}:${rangeHead}`)).toBeUndefined();
    });
});

describe('shared git snapshot guards', () => {
    it('checks sizes before reading blobs', async () => {
        const readBlob = vi.fn();
        const io: WorkingTreeContentIO = {
            resolveHead: vi.fn(), headEntry: vi.fn(), indexEntry: vi.fn(),
            blobSize: vi.fn().mockResolvedValue(MAX_WORKING_TREE_CONTENT_BYTES + 1),
            readBlob, statDisk: vi.fn(), readDisk: vi.fn(),
        };
        const result = await loadGitBlobFileContent(io, 'large.txt',
            { ref: '', entry: null }, { ref: 'head', entry: { mode: '100644', sha: 'blob' } });
        expect(result.tooLarge).toBe(true);
        expect(readBlob).not.toHaveBeenCalled();
    });

    it('parses rename and copy records without losing filename whitespace', () => {
        expect(parseRefFileChanges('R100\0old\t.txt\0new\n.txt\0C100\0source\0copy\0M\0plain\0')).toEqual([
            { oldPath: 'old\t.txt', path: 'new\n.txt' },
            { oldPath: 'source', path: 'copy' },
            { path: 'plain' },
        ]);
    });
});
