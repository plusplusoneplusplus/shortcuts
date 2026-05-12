/**
 * Integration tests for git-diff-provider running against the real repository.
 *
 * These tests use known commits from this repo's history to verify that
 * the diff providers correctly parse real git output. They require the
 * test to be run from within a git repository.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execGitAsync } from '../../src/git/exec';
import {
    createCommitDiffProvider,
    createRangeDiffProvider,
    createWorkingTreeDiffProvider,
} from '../../src/diff/git-diff-provider';
import type { IDiffProvider, DiffFileEntry, DiffContent } from '../../src/diff/types';
import path from 'path';

// ── Resolve repo root dynamically ────────────────────────────

let repoRoot: string;

beforeAll(async () => {
    // Find the repo root from the current working directory
    try {
        const root = await execGitAsync(['rev-parse', '--show-toplevel'], process.cwd());
        repoRoot = root.trim();
    } catch {
        // If we can't find the repo root, skip all tests
        repoRoot = '';
    }
});

/**
 * Use the first commit that introduced the diff module — a known commit
 * that added 7 files. We look it up by its short hash prefix so it works
 * even if the history is rewritten (but that's unlikely for merged commits).
 */
const KNOWN_COMMIT_SHORT = '1412a6dc3';

// ── Commit diff provider integration ─────────────────────────

describe('createCommitDiffProvider (integration)', () => {
    let provider: IDiffProvider;
    let commitHash: string;

    beforeAll(async () => {
        if (!repoRoot) return;
        // Resolve full hash
        commitHash = (await execGitAsync(['rev-parse', KNOWN_COMMIT_SHORT], repoRoot)).trim();
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

    it('should cache listFiles results', async () => {
        if (!repoRoot) return;
        const files1 = await provider.listFiles();
        const files2 = await provider.listFiles();
        expect(files1).toBe(files2); // Same reference — cached
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
        headHash = (await execGitAsync(['rev-parse', KNOWN_COMMIT_SHORT], repoRoot)).trim();
        baseHash = (await execGitAsync(['rev-parse', `${KNOWN_COMMIT_SHORT}^`], repoRoot)).trim();
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
    // Working tree tests are inherently non-deterministic (depend on local state)
    // so we just verify the API contract is met, not specific file content.

    it('should create a provider with default scope "all"', () => {
        if (!repoRoot) return;
        const provider = createWorkingTreeDiffProvider(repoRoot);
        expect(provider.source.kind).toBe('working-tree');
        if (provider.source.kind === 'working-tree') {
            expect(provider.source.scope).toBe('all');
        }
    });

    it('should list files without error (staged)', async () => {
        if (!repoRoot) return;
        const provider = createWorkingTreeDiffProvider(repoRoot, 'staged');
        const files = await provider.listFiles();
        expect(Array.isArray(files)).toBe(true);
        for (const f of files) {
            expect(f.path).toBeTruthy();
            expect(f.status).toBeTruthy();
        }
    });

    it('should list files without error (unstaged)', async () => {
        if (!repoRoot) return;
        const provider = createWorkingTreeDiffProvider(repoRoot, 'unstaged');
        const files = await provider.listFiles();
        expect(Array.isArray(files)).toBe(true);
    });

    it('should list files without error (all)', async () => {
        if (!repoRoot) return;
        const provider = createWorkingTreeDiffProvider(repoRoot, 'all');
        const files = await provider.listFiles();
        expect(Array.isArray(files)).toBe(true);
    });

    it('should compute summary without error', async () => {
        if (!repoRoot) return;
        const provider = createWorkingTreeDiffProvider(repoRoot);
        const summary = await provider.getSummary();
        expect(summary.filesChanged).toBeGreaterThanOrEqual(0);
        expect(summary.additions).toBeGreaterThanOrEqual(0);
        expect(summary.deletions).toBeGreaterThanOrEqual(0);
    });

    it('should getFullDiff without error', async () => {
        if (!repoRoot) return;
        const provider = createWorkingTreeDiffProvider(repoRoot);
        const content = await provider.getFullDiff();
        expect(typeof content.raw).toBe('string');
        expect(content.truncated).toBe(false);
    });

    it('should prefetchAll without error', async () => {
        if (!repoRoot) return;
        const provider = createWorkingTreeDiffProvider(repoRoot);
        const map = await provider.prefetchAll();
        expect(map instanceof Map).toBe(true);
    });
});

// ── Cross-provider consistency ───────────────────────────────

describe('cross-provider consistency (integration)', () => {
    it('commit and range providers should agree on file count for single-commit range', async () => {
        if (!repoRoot) return;
        const commitHash = (await execGitAsync(['rev-parse', KNOWN_COMMIT_SHORT], repoRoot)).trim();
        const parentHash = (await execGitAsync(['rev-parse', `${KNOWN_COMMIT_SHORT}^`], repoRoot)).trim();

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
        const commitHash = (await execGitAsync(['rev-parse', KNOWN_COMMIT_SHORT], repoRoot)).trim();
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
        const commitHash = (await execGitAsync(['rev-parse', KNOWN_COMMIT_SHORT], repoRoot)).trim();
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
