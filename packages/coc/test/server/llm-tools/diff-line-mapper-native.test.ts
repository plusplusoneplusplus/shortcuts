/**
 * `getFileDiff` against real repositories.
 *
 * The parser and the mapper are covered by `diff-line-mapper.test.ts` against
 * fixture strings. This file covers the one part of the module that talks to
 * git, which since the native move runs in the addon rather than as a blocking
 * child process. Its own suite cannot live in the fixture file: everything here
 * needs a repository on disk.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getFileDiff, parseUnifiedDiff } from '../../../src/server/llm-tools/diff-line-mapper';

let repoDir: string;
let nonGitDir: string;
let initialHash: string;
let secondHash: string;

function git(dir: string, ...args: string[]): string {
    return execFileSync('git', ['-C', dir, ...args], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).replace(/\r?\n$/, '');
}

beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-line-mapper-repo-'));
    nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-line-mapper-nongit-'));
    git(repoDir, 'init', '-q');
    git(repoDir, 'config', 'user.email', 'test@test.com');
    git(repoDir, 'config', 'user.name', 'Test');
    git(repoDir, 'config', 'commit.gpgsign', 'false');

    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\ntwo\nthree\n', 'utf-8');
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', 'initial');
    initialHash = git(repoDir, 'rev-parse', 'HEAD');

    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\nTWO\nthree\nfour\n', 'utf-8');
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', 'second');
    secondHash = git(repoDir, 'rev-parse', 'HEAD');
});

afterAll(() => {
    for (const dir of [repoDir, nonGitDir]) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});

describe('getFileDiff', () => {
    it('returns the unified diff between two commits', async () => {
        const diff = await getFileDiff(repoDir, initialHash, secondHash, 'a.txt');

        expect(diff).toContain('@@');
        expect(diff).toContain('-two');
        expect(diff).toContain('+TWO');
        expect(diff).toContain('+four');
    });

    it('falls back to `git show` for an initial commit, whose parent ref does not resolve', async () => {
        // Establishes the premise rather than assuming it: `<hash>..<initial>`
        // is not a range git can walk, which is what makes the fallback the
        // only way to see an initial commit's contents.
        expect(() => git(repoDir, 'diff', `${initialHash}^..${initialHash}`, '--', 'a.txt')).toThrow();

        const diff = await getFileDiff(repoDir, `${initialHash}^`, initialHash, 'a.txt');

        expect(diff).toContain('+one');
        expect(diff).toContain('+two');
        expect(diff).toContain('+three');
    });

    it('throws a per-file message when neither command can produce a diff', async () => {
        await expect(
            getFileDiff(nonGitDir, initialHash, secondHash, 'a.txt'),
        ).rejects.toThrow('Failed to retrieve diff for a.txt');
    });

    it('returns an empty diff for a path the commit did not touch', async () => {
        expect(await getFileDiff(repoDir, initialHash, secondHash, 'never-existed.txt')).toBe('');
    });

    it('parses to the same lines as the raw git output, trailing newline and all', async () => {
        // Everything crossing the native boundary loses one trailing line
        // ending. A diff is a rendering rather than a file's bytes, so that is
        // invisible — but only because the parser drops the empty string the
        // newline used to leave behind. This is what pins that.
        const raw = git(repoDir, 'diff', `${initialHash}..${secondHash}`, '--', 'a.txt');
        const native = await getFileDiff(repoDir, initialHash, secondHash, 'a.txt');

        expect(parseUnifiedDiff(`${raw}\n`)).toEqual(parseUnifiedDiff(native));
        expect(parseUnifiedDiff(native).length).toBeGreaterThan(0);
    });
});
