/**
 * Tests for useFileDiff — single-file diff fetch hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// --- Module mocks ---

const mockFetchDiffFromSource = vi.fn();
const mockPeekDiffCache = vi.fn((..._args: any[]): any => undefined);

vi.mock('../../../../src/server/spa/client/react/features/git/diff/diffSource', () => ({
    fetchDiffFromSource: (...args: any[]) => mockFetchDiffFromSource(...args),
    peekDiffCache: (...args: any[]) => mockPeekDiffCache(...args),
}));

import { useFileDiff } from '../../../../src/server/spa/client/react/features/git/hooks/useFileDiff';

describe('useFileDiff', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: cache miss, so tests exercise the network path unless they opt in.
        mockPeekDiffCache.mockReturnValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches diff from URL and returns parsed state', async () => {
        mockFetchDiffFromSource.mockResolvedValue({
            diff: '+added line\n context',
            truncated: false,
            totalLines: 0,
        });

        const { result } = renderHook(() => useFileDiff('/api/diff'));

        // Initially loading
        expect(result.current.loading).toBe(true);
        expect(result.current.diff).toBeNull();

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.diff).toBe('+added line\n context');
        expect(result.current.error).toBeNull();
        expect(result.current.truncated).toBe(false);
        expect(result.current.totalLines).toBe(0);
        // No workspaceId passed → routes to the default origin ('' workspace id).
        expect(mockFetchDiffFromSource).toHaveBeenCalledWith('', '/api/diff');
    });

    it('forwards the workspaceId so the fetch routes to that clone (AC-07)', async () => {
        mockFetchDiffFromSource.mockResolvedValue({
            diff: 'remote diff',
            truncated: false,
            totalLines: 0,
        });

        const { result } = renderHook(() => useFileDiff('/api/diff', null, 'remote-ws'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.diff).toBe('remote diff');
        expect(mockFetchDiffFromSource).toHaveBeenCalledWith('remote-ws', '/api/diff');
    });

    it('handles truncated response', async () => {
        mockFetchDiffFromSource.mockResolvedValue({
            diff: '+line1\n+line2',
            truncated: true,
            totalLines: 10000,
        });

        const { result } = renderHook(() =>
            useFileDiff('/api/diff', '/api/diff?full=true'),
        );

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.truncated).toBe(true);
        expect(result.current.totalLines).toBe(10000);
        expect(result.current.diff).toBe('+line1\n+line2');
    });

    it('requestFullDiff re-fetches with full URL', async () => {
        mockFetchDiffFromSource
            .mockResolvedValueOnce({
                diff: 'truncated',
                truncated: true,
                totalLines: 10000,
            })
            .mockResolvedValueOnce({
                diff: 'full content',
                truncated: false,
                totalLines: 0,
            });

        const { result } = renderHook(() =>
            useFileDiff('/api/diff', '/api/diff?full=true'),
        );

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.truncated).toBe(true);

        act(() => {
            result.current.requestFullDiff();
        });

        await waitFor(() => expect(result.current.diff).toBe('full content'));
        expect(mockFetchDiffFromSource).toHaveBeenCalledWith('', '/api/diff?full=true');
        expect(result.current.truncated).toBe(false);
    });

    it('requestFullDiff is no-op when not truncated', async () => {
        mockFetchDiffFromSource.mockResolvedValue({
            diff: 'all content',
            truncated: false,
            totalLines: 0,
        });

        const { result } = renderHook(() =>
            useFileDiff('/api/diff', '/api/diff?full=true'),
        );

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.requestFullDiff();
        });

        // Should not trigger another fetch
        expect(mockFetchDiffFromSource).toHaveBeenCalledTimes(1);
    });

    it('retry re-fetches after error', async () => {
        mockFetchDiffFromSource
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce({
                diff: 'recovered diff',
                truncated: false,
                totalLines: 0,
            });

        const { result } = renderHook(() => useFileDiff('/api/diff'));

        await waitFor(() => expect(result.current.error).toBe('Network error'));
        expect(result.current.diff).toBeNull();

        act(() => {
            result.current.retry();
        });

        await waitFor(() => expect(result.current.diff).toBe('recovered diff'));
        expect(result.current.error).toBeNull();
    });

    it('returns null diff when URL is null', () => {
        const { result } = renderHook(() => useFileDiff(null));

        expect(result.current.diff).toBeNull();
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.truncated).toBe(false);
        expect(mockFetchDiffFromSource).not.toHaveBeenCalled();
    });

    it('resets state on URL change', async () => {
        mockFetchDiffFromSource
            .mockResolvedValueOnce({
                diff: 'first diff',
                truncated: true,
                totalLines: 5000,
            })
            .mockResolvedValueOnce({
                diff: 'second diff',
                truncated: false,
                totalLines: 0,
            });

        const { result, rerender } = renderHook(
            ({ url }) => useFileDiff(url, url ? `${url}?full=true` : null),
            { initialProps: { url: '/api/diff/file1' as string | null } },
        );

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.truncated).toBe(true);
        expect(result.current.diff).toBe('first diff');

        rerender({ url: '/api/diff/file2' });

        await waitFor(() => expect(result.current.diff).toBe('second diff'));
        expect(result.current.truncated).toBe(false);
        expect(result.current.totalLines).toBe(0);
    });

    it('retry is no-op when URL is null', () => {
        const { result } = renderHook(() => useFileDiff(null));

        act(() => {
            result.current.retry();
        });

        expect(mockFetchDiffFromSource).not.toHaveBeenCalled();
    });

    it('handles fetch error with fallback message', async () => {
        mockFetchDiffFromSource.mockRejectedValue({ message: '' });

        const { result } = renderHook(() => useFileDiff('/api/diff'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('Failed to load diff');
    });

    it('requestFullDiff is no-op when no fullUrl provided', async () => {
        mockFetchDiffFromSource.mockResolvedValue({
            diff: 'diff content',
            truncated: true,
            totalLines: 5000,
        });

        const { result } = renderHook(() => useFileDiff('/api/diff', null));

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.requestFullDiff();
        });

        // Should not fetch again since fullUrl is null
        expect(mockFetchDiffFromSource).toHaveBeenCalledTimes(1);
    });

    it('propagates fullContextUnavailable=true from server response', async () => {
        mockFetchDiffFromSource.mockResolvedValue({
            diff: 'hunk-only fallback diff',
            truncated: false,
            totalLines: 0,
            fullContextUnavailable: true,
        });

        const { result } = renderHook(() => useFileDiff('/api/diff?fullContext=true'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.fullContextUnavailable).toBe(true);
        expect(result.current.diff).toBe('hunk-only fallback diff');
    });

    it('fullContextUnavailable is undefined when not in server response', async () => {
        mockFetchDiffFromSource.mockResolvedValue({
            diff: 'normal diff',
            truncated: false,
            totalLines: 0,
        });

        const { result } = renderHook(() => useFileDiff('/api/diff'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.fullContextUnavailable).toBeUndefined();
    });

    it('cache hit: applies cached result synchronously with no network fetch', async () => {
        mockPeekDiffCache.mockReturnValue({
            diff: 'cached diff',
            truncated: false,
            totalLines: 0,
            fullContextUnavailable: undefined,
        });

        const { result } = renderHook(() => useFileDiff('/api/diff?fullContext=true', null, 'ws-1'));

        // No loading flash and no network round-trip on a cache hit.
        expect(result.current.loading).toBe(false);
        expect(result.current.diff).toBe('cached diff');
        expect(result.current.error).toBeNull();
        expect(mockFetchDiffFromSource).not.toHaveBeenCalled();
        expect(mockPeekDiffCache).toHaveBeenCalledWith('ws-1', '/api/diff?fullContext=true');
    });

    it('cache hit propagates fullContextUnavailable without a network fetch', async () => {
        mockPeekDiffCache.mockReturnValue({
            diff: 'hunk fallback',
            truncated: false,
            totalLines: 0,
            fullContextUnavailable: true,
        });

        const { result } = renderHook(() => useFileDiff('/api/diff?fullContext=true'));

        expect(result.current.loading).toBe(false);
        expect(result.current.fullContextUnavailable).toBe(true);
        expect(result.current.diff).toBe('hunk fallback');
        expect(mockFetchDiffFromSource).not.toHaveBeenCalled();
    });

    it('toggle URL A → B → A: a cached URL resolves from cache, uncached URL fetches', async () => {
        // A is cached; B is not. Toggling back to A must not re-fetch.
        const cachedA = { diff: 'diff A', truncated: false, totalLines: 0, fullContextUnavailable: undefined };
        mockPeekDiffCache.mockImplementation((_ws: string, u: string) => (u === '/api/A' ? cachedA : undefined));
        mockFetchDiffFromSource.mockResolvedValue({ diff: 'diff B', truncated: false, totalLines: 0 });

        const { result, rerender } = renderHook(
            ({ url }) => useFileDiff(url),
            { initialProps: { url: '/api/A' as string } },
        );

        // A: cache hit, no fetch.
        expect(result.current.diff).toBe('diff A');
        expect(mockFetchDiffFromSource).not.toHaveBeenCalled();

        // B: cache miss, one fetch.
        rerender({ url: '/api/B' });
        await waitFor(() => expect(result.current.diff).toBe('diff B'));
        expect(mockFetchDiffFromSource).toHaveBeenCalledTimes(1);
        expect(mockFetchDiffFromSource).toHaveBeenCalledWith('', '/api/B');

        // Back to A: cache hit again, still only the single B fetch total.
        rerender({ url: '/api/A' });
        expect(result.current.diff).toBe('diff A');
        expect(mockFetchDiffFromSource).toHaveBeenCalledTimes(1);
    });

    it('resets fullContextUnavailable on URL change', async () => {
        mockFetchDiffFromSource
            .mockResolvedValueOnce({
                diff: 'hunk fallback',
                truncated: false,
                totalLines: 0,
                fullContextUnavailable: true,
            })
            .mockResolvedValueOnce({
                diff: 'normal diff',
                truncated: false,
                totalLines: 0,
            });

        const { result, rerender } = renderHook(
            ({ url }) => useFileDiff(url),
            { initialProps: { url: '/api/diff?fullContext=true' as string } },
        );

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.fullContextUnavailable).toBe(true);

        rerender({ url: '/api/diff' });

        await waitFor(() => expect(result.current.diff).toBe('normal diff'));
        expect(result.current.fullContextUnavailable).toBeUndefined();
    });
});
