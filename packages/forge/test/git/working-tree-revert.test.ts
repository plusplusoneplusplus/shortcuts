/**
 * `WorkingTreeService.revertChange` against real temp repos: each status case,
 * mixed staged/unstaged state, stale-state refusal, and unrelated files kept.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import {
    WORKING_TREE_REVERT_STALE, WorkingTreeService, workingTreeRevertKind, workingTreeRevertPaths, workingTreeRevertRelatedRows,
} from '../../src/git/working-tree-service';
import type { GitChange, GitChangeStage } from '../../src/git/types';

const service = new WorkingTreeService();
const repos: string[] = [];

function git(repo: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

function makeRepo(): string {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-worktree-revert-')));
    repos.push(repo);
    git(repo, 'init', '--initial-branch=main');
    git(repo, 'config', 'user.email', 'ralph@example.com');
    git(repo, 'config', 'user.name', 'Ralph');
    git(repo, 'config', 'commit.gpgsign', 'false');
    for (const name of ['a.txt', 'b.txt', 'keep.txt']) fs.writeFileSync(path.join(repo, name), `${name}\n`);
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'initial commit');
    return repo;
}

function porcelain(repo: string): Record<string, string> {
    const rows: Record<string, string> = {};
    for (const line of git(repo, 'status', '--porcelain', '--untracked-files=all').split('\n')) {
        if (line.trim() === '') continue;
        rows[line.slice(3)] = line.slice(0, 2);
    }
    return rows;
}

const file = (repo: string, name: string) => path.join(repo, name);
const read = (repo: string, name: string) => fs.readFileSync(file(repo, name), 'utf-8');

/** Revert the row the way the UI does: with every related row it saw in the list. */
async function revert(repo: string, name: string, stage: GitChangeStage) {
    const rows = await service.getAllChanges(repo);
    const target = rows.find(row => row.filePath === file(repo, name) && row.stage === stage)!;
    expect(target).toBeDefined();
    const expected = workingTreeRevertRelatedRows(rows, workingTreeRevertPaths(target));
    return service.revertChange(repo, { filePath: target.filePath, stage, expected });
}

/** An unrelated modified file every case leaves alone. */
function dirtyUnrelated(repo: string) {
    fs.writeFileSync(file(repo, 'keep.txt'), 'unrelated edit\n');
}

afterAll(() => {
    for (const repo of repos) fs.rmSync(repo, { recursive: true, force: true });
});

describe('workingTreeRevertKind', () => {
    it.each<[GitChangeStage, string, string | null]>([
        ['untracked', 'untracked', 'delete-untracked'],
        ['unstaged', 'modified', 'discard-unstaged'],
        ['unstaged', 'deleted', 'discard-unstaged'],
        ['unstaged', 'added', 'restore-from-head'],
        ['staged', 'modified', 'restore-from-head'],
        ['staged', 'added', 'restore-from-head'],
        ['staged', 'deleted', 'restore-from-head'],
        ['staged', 'renamed', 'restore-from-head'],
        ['staged', 'copied', 'restore-from-head'],
        ['staged', 'conflict', null],
        ['unstaged', 'conflict', null],
    ])('%s %s → %s', (stage, status, kind) => {
        expect(workingTreeRevertKind({ stage, status } as Pick<GitChange, 'stage' | 'status'>)).toBe(kind);
    });
});

