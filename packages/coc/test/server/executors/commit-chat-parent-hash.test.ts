/**
 * `resolveParentHash` against a real repository.
 *
 * The executor's own suite mocks `fs` module-wide and stubs the git runner, so
 * it can only assert that whatever the runner said reaches the diff-comment
 * tool. What the command actually resolves to — first parent of a merge, the
 * empty string for an initial commit — is behaviour, and behaviour needs a
 * repository.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { resolveParentHash } from '../../../src/server/executors/commit-chat-executor';

let repoDir: string;
let nonGitDir: string;
let initialHash: string;
let secondHash: string;
let sideHash: string;
let mergeHash: string;

function git(dir: string, ...args: string[]): string {
    return execFileSync('git', ['-C', dir, ...args], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).replace(/\r?\n$/, '');
}

beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-chat-parent-repo-'));
    nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-chat-parent-nongit-'));
    git(repoDir, 'init', '-q');
    git(repoDir, 'config', 'user.email', 'test@test.com');
    git(repoDir, 'config', 'user.name', 'Test');
    git(repoDir, 'config', 'commit.gpgsign', 'false');

    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'a\n', 'utf-8');
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', 'initial');
    initialHash = git(repoDir, 'rev-parse', 'HEAD');

    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'a\nb\n', 'utf-8');
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', 'second');
    secondHash = git(repoDir, 'rev-parse', 'HEAD');

    // A two-parent commit, built with plumbing so the parents land in a known
    // order and no branch is ever switched.
    sideHash = git(
        repoDir, 'commit-tree', `${initialHash}^{tree}`, '-p', initialHash, '-m', 'side',
    );
    mergeHash = git(
        repoDir, 'commit-tree', `${secondHash}^{tree}`,
        '-p', secondHash, '-p', sideHash, '-m', 'merge side',
    );
});

afterAll(() => {
    for (const dir of [repoDir, nonGitDir]) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});

describe('resolveParentHash', () => {
    it('resolves a commit to its parent', async () => {
        await expect(resolveParentHash(secondHash, repoDir)).resolves.toBe(initialHash);
    });

    it('takes the first parent of a merge commit', async () => {
        // Assert the shape of the repository before asserting the port agrees
        // with it: the merge really does have two parents, in this order.
        expect(git(repoDir, 'log', '--pretty=%P', '-n1', mergeHash).split(/\s+/)).toEqual([
            secondHash,
            sideHash,
        ]);

        await expect(resolveParentHash(mergeHash, repoDir)).resolves.toBe(secondHash);
    });

    it('resolves an initial commit to the empty string', async () => {
        expect(git(repoDir, 'log', '--pretty=%P', '-n1', initialHash)).toBe('');

        await expect(resolveParentHash(initialHash, repoDir)).resolves.toBe('');
    });

    it('resolves to the empty string for a commit that is not in the repository', async () => {
        await expect(resolveParentHash('0'.repeat(40), repoDir)).resolves.toBe('');
    });

    it('resolves to the empty string outside a repository', async () => {
        await expect(resolveParentHash(secondHash, nonGitDir)).resolves.toBe('');
    });

    it('resolves to the empty string when either argument is missing', async () => {
        await expect(resolveParentHash('', repoDir)).resolves.toBe('');
        await expect(resolveParentHash(secondHash, undefined)).resolves.toBe('');
    });
});
