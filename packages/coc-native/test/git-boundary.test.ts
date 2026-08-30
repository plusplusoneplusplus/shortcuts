/**
 * N-API boundary tests for the git capability: marshalling, async behaviour,
 * the `git <args> failed:` error text, concurrency and the option defaults —
 * all against the real compiled addon and a real temporary repository.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { gitAddon, removeDir } from './helpers';

let repo: string;

function git(...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

beforeAll(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-')));
    git('init', '--initial-branch=main');
    git('config', 'user.email', 'ralph@example.com');
    git('config', 'user.name', 'Ralph');
    git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
    fs.writeFileSync(path.join(repo, 'a file with spaces.md'), 'spaces\n');
    git('add', '.');
    git('commit', '-m', 'initial commit');
});

afterAll(() => {
    if (repo) removeDir(repo);
});

describe('execGit marshalling', () => {
    it('resolves with trimmed stdout', async () => {
        await expect(gitAddon.execGit(['log', '--format=%s'], repo)).resolves.toBe('initial commit');
    });

    it('accepts an omitted options object', async () => {
        const head = await gitAddon.execGit(['rev-parse', 'HEAD'], repo);
        expect(head).toMatch(/^[0-9a-f]{40}$/);
    });

    it('passes arguments through without a shell, so spaces need no quoting', async () => {
        const listed = await gitAddon.execGit(
            ['log', '-1', '--format=%s', '--', 'a file with spaces.md'],
            repo,
        );
        expect(listed).toBe('initial commit');
    });

    it('returns an empty string for a command with no output', async () => {
        await expect(gitAddon.execGit(['status', '--porcelain'], repo)).resolves.toBe('');
    });
});

describe('execGit is asynchronous', () => {
    it('returns a promise rather than blocking the event loop', async () => {
        let ticked = false;
        setImmediate(() => {
            ticked = true;
        });
        const pending = gitAddon.execGit(['rev-parse', 'HEAD'], repo);
        expect(typeof pending.then).toBe('function');
        await pending;
        expect(ticked).toBe(true);
    });
});

describe('execGit error propagation', () => {
    it('rejects with the `git <args> failed: <stderr>` shape the UI shows', async () => {
        await expect(gitAddon.execGit(['rev-parse', 'nope-not-a-ref'], repo)).rejects.toThrow(
            /^git rev-parse nope-not-a-ref failed: /,
        );
    });

    it('rejects when the path is not a repository', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-empty-'));
        try {
            await expect(gitAddon.execGit(['status'], empty)).rejects.toThrow(/^git status failed: /);
        } finally {
            removeDir(empty);
        }
    });

    it('rejects when the path does not exist', async () => {
        const missing = path.join(os.tmpdir(), 'coc-native-git-missing-directory');
        await expect(gitAddon.execGit(['status'], missing)).rejects.toThrow(/^git status failed: /);
    });

    it('kills a command that outlives its timeout', async () => {
        await expect(
            gitAddon.execGit(['-c', 'alias.nap=!sleep 30', 'nap'], repo, { timeout: 250 }),
        ).rejects.toThrow(/^git -c alias\.nap=!sleep 30 nap failed: /);
    });

    it('rejects when output passes the buffer cap', async () => {
        await expect(
            gitAddon.execGit(['log', '--format=%H %s'], repo, { maxBuffer: 8 }),
        ).rejects.toThrow(/^git log --format=%H %s failed: /);
    });
});

describe('execGit environment overrides', () => {
    it('layers the caller\u2019s variables onto the child', async () => {
        const author = await gitAddon.execGit(['var', 'GIT_AUTHOR_IDENT'], repo, {
            env: { GIT_AUTHOR_NAME: 'Env Author', GIT_AUTHOR_EMAIL: 'env@example.com' },
        });
        expect(author).toContain('Env Author <env@example.com>');
    });

    it('inherits everything the caller did not name', async () => {
        // Nothing here names PATH, and git is still found — which is what keeps
        // a credential helper and an SSH agent reachable from push and pull.
        const subject = await gitAddon.execGit(['log', '--format=%s'], repo, {
            env: { GIT_TERMINAL_PROMPT: '0' },
        });
        expect(subject).toBe('initial commit');
    });

    it('treats an omitted env the same as an empty one', async () => {
        const withEmpty = await gitAddon.execGit(['rev-parse', 'HEAD'], repo, { env: {} });
        const without = await gitAddon.execGit(['rev-parse', 'HEAD'], repo);
        expect(withEmpty).toBe(without);
    });
});

describe('execGit concurrency', () => {
    it('runs many calls against one repo without interleaving their output', async () => {
        const heads = await Promise.all(
            Array.from({ length: 16 }, () => gitAddon.execGit(['rev-parse', 'HEAD'], repo)),
        );
        expect(new Set(heads).size).toBe(1);
        expect(heads[0]).toMatch(/^[0-9a-f]{40}$/);
    });
});

describe('gitStatusEntries marshalling', () => {
    /** Undo whatever a test left in the working tree. */
    function reset(): void {
        // A timed-out `git status` is killed while it is refreshing the index,
        // and git leaves `index.lock` behind when that happens — the same state
        // it tells a human to "remove the file manually to continue" from. Every
        // later git command in this repo fails until it is gone.
        fs.rmSync(path.join(repo, '.git', 'index.lock'), { force: true });
        git('reset', '--hard', 'HEAD');
        git('clean', '-fd');
    }

    afterEach(() => reset());

    it('returns an empty list for a clean repository', async () => {
        await expect(gitAddon.gitStatusEntries(repo)).resolves.toEqual([]);
    });

    it('marshals status, stage and repository-relative path', async () => {
        fs.writeFileSync(path.join(repo, 'README.md'), 'changed\n');
        fs.writeFileSync(path.join(repo, 'fresh.txt'), 'fresh\n');
        git('add', 'fresh.txt');

        const entries = await gitAddon.gitStatusEntries(repo);
        expect(entries).toEqual(
            expect.arrayContaining([
                { path: 'README.md', status: 'modified', stage: 'unstaged' },
                { path: 'fresh.txt', status: 'added', stage: 'staged' },
            ]),
        );
        // An absent original path arrives as an absent property, not null, so
        // spreading an entry into a `GitChange` leaves `originalPath` undefined
        // exactly as the TypeScript parser did.
        expect(entries.every(entry => !('originalPath' in entry))).toBe(true);
    });

    it('carries the original path of a rename across the boundary', async () => {
        git('mv', 'README.md', 'READYOU.md');
        const entries = await gitAddon.gitStatusEntries(repo);
        expect(entries).toEqual([
            { path: 'READYOU.md', status: 'renamed', stage: 'staged', originalPath: 'README.md' },
        ]);
        expect(entries[0].originalPath).toBe('README.md');
    });

    // Porcelain v1 C-quotes any path holding a space or a non-ASCII byte, and
    // neither this parser nor the TypeScript one it replaces unquotes it. That
    // is pre-existing behaviour the Git tab already renders, so it is pinned
    // rather than fixed here — unquoting would change what the UI shows, which
    // no slice of this move covers.
    it('passes a quoted path through exactly as git printed it', async () => {
        fs.writeFileSync(path.join(repo, 'a file with spaces.md'), 'edited\n');
        const entries = await gitAddon.gitStatusEntries(repo);
        expect(entries.map(entry => entry.path)).toEqual(['"a file with spaces.md"']);
    });

    it('rejects with the `git <args> failed:` shape when the path is not a repository', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-status-'));
        try {
            await expect(gitAddon.gitStatusEntries(empty)).rejects.toThrow(
                /^git status --porcelain --untracked-files=all failed: /,
            );
        } finally {
            removeDir(empty);
        }
    });

    it('honours a per-call timeout override', async () => {
        // A one-millisecond deadline is only unmeetable if the status is slow
        // enough to notice it. Against the two-file repo this raced: the clock
        // starts once the child is spawned and its readers are up, by which
        // point a warm macOS runner had already finished, so the call resolved
        // with the correct empty list and the assertion failed. Two thousand
        // untracked paths put the work three orders of magnitude clear of the
        // deadline on every platform.
        const crowded = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-crowded-'));
        try {
            execFileSync('git', ['-C', crowded, 'init', '--initial-branch=main']);
            for (let index = 0; index < 2000; index++) {
                fs.writeFileSync(path.join(crowded, `file-${index}.txt`), 'x\n');
            }
            await expect(gitAddon.gitStatusEntries(crowded, { timeout: 1 })).rejects.toThrow(
                /^git status --porcelain --untracked-files=all failed: /,
            );
        } finally {
            removeDir(crowded);
        }
    });
});

