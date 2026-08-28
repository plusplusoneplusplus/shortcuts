/**
 * The PR full-context diff against real repositories, now that it runs git in
 * the native addon instead of spawning a child from Node.
 *
 * The route suite already drives this path end to end, including a real
 * `git fetch` from a local bare remote. What is pinned here is the one thing
 * the move changed: everything crossing the N-API boundary loses exactly one
 * trailing line ending, and this function decides "no full context available"
 * with a plain `stdout || null`. So the emptiness check and the diff's own
 * bytes are worth asserting against what the raw command prints.
 */

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
    baseSha = await commit('base');
    fs.writeFileSync(path.join(repo, 'a.ts'), ['one', 'two changed', 'three', ''].join('\n'), 'utf-8');
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
