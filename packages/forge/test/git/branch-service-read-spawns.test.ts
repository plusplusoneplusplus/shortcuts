/**
 * The reads that stopped spawning: HEAD's name, HEAD's raw upstream config, and
 * the resolved git directory.
 *
 * Each of the three had a documented way to go subtly wrong when ported, and
 * each of those is a case below rather than a comment:
 *
 * * **`getCurrentBranchName`** — `rev-parse --abbrev-ref HEAD` prints the
 *   literal `HEAD` when detached and exits non-zero on a repository with no
 *   commits. A library read succeeds in both, so the `null` the callers expect
 *   has to be produced deliberately.
 * * **`getCurrentBranchUpstream`** — it runs immediately *before* a fetch, so
 *   the branch whose upstream ref was never downloaded is the case that has to
 *   work. Routing it through the existence-checking tracking-branch read would
 *   break `fetch` for exactly that branch.
 * * **`getResolvedGitDir`** — in a linked worktree the git directory is
 *   `.git/worktrees/<name>`, and that is where an in-progress rebase or
 *   cherry-pick leaves its sentinels. Reading the common directory instead
 *   passes in a plain clone and silently reports "no operation in progress"
 *   everywhere else.
 *
 * Real repositories throughout: the point of every case here is what git
 * actually writes on disk.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { BranchService } from '../../src/git/branch-service';
import { GitRangeService } from '../../src/git/git-range-service';
import { nullLogger, setLogger } from '../../src/logger';

setLogger(nullLogger);

const roots: string[] = [];

function git(repo: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], {
        encoding: 'utf-8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
}

/** A repository with two commits on `main`, plus a temp root to hang more off. */
function makeRepo(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `forge-${prefix}-`)));
    roots.push(root);
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '--initial-branch=main');
    git(repo, 'config', 'user.email', 'ralph@example.com');
    git(repo, 'config', 'user.name', 'Ralph');
    git(repo, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'first');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'two\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'second');
    return repo;
}

afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const service = new BranchService();

// ─────────────────────────────────────────────────────────────────────────────
// The current branch name
// ─────────────────────────────────────────────────────────────────────────────
// `getCurrentBranchName` is private; `cherryPick` with a target branch reports
// what it read as `originalBranch`, which is the observable it exists for.

