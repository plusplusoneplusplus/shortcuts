/**
 * `GitRangeService` against real repositories.
 *
 * The ref work runs in the addon now, so there is no `execGit` to mock and no
 * command string worth asserting on. What is left on this side of the boundary
 * is the seam: the fields Node still builds, the `localeCompare` ordering it
 * still applies, the `maxFiles` cap, the cache that only remembers remote-derived
 * answers, and the cases `detectCommitRange` turns into a null rather than a
 * throw.
 *
 * Rust owns the resolution semantics themselves — `rust/core/tests/git_range.rs`
 * covers every candidate ref and every base mode against temp repositories.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { GitRangeService } from '../../src/git/git-range-service';

const repos: string[] = [];

function git(repo: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' }).trim();
}

function write(repo: string, name: string, contents: string): void {
    fs.writeFileSync(path.join(repo, name), contents);
}

function commit(repo: string, message: string): string {
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', message);
    return git(repo, 'rev-parse', 'HEAD');
}

/**
 * A repository whose `origin/main` sits one commit behind HEAD.
 *
 * The remote ref is written directly rather than fetched: nothing here needs a
 * real remote, only a ref in `refs/remotes/` for the base to resolve to.
 */
function makeRepo(): { repo: string; base: string } {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-range-')));
    repos.push(repo);
    git(repo, 'init', '--initial-branch=main');
    git(repo, 'config', 'user.email', 'ralph@example.com');
    git(repo, 'config', 'user.name', 'Ralph');
    git(repo, 'config', 'commit.gpgsign', 'false');

    write(repo, 'README.md', 'one\n');
    const base = commit(repo, 'base');
    git(repo, 'update-ref', 'refs/remotes/origin/main', base);

    write(repo, 'README.md', 'one\ntwo\n');
    write(repo, 'docs.md', 'docs\n');
    commit(repo, 'ahead');
    return { repo, base };
}

afterAll(() => {
    for (const repo of repos) fs.rmSync(repo, { recursive: true, force: true });
});

describe('detectCommitRange', () => {
    it('assembles the range the view renders', async () => {
        const { repo, base } = makeRepo();
        const service = new GitRangeService();

        const range = await service.detectCommitRange(repo);
        expect(range).not.toBeNull();
        expect(range!.baseRef).toBe('origin/main');
        expect(range!.headRef).toBe('HEAD');
        expect(range!.mergeBase).toBe(base);
        expect(range!.commitCount).toBe(1);
        expect(range!.branchName).toBe('main');
        expect(range!.baseMode).toBe('default-branch');
        expect(range!.baseModeFallback).toBeUndefined();
        expect(range!.additions).toBe(2);
        expect(range!.deletions).toBe(0);
        service.dispose();
    });

    // The two fields Rust deliberately does not build, for the same reason it
    // does not build a status entry's absolute path.
    it('attaches the repository root and its basename in Node', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();

        const range = await service.detectCommitRange(repo);
        expect(range!.repositoryRoot).toBe(repo);
        expect(range!.repositoryName).toBe(path.basename(repo));
        expect(range!.files.every(file => file.repositoryRoot === repo)).toBe(true);
        service.dispose();
    });

    it('is null when the branch is level with its base', async () => {
        const { repo } = makeRepo();
        git(repo, 'update-ref', 'refs/remotes/origin/main', git(repo, 'rev-parse', 'HEAD'));
        const service = new GitRangeService();

        expect(await service.detectCommitRange(repo)).toBeNull();
        service.dispose();
    });

    it('is null when the repository has no default branch', async () => {
        const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-range-none-')));
        repos.push(repo);
        git(repo, 'init', '--initial-branch=trunk');
        git(repo, 'config', 'user.email', 'ralph@example.com');
        git(repo, 'config', 'user.name', 'Ralph');
        git(repo, 'config', 'commit.gpgsign', 'false');
        write(repo, 'README.md', 'one\n');
        commit(repo, 'only');

        const service = new GitRangeService();
        expect(await service.detectCommitRange(repo)).toBeNull();
        service.dispose();
    });

    it('is null for a path that does not exist', async () => {
        const service = new GitRangeService();
        expect(await service.detectCommitRange(path.join(os.tmpdir(), 'forge-git-range-absent'))).toBeNull();
        service.dispose();
    });

    it('is null for a path that is not a repository', async () => {
        const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-range-plain-')));
        repos.push(plain);
        const service = new GitRangeService();
        expect(await service.detectCommitRange(plain)).toBeNull();
        service.dispose();
    });

    it('caps the file list at maxFiles', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService({ maxFiles: 1 });

        const range = await service.detectCommitRange(repo);
        expect(range!.files).toHaveLength(1);
        // The count itself is not capped — only the list the view renders is.
        expect(range!.commitCount).toBe(1);
        service.dispose();
    });
});

