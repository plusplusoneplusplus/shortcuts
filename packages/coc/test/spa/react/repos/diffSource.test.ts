import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createCommitDiffSource,
    createBranchRangeDiffSource,
    fetchDiffFromSource,
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