describe('parseGitStatusPorcelain marshalling', () => {
    it('parses text produced elsewhere — the WSL path', async () => {
        const entries = await gitAddon.parseGitStatusPorcelain('MM src/foo.ts\n?? new.txt\n');
        expect(entries).toEqual([
            { path: 'src/foo.ts', status: 'modified', stage: 'staged' },
            { path: 'src/foo.ts', status: 'modified', stage: 'unstaged' },
            { path: 'new.txt', status: 'untracked', stage: 'untracked' },
        ]);
    });

    it('agrees with gitStatusEntries on the same repository', async () => {
        fs.writeFileSync(path.join(repo, 'parity.txt'), 'parity\n');
        try {
            const text = execFileSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=all'], {
                encoding: 'utf-8',
            });
            expect(await gitAddon.parseGitStatusPorcelain(text)).toEqual(
                await gitAddon.gitStatusEntries(repo),
            );
        } finally {
            fs.rmSync(path.join(repo, 'parity.txt'));
        }
    });

    it('returns an empty list for empty text', async () => {
        await expect(gitAddon.parseGitStatusPorcelain('')).resolves.toEqual([]);
    });
});

describe('gitLogCommits marshalling', () => {
    it('reads a page of history without spawning anything', async () => {
        const page = await gitAddon.gitLogCommits(repo, { maxCount: 10, skip: 0 });
        expect(page.hasMore).toBe(false);
        expect(page.commits).toHaveLength(1);

        const commit = page.commits[0];
        expect(commit.hash).toMatch(/^[0-9a-f]{40}$/);
        expect(commit.hash.startsWith(commit.shortHash)).toBe(true);
        expect(commit.subject).toBe('initial commit');
        expect(commit.authorName).toBe('Ralph');
        expect(commit.authorEmail).toBe('ralph@example.com');
        expect(commit.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
        expect(commit.relativeDate).toMatch(/ago$/);
        // A root commit has no parents, and the field is an empty string rather
        // than absent, because `%P` printed one.
        expect(commit.parentHashes).toBe('');
    });

    it('marshals the decoration list as an array of strings', async () => {
        const page = await gitAddon.gitLogCommits(repo, { maxCount: 1, skip: 0 });
        expect(page.commits[0].refs).toEqual(['HEAD -> main']);
    });

    it('reports the unpushed flag as a boolean, not as an absent property', async () => {
        const page = await gitAddon.gitLogCommits(repo, { maxCount: 1, skip: 0 });
        expect(page.commits[0].isAheadOfRemote).toBe(false);
    });

    it('accepts an omitted search field', async () => {
        const page = await gitAddon.gitLogCommits(repo, { maxCount: 1, skip: 0 });
        expect(page.commits).toHaveLength(1);
    });

    it('filters on the search field when one is given', async () => {
        const matching = await gitAddon.gitLogCommits(repo, {
            maxCount: 10,
            skip: 0,
            search: 'INITIAL',
        });
        expect(matching.commits).toHaveLength(1);

        const missing = await gitAddon.gitLogCommits(repo, {
            maxCount: 10,
            skip: 0,
            search: 'nothing matches this',
        });
        expect(missing.commits).toEqual([]);
        expect(missing.hasMore).toBe(false);
    });

    it('rejects a path that is not a repository with the shared error text', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-empty-'));
        try {
            await expect(
                gitAddon.gitLogCommits(empty, { maxCount: 1, skip: 0 }),
            ).rejects.toThrow(/^git log failed: /);
        } finally {
            removeDir(empty);
        }
    });

    it('runs off the event-loop thread', async () => {
        let ticked = false;
        setImmediate(() => {
            ticked = true;
        });
        await gitAddon.gitLogCommits(repo, { maxCount: 1, skip: 0 });
        expect(ticked).toBe(true);
    });

    it('serves concurrent pages of the same repository', async () => {
        const pages = await Promise.all(
            Array.from({ length: 8 }, () => gitAddon.gitLogCommits(repo, { maxCount: 1, skip: 0 })),
        );
        for (const page of pages) {
            expect(page.commits[0].subject).toBe('initial commit');
        }
    });
});

