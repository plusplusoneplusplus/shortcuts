/**
 * Tests for useCommitListExpansion — the inline commit file list.
 *
 * The important guarantee here is the stale-request guard: commit hashes are
 * not unique across repos, so a `listCommitFiles` response that lands after the
 * user switched workspaces must be discarded rather than written into the new
 * workspace's cache.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const listCommitFiles = vi.fn();

vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ git: { listCommitFiles: (...args: any[]) => listCommitFiles(...args) } }),
}));

// Must be a stable reference: the real hook returns React state, and the
// fileCommentMap effect depends on this map's identity.
const EMPTY_COMMENT_COUNTS = new Map<string, number>();
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => ({
    useFileCommentCounts: () => EMPTY_COMMENT_COUNTS,
}));

vi.mock('../../../../src/server/spa/client/comments/diff-comment-utils', () => ({
    computeDiffCommentKey: async (_repo: string, _old: string, _new: string, filePath: string) => `key-${filePath}`,
}));

import { useCommitListExpansion } from '../../../../src/server/spa/client/react/features/git/commits/useCommitListExpansion';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/commitListTypes';

const COMMIT: GitCommitItem = {
    hash: 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
    shortHash: 'aaaa111',
    subject: 'Fix bug A',
    author: 'Alice',
    date: '2024-01-01T00:00:00Z',
    parentHashes: [],
};

const OTHER: GitCommitItem = { ...COMMIT, hash: 'bbbb2222bbbb2222', shortHash: 'bbbb222' };

/** A promise plus its resolver, so a test can decide when a fetch lands. */
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('useCommitListExpansion — expand / collapse', () => {
    it('expands a commit and caches its files', async () => {
        listCommitFiles.mockResolvedValue({ files: [{ status: 'M', path: 'src/foo.ts' }] });
        const { result } = renderHook(() => useCommitListExpansion('ws-1', null));

        act(() => { result.current.toggleExpansion(COMMIT); });
        expect(result.current.expandedHash).toBe(COMMIT.hash);

        await waitFor(() => expect(result.current.fileCache[COMMIT.hash]).toBeTruthy());
        expect(result.current.fileCache[COMMIT.hash].map(f => f.path)).toEqual(['src/foo.ts']);
        expect(result.current.filesLoading).toBeNull();
    });

    it('collapses on a second toggle without refetching', async () => {
        listCommitFiles.mockResolvedValue({ files: [] });
        const { result } = renderHook(() => useCommitListExpansion('ws-1', null));

        act(() => { result.current.toggleExpansion(COMMIT); });
        await waitFor(() => expect(result.current.fileCache[COMMIT.hash]).toBeTruthy());

        act(() => { result.current.toggleExpansion(COMMIT); });
        expect(result.current.expandedHash).toBeNull();

        act(() => { result.current.toggleExpansion(COMMIT); });
        expect(result.current.expandedHash).toBe(COMMIT.hash);
        expect(listCommitFiles).toHaveBeenCalledTimes(1);
    });

    it('caches an empty file list when the fetch fails', async () => {
        listCommitFiles.mockRejectedValue(new Error('boom'));
        const { result } = renderHook(() => useCommitListExpansion('ws-1', null));

        act(() => { result.current.toggleExpansion(COMMIT); });
        await waitFor(() => expect(result.current.fileCache[COMMIT.hash]).toEqual([]));
        expect(result.current.filesLoading).toBeNull();
    });

    it('does not fetch when there is no workspace', () => {
        const { result } = renderHook(() => useCommitListExpansion(undefined, null));
        act(() => { result.current.toggleExpansion(COMMIT); });
        expect(result.current.expandedHash).toBe(COMMIT.hash);
        expect(listCommitFiles).not.toHaveBeenCalled();
    });
});

describe('useCommitListExpansion — deep-link auto-expansion', () => {
    it('expands and fetches the initial hash exactly once', async () => {
        listCommitFiles.mockResolvedValue({ files: [] });
        const { result, rerender } = renderHook(
            ({ hash }) => useCommitListExpansion('ws-1', hash),
            { initialProps: { hash: COMMIT.hash as string | null } },
        );

        await waitFor(() => expect(result.current.fileCache[COMMIT.hash]).toBeTruthy());
        expect(result.current.expandedHash).toBe(COMMIT.hash);

        rerender({ hash: COMMIT.hash });
        expect(listCommitFiles).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no initial hash is supplied', () => {
        renderHook(() => useCommitListExpansion('ws-1', null));
        expect(listCommitFiles).not.toHaveBeenCalled();
    });
});

describe('useCommitListExpansion — stale request guard', () => {
    it('drops a file response that lands after the workspace changed', async () => {
        const slow = deferred<{ files: { status: string; path: string }[] }>();
        listCommitFiles.mockReturnValueOnce(slow.promise);

        const { result, rerender } = renderHook(
            ({ ws }) => useCommitListExpansion(ws, null),
            { initialProps: { ws: 'ws-1' as string } },
        );

        act(() => { result.current.toggleExpansion(COMMIT); });
        expect(result.current.filesLoading).toBe(COMMIT.hash);

        // User switches repos before the fetch settles.
        rerender({ ws: 'ws-2' });
        await act(async () => {
            slow.resolve({ files: [{ status: 'M', path: 'from/old/workspace.ts' }] });
            await slow.promise;
        });

        expect(result.current.fileCache[COMMIT.hash]).toBeUndefined();
    });

    it('drops a failed response that lands after the workspace changed', async () => {
        const slow = deferred<never>();
        listCommitFiles.mockReturnValueOnce(slow.promise);

        const { result, rerender } = renderHook(
            ({ ws }) => useCommitListExpansion(ws, null),
            { initialProps: { ws: 'ws-1' as string } },
        );

        act(() => { result.current.toggleExpansion(COMMIT); });
        rerender({ ws: 'ws-2' });
        await act(async () => {
            slow.reject(new Error('aborted'));
            await slow.promise.catch(() => {});
        });

        expect(result.current.fileCache[COMMIT.hash]).toBeUndefined();
    });

    it('clears the cached files when the workspace changes', async () => {
        listCommitFiles.mockResolvedValue({ files: [{ status: 'M', path: 'src/foo.ts' }] });
        const { result, rerender } = renderHook(
            ({ ws }) => useCommitListExpansion(ws, null),
            { initialProps: { ws: 'ws-1' as string } },
        );

        act(() => { result.current.toggleExpansion(COMMIT); });
        await waitFor(() => expect(result.current.fileCache[COMMIT.hash]).toBeTruthy());

        rerender({ ws: 'ws-2' });
        await waitFor(() => expect(result.current.fileCache[COMMIT.hash]).toBeUndefined());
    });

    it('does not let a settled older request clear a newer commit\'s loading state', async () => {
        const first = deferred<{ files: never[] }>();
        const second = deferred<{ files: never[] }>();
        listCommitFiles.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

        const { result } = renderHook(() => useCommitListExpansion('ws-1', null));

        act(() => { result.current.toggleExpansion(COMMIT); });
        act(() => { result.current.toggleExpansion(OTHER); });
        expect(result.current.filesLoading).toBe(OTHER.hash);

        await act(async () => {
            first.resolve({ files: [] });
            await first.promise;
        });

        // The older request finished, but OTHER is still loading.
        expect(result.current.filesLoading).toBe(OTHER.hash);

        await act(async () => {
            second.resolve({ files: [] });
            await second.promise;
        });
        await waitFor(() => expect(result.current.filesLoading).toBeNull());
    });
});