describe('WorkingTreeService.revertChange', () => {
    it('deletes an untracked file and nothing else', async () => {
        const repo = makeRepo();
        dirtyUnrelated(repo);
        fs.writeFileSync(file(repo, 'new.txt'), 'new\n');
        fs.writeFileSync(file(repo, 'other-new.txt'), 'other\n');

        await expect(revert(repo, 'new.txt', 'untracked')).resolves.toEqual({ success: true });
        expect(fs.existsSync(file(repo, 'new.txt'))).toBe(false);
        expect(porcelain(repo)).toEqual({ 'keep.txt': ' M', 'other-new.txt': '??' });
    });

    it('discards unstaged edits and keeps staged edits to the same file', async () => {
        const repo = makeRepo();
        dirtyUnrelated(repo);
        fs.writeFileSync(file(repo, 'a.txt'), 'staged\n');
        git(repo, 'add', 'a.txt');
        fs.writeFileSync(file(repo, 'a.txt'), 'staged\nunstaged\n');

        await expect(revert(repo, 'a.txt', 'unstaged')).resolves.toEqual({ success: true });
        expect(read(repo, 'a.txt')).toBe('staged\n');
        expect(porcelain(repo)).toEqual({ 'a.txt': 'M ', 'keep.txt': ' M' });
    });

    it('restores an unstaged deletion', async () => {
        const repo = makeRepo();
        fs.rmSync(file(repo, 'a.txt'));

        await expect(revert(repo, 'a.txt', 'unstaged')).resolves.toEqual({ success: true });
        expect(read(repo, 'a.txt')).toBe('a.txt\n');
        expect(porcelain(repo)).toEqual({});
    });

    it('reverts a staged edit and the unstaged edits on top of it to HEAD', async () => {
        const repo = makeRepo();
        dirtyUnrelated(repo);
        fs.writeFileSync(file(repo, 'a.txt'), 'staged\n');
        git(repo, 'add', 'a.txt');
        fs.writeFileSync(file(repo, 'a.txt'), 'staged\nunstaged\n');

        await expect(revert(repo, 'a.txt', 'staged')).resolves.toEqual({ success: true });
        expect(read(repo, 'a.txt')).toBe('a.txt\n');
        expect(porcelain(repo)).toEqual({ 'keep.txt': ' M' });
    });

    it('removes a staged new file from the index and disk', async () => {
        const repo = makeRepo();
        fs.writeFileSync(file(repo, 'n.txt'), 'new\n');
        git(repo, 'add', 'n.txt');

        await expect(revert(repo, 'n.txt', 'staged')).resolves.toEqual({ success: true });
        expect(fs.existsSync(file(repo, 'n.txt'))).toBe(false);
        expect(porcelain(repo)).toEqual({});
    });

    it('removes an intent-to-add file instead of emptying it', async () => {
        const repo = makeRepo();
        fs.writeFileSync(file(repo, 'i.txt'), 'content\n');
        git(repo, 'add', '-N', 'i.txt');

        await expect(revert(repo, 'i.txt', 'unstaged')).resolves.toEqual({ success: true });
        expect(fs.existsSync(file(repo, 'i.txt'))).toBe(false);
        expect(porcelain(repo)).toEqual({});
    });

    it('restores a staged deletion', async () => {
        const repo = makeRepo();
        git(repo, 'rm', '-q', 'a.txt');

        await expect(revert(repo, 'a.txt', 'staged')).resolves.toEqual({ success: true });
        expect(read(repo, 'a.txt')).toBe('a.txt\n');
        expect(porcelain(repo)).toEqual({});
    });

    it('undoes a staged rename at both paths', async () => {
        const repo = makeRepo();
        dirtyUnrelated(repo);
        git(repo, 'mv', 'b.txt', 'b2.txt');

        await expect(revert(repo, 'b2.txt', 'staged')).resolves.toEqual({ success: true });
        expect(read(repo, 'b.txt')).toBe('b.txt\n');
        expect(fs.existsSync(file(repo, 'b2.txt'))).toBe(false);
        expect(porcelain(repo)).toEqual({ 'keep.txt': ' M' });
    });

    it('refuses to overwrite an untracked file at a staged deletion path', async () => {
        const repo = makeRepo();
        git(repo, 'rm', '-q', '--cached', 'a.txt');
        fs.writeFileSync(file(repo, 'a.txt'), 'user content\n');

        const result = await revert(repo, 'a.txt', 'staged');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/untracked file/);
        expect(read(repo, 'a.txt')).toBe('user content\n');
    });

    it('refuses when the file gained changes after the list was read', async () => {
        const repo = makeRepo();
        fs.writeFileSync(file(repo, 'a.txt'), 'staged\n');
        git(repo, 'add', 'a.txt');
        const rows = await service.getAllChanges(repo);
        const target = rows.find(row => row.stage === 'staged')!;
        const expected = workingTreeRevertRelatedRows(rows, workingTreeRevertPaths(target));
        // An unstaged edit appears after the user confirmed "staged changes only".
        fs.writeFileSync(file(repo, 'a.txt'), 'staged\nlater\n');

        await expect(service.revertChange(repo, { filePath: target.filePath, stage: 'staged', expected }))
            .resolves.toEqual({ success: false, error: WORKING_TREE_REVERT_STALE });
        expect(read(repo, 'a.txt')).toBe('staged\nlater\n');
    });

    it('refuses a path git does not report, including one outside the repository', async () => {
        const repo = makeRepo();
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-worktree-revert-outside-'));
        repos.push(outside);
        const victim = path.join(outside, 'victim.txt');
        fs.writeFileSync(victim, 'keep me\n');

        const result = await service.revertChange(repo, { filePath: victim, stage: 'untracked', expected: [] });
        expect(result).toEqual({ success: false, error: WORKING_TREE_REVERT_STALE });
        expect(fs.existsSync(victim)).toBe(true);
        const tracked = await service.revertChange(repo, { filePath: file(repo, 'a.txt'), stage: 'untracked', expected: [] });
        expect(tracked.success).toBe(false);
        expect(read(repo, 'a.txt')).toBe('a.txt\n');
    });

    it('refuses a conflicted file', async () => {
        const repo = makeRepo();
        git(repo, 'checkout', '-q', '-b', 'other');
        fs.writeFileSync(file(repo, 'a.txt'), 'other\n');
        git(repo, 'commit', '-qam', 'other');
        git(repo, 'checkout', '-q', 'main');
        fs.writeFileSync(file(repo, 'a.txt'), 'main\n');
        git(repo, 'commit', '-qam', 'main');
        try { git(repo, 'merge', 'other'); } catch { /* conflict expected */ }
        const rows = await service.getAllChanges(repo);
        const conflict = rows.find(row => row.filePath === file(repo, 'a.txt'))!;
        expect(conflict.status).toBe('conflict');

        const result = await service.revertChange(repo, { filePath: conflict.filePath, stage: conflict.stage, expected: [conflict] });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/merge conflict/);
    });
});
