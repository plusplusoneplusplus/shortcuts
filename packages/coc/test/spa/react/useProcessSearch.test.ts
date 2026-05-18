/**
 * Tests for useProcessSearch hook — debouncing, abort, minimum query length, error fallback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProcessSearch } from '../../../src/server/spa/client/react/processes/hooks/useProcessSearch';

// Stub config
vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
}));

function makeResponse(results: any[] = [], total = 0) {
    return {
        ok: true,
        json: async () => ({ results, total, query: 'test', limit: 50, offset: 0 }),
    };
}

const sampleResult = {
    processId: 'p1', turnIndex: 0, role: 'user', snippet: '<mark>test</mark>',
    rank: -1.5, processTitle: 'Proc 1', promptPreview: 'hello', processStatus: 'completed',
    processType: 'chat', workspaceId: 'ws1', startTime: '2024-01-01',
};

describe('useProcessSearch', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn().mockResolvedValue(makeResponse([sampleResult], 1));
        vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not search when query is below minimum length', () => {
        const { result } = renderHook(() => useProcessSearch('a', { debounceMs: 0 }));
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result.current.results).toEqual([]);
        expect(result.current.loading).toBe(false);
    });

    it('does not search for empty query', () => {
        const { result } = renderHook(() => useProcessSearch('', { debounceMs: 0 }));
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result.current.results).toEqual([]);
    });

    it('calls fetch after debounce for valid query', async () => {
        const { result } = renderHook(
            () => useProcessSearch('test', { debounceMs: 0 }),
        );

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        });
        expect(result.current.results).toHaveLength(1);
        expect(result.current.results[0].processId).toBe('p1');
        expect(result.current.loading).toBe(false);
    });

    it('cancels in-flight requests when query changes', async () => {
        let abortSignals: AbortSignal[] = [];
        let resolvers: Array<(value: any) => void> = [];

        fetchSpy.mockImplementation((_url: string, opts: any) => {
            abortSignals.push(opts.signal);
            return new Promise((resolve) => {
                resolvers.push(resolve);
            });
        });

        const { rerender } = renderHook(
            ({ q }) => useProcessSearch(q, { debounceMs: 0 }),
            { initialProps: { q: 'test' } },
        );

        // Wait for first fetch to be called
        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        });

        // Change query — should abort previous
        rerender({ q: 'testing' });

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledTimes(2);
        });

        expect(abortSignals[0].aborted).toBe(true);
    });

    it('passes workspace and status filters through client.processes.search', async () => {
        renderHook(
            () => useProcessSearch('test', { workspace: 'ws-abc', statusFilter: 'completed', debounceMs: 0 }),
        );

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        });
        const calledUrl = fetchSpy.mock.calls[0][0] as string;
        expect(calledUrl).toContain('q=test');
        expect(calledUrl).toContain('workspace=ws-abc');
        expect(calledUrl).toContain('status=completed');
    });

    it('does not include workspace param when workspace is __all', async () => {
        renderHook(() => useProcessSearch('test', { workspace: '__all', debounceMs: 0 }));

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        });
        const calledUrl = fetchSpy.mock.calls[0][0] as string;
        expect(calledUrl).not.toContain('workspace=');
    });

    it('falls back to empty results on fetch error', async () => {
        fetchSpy.mockRejectedValueOnce(new Error('Network error'));

        const { result } = renderHook(
            () => useProcessSearch('test', { debounceMs: 0 }),
        );

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.results).toEqual([]);
        expect(result.current.error).toBe('Network error');
    });

    it('falls back to empty results on non-ok response', async () => {
        fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });

        const { result } = renderHook(
            () => useProcessSearch('test', { debounceMs: 0 }),
        );

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.results).toEqual([]);
        expect(result.current.error).toContain('500');
    });

    it('resets results when query drops below minimum length', async () => {
        const { result, rerender } = renderHook(
            ({ q }) => useProcessSearch(q, { debounceMs: 0 }),
            { initialProps: { q: 'test' } },
        );

        await waitFor(() => {
            expect(result.current.results).toHaveLength(1);
        });

        // Drop below min length
        rerender({ q: 'a' });
        expect(result.current.results).toEqual([]);
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBe(null);
    });

    it('respects custom minQueryLength', () => {
        renderHook(() => useProcessSearch('ab', { minQueryLength: 3, debounceMs: 0 }));
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
