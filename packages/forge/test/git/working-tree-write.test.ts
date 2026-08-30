/**
 * `WorkingTreeService`'s mutating half, and `getFileDiff`, against real repos.
 *
 * Stage, unstage, discard and diff run in the native addon now, so there is no
 * child process to intercept and nothing left to assert about which one Node
 * was asked to start. These drive real repositories and assert what actually
 * happened to the index and the working tree.
 *
 * Deliberately a separate file — `working-tree-service.test.ts` mocks `fs`
 * module-wide, which a suite that writes to a temp directory cannot live with.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { WorkingTreeService } from '../../src/git/working-tree-service';

const service = new WorkingTreeService();
const repos: string[] = [];

function git(repo: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

/** A repo with one commit and an identity that does not read global config. */
function makeRepo(): string {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-worktree-write-')));
    repos.push(repo);
    git(repo, 'init', '--initial-branch=main');
    git(repo, 'config', 'user.email', 'ralph@example.com');
    git(repo, 'config', 'user.name', 'Ralph');
    git(repo, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'initial commit');
    return repo;
}

/** The porcelain status letters keyed by path, straight from the CLI. */
function porcelain(repo: string): Record<string, string> {
    const rows: Record<string, string> = {};
    for (const line of git(repo, 'status', '--porcelain').split('\n')) {
        if (line.trim() === '') continue;
        rows[line.slice(3)] = line.slice(0, 2);
    }
    return rows;
}

function write(repo: string, name: string, contents: string): string {
    const file = path.join(repo, name);
    fs.writeFileSync(file, contents);
    return file;
}

afterAll(() => {
    for (const repo of repos) fs.rmSync(repo, { recursive: true, force: true });
});

describe('WorkingTreeService.stageFile', () => {
    it('stages an untracked file', async () => {
        const repo = makeRepo();
        const file = write(repo, 'fresh.txt', 'fresh\n');

        await expect(service.stageFile(repo, file)).resolves.toEqual({ success: true });
        expect(porcelain(repo)['fresh.txt']).toBe('A ');
    });

    it('stages a path holding a space', async () => {
        const repo = makeRepo();
        const file = write(repo, 'a file.txt', 'spaces\n');

        await expect(service.stageFile(repo, file)).resolves.toEqual({ success: true });
        // No shell is involved on either side of the boundary, so the space
        // needs no quoting and cannot re-split the command.
        expect(porcelain(repo)['"a file.txt"']).toBe('A ');
    });

    it('reports the failure when the path does not match anything', async () => {
        const repo = makeRepo();
        const result = await service.stageFile(repo, path.join(repo, 'missing.ts'));

        expect(result.success).toBe(false);
        expect(result.error).toContain('did not match');
        // The whole move keeps this shape: routes show it to users verbatim.
        expect(result.error).toContain('git add -- ');
    });
});

describe('WorkingTreeService.stageFiles', () => {
    it('does not run git for an empty list', async () => {
        const repo = makeRepo();
        await expect(service.stageFiles(repo, [])).resolves.toEqual({
            success: true,
            staged: 0,
            errors: [],
        });
    });

    it('stages every file in one command', async () => {
        const repo = makeRepo();
        const files = [write(repo, 'a.txt', 'a\n'), write(repo, 'b.txt', 'b\n')];

        await expect(service.stageFiles(repo, files)).resolves.toEqual({
            success: true,
            staged: 2,
            errors: [],
        });
        expect(porcelain(repo)).toMatchObject({ 'a.txt': 'A ', 'b.txt': 'A ' });
    });

    it('falls back to staging one at a time when the batch fails', async () => {
        const repo = makeRepo();
        const good = write(repo, 'good.txt', 'good\n');
        const missing = path.join(repo, 'missing.txt');

        // One bad pathspec fails the whole batch; the good file still lands.
        const result = await service.stageFiles(repo, [good, missing]);

        expect(result.staged).toBe(1);
        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('missing.txt');
        expect(porcelain(repo)['good.txt']).toBe('A ');
    });
});