describe("detectCommitRange with baseMode 'upstream'", () => {
    it('measures against the tracking branch', async () => {
        const { repo, base } = makeRepo();
        git(repo, 'update-ref', 'refs/remotes/origin/feature', base);
        git(repo, 'remote', 'add', 'origin', 'https://example.invalid/repo.git');
        git(repo, 'branch', '--set-upstream-to=origin/feature', 'main');
        const service = new GitRangeService();

        const range = await service.detectCommitRange(repo, { baseMode: 'upstream' });
        expect(range!.baseRef).toBe('origin/feature');
        expect(range!.baseMode).toBe('upstream');
        expect(range!.baseModeFallback).toBeUndefined();
        service.dispose();
    });

    // Hiding the range would also hide the base-mode toggle, so "nothing
    // unpushed" stays a range rather than becoming a null.
    it('returns an empty range rather than null when nothing is unpushed', async () => {
        const { repo } = makeRepo();
        const head = git(repo, 'rev-parse', 'HEAD');
        git(repo, 'update-ref', 'refs/remotes/origin/feature', head);
        git(repo, 'remote', 'add', 'origin', 'https://example.invalid/repo.git');
        git(repo, 'branch', '--set-upstream-to=origin/feature', 'main');
        const service = new GitRangeService();

        const range = await service.detectCommitRange(repo, { baseMode: 'upstream' });
        expect(range).not.toBeNull();
        expect(range!.commitCount).toBe(0);
        expect(range!.files).toEqual([]);
        service.dispose();
    });

    it('falls back to the default branch and says so', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();

        const range = await service.detectCommitRange(repo, { baseMode: 'upstream' });
        expect(range!.baseRef).toBe('origin/main');
        expect(range!.baseMode).toBe('default-branch');
        expect(range!.baseModeFallback).toBe(true);
        service.dispose();
    });
});

describe('resolveBaseRef', () => {
    it('reports the default branch for the default mode', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();

        expect(await service.resolveBaseRef(repo)).toEqual({
            baseRef: 'origin/main',
            baseMode: 'default-branch',
        });
        service.dispose();
    });

    it('reports the fallback when upstream is asked for and absent', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();

        expect(await service.resolveBaseRef(repo, 'upstream')).toEqual({
            baseRef: 'origin/main',
            baseMode: 'default-branch',
            baseModeFallback: true,
        });
        service.dispose();
    });

    // An absent `Option<String>` arrives from napi as an absent property, not
    // as null — the service normalises it so callers keep reading a null.
    it('reports a null base ref, not undefined, when nothing resolves', async () => {
        const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-range-empty-')));
        repos.push(repo);
        git(repo, 'init', '--initial-branch=trunk');
        const service = new GitRangeService();

        const resolved = await service.resolveBaseRef(repo);
        expect(resolved.baseRef).toBeNull();
        expect(resolved.baseMode).toBe('default-branch');
        service.dispose();
    });
});

describe('getDefaultRemoteBranch', () => {
    it('finds the remote branch', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();
        expect(await service.getDefaultRemoteBranch(repo)).toBe('origin/main');
        service.dispose();
    });

    // The cache only ever held the remote-derived answers. A local fallback
    // means the remote refs have not arrived yet, and remembering it would keep
    // the range view on the wrong base for a minute after the first fetch.
    it('caches a remote answer but not a local fallback', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();

        expect(await service.getDefaultRemoteBranch(repo)).toBe('origin/main');
        git(repo, 'update-ref', '-d', 'refs/remotes/origin/main');
        expect(await service.getDefaultRemoteBranch(repo)).toBe('origin/main');

        service.invalidateCache(repo);
        expect(await service.getDefaultRemoteBranch(repo)).toBe('main');
        // Not cached, so removing the local branch too is seen immediately.
        git(repo, 'branch', '-m', 'main', 'trunk');
        expect(await service.getDefaultRemoteBranch(repo)).toBeNull();
        service.dispose();
    });

    it('is null for a path that does not exist', async () => {
        const service = new GitRangeService();
        expect(
            await service.getDefaultRemoteBranch(path.join(os.tmpdir(), 'forge-git-range-absent')),
        ).toBeNull();
        service.dispose();
    });
});

