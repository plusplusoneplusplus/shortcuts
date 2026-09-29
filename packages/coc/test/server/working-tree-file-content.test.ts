/**
 * Tests for the working-tree content-at-ref resolver
 * (`src/server/git/working-tree-file-content.ts`).
 *
 * Runs against a real temporary git repository so stage resolution, the
 * index read, and byte-exact content are exercised end to end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    MAX_WORKING_TREE_CONTENT_BYTES,
    __test__,
    createWorkingTreeContentIO,
    isBinaryBuffer,
    languageFromPath,
    loadWorkingTreeFileContent,
    resolveWorkingTreePath,
    toRepoRelative,
} from '../../src/server/git/working-tree-file-content';
import type {
    WorkingTreeContentIO,
    WorkingTreeContentRequest,
    WorkingTreeContentStage,
} from '../../src/server/git/working-tree-file-content';
import { GitCacheService } from '../../src/server/git/git-cache';

let repo: string;

function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf-8' });
}

function write(rel: string, content: string | Buffer): void {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
}

function commitAll(message = 'commit'): void {
    git('add', '-A');
    git('commit', '-q', '-m', message);
}

function req(rel: string, stage: WorkingTreeContentStage, baseRel = rel): WorkingTreeContentRequest {
    return {
        requestPath: rel,
        absPath: path.join(repo, rel),
        baseAbsPath: path.join(repo, baseRel),
        repoRoot: repo,
        stage,
    };
}

function load(rel: string, stage: WorkingTreeContentStage, baseRel?: string) {
    return loadWorkingTreeFileContent(createWorkingTreeContentIO(repo), req(rel, stage, baseRel));
}

beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wt-content-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'core.autocrlf', 'false');
    git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
});

describe('stage resolution', () => {
    it('unstaged: base is HEAD, head is disk', async () => {
        write('src/foo.ts', 'const a = 1;\n');
        commitAll();
        write('src/foo.ts', 'const a = 2;\n');

        const result = await load('src/foo.ts', 'unstaged');
        const headSha = git('rev-parse', 'HEAD').trim();

        expect(result.base).toEqual({ content: 'const a = 1;\n', ref: headSha, exists: true });
        expect(result.head).toEqual({ content: 'const a = 2;\n', ref: 'WORKTREE', exists: true });
        expect(result).toMatchObject({ path: 'src/foo.ts', fileName: 'foo.ts', language: 'ts', binary: false, tooLarge: false });
    });

    it('staged: head is the index, not the disk', async () => {
        write('a.txt', 'v1\n');
        commitAll();
        write('a.txt', 'v2\n');
        git('add', 'a.txt');
        write('a.txt', 'v3 on disk only\n');

        const staged = await load('a.txt', 'staged');
        expect(staged.base.content).toBe('v1\n');
        expect(staged.head).toEqual({ content: 'v2\n', ref: 'INDEX', exists: true });

        const unstaged = await load('a.txt', 'unstaged');
        expect(unstaged.head.content).toBe('v3 on disk only\n');
    });

    it('untracked: base is empty and missing, head is disk', async () => {
        write('seed.txt', 'x\n');
        commitAll();
        write('new.md', '# hi\n');

        const result = await load('new.md', 'untracked');
        expect(result.base).toEqual({ content: '', ref: '', exists: false });
        expect(result.head).toEqual({ content: '# hi\n', ref: 'WORKTREE', exists: true });
        expect(result.language).toBe('md');
    });

    it('staged added file has no base', async () => {
        write('seed.txt', 'x\n');
        commitAll();
        write('added.ts', 'export {};\n');
        git('add', 'added.ts');

        const result = await load('added.ts', 'staged');
        expect(result.base.exists).toBe(false);
        expect(result.base.content).toBe('');
        expect(result.head).toEqual({ content: 'export {};\n', ref: 'INDEX', exists: true });
    });

    it('unstaged deleted file has no head', async () => {
        write('gone.txt', 'bye\n');
        commitAll();
        fs.unlinkSync(path.join(repo, 'gone.txt'));

        const result = await load('gone.txt', 'unstaged');
        expect(result.base).toMatchObject({ content: 'bye\n', exists: true });
        expect(result.head).toEqual({ content: '', ref: 'WORKTREE', exists: false });
    });

    it('staged deleted file has no head', async () => {
        write('gone.txt', 'bye\n');
        commitAll();
        git('rm', '-q', 'gone.txt');

        const result = await load('gone.txt', 'staged');
        expect(result.base.content).toBe('bye\n');
        expect(result.head).toEqual({ content: '', ref: 'INDEX', exists: false });
    });

    it('staged rename reads the base from the original path', async () => {
        write('old/name.ts', 'same body\n');
        commitAll();
        fs.mkdirSync(path.join(repo, 'new'));
        git('mv', 'old/name.ts', 'new/name.ts');
        write('new/name.ts', 'same body\nplus one\n');
        git('add', 'new/name.ts');

        const result = await load('new/name.ts', 'staged', 'old/name.ts');
        expect(result.base).toMatchObject({ content: 'same body\n', exists: true });
        expect(result.head).toMatchObject({ content: 'same body\nplus one\n', exists: true, ref: 'INDEX' });
        expect(result.path).toBe('new/name.ts');
    });

    it('a repository with no commits has a missing base, not an error', async () => {
        write('first.txt', 'hello\n');
        git('add', 'first.txt');

        const result = await load('first.txt', 'staged');
        expect(result.base).toEqual({ content: '', ref: '', exists: false });
        expect(result.head.content).toBe('hello\n');
    });

    it('reads paths containing glob characters and spaces literally', async () => {
        // Windows file names cannot contain `*`; `[x]` alone still exercises pathspec globbing there.
        const star = process.platform === 'win32' ? '' : '*';
        const target = `dir/a${star}b [x].txt`;
        write(target, 'literal\n');
        write(`dir/a${star ? 'X' : ''}b x.txt`, 'decoy\n');
        commitAll();
        write(target, 'literal 2\n');
        git('add', target);

        const result = await load(target, 'staged');
        expect(result.base.content).toBe('literal\n');
        expect(result.head.content).toBe('literal 2\n');
    });
});

describe('byte fidelity', () => {
    it('keeps CRLF on both sides, including the index side', async () => {
        write('crlf.txt', 'one\r\ntwo\r\n');
        commitAll();
        write('crlf.txt', 'one\r\ntwo\r\nthree\r\n');
        git('add', 'crlf.txt');
        write('crlf.txt', 'one\r\n');

        const staged = await load('crlf.txt', 'staged');
        expect(staged.base.content).toBe('one\r\ntwo\r\n');
        expect(staged.head.content).toBe('one\r\ntwo\r\nthree\r\n');

        const unstaged = await load('crlf.txt', 'unstaged');
        expect(unstaged.head.content).toBe('one\r\n');
    });

    it('treats trailing newlines identically on both sides', async () => {
        write('t.txt', 'no newline');
        commitAll();
        write('t.txt', 'no newline\n');
        git('add', 't.txt');
        write('t.txt', '\n\n  padded  \n\n');

        const staged = await load('t.txt', 'staged');
        expect(staged.base.content).toBe('no newline');
        expect(staged.head.content).toBe('no newline\n');

        const unstaged = await load('t.txt', 'unstaged');
        expect(unstaged.head.content).toBe('\n\n  padded  \n\n');
    });

    it('keeps leading and trailing whitespace of an index blob', async () => {
        write('ws.txt', 'x\n');
        commitAll();
        write('ws.txt', '\n\t leading and trailing \t\n\n');
        git('add', 'ws.txt');

        const result = await load('ws.txt', 'staged');
        expect(result.head.content).toBe('\n\t leading and trailing \t\n\n');
    });

    it('decodes UTF-8 including astral-plane characters', async () => {
        write('u.txt', 'héllo 😀\n');
        commitAll();
        write('u.txt', 'héllo 😀 wörld\n');

        const result = await load('u.txt', 'unstaged');
        expect(result.base.content).toBe('héllo 😀\n');
        expect(result.head.content).toBe('héllo 😀 wörld\n');
    });
});

describe('unrenderable content', () => {
    it('flags a binary file and returns no content', async () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
        write('img.png', png);
        commitAll();
        write('img.png', Buffer.concat([png, Buffer.from([0x00, 0x01])]));

        const result = await load('img.png', 'unstaged');
        expect(result.binary).toBe(true);
        expect(result.tooLarge).toBe(false);
        expect(result.base).toMatchObject({ content: '', exists: true });
        expect(result.head).toMatchObject({ content: '', exists: true, ref: 'WORKTREE' });
    });

    it('flags binary when only one side is binary', async () => {
        write('mixed.dat', 'text\n');
        commitAll();
        write('mixed.dat', Buffer.from([0x41, 0x00, 0x42]));
        git('add', 'mixed.dat');

        const result = await load('mixed.dat', 'staged');
        expect(result.binary).toBe(true);
        expect(result.base.content).toBe('');
        expect(result.head.content).toBe('');
    });

    it('flags a file over the 10MB guard without reading its content', async () => {
        write('big.txt', 'small\n');
        commitAll();
        write('big.txt', 'a'.repeat(MAX_WORKING_TREE_CONTENT_BYTES + 1));

        const io = createWorkingTreeContentIO(repo);
        const reads: string[] = [];
        const spied: WorkingTreeContentIO = {
            ...io,
            readDisk: (p) => { reads.push(p); return io.readDisk(p); },
            readBlob: (s) => { reads.push(s); return io.readBlob(s); },
        };
        const result = await loadWorkingTreeFileContent(spied, req('big.txt', 'unstaged'));
        expect(result.tooLarge).toBe(true);
        expect(result.binary).toBe(false);
        expect(result.head.content).toBe('');
        expect(result.base.content).toBe('');
        expect(reads).toEqual([]);
    });

    it('accepts a file exactly at the 10MB guard', async () => {
        write('edge.txt', 'small\n');
        commitAll();
        write('edge.txt', 'a'.repeat(MAX_WORKING_TREE_CONTENT_BYTES));

        const result = await load('edge.txt', 'unstaged');
        expect(result.tooLarge).toBe(false);
        expect(result.head.content.length).toBe(MAX_WORKING_TREE_CONTENT_BYTES);
    });

    it.skipIf(process.platform === 'win32')('reports a symlink as binary', async () => {
        write('target.txt', 'target\n');
        fs.symlinkSync('target.txt', path.join(repo, 'link.txt'));
        commitAll();
        fs.unlinkSync(path.join(repo, 'link.txt'));
        fs.symlinkSync('elsewhere.txt', path.join(repo, 'link.txt'));

        const unstaged = await load('link.txt', 'unstaged');
        expect(unstaged.binary).toBe(true);
        expect(unstaged.base.content).toBe('');
        expect(unstaged.head.content).toBe('');
    });

    it('reports a submodule (gitlink) as binary', async () => {
        write('seed.txt', 'x\n');
        commitAll();
        const sha = git('rev-parse', 'HEAD').trim();
        git('update-index', '--add', '--cacheinfo', `160000,${sha},vendor/sub`);

        const result = await load('vendor/sub', 'staged');
        expect(result.binary).toBe(true);
        expect(result.head).toMatchObject({ content: '', exists: true, ref: 'INDEX' });
    });
});

describe('caching', () => {
    function countingIO(): { io: WorkingTreeContentIO; reads: () => number } {
        const real = createWorkingTreeContentIO(repo);
        let n = 0;
        return {
            io: {
                ...real,
                readDisk: (p) => { n++; return real.readDisk(p); },
                readBlob: (s) => { n++; return real.readBlob(s); },
            },
            reads: () => n,
        };
    }

    it('serves a repeat request from cache and echoes the caller path', async () => {
        write('c.txt', 'one\n');
        commitAll();
        write('c.txt', 'two\n');
        const service = new GitCacheService();
        const { io, reads } = countingIO();

        const first = await loadWorkingTreeFileContent(io, req('c.txt', 'unstaged'), { service, workspaceId: 'ws1' });
        const afterFirst = reads();
        const second = await loadWorkingTreeFileContent(
            io,
            { ...req('c.txt', 'unstaged'), requestPath: path.join(repo, 'c.txt') },
            { service, workspaceId: 'ws1' },
        );

        expect(afterFirst).toBe(2);
        expect(reads()).toBe(afterFirst);
        expect(second.head.content).toBe(first.head.content);
        expect(second.path).toBe(path.join(repo, 'c.txt'));
    });

    it('misses after the disk side changes and keeps one entry per file', async () => {
        write('c.txt', 'one\n');
        commitAll();
        write('c.txt', 'two\n');
        const service = new GitCacheService();
        const cache = { service, workspaceId: 'ws1' };
        const io = createWorkingTreeContentIO(repo);

        const first = await loadWorkingTreeFileContent(io, req('c.txt', 'unstaged'), cache);
        expect(first.head.content).toBe('two\n');

        write('c.txt', 'three, longer\n');
        const second = await loadWorkingTreeFileContent(io, req('c.txt', 'unstaged'), cache);
        expect(second.head.content).toBe('three, longer\n');
        expect(service.size).toBe(1);
    });

    it('misses after re-staging and after a new HEAD', async () => {
        write('s.txt', 'v1\n');
        commitAll();
        write('s.txt', 'v2\n');
        git('add', 's.txt');
        const service = new GitCacheService();
        const cache = { service, workspaceId: 'ws1' };
        const io = createWorkingTreeContentIO(repo);

        expect((await loadWorkingTreeFileContent(io, req('s.txt', 'staged'), cache)).head.content).toBe('v2\n');

        write('s.txt', 'v3\n');
        git('add', 's.txt');
        expect((await loadWorkingTreeFileContent(io, req('s.txt', 'staged'), cache)).head.content).toBe('v3\n');

        git('commit', '-q', '-m', 'v3');
        write('s.txt', 'v4\n');
        git('add', 's.txt');
        const afterCommit = await loadWorkingTreeFileContent(io, req('s.txt', 'staged'), cache);
        expect(afterCommit.base.content).toBe('v3\n');
        expect(afterCommit.head.content).toBe('v4\n');
    });

    it('keeps workspaces and stages in separate entries', async () => {
        write('m.txt', 'v1\n');
        commitAll();
        write('m.txt', 'v2\n');
        git('add', 'm.txt');
        write('m.txt', 'v3\n');
        const service = new GitCacheService();
        const io = createWorkingTreeContentIO(repo);

        await loadWorkingTreeFileContent(io, req('m.txt', 'staged'), { service, workspaceId: 'ws1' });
        await loadWorkingTreeFileContent(io, req('m.txt', 'unstaged'), { service, workspaceId: 'ws1' });
        await loadWorkingTreeFileContent(io, req('m.txt', 'unstaged'), { service, workspaceId: 'ws2' });
        expect(service.size).toBe(3);

        service.invalidateMutable('ws1');
        expect(service.size).toBe(1);
    });
});

describe('helpers', () => {
    it('resolveWorkingTreePath accepts relative and absolute paths inside the root', () => {
        const root = path.resolve('/repo/root');
        expect(resolveWorkingTreePath(root, 'src/a.ts')).toBe(path.join(root, 'src', 'a.ts'));
        expect(resolveWorkingTreePath(root, path.join(root, 'src', 'a.ts'))).toBe(path.join(root, 'src', 'a.ts'));
    });

    it('resolveWorkingTreePath rejects escapes and the root itself', () => {
        const root = path.resolve('/repo/root');
        expect(resolveWorkingTreePath(root, '../outside.ts')).toBeNull();
        expect(resolveWorkingTreePath(root, 'src/../../outside.ts')).toBeNull();
        expect(resolveWorkingTreePath(root, path.resolve('/elsewhere/a.ts'))).toBeNull();
        expect(resolveWorkingTreePath(root, '.')).toBeNull();
    });

    it('toRepoRelative uses forward slashes', () => {
        const root = path.resolve('/repo/root');
        expect(toRepoRelative(root, path.join(root, 'a', 'b', 'c.ts'))).toBe('a/b/c.ts');
    });

    it('languageFromPath returns the lower-cased extension', () => {
        expect(languageFromPath('src/Foo.TS')).toBe('ts');
        expect(languageFromPath('Makefile')).toBe('');
    });

    it('isBinaryBuffer only sniffs the first 8000 bytes', () => {
        expect(isBinaryBuffer(Buffer.from('plain text'))).toBe(false);
        expect(isBinaryBuffer(Buffer.from([0x61, 0x00]))).toBe(true);
        const late = Buffer.concat([Buffer.alloc(8000, 0x61), Buffer.from([0x00])]);
        expect(isBinaryBuffer(late)).toBe(false);
    });

    it('parses ls-tree and ls-files -s lines, ignoring conflict stages', () => {
        const sha = 'a'.repeat(40);
        expect(__test__.parseLsTreeLine(`100644 blob ${sha}\tsrc/a.ts`)).toEqual({ mode: '100644', sha });
        expect(__test__.parseLsTreeLine('')).toBeNull();
        expect(__test__.parseLsFilesStageLine(`100755 ${sha} 0\tbin/run`)).toEqual({ mode: '100755', sha });
        expect(__test__.parseLsFilesStageLine(`100644 ${sha} 2\tconflict.ts`)).toBeNull();
    });
});
