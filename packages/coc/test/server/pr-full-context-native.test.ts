/** Real-Git regressions for Rust-owned direct PR comparison planning. */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execGitAsync } from '@plusplusoneplusplus/forge';
import { getFullContextFileDiff } from '../../src/server/repos/pr-routes';

let tmpDir: string;
let repo: string;
let baseSha: string;
let headSha: string;

async function commit(message: string): Promise<string> {
    await execGitAsync(['add', '-A'], repo);
    await execGitAsync(
        ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-q', '-m', message],
        repo,
    );
    return (await execGitAsync(['rev-parse', 'HEAD'], repo)).trim();
}

beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-full-context-'));
    repo = path.join(tmpDir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    await execGitAsync(['init', '-q', '-b', 'main', '.'], repo);
    fs.writeFileSync(path.join(repo, 'a.ts'), ['one', 'two', 'three', ''].join('\n'), 'utf-8');
    fs.writeFileSync(path.join(repo, 'untouched.ts'), 'stable\n', 'utf-8');
    for (const name of ['[ab].txt', 'a.txt', 'b.txt']) fs.writeFileSync(path.join(repo, name), 'old\n');
    baseSha = await commit('base');
    fs.writeFileSync(path.join(repo, 'a.ts'), ['one', 'two changed', 'three', ''].join('\n'), 'utf-8');
    for (const name of ['[ab].txt', 'a.txt', 'b.txt']) fs.writeFileSync(path.join(repo, name), 'new\n');
    headSha = await commit('head');
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const pr = () => ({ baseSha, headSha }) as any;

describe('getFullContextFileDiff on native', () => {
    it('returns the diff git prints, minus the one trailing line ending', async () => {
        const raw = await execGitAsync(['diff', '-U99999', baseSha, headSha, '--', 'a.ts'], repo);
        const result = await getFullContextFileDiff(repo, 'origin', '42', pr(), 'a.ts');

        expect(result.unavailableReason).toBeUndefined();
        expect(result.diff).toBe(raw);
        expect(result.diff).toContain('-two');
        expect(result.diff).toContain('+two changed');
        // Full context: the unchanged lines are in the hunk too.
        expect(result.diff).toContain(' one');
        expect(result.diff).toContain(' three');
    });


    it('selects unusual paths literally rather than returning matching neighbours', async () => {
        const old = await execGitAsync(['diff', '-U99999', baseSha, headSha, '--', '[ab].txt'], repo);
        expect(old).toContain('diff --git a/a.txt b/a.txt');
        const expected = await execGitAsync(['--literal-pathspecs', 'diff', '-U99999', baseSha, headSha, '--', '[ab].txt'], repo);
        const result = await getFullContextFileDiff(repo, 'origin', '42', pr(), '[ab].txt');
        expect(result.diff).toBe(expected);
        expect(result.diff).not.toContain('diff --git a/a.txt b/a.txt');
    });

    it('keeps canonical patch bytes with configured colour and missing prefixes', async () => {
        const expected = await getFullContextFileDiff(repo, 'origin', '42', pr(), 'a.ts');
        await execGitAsync(['config', 'color.ui', 'always'], repo);
        await execGitAsync(['config', 'diff.noprefix', 'true'], repo);
        try {
            const old = await execGitAsync(['diff', '-U99999', baseSha, headSha, '--', 'a.ts'], repo);
            expect(old).toContain('\u001b[');
            expect(old).not.toContain('diff --git a/a.ts b/a.ts');
            expect(await getFullContextFileDiff(repo, 'origin', '42', pr(), 'a.ts')).toEqual(expected);
        } finally {
            await execGitAsync(['config', '--unset', 'color.ui'], repo);
            await execGitAsync(['config', '--unset', 'diff.noprefix'], repo);
        }
    });

    it('compares divergent endpoints directly and keeps concurrent clone roots isolated', async () => {
        fs.writeFileSync(path.join(repo, 'base-only.txt'), 'base branch\n');
        await execGitAsync(['add', 'base-only.txt'], repo);
        const tree = (await execGitAsync(['write-tree'], repo)).trim();
        const divergentBase = (await execGitAsync(['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit-tree', tree, '-p', baseSha, '-m', 'divergent base'], repo)).trim();
        await execGitAsync(['read-tree', 'HEAD'], repo);
        const comparison = { baseSha: divergentBase, headSha } as any;
        const expected = await execGitAsync(['diff', '-U99999', divergentBase, headSha, '--', 'base-only.txt'], repo);
        expect(expected).toContain('deleted file mode');
        expect(await execGitAsync(['diff', `${divergentBase}...${headSha}`, '--', 'base-only.txt'], repo)).toBe('');
        const clone = path.join(tmpDir, 'clone');
        await execGitAsync(['clone', '-q', repo, clone], tmpDir);
        const own = { baseSha, headSha: baseSha } as any;
        const [one, two] = await Promise.all([
            getFullContextFileDiff(repo, 'origin', '42', comparison, 'base-only.txt'),
            getFullContextFileDiff(clone, 'origin', '42', own, 'a.ts'),
        ]);
        expect(one.diff).toBe(expected);
        expect(two).toEqual({ diff: null, unavailableReason: 'git-diff-failed' });
    });

    it('reports git-diff-failed for a file the range does not touch', async () => {
        // git prints nothing at all, and `stdout || null` turns that into the
        // unavailable reason — the empty-string case a trailing-newline strip
        // could otherwise have manufactured.
        const raw = await execGitAsync(['diff', '-U99999', baseSha, headSha, '--', 'untouched.ts'], repo);
        expect(raw).toBe('');

        await expect(getFullContextFileDiff(repo, 'origin', '42', pr(), 'untouched.ts'))
            .resolves.toEqual({ diff: null, unavailableReason: 'git-diff-failed' });
    });

    it('reports git-fetch-failed when a SHA is missing and there is nothing to fetch from', async () => {
        const missing = 'a'.repeat(40);
        await expect(getFullContextFileDiff(repo, 'origin', '42', { baseSha: missing, headSha } as any, 'a.ts'))
            .resolves.toEqual({ diff: null, unavailableReason: 'git-fetch-failed' });
    });

    it('reports missing-pr-shas without touching git', async () => {
        await expect(getFullContextFileDiff(repo, 'origin', '42', { headSha } as any, 'a.ts'))
            .resolves.toEqual({ diff: null, unavailableReason: 'missing-pr-shas' });
    });

    it('reports git-diff-failed for a path that is not a repository', async () => {
        // "not a git repository" is not a missing-commit error, so it stops
        // before the fetch rather than trying to pull commits into a plain
        // directory. Pinned because the classification reads git's stderr, and
        // the native runner is what puts that text on the rejection now.
        const plain = path.join(tmpDir, 'plain');
        fs.mkdirSync(plain, { recursive: true });
        await expect(getFullContextFileDiff(plain, 'origin', '42', pr(), 'a.ts'))
            .resolves.toEqual({ diff: null, unavailableReason: 'git-diff-failed' });
    });
});
