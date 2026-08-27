/**
 * `BranchService`'s read half against real repositories.
 *
 * Branch listing, HEAD resolution and upstream drift run in the addon now, so
 * there is no `execSync` to mock and no command string worth asserting on.
 * What is left on this side of the boundary is the seam: the shapes Node
 * rebuilds from what crossed it, the paging arguments it clamps, the
 * count-only questions it asks with a zero limit, and the failures it turns
 * into an empty list rather than a throw.
 *
 * Rust owns the semantics themselves — `rust/core/tests/git_branch.rs` covers
 * the porcelain parser, ref ordering, ahead/behind and the search filter
 * against temp repositories.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { BranchService, parsePorcelainV2BranchStatus } from '../../src/git/branch-service';

const repos: string[] = [];

function git(repo: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

function makeRepo(prefix: string): string {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `forge-${prefix}-`)));
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

/** An `origin` and a clone of it, so upstream tracking is real. */
function makeClone(prefix: string): { origin: string; work: string } {
    const origin = makeRepo(`${prefix}-origin`);
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `forge-${prefix}-`)));
    repos.push(parent);
    const work = path.join(parent, 'clone');
    execFileSync('git', ['clone', origin, work], { encoding: 'utf-8' });
    git(work, 'config', 'user.email', 'ralph@example.com');
    git(work, 'config', 'user.name', 'Ralph');
    git(work, 'config', 'commit.gpgsign', 'false');
    return { origin, work };
}

afterAll(() => {
    for (const repo of repos) fs.rmSync(repo, { recursive: true, force: true });
});

const service = new BranchService();

describe('getRepositoryStatus', () => {
    it('reads branch, tracking and drift for a clean clone', async () => {
        const { work } = makeClone('branch-status');
        await expect(service.getRepositoryStatus(work)).resolves.toEqual({
            branch: 'main',
            isDetached: false,
            dirty: false,
            ahead: 0,
            behind: 0,
            trackingBranch: 'origin/main',
            unborn: false,
        });
    });

    it('reports an untracked file as dirty', async () => {
        const repo = makeRepo('branch-dirty');
        fs.writeFileSync(path.join(repo, 'scratch.txt'), 'scratch\n');
        const status = await service.getRepositoryStatus(repo);
        expect(status?.dirty).toBe(true);
    });

    // The property is absent, not present-and-undefined: routes JSON-encode
    // this straight onto the wire.
    it('leaves an unconfigured upstream off the object entirely', async () => {
        const repo = makeRepo('branch-no-upstream');
        const status = await service.getRepositoryStatus(repo);
        expect(status && 'trackingBranch' in status).toBe(false);
    });

    it('returns null rather than throwing outside a repository', async () => {
        const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-branch-none-')));
        repos.push(empty);
        await expect(service.getRepositoryStatus(empty)).resolves.toBeNull();
    });
});

describe('parsePorcelainV2BranchStatus', () => {
    it('parses text some other process produced — the WSL path', async () => {
        await expect(
            parsePorcelainV2BranchStatus(
                '# branch.oid abc\n# branch.head trunk\n# branch.upstream origin/trunk\n# branch.ab +1 -2\n? new.txt\n',
            ),
        ).resolves.toEqual({
            branch: 'trunk',
            isDetached: false,
            dirty: true,
            ahead: 1,
            behind: 2,
            trackingBranch: 'origin/trunk',
            unborn: false,
        });
    });

    it('agrees with getRepositoryStatus on the same repository', async () => {
        const repo = makeRepo('branch-parity');
        const text = git(repo, 'status', '--porcelain=v2', '--branch', '--untracked-files=all');
        expect(await parsePorcelainV2BranchStatus(text)).toEqual(
            await service.getRepositoryStatus(repo),
        );
    });
});

describe('getBranchStatus', () => {
    it('merges the caller’s uncommitted-changes answer into the branch status', async () => {
        const { work } = makeClone('branch-tracking');
        await expect(service.getBranchStatus(work, true)).resolves.toEqual({
            name: 'main',
            isDetached: false,
            ahead: 0,
            behind: 0,
            trackingBranch: 'origin/main',
            hasUncommittedChanges: true,
        });
    });

    it('counts commits ahead of the upstream', async () => {
        const { work } = makeClone('branch-ahead');
        fs.writeFileSync(path.join(work, 'ahead.txt'), 'ahead\n');
        git(work, 'add', '.');
        git(work, 'commit', '-m', 'ahead by one');

        const status = await service.getBranchStatus(work, false);
        expect(status).toMatchObject({ ahead: 1, behind: 0, trackingBranch: 'origin/main' });
    });

    it('reports a detached HEAD with its hash and no branch name', async () => {
        const repo = makeRepo('branch-detached');
        const head = git(repo, 'rev-parse', 'HEAD').trim();
        git(repo, 'checkout', '--detach', 'HEAD');

        await expect(service.getBranchStatus(repo, false)).resolves.toEqual({
            name: '',
            isDetached: true,
            detachedHash: head,
            ahead: 0,
            behind: 0,
            hasUncommittedChanges: false,
        });
    });

    it('leaves detachedHash off a branch that is not detached', async () => {
        const repo = makeRepo('branch-attached');
        const status = await service.getBranchStatus(repo, false);
        expect(status && 'detachedHash' in status).toBe(false);
    });

    it('returns null for a repository with no commits', async () => {
        const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-branch-unborn-')));
        repos.push(empty);
        git(empty, 'init', '--initial-branch=main');
        await expect(service.getBranchStatus(empty, false)).resolves.toBeNull();
    });

    it('returns null rather than throwing outside a repository', async () => {
        const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-branch-nogit-')));
        repos.push(empty);
        await expect(service.getBranchStatus(empty, false)).resolves.toBeNull();
    });
});

