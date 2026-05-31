import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createCommitDiffSource,
    createBranchRangeDiffSource,
    createPrDiffSource,
    fetchDiffFromSource,
    extractFilePathsFromDiff,
    extractFileStatsFromDiff,
    extractFileDiffFromCombined,
} from '../../../../src/server/spa/client/react/features/git/diff/diffSource';

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

import { fetchApi } from '../../../../src/server/spa/client/react/hooks/useApi';

const mockedFetchApi = vi.mocked(fetchApi);

describe('createCommitDiffSource', () => {
    const ws = 'ws1';
    const hash = 'abc1234def5678';

    it('fileDiffUrl builds correct path', () => {
        const source = createCommitDiffSource(ws, hash);
        expect(source.fileDiffUrl('src/foo.ts')).toBe(
            '/workspaces/ws1/git/commits/abc1234def5678/files/src%2Ffoo.ts/diff',
        );
    });

    it('fileDiffUrl with full=true appends query param', () => {
        const source = createCommitDiffSource(ws, hash);
        expect(source.fileDiffUrl('src/foo.ts', true)).toBe(
            '/workspaces/ws1/git/commits/abc1234def5678/files/src%2Ffoo.ts/diff?full=true',
        );
    });

    it('fileDiffUrl encodes special characters', () => {
        const source = createCommitDiffSource('my workspace', hash);
        expect(source.fileDiffUrl('path with spaces/file.ts')).toBe(
            '/workspaces/my%20workspace/git/commits/abc1234def5678/files/path%20with%20spaces%2Ffile.ts/diff',
        );
    });

    it('fullDiffUrl returns the combined endpoint', () => {
        const source = createCommitDiffSource(ws, hash);
        expect(source.fullDiffUrl()).toBe(
            '/workspaces/ws1/git/commits/abc1234def5678/diff',
        );
    });

    it('commentContext returns hash-based refs', () => {
        const source = createCommitDiffSource(ws, hash);
        const ctx = source.commentContext('src/bar.ts');
        expect(ctx).toEqual({
            repositoryId: 'ws1',
            filePath: 'src/bar.ts',
            oldRef: 'abc1234def5678^',
            newRef: 'abc1234def5678',
        });
    });

    it('label shows short hash (first 7 chars)', () => {
        const source = createCommitDiffSource(ws, hash);
        expect(source.label).toBe('Commit abc1234');
    });

    it('chat is populated with workspaceId, commitHash, and commitMessage', () => {
        const source = createCommitDiffSource(ws, hash, {
            commit: { subject: 'fix: something' },
        });
        expect(source.chat).toEqual({
            workspaceId: 'ws1',
            commitHash: 'abc1234def5678',
            commitMessage: 'fix: something',
        });
    });

    it('chat.commitMessage is undefined when commit not provided', () => {
        const source = createCommitDiffSource(ws, hash);
        expect(source.chat).toEqual({
            workspaceId: 'ws1',
            commitHash: 'abc1234def5678',
            commitMessage: undefined,
        });
    });

    it('supportsTruncation is false', () => {
        const source = createCommitDiffSource(ws, hash);
        expect(source.supportsTruncation).toBe(false);
    });

    it('files defaults to empty array', () => {
        const source = createCommitDiffSource(ws, hash);
        expect(source.files).toEqual([]);
    });

    it('files uses provided array', () => {
        const source = createCommitDiffSource(ws, hash, { files: ['a.ts', 'b.ts'] });
        expect(source.files).toEqual(['a.ts', 'b.ts']);
    });

    it('cacheKey includes hash', () => {
        const source = createCommitDiffSource(ws, hash);
        expect(source.cacheKey).toBe('commit:abc1234def5678');
    });

    it('classificationKey is set with type commit, repoId = workspaceId, identifier = hash', () => {
        const source = createCommitDiffSource(ws, hash);
        expect(source.classificationKey).toEqual({
            type: 'commit',
            repoId: 'ws1',
            identifier: 'abc1234def5678',
        });
    });

    it('classificationKey.identifier matches the full hash', () => {
        const longHash = 'abcdef1234567890abcdef1234567890abcdef12';
        const source = createCommitDiffSource(ws, longHash);
        expect(source.classificationKey?.identifier).toBe(longHash);
    });
});

