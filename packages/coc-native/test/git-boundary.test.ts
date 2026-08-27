/**
 * N-API boundary tests for the git capability: marshalling, async behaviour,
 * the `git <args> failed:` error text, concurrency and the option defaults —
 * all against the real compiled addon and a real temporary repository.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { gitAddon } from './helpers';

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
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
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
            fs.rmSync(empty, { recursive: true, force: true });
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
            fs.rmSync(empty, { recursive: true, force: true });
        }
    });

    it('honours a per-call timeout override', async () => {
        await expect(gitAddon.gitStatusEntries(repo, { timeout: 1 })).rejects.toThrow(
            /^git status --porcelain --untracked-files=all failed: /,
        );
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
            fs.rmSync(empty, { recursive: true, force: true });
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
        if (range) fs.rmSync(range, { recursive: true, force: true });
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
            fs.rmSync(bare, { recursive: true, force: true });
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
            fs.rmSync(bare, { recursive: true, force: true });
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
            fs.rmSync(empty, { recursive: true, force: true });
        }
    });

    it('serves concurrent range reads of the same repository', async () => {
        const resolved = await Promise.all(
            Array.from({ length: 8 }, () => gitAddon.gitRangeResolveBaseRef(range, 'upstream')),
        );
        expect(resolved.every(one => one.baseModeFallback === true)).toBe(true);
    });
});
