/**
 * `GitLogService.getCommits` / `getCommit` against real repositories.
 *
 * History is read by `gix` in the addon now, so there is no command string and
 * no `--pretty=format:` output to mock. What is left to check on this side of
 * the boundary is the seam itself: the two repository fields Node still builds,
 * the paging arguments the N-API layer will not accept as-is, and the cases the
 * service turns into an empty answer rather than a rejection.
 *
 * Rust owns the field-level parity with `git log` — `rust/core/tests/git_log.rs`
 * compares every field of every page against the real CLI.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { GitLogService } from '../../src/git/git-log-service';

const service = new GitLogService();
const repos: string[] = [];

function git(repo: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

/** A repo with three commits and an identity that does not read global config. */
function makeRepo(): string {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-log-')));
    repos.push(repo);
    git(repo, 'init', '--initial-branch=main');
    git(repo, 'config', 'user.email', 'ralph@example.com');
    git(repo, 'config', 'user.name', 'Ralph');
    git(repo, 'config', 'commit.gpgsign', 'false');
    for (const name of ['one', 'two', 'three']) {
        fs.writeFileSync(path.join(repo, `${name}.txt`), `${name}\n`);
        git(repo, 'add', '.');
        git(repo, 'commit', '-m', `${name} commit`);
    }
    return repo;
}

afterAll(() => {
    for (const repo of repos) fs.rmSync(repo, { recursive: true, force: true });
});

describe('the fields Node still builds', () => {
    it('attaches the repository root and its basename to every commit', async () => {
        const repo = makeRepo();
        const result = await service.getCommits(repo, { maxCount: 10, skip: 0 });
        expect(result.commits).toHaveLength(3);
        for (const commit of result.commits) {
            expect(commit.repositoryRoot).toBe(repo);
            expect(commit.repositoryName).toBe(path.basename(repo));
        }
    });

    it('attaches them to a single commit too', async () => {
        const repo = makeRepo();
        const commit = await service.getCommit(repo, 'HEAD');
        expect(commit?.repositoryRoot).toBe(repo);
        expect(commit?.repositoryName).toBe(path.basename(repo));
    });

    // The page path computes it; the single-commit path never did, and the
    // field arrived as `undefined` rather than `false`.
    it('reports the unpushed flag on a page and leaves it unset on one commit', async () => {
        const repo = makeRepo();
        const page = await service.getCommits(repo, { maxCount: 1, skip: 0 });
        expect(page.commits[0].isAheadOfRemote).toBe(false);

        const single = await service.getCommit(repo, 'HEAD');
        expect(single?.isAheadOfRemote).toBeUndefined();
    });
});

describe('paging arguments the boundary will not take as-is', () => {
    it('accepts a fractional count rather than failing the page', async () => {
        const repo = makeRepo();
        const result = await service.getCommits(repo, { maxCount: 2.7, skip: 0.4 });
        expect(result.commits).toHaveLength(2);
        expect(result.hasMore).toBe(true);
    });

    it('treats a negative count as zero', async () => {
        const repo = makeRepo();
        const result = await service.getCommits(repo, { maxCount: -5, skip: 0 });
        expect(result.commits).toEqual([]);
        expect(result.hasMore).toBe(true);
    });

    it('survives a count past the 32-bit boundary', async () => {
        const repo = makeRepo();
        const result = await service.getCommits(repo, { maxCount: Number.MAX_SAFE_INTEGER, skip: 0 });
        expect(result.commits).toHaveLength(3);
        expect(result.hasMore).toBe(false);
    });
});

describe('search', () => {
    it('filters case-insensitively on the commit message', async () => {
        const repo = makeRepo();
        const result = await service.getCommits(repo, { maxCount: 10, skip: 0, search: 'TWO' });
        expect(result.commits.map(commit => commit.subject)).toEqual(['two commit']);
    });

    it('treats an empty search as no filter at all', async () => {
        const repo = makeRepo();
        const filtered = await service.getCommits(repo, { maxCount: 10, skip: 0, search: '' });
        const unfiltered = await service.getCommits(repo, { maxCount: 10, skip: 0 });
        expect(filtered.commits.map(c => c.hash)).toEqual(unfiltered.commits.map(c => c.hash));
    });
});

describe('answers that are empty rather than failures', () => {
    it('returns no commits for a path that is not a repository', async () => {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-log-bare-')));
        repos.push(dir);
        const result = await service.getCommits(dir, { maxCount: 5, skip: 0 });
        expect(result.commits).toEqual([]);
        expect(result.hasMore).toBe(false);
    });

    it('returns no commits for a repository that has none yet', async () => {
        const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-log-empty-')));
        repos.push(repo);
        git(repo, 'init', '--initial-branch=main');
        const result = await service.getCommits(repo, { maxCount: 5, skip: 0 });
        expect(result.commits).toEqual([]);
        expect(result.hasMore).toBe(false);
    });

    it('returns undefined for a revision that names nothing', async () => {
        const repo = makeRepo();
        await expect(service.getCommit(repo, 'no-such-ref')).resolves.toBeUndefined();
    });
});