describe('createBranchRangeDiffSource', () => {
    const ws = 'ws1';

    it('fileDiffUrl builds correct branch-range path', () => {
        const source = createBranchRangeDiffSource(ws);
        expect(source.fileDiffUrl('src/foo.ts')).toBe(
            '/workspaces/ws1/git/branch-range/files/src%2Ffoo.ts/diff',
        );
    });

    it('fileDiffUrl with full=true appends query param', () => {
        const source = createBranchRangeDiffSource(ws);
        expect(source.fileDiffUrl('src/foo.ts', true)).toBe(
            '/workspaces/ws1/git/branch-range/files/src%2Ffoo.ts/diff?full=true',
        );
    });

    it('fullDiffUrl returns null', () => {
        const source = createBranchRangeDiffSource(ws);
        expect(source.fullDiffUrl()).toBeNull();
    });

    it('commentContext returns symbolic refs', () => {
        const source = createBranchRangeDiffSource(ws);
        const ctx = source.commentContext('src/bar.ts');
        expect(ctx).toEqual({
            repositoryId: 'ws1',
            filePath: 'src/bar.ts',
            oldRef: 'branch-base',
            newRef: 'branch-head',
        });
    });

    it('label is "Branch diff"', () => {
        const source = createBranchRangeDiffSource(ws);
        expect(source.label).toBe('Branch diff');
    });

    it('chat is null', () => {
        const source = createBranchRangeDiffSource(ws);
        expect(source.chat).toBeNull();
    });

    it('supportsTruncation is true', () => {
        const source = createBranchRangeDiffSource(ws);
        expect(source.supportsTruncation).toBe(true);
    });

    it('files defaults to empty array', () => {
        const source = createBranchRangeDiffSource(ws);
        expect(source.files).toEqual([]);
    });

    it('files uses provided array', () => {
        const source = createBranchRangeDiffSource(ws, { files: ['x.ts', 'y.ts'] });
        expect(source.files).toEqual(['x.ts', 'y.ts']);
    });

    it('cacheKey is "branch-range"', () => {
        const source = createBranchRangeDiffSource(ws);
        expect(source.cacheKey).toBe('branch-range');
    });
});

describe('fetchDiffFromSource', () => {
    beforeEach(() => {
        mockedFetchApi.mockReset();
    });

    it('normalizes standard response with all fields', async () => {
        mockedFetchApi.mockResolvedValue({
            diff: '--- a/file\n+++ b/file',
            truncated: true,
            totalLines: 8000,
        });
        const result = await fetchDiffFromSource('/some/url');
        expect(mockedFetchApi).toHaveBeenCalledWith('/some/url');
        expect(result).toEqual({
            diff: '--- a/file\n+++ b/file',
            truncated: true,
            totalLines: 8000,
        });
    });

    it('normalizes minimal response without truncation fields', async () => {
        mockedFetchApi.mockResolvedValue({ diff: 'some diff' });
        const result = await fetchDiffFromSource('/some/url');
        expect(result).toEqual({
            diff: 'some diff',
            truncated: false,
            totalLines: 0,
        });
    });

    it('handles missing diff field', async () => {
        mockedFetchApi.mockResolvedValue({});
        const result = await fetchDiffFromSource('/some/url');
        expect(result).toEqual({
            diff: '',
            truncated: false,
            totalLines: 0,
        });
    });

    it('propagates fetchApi errors', async () => {
        mockedFetchApi.mockRejectedValue(new Error('API error: 500'));
        await expect(fetchDiffFromSource('/some/url')).rejects.toThrow('API error: 500');
    });
});

describe('createPrDiffSource', () => {
    const ws = 'ws1';
    const repoId = 'repo1';
    const prId = '42';

    it('label uses PR title when provided', () => {
        const source = createPrDiffSource(ws, repoId, prId, { title: 'Fix bug' });
        expect(source.label).toBe('PR: Fix bug');
    });

    it('label falls back to PR number', () => {
        const source = createPrDiffSource(ws, repoId, prId);
        expect(source.label).toBe('PR #42');
    });

    it('fullDiffUrl returns the combined PR diff endpoint', () => {
        const source = createPrDiffSource(ws, repoId, prId);
        expect(source.fullDiffUrl()).toBe('/api/repos/repo1/pull-requests/42/diff');
    });

    it('fileDiffUrl returns the per-file PR diff endpoint', () => {
        const source = createPrDiffSource(ws, repoId, prId);
        expect(source.fileDiffUrl('src/foo.ts')).toBe('/api/repos/repo1/pull-requests/42/diff/files/src%2Ffoo.ts');
    });

    it('commentContext returns PR-specific refs', () => {
        const source = createPrDiffSource(ws, repoId, prId);
        const ctx = source.commentContext('src/bar.ts');
        expect(ctx).toEqual({
            repositoryId: 'ws1',
            filePath: 'src/bar.ts',
            oldRef: 'pr-42-base',
            newRef: 'pr-42-head',
        });
    });

    it('chat is null (PR uses separate binding)', () => {
        const source = createPrDiffSource(ws, repoId, prId);
        expect(source.chat).toBeNull();
    });

    it('supportsTruncation is false', () => {
        const source = createPrDiffSource(ws, repoId, prId);
        expect(source.supportsTruncation).toBe(false);
    });

    it('cacheKey includes repoId and prId', () => {
        const source = createPrDiffSource(ws, repoId, prId);
        expect(source.cacheKey).toBe('pr:repo1:42');
    });

    it('files defaults to empty array', () => {
        const source = createPrDiffSource(ws, repoId, prId);
        expect(source.files).toEqual([]);
    });

    it('files uses provided array', () => {
        const source = createPrDiffSource(ws, repoId, prId, { files: ['a.ts', 'b.ts'] });
        expect(source.files).toEqual(['a.ts', 'b.ts']);
    });

    it('classificationKey is set when headSha provided', () => {
        const source = createPrDiffSource(ws, repoId, prId, { headSha: 'abc123' });
        expect(source.classificationKey).toEqual({
            type: 'pr',
            repoId: 'repo1',
            identifier: '42:abc123',
        });
    });

    it('classificationKey is undefined when headSha not provided', () => {
        const source = createPrDiffSource(ws, repoId, prId);
        expect(source.classificationKey).toBeUndefined();
    });

    it('encodes special characters in URL', () => {
        const source = createPrDiffSource(ws, 'repo with spaces', '99');
        expect(source.fullDiffUrl()).toBe('/api/repos/repo%20with%20spaces/pull-requests/99/diff');
    });
});