describe('the current branch name', () => {
    it('is the branch git has checked out, including one whose name holds a slash', async () => {
        const repo = makeRepo('branch-name');
        git(repo, 'checkout', '-b', 'feature/nested/name');
        git(repo, 'branch', 'target');

        const result = await service.cherryPick(repo, git(repo, 'rev-parse', 'HEAD'), {
            hashes: [git(repo, 'rev-parse', 'HEAD'), git(repo, 'rev-parse', 'HEAD~1')],
            targetBranch: 'target',
        });
        expect(result.originalBranch).toBe('feature/nested/name');
        // And the read is not stale: git agrees the switch back happened.
        expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/nested/name');
    });

    it('is absent on a detached HEAD, where the CLI printed the literal HEAD', async () => {
        const repo = makeRepo('branch-name-detached');
        git(repo, 'branch', 'target');
        const head = git(repo, 'rev-parse', 'HEAD');
        git(repo, 'checkout', '--detach', head);

        const result = await service.cherryPick(repo, head, { hashes: [head], targetBranch: 'target' });
        expect(result.success).toBe(false);
        expect(result.message).toContain('Cannot determine current branch');
        expect(result.originalBranch).toBeNull();
    });

    it('reads as HEAD on a detached head and on an unborn branch in the range service', async () => {
        // The range service's fallback is the string `HEAD` rather than null, and
        // an unborn repository is the case where the CLI exited non-zero.
        const range = new GitRangeService();
        const repo = makeRepo('range-branch-name');
        expect(await range.getCurrentBranch(repo)).toBe('main');

        git(repo, 'checkout', '--detach', git(repo, 'rev-parse', 'HEAD'));
        expect(await range.getCurrentBranch(repo)).toBe('HEAD');

        const unborn = path.join(path.dirname(repo), 'unborn');
        fs.mkdirSync(unborn);
        git(unborn, 'init', '--initial-branch=main');
        expect(await range.getCurrentBranch(unborn)).toBe('HEAD');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The upstream configuration
// ─────────────────────────────────────────────────────────────────────────────

describe('the upstream configuration', () => {
    /** A bare `origin` with `main`, and a clone of it. */
    function makeClone(prefix: string): { origin: string; work: string } {
        const seed = makeRepo(prefix);
        const root = path.dirname(seed);
        const origin = path.join(root, 'origin.git');
        execFileSync('git', ['init', '--bare', '--initial-branch=main', origin], { encoding: 'utf-8' });
        git(seed, 'remote', 'add', 'origin', origin);
        git(seed, 'push', 'origin', 'main');

        const work = path.join(root, 'work');
        execFileSync('git', ['clone', origin, work], { encoding: 'utf-8' });
        git(work, 'config', 'user.email', 'ralph@example.com');
        git(work, 'config', 'user.name', 'Ralph');
        git(work, 'config', 'commit.gpgsign', 'false');
        return { origin, work };
    }

    it('fetches a branch whose upstream ref was never downloaded', async () => {
        // The trap this exists for. The tracking branch on `getBranchStatus`
        // requires the ref to exist and answers null here, so routing the
        // pre-fetch read through it would make `fetch` impossible for precisely
        // the branch that needs one.
        const { work } = makeClone('upstream-never-fetched');
        git(work, 'update-ref', '-d', 'refs/remotes/origin/main');
        expect(() => git(work, 'rev-parse', '--verify', 'refs/remotes/origin/main')).toThrow();
        expect((await service.getBranchStatus(work, false))?.trackingBranch).toBeUndefined();

        const result = await service.fetchCurrentBranch(work);
        expect(result).toEqual({ success: true });
    });

    it('fetches normally when the upstream ref is present', async () => {
        const { work } = makeClone('upstream-present');
        await expect(service.fetchCurrentBranch(work)).resolves.toEqual({ success: true });
        await expect(service.pullCurrentBranch(work)).resolves.toEqual({ success: true });
    });

    it('refuses to fetch or pull while HEAD is detached', async () => {
        const { work } = makeClone('upstream-detached');
        git(work, 'checkout', '--detach', git(work, 'rev-parse', 'HEAD'));
        await expect(service.fetchCurrentBranch(work)).resolves.toEqual({
            success: false,
            error: 'Cannot fetch or pull while HEAD is detached',
        });
        await expect(service.pullCurrentBranch(work)).resolves.toEqual({
            success: false,
            error: 'Cannot fetch or pull while HEAD is detached',
        });
    });

    it('reports a branch with no upstream configured, unborn or not', async () => {
        const repo = makeRepo('upstream-none');
        const result = await service.fetchCurrentBranch(repo);
        expect(result.error).toBe('Current branch "main" has no upstream configured');

        // An unborn branch has a name and no config, so it gets the accurate
        // message rather than the detached-HEAD one.
        const unborn = path.join(path.dirname(repo), 'unborn');
        fs.mkdirSync(unborn);
        git(unborn, 'init', '--initial-branch=main');
        const unbornResult = await service.fetchCurrentBranch(unborn);
        expect(unbornResult.error).toBe('Current branch "main" has no upstream configured');
    });

    it('reports a branch configured with more than one upstream', async () => {
        const { work } = makeClone('upstream-multiple');
        git(work, 'config', '--add', 'branch.main.remote', 'backup');
        const result = await service.fetchCurrentBranch(work);
        expect(result.error).toBe(
            'Current branch "main" has multiple upstream branches; fetch and pull require exactly one',
        );
    });

    it('reports an upstream that is not one exact branch ref', async () => {
        const { work } = makeClone('upstream-not-a-branch');
        git(work, 'config', 'branch.main.merge', 'refs/tags/v1');
        const result = await service.fetchCurrentBranch(work);
        expect(result.error).toBe('Current branch "main" upstream must be one exact branch ref');
    });

    it('reads a branch whose own name holds a dot', async () => {
        // `branch.release.1.0.remote` has no unambiguous dotted split, so a
        // key-by-string lookup would find nothing and report "no upstream".
        const { origin, work } = makeClone('upstream-dotted-name');
        git(work, 'checkout', '-b', 'release.1.0');
        git(work, 'push', '-u', origin, 'release.1.0');
        git(work, 'config', 'branch.release.1.0.remote', 'origin');
        git(work, 'config', 'branch.release.1.0.merge', 'refs/heads/release.1.0');
        await expect(service.fetchCurrentBranch(work)).resolves.toEqual({ success: true });
    });

    it('survives a config value written with CRLF line endings', async () => {
        // The values are compared by exact string equality downstream, so a
        // surviving `\r` would make `refs/heads/main` fail its own prefix check
        // and report "upstream must be one exact branch ref".
        //
        // Written into the seed rather than the clone, because a clone already
        // has a `[branch "main"]` section and a second one would be two
        // upstreams rather than one CRLF-spelled one.
        const seed = makeRepo('upstream-crlf');
        const origin = path.join(path.dirname(seed), 'origin.git');
        execFileSync('git', ['init', '--bare', '--initial-branch=main', origin], { encoding: 'utf-8' });
        git(seed, 'remote', 'add', 'origin', origin);
        git(seed, 'push', 'origin', 'main');

        const configPath = path.join(seed, '.git', 'config');
        fs.writeFileSync(
            configPath,
            `${fs.readFileSync(configPath, 'utf-8')}[branch "main"]\r\n\tremote = origin \r\n\tmerge = refs/heads/main\r\n`,
        );
        expect(fs.readFileSync(configPath, 'utf-8')).toContain('origin \r\n');
        await expect(service.fetchCurrentBranch(seed)).resolves.toEqual({ success: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The resolved git directory
// ─────────────────────────────────────────────────────────────────────────────
// Only reachable through `getRepoState`, which is the only thing that opens it.

describe('the resolved git directory', () => {
    it('finds an in-progress merge in a plain repository', async () => {
        const repo = makeRepo('git-dir-merge');
        fs.writeFileSync(path.join(repo, 'MERGE_HEAD-source'), 'x\n');
        fs.writeFileSync(path.join(repo, '.git', 'MERGE_HEAD'), `${git(repo, 'rev-parse', 'HEAD')}\n`);
        expect((await service.getRepoState(repo)).operation).toBe('merge');
    });

    it('finds an in-progress cherry-pick in a linked worktree', async () => {
        // The worktree trap: `.git/worktrees/<name>` is where the sentinel goes,
        // and reading the main repository's `.git` would report `none` here
        // while passing every plain-clone case above.
        const repo = makeRepo('git-dir-worktree');
        const linked = path.join(path.dirname(repo), 'linked');
        git(repo, 'worktree', 'add', linked, '-b', 'side');

        // Where git itself says the worktree's sentinels live.
        const worktreeGitDir = git(linked, 'rev-parse', '--absolute-git-dir');
        expect(worktreeGitDir).toContain('worktrees');
        expect(await service.getRepoState(linked)).toMatchObject({ operation: 'none' });

        fs.writeFileSync(
            path.join(worktreeGitDir, 'CHERRY_PICK_HEAD'),
            `${git(linked, 'rev-parse', 'HEAD')}\n`,
        );
        expect((await service.getRepoState(linked)).operation).toBe('cherry-pick');

        // And the main working tree is unaffected, which is the whole point of
        // reading the worktree-specific directory rather than the common one.
        expect((await service.getRepoState(repo)).operation).toBe('none');
    });

    it('reports no operation for a path that is not a repository', async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-dir-none-')));
        roots.push(root);
        expect(await service.getRepoState(root)).toMatchObject({ operation: 'none' });
    });
});
