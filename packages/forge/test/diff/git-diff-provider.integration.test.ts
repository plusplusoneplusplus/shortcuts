/**
 * Integration tests for git-diff-provider using real Git.
 *
 * These tests use known commits from this repo's history to verify that
 * the revision providers correctly parse real git output. Working-tree tests
 * use isolated repositories so caller checkout state cannot affect them.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execGitAsync } from '../../src/git/exec';
import {
    createCommitDiffProvider,
    createRangeDiffProvider,
    createWorkingTreeDiffProvider,
} from '../../src/diff/git-diff-provider';
import type { IDiffProvider, DiffFileEntry, DiffContent } from '../../src/diff/types';

// ── Resolve repo root and diff-module commit dynamically ─────

let repoRoot: string;
// Resolved at runtime to the commit that introduced
// `packages/forge/src/diff/git-diff-provider.ts` — the file this test
// suite exercises. Resolving from a path is robust to history rewrites
// (rebase/squash on merge) which can change short commit hashes.
let knownCommit: string;

beforeAll(async () => {
    try {
        const root = await execGitAsync(['rev-parse', '--show-toplevel'], process.cwd());
        repoRoot = root.trim();
    } catch {
        repoRoot = '';
        return;
    }

    try {
        const out = await execGitAsync(
            [
                'log',
                '--diff-filter=A',
                '--reverse',
                '--format=%H',
                '--',
                'packages/forge/src/diff/git-diff-provider.ts',
            ],
            repoRoot,
        );
        // Take the first line: the original commit that added the file.
        knownCommit = out.split('\n').find(line => line.trim().length > 0)?.trim() ?? '';
    } catch {
        knownCommit = '';
    }

    if (!knownCommit) {
        // Without a resolvable commit, downstream tests can't run meaningfully.
        repoRoot = '';
    }
});

// ── Commit diff provider integration ─────────────────────────

describe('createCommitDiffProvider (integration)', () => {
    let provider: IDiffProvider;
    let commitHash: string;

    beforeAll(async () => {
        if (!repoRoot) return;
        commitHash = knownCommit;
        provider = createCommitDiffProvider(repoRoot, commitHash);
    });

    it('should have a commit source descriptor', () => {
        if (!repoRoot) return;
        expect(provider.source.kind).toBe('commit');
        if (provider.source.kind === 'commit') {
            expect(provider.source.commitHash).toBe(commitHash);
            expect(provider.source.repositoryRoot).toBe(repoRoot);
        }
    });

    it('should list files changed in the commit', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();

        expect(files.length).toBeGreaterThan(0);

        // The known commit added diff module files
        const diffFiles = files.filter(f => f.path.startsWith('packages/forge/src/diff/'));
        expect(diffFiles.length).toBeGreaterThan(0);

        // Every file should have required fields
        for (const file of files) {
            expect(file.path).toBeTruthy();
            expect(file.status).toBeTruthy();
            expect(typeof file.path).toBe('string');
        }
    });

    it('should return sorted file list', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        const paths = files.map(f => f.path);
        const sorted = [...paths].sort((a, b) => a.localeCompare(b));
        expect(paths).toEqual(sorted);
    });

    it('returns equivalent fresh results for an immutable commit', async () => {
        if (!repoRoot) return;
        const files1 = await provider.listFiles();
        const files2 = await provider.listFiles();
        expect(files1).toEqual(files2);
    });

    it('should get diff content for a single file', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        const firstFile = files[0];

        const content = await provider.getFileDiff(firstFile.path);
        expect(content.raw).toBeTruthy();
        expect(content.raw).toContain('diff --git');
        expect(content.truncated).toBe(false);
        expect(content.totalLines).toBeGreaterThan(0);
    });

    it('should get full diff across all files', async () => {
        if (!repoRoot) return;
        const content = await provider.getFullDiff();
        expect(content.raw).toBeTruthy();
        expect(content.raw).toContain('diff --git');
        expect(content.totalLines).toBeGreaterThan(0);
    });

    it('should prefetchAll and return a map keyed by file path', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        const map = await provider.prefetchAll();

        expect(map.size).toBeGreaterThan(0);
        // Every file in the map should have valid diff content
        for (const [filePath, content] of map) {
            expect(filePath).toBeTruthy();
            expect(content.raw).toContain('diff --git');
        }

        // Files from the prefetch should be a subset of listFiles
        for (const filePath of map.keys()) {
            expect(files.some(f => f.path === filePath)).toBe(true);
        }
    });

    it('should compute summary with non-negative stats', async () => {
        if (!repoRoot) return;
        const summary = await provider.getSummary();
        expect(summary.filesChanged).toBeGreaterThan(0);
        expect(summary.additions).toBeGreaterThanOrEqual(0);
        expect(summary.deletions).toBeGreaterThanOrEqual(0);
    });

    it('should report additions/deletions per file when available', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        const filesWithStats = files.filter(
            f => f.additions !== undefined || f.deletions !== undefined,
        );
        // The known commit has source files, so at least some should have stats
        expect(filesWithStats.length).toBeGreaterThan(0);
        for (const f of filesWithStats) {
            expect(f.additions).toBeGreaterThanOrEqual(0);
            expect(f.deletions).toBeGreaterThanOrEqual(0);
        }
    });
});

// ── Range diff provider integration ──────────────────────────

describe('createRangeDiffProvider (integration)', () => {
    let provider: IDiffProvider;
    let baseHash: string;
    let headHash: string;

    beforeAll(async () => {
        if (!repoRoot) return;
        // Use the commit before the diff module commit as base, and the diff commit as head
        headHash = knownCommit;
        baseHash = (await execGitAsync(['rev-parse', `${knownCommit}^`], repoRoot)).trim();
        provider = createRangeDiffProvider(repoRoot, baseHash, headHash);
    });

    it('should have a range source descriptor', () => {
        if (!repoRoot) return;
        expect(provider.source.kind).toBe('range');
        if (provider.source.kind === 'range') {
            expect(provider.source.baseRef).toBe(baseHash);
            expect(provider.source.headRef).toBe(headHash);
        }
    });

    it('should list changed files in the range', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        expect(files.length).toBeGreaterThan(0);

        // Should include the same files as the commit diff
        const diffFiles = files.filter(f => f.path.startsWith('packages/forge/'));
        expect(diffFiles.length).toBeGreaterThan(0);
    });

    it('should get diff content for a file in the range', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        const content = await provider.getFileDiff(files[0].path);
        expect(content.raw).toContain('diff --git');
        expect(content.totalLines).toBeGreaterThan(0);
    });

    it('should get full diff for the range', async () => {
        if (!repoRoot) return;
        const fullDiff = await provider.getFullDiff();
        expect(fullDiff.raw).toContain('diff --git');
    });

    it('should prefetchAll for the range', async () => {
        if (!repoRoot) return;
        const map = await provider.prefetchAll();
        expect(map.size).toBeGreaterThan(0);
        for (const content of map.values()) {
            expect(content.raw).toContain('diff --git');
        }
    });

    it('should compute consistent summary', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        const summary = await provider.getSummary();
        expect(summary.filesChanged).toBe(files.length);
    });
});

// ── Working tree diff provider integration ───────────────────

describe('createWorkingTreeDiffProvider (integration)', () => {
    let workingTreeRoot: string;
    const git = (...args: string[]) =>
        execFileSync('git', ['-C', workingTreeRoot, ...args], { encoding: 'utf8' });

    beforeEach(() => {
        workingTreeRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-working-tree-diff-')));
        git('init', '-q');
        git('config', 'user.name', 'Test');
        git('config', 'user.email', 'test@example.com');
        git('config', 'commit.gpgsign', 'false');
        git('config', 'core.autocrlf', 'false');
        for (const file of ['staged.txt', 'unstaged.txt', 'shared.txt']) {
            fs.writeFileSync(path.join(workingTreeRoot, file), 'before\n');
        }
        git('add', '.');
        git('commit', '-qm', 'fixture');
        fs.writeFileSync(path.join(workingTreeRoot, 'staged.txt'), 'staged-only\n');
        fs.writeFileSync(path.join(workingTreeRoot, 'shared.txt'), 'shared-staged\n');
        git('add', 'staged.txt', 'shared.txt');
        fs.writeFileSync(path.join(workingTreeRoot, 'unstaged.txt'), 'unstaged-only\n');
        fs.writeFileSync(path.join(workingTreeRoot, 'shared.txt'), 'shared-unstaged\n');
    });

    afterEach(() => {
        fs.rmSync(workingTreeRoot, { recursive: true, force: true });
    });

    it('should create a provider with default scope "all"', () => {
        const provider = createWorkingTreeDiffProvider(workingTreeRoot);
        expect(provider.source.kind).toBe('working-tree');
        if (provider.source.kind === 'working-tree') {
            expect(provider.source.scope).toBe('all');
            expect(provider.source.repositoryRoot).toBe(workingTreeRoot);
        }
    });

    it('lists only staged fixture changes', async () => {
        const provider = createWorkingTreeDiffProvider(workingTreeRoot, 'staged');
        const files = await provider.listFiles();
        expect(files.map(file => file.path)).toEqual(['shared.txt', 'staged.txt']);
        for (const f of files) {
            expect(f).toMatchObject({ status: 'modified', additions: 1, deletions: 1 });
        }
    });

    it('lists only unstaged fixture changes', async () => {
        const provider = createWorkingTreeDiffProvider(workingTreeRoot, 'unstaged');
        const files = await provider.listFiles();
        expect(files.map(file => file.path)).toEqual(['shared.txt', 'unstaged.txt']);
    });

    it('lists the union of fixture changes without duplicate paths', async () => {
        const provider = createWorkingTreeDiffProvider(workingTreeRoot, 'all');
        const files = await provider.listFiles();
        expect(files.map(file => file.path)).toEqual(['shared.txt', 'staged.txt', 'unstaged.txt']);
    });

    it('computes the exact fixture summary', async () => {
        const provider = createWorkingTreeDiffProvider(workingTreeRoot);
        const summary = await provider.getSummary();
        expect(summary).toEqual({ filesChanged: 3, additions: 3, deletions: 3 });
    });

    it('returns both index and disk patches from the fixture', async () => {
        const provider = createWorkingTreeDiffProvider(workingTreeRoot);
        const content = await provider.getFullDiff();
        expect(content.raw).toContain('+staged-only');
        expect(content.raw).toContain('+unstaged-only');
        expect(content.raw).toContain('+shared-staged');
        expect(content.raw).toContain('+shared-unstaged');
        expect(content.truncated).toBe(false);
    });

    it('prefetches all fixture file patches', async () => {
        const provider = createWorkingTreeDiffProvider(workingTreeRoot);
        const map = await provider.prefetchAll();
        expect([...map.keys()].sort()).toEqual(['shared.txt', 'staged.txt', 'unstaged.txt']);
        expect(map.get('staged.txt')?.raw).toContain('+staged-only');
        expect(map.get('unstaged.txt')?.raw).toContain('+unstaged-only');
        expect(map.get('shared.txt')?.raw).toContain('+shared-staged');
        expect(map.get('shared.txt')?.raw).toContain('+shared-unstaged');
    });

    it('returns empty results after the fixture changes are committed', async () => {
        const provider = createWorkingTreeDiffProvider(workingTreeRoot);
        expect(await provider.listFiles()).toHaveLength(3);
        git('add', '.');
        git('commit', '-qm', 'clean fixture');
        expect(await provider.listFiles()).toEqual([]);
        expect(await provider.getSummary()).toEqual({ filesChanged: 0, additions: 0, deletions: 0 });
        expect((await provider.getFullDiff()).raw).toBe('');
        expect(await provider.prefetchAll()).toEqual(new Map());
    });
});

// ── Cross-provider consistency ───────────────────────────────

describe('cross-provider consistency (integration)', () => {
    it('commit and range providers should agree on file count for single-commit range', async () => {
        if (!repoRoot) return;
        const commitHash = knownCommit;
        const parentHash = (await execGitAsync(['rev-parse', `${knownCommit}^`], repoRoot)).trim();

        const commitProvider = createCommitDiffProvider(repoRoot, commitHash);
        const rangeProvider = createRangeDiffProvider(repoRoot, parentHash, commitHash);

        const commitFiles = await commitProvider.listFiles();
        const rangeFiles = await rangeProvider.listFiles();

        // Same commit viewed as commit vs range should produce the same file list
        expect(commitFiles.length).toBe(rangeFiles.length);

        const commitPaths = commitFiles.map(f => f.path).sort();
        const rangePaths = rangeFiles.map(f => f.path).sort();
        expect(commitPaths).toEqual(rangePaths);
    });

    it('prefetchAll should cover all listed files', async () => {
        if (!repoRoot) return;
        const commitHash = knownCommit;
        const provider = createCommitDiffProvider(repoRoot, commitHash);

        const files = await provider.listFiles();
        const map = await provider.prefetchAll();

        // Binary files might not appear in the prefetch map, but text files should
        const textFiles = files.filter(f => !f.isBinary);
        for (const file of textFiles) {
            expect(map.has(file.path)).toBe(true);
        }
    });

    it('getFileDiff should return content consistent with prefetchAll', async () => {
        if (!repoRoot) return;
        const commitHash = knownCommit;
        const provider = createCommitDiffProvider(repoRoot, commitHash);

        const files = await provider.listFiles();
        if (files.length === 0) return;

        const firstFile = files[0];
        const singleDiff = await provider.getFileDiff(firstFile.path);
        const allDiffs = await provider.prefetchAll();
        const prefetchedDiff = allDiffs.get(firstFile.path);

        expect(prefetchedDiff).toBeDefined();
        // Both should contain the same diff content (may differ in trailing whitespace)
        expect(singleDiff.raw.trim()).toBe(prefetchedDiff!.raw.trim());
    });
});

// ── GetFileDiffOptions integration ───────────────────────────

describe('contextLines option (integration)', () => {
    let provider: IDiffProvider;

    beforeAll(async () => {
        if (!repoRoot) return;
        provider = createCommitDiffProvider(repoRoot, knownCommit);
    });

    it('should produce less context with contextLines=0 than default', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        if (files.length === 0) return;

        const filePath = files[0].path;
        const defaultDiff = await provider.getFileDiff(filePath);
        const zeroDiff = await provider.getFileDiff(filePath, { contextLines: 0 });

        expect(zeroDiff.totalLines).toBeLessThanOrEqual(defaultDiff.totalLines);
    });

    it('should produce more context with contextLines=10 than contextLines=0', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        // Find a file that modifies existing content (not a pure add/delete)
        const modifiedFile = files.find(f => f.status === 'modified') ?? files[0];

        const zeroDiff = await provider.getFileDiff(modifiedFile.path, { contextLines: 0 });
        const largeDiff = await provider.getFileDiff(modifiedFile.path, { contextLines: 10 });

        expect(largeDiff.totalLines).toBeGreaterThanOrEqual(zeroDiff.totalLines);
    });

    it('should still return valid diff format with contextLines', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        if (files.length === 0) return;

        const diff = await provider.getFileDiff(files[0].path, { contextLines: 5 });
        expect(diff.raw).toContain('diff --git');
        expect(diff.truncated).toBe(false);
    });
});

describe('maxLines option (integration)', () => {
    let provider: IDiffProvider;

    beforeAll(async () => {
        if (!repoRoot) return;
        provider = createCommitDiffProvider(repoRoot, knownCommit);
    });

    it('should truncate diff when maxLines is small', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        if (files.length === 0) return;

        const filePath = files[0].path;
        const fullDiff = await provider.getFileDiff(filePath);

        if (fullDiff.totalLines <= 3) return; // File too small to test truncation

        const truncated = await provider.getFileDiff(filePath, { maxLines: 3 });
        expect(truncated.truncated).toBe(true);
        expect(truncated.totalLines).toBe(fullDiff.totalLines);
        // The raw content should have at most 3 lines
        const lineCount = truncated.raw.split('\n').filter(l => l !== '').length;
        expect(lineCount).toBeLessThanOrEqual(3);
    });

    it('should not truncate when maxLines exceeds total lines', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        if (files.length === 0) return;

        const diff = await provider.getFileDiff(files[0].path, { maxLines: 100000 });
        expect(diff.truncated).toBe(false);
    });

    it('should combine maxLines with contextLines', async () => {
        if (!repoRoot) return;
        const files = await provider.listFiles();
        if (files.length === 0) return;

        const filePath = files[0].path;
        const diff = await provider.getFileDiff(filePath, { contextLines: 0, maxLines: 5 });

        // Should respect both options without error
        expect(typeof diff.raw).toBe('string');
        expect(diff.totalLines).toBeGreaterThan(0);
    });
});