describe('extractFilePathsFromDiff', () => {
    it('extracts paths from a unified diff', () => {
        const diff = [
            'diff --git a/src/foo.ts b/src/foo.ts',
            '--- a/src/foo.ts',
            '+++ b/src/foo.ts',
            '@@ -1,3 +1,4 @@',
            ' line1',
            '+added',
            'diff --git a/src/bar.ts b/src/bar.ts',
            '--- a/src/bar.ts',
            '+++ b/src/bar.ts',
        ].join('\n');

        expect(extractFilePathsFromDiff(diff)).toEqual(['src/foo.ts', 'src/bar.ts']);
    });

    it('handles renames (extracts new path)', () => {
        const diff = 'diff --git a/old.ts b/new.ts\nrename from old.ts\nrename to new.ts\n';
        expect(extractFilePathsFromDiff(diff)).toEqual(['new.ts']);
    });

    it('returns empty array for empty input', () => {
        expect(extractFilePathsFromDiff('')).toEqual([]);
    });
});

describe('extractFileStatsFromDiff', () => {
    it('computes additions and deletions per file', () => {
        const diff = [
            'diff --git a/src/foo.ts b/src/foo.ts',
            '--- a/src/foo.ts',
            '+++ b/src/foo.ts',
            '@@ -1,3 +1,4 @@',
            ' line1',
            '+added1',
            '+added2',
            'diff --git a/src/bar.ts b/src/bar.ts',
            '--- a/src/bar.ts',
            '+++ b/src/bar.ts',
            '@@ -1,2 +1,2 @@',
            '-old',
            '+new',
        ].join('\n');

        expect(extractFileStatsFromDiff(diff)).toEqual([
            { path: 'src/foo.ts', additions: 2, deletions: 0 },
            { path: 'src/bar.ts', additions: 1, deletions: 1 },
        ]);
    });

    it('does not count --- or +++ header lines', () => {
        const diff = [
            'diff --git a/f.ts b/f.ts',
            '--- a/f.ts',
            '+++ b/f.ts',
            '@@ -1 +1,2 @@',
            ' context',
            '+real addition',
        ].join('\n');

        const stats = extractFileStatsFromDiff(diff);
        expect(stats).toEqual([{ path: 'f.ts', additions: 1, deletions: 0 }]);
    });

    it('returns empty array for empty input', () => {
        expect(extractFileStatsFromDiff('')).toEqual([]);
    });

    it('handles files with no content changes (e.g. mode change)', () => {
        const diff = [
            'diff --git a/script.sh b/script.sh',
            'old mode 100644',
            'new mode 100755',
        ].join('\n');

        expect(extractFileStatsFromDiff(diff)).toEqual([
            { path: 'script.sh', additions: 0, deletions: 0 },
        ]);
    });
});

describe('extractFileDiffFromCombined', () => {
    const combined = [
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -1,3 +1,4 @@',
        ' line1',
        '+added',
        'diff --git a/src/bar.ts b/src/bar.ts',
        '--- a/src/bar.ts',
        '+++ b/src/bar.ts',
        '@@ -1,2 +1,2 @@',
        '-old',
        '+new',
    ].join('\n');

    it('extracts the diff section for a specific file', () => {
        const result = extractFileDiffFromCombined(combined, 'src/foo.ts');
        expect(result).toContain('diff --git a/src/foo.ts b/src/foo.ts');
        expect(result).toContain('+added');
        expect(result).not.toContain('src/bar.ts');
    });

    it('extracts the last file correctly', () => {
        const result = extractFileDiffFromCombined(combined, 'src/bar.ts');
        expect(result).toContain('diff --git a/src/bar.ts b/src/bar.ts');
        expect(result).toContain('+new');
        expect(result).not.toContain('src/foo.ts');
    });

    it('returns null for a non-existent file', () => {
        expect(extractFileDiffFromCombined(combined, 'src/nope.ts')).toBeNull();
    });

    it('returns null for empty diff', () => {
        expect(extractFileDiffFromCombined('', 'src/foo.ts')).toBeNull();
    });
});