describe('WorkingTreeService.unstageFile', () => {
    it('unstages a modification', async () => {
        const repo = makeRepo();
        const file = write(repo, 'README.md', 'changed\n');
        git(repo, 'add', 'README.md');

        await expect(service.unstageFile(repo, file)).resolves.toEqual({ success: true });
        expect(porcelain(repo)['README.md']).toBe(' M');
    });

    it('falls back to rm --cached in a repository with no commits', async () => {
        // `reset HEAD` has no HEAD to reset to before the first commit, so the
        // fallback is the only thing that can unstage here.
        const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-worktree-unborn-')));
        repos.push(repo);
        git(repo, 'init', '--initial-branch=main');
        const file = write(repo, 'first.txt', 'first\n');
        git(repo, 'add', 'first.txt');

        await expect(service.unstageFile(repo, file)).resolves.toEqual({ success: true });
        expect(porcelain(repo)['first.txt']).toBe('??');
    });
});

describe('WorkingTreeService.unstageFiles', () => {
    it('does not run git for an empty list', async () => {
        const repo = makeRepo();
        await expect(service.unstageFiles(repo, [])).resolves.toEqual({
            success: true,
            unstaged: 0,
            errors: [],
        });
    });

    it('unstages every file in one command', async () => {
        const repo = makeRepo();
        const files = [write(repo, 'a.txt', 'a\n'), write(repo, 'b.txt', 'b\n')];
        git(repo, 'add', '.');

        await expect(service.unstageFiles(repo, files)).resolves.toEqual({
            success: true,
            unstaged: 2,
            errors: [],
        });
        expect(porcelain(repo)).toMatchObject({ 'a.txt': '??', 'b.txt': '??' });
    });
});

describe('WorkingTreeService.discardChanges', () => {
    it('restores a tracked file from the index', async () => {
        const repo = makeRepo();
        const file = write(repo, 'README.md', 'clobbered\n');

        await expect(service.discardChanges(repo, file)).resolves.toEqual({ success: true });
        expect(fs.readFileSync(file, 'utf-8')).toBe('hello\n');
        expect(porcelain(repo)).toEqual({});
    });

    it('reports the failure for a path git does not track', async () => {
        const repo = makeRepo();
        const result = await service.discardChanges(repo, write(repo, 'untracked.txt', 'x\n'));

        expect(result.success).toBe(false);
        expect(result.error).toContain('git checkout -- ');
    });
});

describe('WorkingTreeService.discardAll', () => {
    it('returns the working tree to a clean state', async () => {
        const repo = makeRepo();
        write(repo, 'README.md', 'edited\n');
        write(repo, 'staged.txt', 'staged\n');
        write(repo, 'untracked.txt', 'untracked\n');
        git(repo, 'add', 'staged.txt');

        const result = await service.discardAll(repo);

        expect(result.errors).toEqual([]);
        expect(result.success).toBe(true);
        // The edit reverted, the staged-added file deleted, the untracked one
        // deleted — three paths, and nothing left behind.
        expect(result.discarded).toBe(3);
        expect(porcelain(repo)).toEqual({});
        expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf-8')).toBe('hello\n');
        expect(fs.existsSync(path.join(repo, 'staged.txt'))).toBe(false);
        expect(fs.existsSync(path.join(repo, 'untracked.txt'))).toBe(false);
    });

    it('does nothing to a clean repository', async () => {
        const repo = makeRepo();
        await expect(service.discardAll(repo)).resolves.toEqual({
            success: true,
            discarded: 0,
            errors: [],
        });
    });
});

describe('WorkingTreeService.getFileDiff', () => {
    it('reads the unstaged diff for one file', async () => {
        const repo = makeRepo();
        const file = write(repo, 'README.md', 'hello\nworld\n');

        const diff = await service.getFileDiff(repo, file, false);

        expect(diff).toContain('--- a/README.md');
        expect(diff).toContain('+world');
    });

    it('reads the staged diff only when asked for it', async () => {
        const repo = makeRepo();
        const file = write(repo, 'README.md', 'hello\nstaged\n');
        git(repo, 'add', 'README.md');
        fs.writeFileSync(file, 'hello\nstaged\nand unstaged\n');

        expect(await service.getFileDiff(repo, file, true)).toContain('+staged');
        expect(await service.getFileDiff(repo, file, true)).not.toContain('+and unstaged');
        expect(await service.getFileDiff(repo, file, false)).toContain('+and unstaged');
    });

    it('returns an empty string when there is no diff', async () => {
        const repo = makeRepo();
        await expect(service.getFileDiff(repo, path.join(repo, 'README.md'), false)).resolves.toBe('');
    });

    it('returns an empty string when git fails', async () => {
        const repo = makeRepo();
        await expect(service.getFileDiff(repo, path.join(repo, 'nope.txt'), true)).resolves.toBe('');
    });
});