describe('gitLogCommit marshalling', () => {
    it('reads one commit by hash', async () => {
        const head = git('rev-parse', 'HEAD').trim();
        const commit = await gitAddon.gitLogCommit(repo, head);
        expect(commit?.hash).toBe(head);
        expect(commit?.subject).toBe('initial commit');
    });

    it('resolves with null for a revision that names nothing', async () => {
        await expect(gitAddon.gitLogCommit(repo, 'no-such-ref')).resolves.toBeNull();
    });

    // Nobody computed it for a single commit, so the property is absent and
    // arrives in JavaScript as `undefined` — not as `false`.
    it('omits the unpushed flag rather than guessing at it', async () => {
        const commit = await gitAddon.gitLogCommit(repo, 'HEAD');
        expect(commit).not.toBeNull();
        expect('isAheadOfRemote' in (commit as object)).toBe(false);
    });
});

// The range exports get their own repository: they need remote-tracking refs
// and a base commit that is not HEAD, and mutating the shared one would leak
// into every suite above.
describe('commit-range marshalling', () => {
    let range: string;
    let base: string;

    function rangeGit(...args: string[]): string {
        return execFileSync('git', ['-C', range, ...args], { encoding: 'utf-8' });
    }

    beforeAll(() => {
        range = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-range-')));
        rangeGit('init', '--initial-branch=main');
        rangeGit('config', 'user.email', 'ralph@example.com');
        rangeGit('config', 'user.name', 'Ralph');
        rangeGit('config', 'commit.gpgsign', 'false');
        fs.writeFileSync(path.join(range, 'kept.md'), 'one\n');
        rangeGit('add', '.');
        rangeGit('commit', '-m', 'base');
        base = rangeGit('rev-parse', 'HEAD').trim();

        fs.writeFileSync(path.join(range, 'kept.md'), 'one\ntwo\n');
        fs.writeFileSync(path.join(range, 'added.md'), 'new\n');
        rangeGit('add', '.');
        rangeGit('commit', '-m', 'ahead');

        rangeGit('update-ref', 'refs/remotes/origin/main', base);
    });

    afterAll(() => {
        if (range) removeDir(range);
    });

    it('marshals the default branch and where it was found', async () => {
        await expect(gitAddon.gitRangeDefaultBranch(range)).resolves.toEqual({
            name: 'origin/main',
            fromRemote: true,
        });
    });

    it('resolves with null when there is no default branch', async () => {
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-nodefault-'));
        try {
            execFileSync('git', ['-C', bare, 'init', '--initial-branch=trunk']);
            await expect(gitAddon.gitRangeDefaultBranch(bare)).resolves.toBeNull();
        } finally {
            removeDir(bare);
        }
    });

    it('resolves with null for a branch with no upstream', async () => {
        await expect(gitAddon.gitRangeUpstreamBranch(range)).resolves.toBeNull();
    });

    it('marshals a base-ref resolution', async () => {
        await expect(gitAddon.gitRangeResolveBaseRef(range, 'default-branch')).resolves.toEqual({
            baseRef: 'origin/main',
            baseMode: 'default-branch',
            baseModeFallback: false,
        });
    });

    // Asking for `upstream` on a branch that has none reports the mode actually
    // used, so the range view's toggle does not claim to be showing unpushed
    // commits when it is showing everything since the default branch.
    it('reports the fallback when upstream is asked for and absent', async () => {
        await expect(gitAddon.gitRangeResolveBaseRef(range, 'upstream')).resolves.toEqual({
            baseRef: 'origin/main',
            baseMode: 'default-branch',
            baseModeFallback: true,
        });
    });

    // napi omits an absent `Option<String>` inside an object rather than
    // sending null, so `baseRef` arrives as an absent property and reads as
    // `undefined` — which is what the caller's `if (!baseRef)` already expects.
    it('omits an absent base ref rather than sending null', async () => {
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-nobase-'));
        try {
            execFileSync('git', ['-C', bare, 'init', '--initial-branch=trunk']);
            const resolved = await gitAddon.gitRangeResolveBaseRef(bare, 'default-branch');
            expect('baseRef' in resolved).toBe(false);
            expect(resolved.baseRef).toBeUndefined();
            expect(resolved.baseMode).toBe('default-branch');
        } finally {
            removeDir(bare);
        }
    });

    it('marshals a merge base', async () => {
        await expect(gitAddon.gitRangeMergeBase(range, 'HEAD', 'origin/main')).resolves.toBe(base);
    });

    it('resolves with null for a revision that names nothing', async () => {
        await expect(gitAddon.gitRangeMergeBase(range, 'HEAD', 'origin/nope')).resolves.toBeNull();
    });

    it('counts the commits ahead of the base', async () => {
        await expect(gitAddon.gitRangeCountAhead(range, 'origin/main', 'HEAD')).resolves.toBe(1);
    });

    it('marshals the changed-file list', async () => {
        const files = await gitAddon.gitRangeChangedFiles(range, 'origin/main', 'HEAD');
        expect(files).toEqual(
            expect.arrayContaining([
                { path: 'kept.md', status: 'modified', additions: 1, deletions: 0 },
                { path: 'added.md', status: 'added', additions: 1, deletions: 0 },
            ]),
        );
        // As with a status entry, an absent `oldPath` is an absent property.
        expect(files.every(file => !('oldPath' in file))).toBe(true);
    });

    it('carries the source of a rename across the boundary', async () => {
        const files = await gitAddon.parseGitRangeChangedFiles(
            '0\t0\told.ts => new.ts\n',
            'R100\told.ts\tnew.ts\n',
        );
        expect(files).toEqual([
            { path: 'new.ts', status: 'renamed', additions: 0, deletions: 0, oldPath: 'old.ts' },
        ]);
    });

    it('parses changed-file text produced elsewhere — the WSL path', async () => {
        const files = await gitAddon.parseGitRangeChangedFiles(
            '4\t1\tsrc/a.ts\n',
            'M\tsrc/a.ts\n',
        );
        expect(files).toEqual([{ path: 'src/a.ts', status: 'modified', additions: 4, deletions: 1 }]);
    });

    it('marshals diff statistics', async () => {
        await expect(gitAddon.gitRangeDiffStats(range, 'origin/main', 'HEAD')).resolves.toEqual({
            additions: 2,
            deletions: 0,
        });
    });

    it('parses shortstat text produced elsewhere — the WSL path', async () => {
        await expect(
            gitAddon.parseGitDiffShortstat(' 3 files changed, 12 insertions(+), 7 deletions(-)'),
        ).resolves.toEqual({ additions: 12, deletions: 7 });
    });

    it('rejects with the `git <args> failed:` shape when the path is not a repository', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-range-empty-'));
        try {
            await expect(gitAddon.gitRangeDefaultBranch(empty)).rejects.toThrow(
                /^git rev-parse --verify origin\/main failed: /,
            );
            await expect(gitAddon.gitRangeChangedFiles(empty, 'origin/main', 'HEAD')).rejects.toThrow(
                /^git diff --numstat origin\/main\.\.\.HEAD failed: /,
            );
        } finally {
            removeDir(empty);
        }
    });

    it('serves concurrent range reads of the same repository', async () => {
        const resolved = await Promise.all(
            Array.from({ length: 8 }, () => gitAddon.gitRangeResolveBaseRef(range, 'upstream')),
        );
        expect(resolved.every(one => one.baseModeFallback === true)).toBe(true);
    });
});

