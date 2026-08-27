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