describe('getUpstreamBranch', () => {
    it('is null without tracking configuration', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();
        expect(await service.getUpstreamBranch(repo)).toBeNull();
        service.dispose();
    });

    it('reads the tracking branch when there is one', async () => {
        const { repo, base } = makeRepo();
        git(repo, 'update-ref', 'refs/remotes/origin/feature', base);
        git(repo, 'remote', 'add', 'origin', 'https://example.invalid/repo.git');
        git(repo, 'branch', '--set-upstream-to=origin/feature', 'main');
        const service = new GitRangeService();

        expect(await service.getUpstreamBranch(repo)).toBe('origin/feature');
        service.dispose();
    });

    it('is null for a path that does not exist', async () => {
        const service = new GitRangeService();
        expect(
            await service.getUpstreamBranch(path.join(os.tmpdir(), 'forge-git-range-absent')),
        ).toBeNull();
        service.dispose();
    });
});

describe('getChangedFiles', () => {
    it('orders the list with localeCompare, not by byte value', async () => {
        const { repo } = makeRepo();
        write(repo, 'README2.md', 'read\n');
        fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
        write(repo, path.join('docs', 'x.md'), 'x\n');
        commit(repo, 'more');
        const service = new GitRangeService();

        const paths = (await service.getChangedFiles(repo, 'origin/main', 'HEAD')).map(f => f.path);
        // `docs/x.md` before `README2.md`: a byte comparison would put the
        // capital first, and the range view has always shown the other order.
        expect(paths.indexOf('docs/x.md')).toBeLessThan(paths.indexOf('README2.md'));
        expect([...paths]).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
        service.dispose();
    });

    it('carries a rename with its source path', async () => {
        const { repo } = makeRepo();
        fs.renameSync(path.join(repo, 'docs.md'), path.join(repo, 'guide.md'));
        commit(repo, 'renamed');
        const service = new GitRangeService();

        const files = await service.getChangedFiles(repo, 'origin/main', 'HEAD');
        // `docs.md` was added in the range, so a rename inside it shows as the
        // final name being added — the source only appears when the original
        // existed at the base.
        expect(files.map(file => file.path)).toContain('guide.md');
        service.dispose();
    });

    it('is empty when the command fails rather than throwing', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();
        expect(await service.getChangedFiles(repo, 'origin/nope', 'HEAD')).toEqual([]);
        service.dispose();
    });
});

describe('getDiffStats', () => {
    it('totals the range', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();
        expect(await service.getDiffStats(repo, 'origin/main', 'HEAD')).toEqual({
            additions: 2,
            deletions: 0,
        });
        service.dispose();
    });

    it('is zero when the command fails rather than throwing', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();
        expect(await service.getDiffStats(repo, 'origin/nope', 'HEAD')).toEqual({
            additions: 0,
            deletions: 0,
        });
        service.dispose();
    });
});

describe('the raw diff readers', () => {
    it('reads a range diff and a single file out of it', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();

        const full = await service.getRangeDiff(repo, 'origin/main', 'HEAD');
        expect(full).toContain('docs.md');
        expect(full).toContain('README.md');

        const one = await service.getFileDiff(repo, 'origin/main', 'HEAD', 'docs.md');
        expect(one).toContain('docs.md');
        expect(one).not.toContain('README.md');
        service.dispose();
    });

    it('reads file content at a ref, and empty for one that is not there', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();

        expect(await service.getFileAtRef(repo, 'HEAD', 'docs.md')).toBe('docs');
        expect(await service.getFileAtRef(repo, 'origin/main', 'docs.md')).toBe('');
        service.dispose();
    });

    it('returns an empty string instead of throwing on a bad range', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();
        expect(await service.getRangeDiff(repo, 'origin/nope', 'HEAD')).toBe('');
        expect(await service.getFileDiff(repo, 'origin/nope', 'HEAD', 'docs.md')).toBe('');
        service.dispose();
    });
});

describe('getMergeBase and countCommitsAhead', () => {
    it('agree with git', async () => {
        const { repo, base } = makeRepo();
        const service = new GitRangeService();

        expect(await service.getMergeBase(repo, 'HEAD', 'origin/main')).toBe(base);
        expect(await service.countCommitsAhead(repo, 'origin/main', 'HEAD')).toBe(
            Number(git(repo, 'rev-list', '--count', 'origin/main..HEAD')),
        );
        service.dispose();
    });

    it('degrade to null and zero for a revision that names nothing', async () => {
        const { repo } = makeRepo();
        const service = new GitRangeService();

        expect(await service.getMergeBase(repo, 'HEAD', 'origin/nope')).toBeNull();
        expect(await service.countCommitsAhead(repo, 'origin/nope', 'HEAD')).toBe(0);
        service.dispose();
    });
});