describe('branch listing', () => {
    /** A repository with `main` plus three branches, in refname order. */
    function listable(): string {
        const repo = makeRepo('branch-list');
        for (const name of ['zeta', 'alpha', 'feature/one']) git(repo, 'branch', name);
        return repo;
    }

    it('lists every local branch with its subject, date and current flag', async () => {
        const repo = listable();
        const branches = await service.getLocalBranches(repo);
        expect(branches.map(branch => branch.name)).toEqual([
            'alpha',
            'feature/one',
            'main',
            'zeta',
        ]);
        expect(branches.find(branch => branch.name === 'main')).toMatchObject({
            isCurrent: true,
            isRemote: false,
            lastCommitSubject: 'initial commit',
        });
        expect(branches[0].lastCommitDate).toMatch(/ago$/);
    });

    it('leaves remoteName off a local branch', async () => {
        const repo = listable();
        const [first] = await service.getLocalBranches(repo);
        expect('remoteName' in first).toBe(false);
    });

    it('lists remote branches with their remote name and drops origin/HEAD', async () => {
        const { work } = makeClone('branch-remote');
        const branches = await service.getRemoteBranches(work);
        expect(branches.map(branch => branch.name)).toEqual(['origin/main']);
        expect(branches[0]).toMatchObject({ isRemote: true, remoteName: 'origin', isCurrent: false });
    });

    it('combines both namespaces in getAllBranches', async () => {
        const { work } = makeClone('branch-all');
        const { local, remote } = await service.getAllBranches(work);
        expect(local.map(branch => branch.name)).toEqual(['main']);
        expect(remote.map(branch => branch.name)).toEqual(['origin/main']);
    });

    it('paginates with an offset, a limit and hasMore', async () => {
        const repo = listable();
        const page = await service.getLocalBranchesPaginated(repo, { limit: 2, offset: 1 });
        expect(page.branches.map(branch => branch.name)).toEqual(['feature/one', 'main']);
        expect(page.totalCount).toBe(4);
        expect(page.hasMore).toBe(true);
    });

    it('reports no more once a page reaches the end', async () => {
        const repo = listable();
        const page = await service.getLocalBranchesPaginated(repo, { limit: 10, offset: 2 });
        expect(page.branches.map(branch => branch.name)).toEqual(['main', 'zeta']);
        expect(page.hasMore).toBe(false);
    });

    it('filters by name, case-insensitively', async () => {
        const repo = listable();
        const page = await service.getLocalBranchesPaginated(repo, { searchPattern: 'FEATURE' });
        expect(page.branches.map(branch => branch.name)).toEqual(['feature/one']);
        expect(page.totalCount).toBe(1);
    });

    it('returns an empty page when nothing matches', async () => {
        const repo = listable();
        await expect(
            service.getLocalBranchesPaginated(repo, { searchPattern: 'nonexistent' }),
        ).resolves.toEqual({ branches: [], totalCount: 0, hasMore: false });
    });

    // The count callers ask with a zero limit, so the total has to be right
    // even though no row comes back.
    it('counts local branches without describing them', async () => {
        const repo = listable();
        await expect(service.getLocalBranchCount(repo)).resolves.toBe(4);
        await expect(service.getLocalBranchCount(repo, 'FEATURE')).resolves.toBe(1);
    });

    it('counts remote branches, excluding origin/HEAD', async () => {
        const { work } = makeClone('branch-count');
        await expect(service.getRemoteBranchCount(work)).resolves.toBe(1);
        await expect(service.getRemoteBranchCount(work, 'nope')).resolves.toBe(0);
    });

    it('searches both namespaces at once', async () => {
        const { work } = makeClone('branch-search');
        git(work, 'branch', 'feature/one');
        const found = await service.searchBranches(work, 'main');
        expect(found.local.map(branch => branch.name)).toEqual(['main']);
        expect(found.remote.map(branch => branch.name)).toEqual(['origin/main']);
    });

    it('clamps a paging argument too large for the native boundary', async () => {
        const repo = listable();
        const page = await service.getLocalBranchesPaginated(repo, {
            limit: Number.MAX_SAFE_INTEGER,
            offset: 0,
        });
        expect(page.branches).toHaveLength(4);
        expect(page.hasMore).toBe(false);
    });

    it('degrades to an empty list outside a repository rather than throwing', async () => {
        const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-branch-nolist-')));
        repos.push(empty);
        await expect(service.getLocalBranches(empty)).resolves.toEqual([]);
        await expect(service.getLocalBranchCount(empty)).resolves.toBe(0);
        await expect(service.getRemoteBranchesPaginated(empty)).resolves.toEqual({
            branches: [],
            totalCount: 0,
            hasMore: false,
        });
    });

    it('lists nothing for a repository with no commits', async () => {
        const unborn = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-branch-empty-')));
        repos.push(unborn);
        git(unborn, 'init', '--initial-branch=main');
        await expect(service.getLocalBranches(unborn)).resolves.toEqual([]);
    });
});