// The branch exports get their own repository too: they need a second branch,
// a remote with tracking refs, and commits on both sides of an upstream.
describe('branch marshalling', () => {
    let work: string;
    let origin: string;

    function workGit(...args: string[]): string {
        return execFileSync('git', ['-C', work, ...args], { encoding: 'utf-8' });
    }

    beforeAll(() => {
        origin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-origin-')));
        for (const args of [
            ['init', '--initial-branch=main'],
            ['config', 'user.email', 'ralph@example.com'],
            ['config', 'user.name', 'Ralph'],
            ['config', 'commit.gpgsign', 'false'],
        ]) {
            execFileSync('git', ['-C', origin, ...args], { encoding: 'utf-8' });
        }
        fs.writeFileSync(path.join(origin, 'kept.md'), 'one\n');
        execFileSync('git', ['-C', origin, 'add', '.'], { encoding: 'utf-8' });
        execFileSync('git', ['-C', origin, 'commit', '-m', 'first'], { encoding: 'utf-8' });

        work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-branch-')));
        work = path.join(work, 'clone');
        execFileSync('git', ['clone', origin, work], { encoding: 'utf-8' });
        workGit('config', 'user.email', 'ralph@example.com');
        workGit('config', 'user.name', 'Ralph');
        workGit('config', 'commit.gpgsign', 'false');
        workGit('branch', 'feature/one');
        workGit('branch', 'zeta');
    });

    afterAll(() => {
        for (const dir of [origin, work]) {
            if (dir) removeDir(dir);
        }
    });

    describe('gitRepositoryStatus', () => {
        afterEach(() => {
            fs.rmSync(path.join(work, 'scratch.txt'), { force: true });
        });

        it('marshals branch, tracking and drift for a clean tree', async () => {
            await expect(gitAddon.gitRepositoryStatus(work)).resolves.toEqual({
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
            fs.writeFileSync(path.join(work, 'scratch.txt'), 'scratch\n');
            const status = await gitAddon.gitRepositoryStatus(work);
            expect(status.dirty).toBe(true);
        });

        it('rejects with the `git <args> failed:` shape outside a repository', async () => {
            const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-nostatus-'));
            try {
                await expect(gitAddon.gitRepositoryStatus(empty)).rejects.toThrow(
                    /^git status --porcelain=v2 --branch --untracked-files=all failed: /,
                );
            } finally {
                removeDir(empty);
            }
        });
    });

    describe('parseGitBranchStatus', () => {
        it('parses text produced elsewhere — the WSL path', async () => {
            await expect(
                gitAddon.parseGitBranchStatus(
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

        it('agrees with gitRepositoryStatus on the same repository', async () => {
            const text = workGit('status', '--porcelain=v2', '--branch', '--untracked-files=all');
            expect(await gitAddon.parseGitBranchStatus(text)).toEqual(
                await gitAddon.gitRepositoryStatus(work),
            );
        });

        it('leaves an absent upstream absent rather than null', async () => {
            const status = await gitAddon.parseGitBranchStatus(
                '# branch.oid abc\n# branch.head main\n',
            );
            expect('trackingBranch' in status).toBe(false);
        });
    });

    describe('gitBranchStatus', () => {
        it('marshals the branch, its upstream and the drift', async () => {
            await expect(gitAddon.gitBranchStatus(work)).resolves.toEqual({
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                trackingBranch: 'origin/main',
            });
        });

        it('counts commits ahead of the upstream', async () => {
            fs.writeFileSync(path.join(work, 'ahead.txt'), 'ahead\n');
            workGit('add', '.');
            workGit('commit', '-m', 'ahead by one');
            try {
                const status = await gitAddon.gitBranchStatus(work);
                expect(status).toMatchObject({ ahead: 1, behind: 0 });
            } finally {
                workGit('reset', '--hard', 'origin/main');
            }
        });

        it('resolves with null for an unborn branch', async () => {
            const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-unborn-'));
            try {
                execFileSync('git', ['-C', fresh, 'init', '--initial-branch=main'], {
                    encoding: 'utf-8',
                });
                await expect(gitAddon.gitBranchStatus(fresh)).resolves.toBeNull();
            } finally {
                removeDir(fresh);
            }
        });

        it('omits detachedHead fields rather than sending null', async () => {
            const status = await gitAddon.gitBranchStatus(work);
            expect(status && 'detachedHash' in status).toBe(false);
        });
    });

    describe('gitListBranches', () => {
        it('marshals a local page in git refname order', async () => {
            const page = await gitAddon.gitListBranches(work, {
                remote: false,
                limit: 100,
                offset: 0,
            });
            expect(page.branches.map(branch => branch.name)).toEqual([
                'feature/one',
                'main',
                'zeta',
            ]);
            expect(page.totalCount).toBe(3);
            expect(page.hasMore).toBe(false);
            expect(page.branches.find(branch => branch.name === 'main')).toMatchObject({
                isCurrent: true,
                isRemote: false,
                lastCommitSubject: 'first',
            });
        });

        it('omits remoteName on a local branch rather than sending null', async () => {
            const page = await gitAddon.gitListBranches(work, {
                remote: false,
                limit: 1,
                offset: 0,
            });
            expect('remoteName' in page.branches[0]).toBe(false);
        });

        it('marshals a remote page with its remote name, dropping origin/HEAD', async () => {
            const page = await gitAddon.gitListBranches(work, { remote: true, limit: 100, offset: 0 });
            expect(page.branches.map(branch => branch.name)).toEqual(['origin/main']);
            expect(page.branches[0]).toMatchObject({ isRemote: true, remoteName: 'origin' });
        });

        it('applies offset, limit and hasMore', async () => {
            const page = await gitAddon.gitListBranches(work, {
                remote: false,
                limit: 1,
                offset: 1,
            });
            expect(page.branches.map(branch => branch.name)).toEqual(['main']);
            expect(page.totalCount).toBe(3);
            expect(page.hasMore).toBe(true);
        });

        it('answers a count-only question with a zero limit', async () => {
            const page = await gitAddon.gitListBranches(work, {
                remote: false,
                limit: 0,
                offset: 0,
            });
            expect(page.branches).toEqual([]);
            expect(page.totalCount).toBe(3);
        });

        it('filters by name, case-insensitively', async () => {
            const page = await gitAddon.gitListBranches(work, {
                remote: false,
                limit: 100,
                offset: 0,
                search: 'FEATURE',
            });
            expect(page.branches.map(branch => branch.name)).toEqual(['feature/one']);
            expect(page.totalCount).toBe(1);
        });

        it('rejects with the `git <args> failed:` shape outside a repository', async () => {
            const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-nobranch-'));
            try {
                await expect(
                    gitAddon.gitListBranches(empty, { remote: false, limit: 10, offset: 0 }),
                ).rejects.toThrow(/^git branch failed: /);
            } finally {
                removeDir(empty);
            }
        });
    });
});

describe('reading remotes', () => {
    /** A repository of its own, so adding remotes cannot disturb the shared one. */
    let remotes: string;

    function gitIn(dir: string, ...args: string[]): string {
        return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8' });
    }

    beforeAll(() => {
        remotes = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-remotes-')));
        gitIn(remotes, 'init', '--initial-branch=main');
        gitIn(remotes, 'config', 'user.email', 'ralph@example.com');
        gitIn(remotes, 'config', 'user.name', 'Ralph');
        gitIn(remotes, 'config', 'commit.gpgsign', 'false');
        fs.writeFileSync(path.join(remotes, 'README.md'), 'hello\n');
        gitIn(remotes, 'add', '.');
        gitIn(remotes, 'commit', '-m', 'initial commit');
    });

    afterAll(() => {
        if (remotes) removeDir(remotes);
    });

    afterEach(() => {
        for (const name of gitIn(remotes, 'remote').split('\n').map(line => line.trim()).filter(Boolean)) {
            gitIn(remotes, 'remote', 'remove', name);
        }
    });

    it('marshals a configured URL across the boundary as a string', async () => {
        gitIn(remotes, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git');
        await expect(gitAddon.gitRemoteUrl(remotes, 'origin')).resolves.toBe(
            'https://github.com/owner/repo.git',
        );
    });

    // A top-level `Option<String>` is one of the few places napi does send an
    // explicit null rather than omitting the value, so the caller's `?? undefined`
    // has something to act on.
    it('marshals a missing remote as null rather than an absent value', async () => {
        await expect(gitAddon.gitRemoteUrl(remotes, 'origin')).resolves.toBeNull();
        await expect(gitAddon.gitDetectRemoteUrl(remotes)).resolves.toBeNull();
    });

    it('carries non-ASCII bytes through unchanged', async () => {
        gitIn(remotes, 'remote', 'add', 'origin', 'https://example.com/équipe/dépôt.git');
        await expect(gitAddon.gitDetectRemoteUrl(remotes)).resolves.toBe(
            'https://example.com/équipe/dépôt.git',
        );
    });

    it('prefers origin, then falls back to the first remote by name', async () => {
        gitIn(remotes, 'remote', 'add', 'zeta', 'https://example.com/zeta.git');
        gitIn(remotes, 'remote', 'add', 'alpha', 'https://example.com/alpha.git');
        await expect(gitAddon.gitDetectRemoteUrl(remotes)).resolves.toBe('https://example.com/alpha.git');

        gitIn(remotes, 'remote', 'add', 'origin', 'https://example.com/origin.git');
        await expect(gitAddon.gitDetectRemoteUrl(remotes)).resolves.toBe('https://example.com/origin.git');
    });

    it('rejects with the `git <args> failed:` shape outside a repository', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-noremote-'));
        try {
            await expect(gitAddon.gitRemoteUrl(empty, 'origin')).rejects.toThrow(
                /^git remote get-url origin failed: /,
            );
            await expect(gitAddon.gitDetectRemoteUrl(empty)).rejects.toThrow(
                /^git remote get-url origin failed: /,
            );
        } finally {
            removeDir(empty);
        }
    });

    it('serves concurrent lookups against the same repository', async () => {
        gitIn(remotes, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git');
        const answers = await Promise.all(
            Array.from({ length: 8 }, () => gitAddon.gitDetectRemoteUrl(remotes)),
        );
        expect(answers).toEqual(Array(8).fill('https://github.com/owner/repo.git'));
    });
});

describe('global configuration marshalling', () => {
    // Every call points git at a temp config file through the per-call
    // environment, so the suite never reads or writes the developer's real
    // `~/.gitconfig` — and, because the override rides on the command rather
    // than on `process.env`, tests here cannot leak into each other.
    let configDir: string;
    let options: { env: Record<string, string> };

    beforeEach(() => {
        configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-config-'));
        options = { env: { GIT_CONFIG_GLOBAL: path.join(configDir, 'gitconfig') } };
    });

    afterEach(() => {
        removeDir(configDir);
    });

    it('marshals a multi-valued key across the boundary as a string array', async () => {
        await gitAddon.gitGlobalConfigAdd('safe.directory', '/first/repo', options);
        await gitAddon.gitGlobalConfigAdd('safe.directory', '/second/repo', options);

        await expect(gitAddon.gitGlobalConfigGetAll('safe.directory', options)).resolves.toEqual([
            '/first/repo',
            '/second/repo',
        ]);
    });

    // The real entries are shell-hostile: a `$` and a `%(prefix)` sigil that a
    // shell would expand into something git never sees.
    it('carries a %(prefix) WSL entry through unchanged', async () => {
        const entry = '%(prefix)///wsl$/Ubuntu-24.04/home/me/my repo';
        await gitAddon.gitGlobalConfigAdd('safe.directory', entry, options);

        await expect(gitAddon.gitGlobalConfigGetAll('safe.directory', options)).resolves.toEqual([
            entry,
        ]);
    });

    it('rejects with the `git <args> failed:` shape when the key is unset', async () => {
        await expect(gitAddon.gitGlobalConfigGetAll('safe.directory', options)).rejects.toThrow(
            /^git config --global --get-all safe\.directory failed: /,
        );
    });

    it('resolves with undefined after a write', async () => {
        await expect(
            gitAddon.gitGlobalConfigAdd('safe.directory', '/repo', options),
        ).resolves.toBeUndefined();
    });

    // No `repoRoot` parameter and no `-C`: this reads the user's own config,
    // which is what Git for Windows consults before it agrees to open a repo on
    // the WSL share.
    it('writes to the global file, not to the repository the process sits in', async () => {
        await gitAddon.gitGlobalConfigAdd('safe.directory', '/repo', {
            ...options,
            cwd: repo,
        });

        expect(fs.readFileSync(path.join(configDir, 'gitconfig'), 'utf-8')).toContain('/repo');
        expect(() => execFileSync('git', ['-C', repo, 'config', '--local', '--get-all', 'safe.directory'])).toThrow();
    });

    it('serves concurrent reads of the same key', async () => {
        await gitAddon.gitGlobalConfigAdd('safe.directory', '/repo', options);
        const answers = await Promise.all(
            Array.from({ length: 8 }, () => gitAddon.gitGlobalConfigGetAll('safe.directory', options)),
        );
        expect(answers).toEqual(Array(8).fill(['/repo']));
    });
});

describe('repository discovery marshalling', () => {
    it('resolves with the work-tree root as a string', async () => {
        await expect(gitAddon.gitDiscoverRepoRoot(repo)).resolves.toBe(repo);
    });

    it('walks up from a nested directory', async () => {
        const nested = path.join(repo, 'nested', 'deeper');
        fs.mkdirSync(nested, { recursive: true });
        await expect(gitAddon.gitDiscoverRepoRoot(nested)).resolves.toBe(repo);
    });

    it('answers for the directory holding a file', async () => {
        await expect(gitAddon.gitDiscoverRepoRoot(path.join(repo, 'README.md'))).resolves.toBe(repo);
    });

    // A top-level `Option<String>` marshals as an explicit `null`, unlike an
    // absent `Option` inside an object, which arrives as a missing property.
    it('resolves with null rather than undefined outside a repository', async () => {
        const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-nogit-')));
        try {
            const found = await gitAddon.gitDiscoverRepoRoot(outside);
            expect(found).toBeNull();
        } finally {
            removeDir(outside);
        }
    });

    // Discovery walks upward, so without the existence check this would answer
    // with the repository above the path that is not there.
    it('resolves with null for a missing path inside a repository', async () => {
        await expect(gitAddon.gitDiscoverRepoRoot(path.join(repo, 'no', 'such', 'place'))).resolves.toBeNull();
    });

    it('does not block the event loop', async () => {
        let ticks = 0;
        const timer = setInterval(() => { ticks += 1; }, 1);
        try {
            await Promise.all(
                Array.from({ length: 40 }, () => gitAddon.gitDiscoverRepoRoot(repo)),
            );
        } finally {
            clearInterval(timer);
        }
        expect(ticks).toBeGreaterThan(0);
    });

    it('serves concurrent lookups of the same path', async () => {
        const answers = await Promise.all(
            Array.from({ length: 8 }, () => gitAddon.gitDiscoverRepoRoot(repo)),
        );
        expect(answers).toEqual(Array(8).fill(repo));
    });
});

// Commit detail needs a second commit and a rename to be worth asserting, and
// mutating the shared repository would leak into every suite above.
describe('commit-detail marshalling', () => {
    let detail: string;
    let root: string;
    let head: string;

    function detailGit(...args: string[]): string {
        return execFileSync('git', ['-C', detail, ...args], { encoding: 'utf-8' });
    }

    beforeAll(() => {
        detail = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-detail-')));
        detailGit('init', '--initial-branch=main');
        detailGit('config', 'user.email', 'ralph@example.com');
        detailGit('config', 'user.name', 'Ralph');
        detailGit('config', 'commit.gpgsign', 'false');

        fs.mkdirSync(path.join(detail, 'src'));
        fs.writeFileSync(path.join(detail, 'src', 'old.ts'), 'export const value = 1;\n');
        fs.writeFileSync(path.join(detail, 'keep.md'), 'body\n\n\n');
        fs.writeFileSync(path.join(detail, 'logo.bin'), Buffer.from([0, 1, 2, 3, 0xff]));
        detailGit('add', '.');
        detailGit('commit', '-m', 'first');
        root = detailGit('rev-parse', 'HEAD').trim();

        fs.renameSync(path.join(detail, 'src', 'old.ts'), path.join(detail, 'src', 'new.ts'));
        fs.writeFileSync(path.join(detail, 'added.txt'), 'new file\n');
        fs.writeFileSync(path.join(detail, 'logo.bin'), Buffer.from([0, 1, 2, 3, 0x00, 0xfe]));
        detailGit('add', '-A');
        detailGit('commit', '-m', 'second');
        head = detailGit('rev-parse', 'HEAD').trim();
    });

    afterAll(() => {
        if (detail) removeDir(detail);
    });

    describe('gitCommitFiles', () => {
        it('reports the parent and the touched files in one crossing', async () => {
            const result = await gitAddon.gitCommitFiles(detail, head);
            expect(result.parentHash).toBe(root);
            expect(result.files.map(file => file.path).sort()).toEqual([
                'added.txt',
                'logo.bin',
                'src/new.ts',
            ]);
        });

        it('marshals a rename with both ends and its line counts', async () => {
            const result = await gitAddon.gitCommitFiles(detail, head);
            const renamed = result.files.find(file => file.path === 'src/new.ts');
            expect(renamed).toMatchObject({ status: 'renamed', originalPath: 'src/old.ts' });
        });

        // An absent `Option` inside an object arrives as a missing property, not
        // as `null` — which is what keeps a binary file's column blank rather
        // than showing a misleading zero.
        it('omits the counts for a binary file rather than sending null', async () => {
            const result = await gitAddon.gitCommitFiles(detail, head);
            const binary = result.files.find(file => file.path === 'logo.bin');
            expect(binary).toBeDefined();
            expect('additions' in (binary as object)).toBe(false);
            expect('deletions' in (binary as object)).toBe(false);
        });

        // `diff-tree` compares against parents, so a root commit prints nothing
        // — the empty-tree parent is reported all the same.
        it('reports the empty tree and no files for a root commit', async () => {
            const result = await gitAddon.gitCommitFiles(detail, root);
            expect(result.parentHash).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
            expect(result.files).toEqual([]);
        });

        it('rejects with the `git <args> failed:` shape outside a repository', async () => {
            const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-nogit-')));
            try {
                await expect(gitAddon.gitCommitFiles(outside, 'HEAD')).rejects.toThrow(
                    /^git diff-tree .* failed: /,
                );
            } finally {
                removeDir(outside);
            }
        });
    });

    describe('gitCommitDiff', () => {
        it('matches the diff the two commands produced', async () => {
            const native = await gitAddon.gitCommitDiff(detail, head);
            const legacy = detailGit('diff', root, head).replace(/\r?\n$/, '');
            expect(native).toBe(legacy);
        });

        it('rejects for a revision that names nothing', async () => {
            await expect(gitAddon.gitCommitDiff(detail, 'no-such-ref')).rejects.toThrow(
                /^git diff .* failed: /,
            );
        });
    });

    describe('gitFileContentAtCommit', () => {
        // The reason this export exists rather than an `execGit` of `git show`:
        // a command loses one trailing newline crossing the boundary, and a
        // file's bytes cannot.
        it('keeps every trailing newline the blob holds', async () => {
            await expect(gitAddon.gitFileContentAtCommit(detail, head, 'keep.md')).resolves.toBe(
                'body\n\n\n',
            );
        });

        it('reads a nested path', async () => {
            await expect(
                gitAddon.gitFileContentAtCommit(detail, head, 'src/new.ts'),
            ).resolves.toBe('export const value = 1;\n');
        });

        it('resolves with null for a missing path and a bad revision', async () => {
            await expect(gitAddon.gitFileContentAtCommit(detail, head, 'nope.txt')).resolves.toBeNull();
            await expect(gitAddon.gitFileContentAtCommit(detail, 'no-such-ref', 'keep.md')).resolves.toBeNull();
        });

        it('resolves with null for a directory', async () => {
            await expect(gitAddon.gitFileContentAtCommit(detail, head, 'src')).resolves.toBeNull();
        });
    });

    describe('gitFileBytesAtCommit', () => {
        // The reason this export exists beside the string one: a lossy decode
        // rewrites every invalid byte sequence into U+FFFD, and the notes sync
        // mirror writes what it reads back to disk.
        it('marshals a binary blob back byte for byte', async () => {
            const bytes = await gitAddon.gitFileBytesAtCommit(detail, head, 'logo.bin');
            expect(Buffer.isBuffer(bytes)).toBe(true);
            expect([...(bytes as Buffer)]).toEqual([0, 1, 2, 3, 0x00, 0xfe]);
        });

        it('reads the same bytes the string view mangles', async () => {
            const text = await gitAddon.gitFileContentAtCommit(detail, head, 'logo.bin');
            expect(Buffer.from(text as string, 'utf8')).not.toEqual(
                await gitAddon.gitFileBytesAtCommit(detail, head, 'logo.bin'),
            );
        });

        it('keeps every trailing newline the blob holds', async () => {
            const bytes = await gitAddon.gitFileBytesAtCommit(detail, head, 'keep.md');
            expect((bytes as Buffer).toString('utf8')).toBe('body\n\n\n');
        });

        it('resolves with null for a missing path, a bad revision and a directory', async () => {
            await expect(gitAddon.gitFileBytesAtCommit(detail, head, 'nope.txt')).resolves.toBeNull();
            await expect(gitAddon.gitFileBytesAtCommit(detail, 'no-such-ref', 'keep.md')).resolves.toBeNull();
            await expect(gitAddon.gitFileBytesAtCommit(detail, head, 'src')).resolves.toBeNull();
        });

        it('reads a path at the commit asked for, not at HEAD', async () => {
            // `src/old.ts` was renamed away in the second commit, so this only
            // resolves against the root commit.
            await expect(gitAddon.gitFileBytesAtCommit(detail, head, 'src/old.ts')).resolves.toBeNull();
            const bytes = await gitAddon.gitFileBytesAtCommit(detail, root, 'src/old.ts');
            expect((bytes as Buffer).toString('utf8')).toBe('export const value = 1;\n');
        });
    });

    describe('gitFileExistsAtCommit', () => {
        it('answers true for a file and false for a missing one', async () => {
            await expect(gitAddon.gitFileExistsAtCommit(detail, head, 'keep.md')).resolves.toBe(true);
            await expect(gitAddon.gitFileExistsAtCommit(detail, head, 'nope.txt')).resolves.toBe(false);
        });

        it('answers true for a directory, as `cat-file -e` does', async () => {
            await expect(gitAddon.gitFileExistsAtCommit(detail, head, 'src')).resolves.toBe(true);
        });
    });

    describe('gitValidateRef', () => {
        it('resolves HEAD, a branch and a hash to the same commit', async () => {
            for (const ref of ['HEAD', 'main', head]) {
                await expect(gitAddon.gitValidateRef(detail, ref)).resolves.toBe(head);
            }
        });

        it('resolves with null for a ref that names nothing', async () => {
            await expect(gitAddon.gitValidateRef(detail, 'nope-not-a-ref')).resolves.toBeNull();
        });

        it('resolves with null for an annotated tag, which is not a commit', async () => {
            detailGit('tag', '-a', 'boundary-annotated', '-m', 'annotated');
            await expect(gitAddon.gitValidateRef(detail, 'boundary-annotated')).resolves.toBeNull();
        });
    });

    describe('gitLocalBranchNames', () => {
        it('lists local branches in refname order', async () => {
            detailGit('branch', 'zeta');
            detailGit('branch', 'alpha');
            await expect(gitAddon.gitLocalBranchNames(detail)).resolves.toEqual([
                'alpha',
                'main',
                'zeta',
            ]);
        });

        it('does not block the event loop', async () => {
            let ticks = 0;
            const timer = setInterval(() => { ticks += 1; }, 1);
            try {
                await Promise.all(
                    Array.from({ length: 40 }, () => gitAddon.gitLocalBranchNames(detail)),
                );
            } finally {
                clearInterval(timer);
            }
            expect(ticks).toBeGreaterThan(0);
        });
    });
});

describe('gitDiffNoIndex', () => {
    // The one command whose ordinary answer is a non-zero exit. Everything the
    // TypeScript did around it — mkdtemp, two writes, the spawn, the rm and the
    // header rewrite — happens inside this one call.
    const labels = { beforeLabel: 'a/src/main.rs', afterLabel: 'b/src/main.rs' };

    it('renders a unified diff wearing the labels the caller chose', async () => {
        const diff = await gitAddon.gitDiffNoIndex({
            before: 'one\ntwo\nthree\n',
            after: 'one\nTWO\nthree\n',
            ...labels,
        });
        expect(diff.split('\n')[0]).toBe('diff --git a/src/main.rs b/src/main.rs');
        expect(diff).toContain('--- a/src/main.rs');
        expect(diff).toContain('+++ b/src/main.rs');
        expect(diff).toContain('\n-two\n+TWO\n');
        // The temp files it compared are gone from the text and from disk.
        expect(diff).not.toContain(os.tmpdir());
    });

    it('resolves with an empty string when the two contents agree', async () => {
        await expect(
            gitAddon.gitDiffNoIndex({ before: 'same\n', after: 'same\n', ...labels }),
        ).resolves.toBe('');
    });

    it('labels a file that did not exist as /dev/null', async () => {
        const diff = await gitAddon.gitDiffNoIndex({
            before: '',
            after: 'created\n',
            beforeLabel: '/dev/null',
            afterLabel: 'b/new.txt',
        });
        expect(diff.split('\n')[0]).toBe('diff --git /dev/null b/new.txt');
        expect(diff).toContain('--- /dev/null');
        expect(diff).toContain('+created');
    });

    it('carries non-ASCII content across the boundary intact', async () => {
        const diff = await gitAddon.gitDiffNoIndex({
            before: 'café\n',
            after: 'caffè ☕\n',
            ...labels,
        });
        expect(diff).toContain('-café');
        expect(diff).toContain('+caffè ☕');
    });

    it('rejects with the shared error text when the output cap is hit', async () => {
        await expect(
            gitAddon.gitDiffNoIndex({ before: 'one\n', after: 'two\n', ...labels }, {
                maxBuffer: 8,
            }),
        ).rejects.toThrow(/^git diff --no-ext-diff --no-index --no-prefix -- .* failed:/);
    });

    it('does not block the event loop', async () => {
        let ticks = 0;
        const timer = setInterval(() => { ticks += 1; }, 1);
        try {
            await Promise.all(
                Array.from({ length: 20 }, (_unused, index) =>
                    gitAddon.gitDiffNoIndex({
                        before: 'one\ntwo\n',
                        after: `one\n${index}\n`,
                        ...labels,
                    }),
                ),
            );
        } finally {
            clearInterval(timer);
        }
        expect(ticks).toBeGreaterThan(0);
    });

    it('leaves no temp directory behind', async () => {
        const before = fs.readdirSync(os.tmpdir()).filter(entry => entry.startsWith('codex-file-diff-'));
        await gitAddon.gitDiffNoIndex({ before: 'one\n', after: 'two\n', ...labels });
        await gitAddon
            .gitDiffNoIndex({ before: 'one\n', after: 'two\n', ...labels }, { maxBuffer: 8 })
            .catch(() => undefined);
        const after = fs.readdirSync(os.tmpdir()).filter(entry => entry.startsWith('codex-file-diff-'));
        expect(after).toEqual(before);
    });
});
