/**
 * Tests for useFilesViewMode — shared hook for flat/tree file-list preference.
 *
 * Validates:
 * - Defaults to 'tree' when no workspaceId is provided.
 * - Fetches preference from server on mount.
 * - Sends PATCH on setMode.
 * - Handles missing/invalid server response gracefully.
 * - Resets to default when workspaceId changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock getApiBase before importing the hook
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
}));

import { useFilesViewMode } from '../../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode';

describe('useFilesViewMode', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it('defaults to tree when no workspaceId', () => {
        const { result } = renderHook(() => useFilesViewMode());
        expect(result.current.mode).toBe('tree');
    });

    it('defaults to tree when workspaceId is empty string', () => {
        const { result } = renderHook(() => useFilesViewMode(''));
        expect(result.current.mode).toBe('tree');
    });

    it('fetches preference from server on mount', async () => {
        fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ filesViewMode: 'flat' }), { status: 200 }));

        const { result } = renderHook(() => useFilesViewMode('ws-1'));

        await waitFor(() => {
            expect(result.current.mode).toBe('flat');
        });

        expect(fetchSpy).toHaveBeenCalledWith(
            '/api/workspaces/ws-1/preferences',
            {}
        );
    });

    it('stays at default when server returns no filesViewMode', async () => {
        fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ lastDepth: 'deep' }), { status: 200 }));

        const { result } = renderHook(() => useFilesViewMode('ws-2'));

        // Wait for the fetch to complete
        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalled();
        });

        expect(result.current.mode).toBe('tree');
    });

    it('stays at default when server returns invalid filesViewMode', async () => {
        fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ filesViewMode: 'grid' }), { status: 200 }));

        const { result } = renderHook(() => useFilesViewMode('ws-3'));

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalled();
        });

        expect(result.current.mode).toBe('tree');
    });

    it('handles fetch error gracefully', async () => {
        fetchSpy.mockRejectedValueOnce(new Error('network error'));

        const { result } = renderHook(() => useFilesViewMode('ws-4'));

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalled();
        });

        expect(result.current.mode).toBe('tree');
    });

    it('handles non-ok response gracefully', async () => {
        fetchSpy.mockResolvedValueOnce(new Response('', { status: 500 }));

        const { result } = renderHook(() => useFilesViewMode('ws-5'));

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalled();
        });

        expect(result.current.mode).toBe('tree');
    });

    it('sends PATCH on setMode and updates local state', async () => {
        fetchSpy
            .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })) // initial GET
            .mockResolvedValueOnce(new Response('', { status: 200 })); // PATCH

        const { result } = renderHook(() => useFilesViewMode('ws-6'));

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        });

        act(() => {
            result.current.setMode('flat');
        });

        expect(result.current.mode).toBe('flat');

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledTimes(2);
        });

        const patchCall = fetchSpy.mock.calls[1];
        expect(patchCall[0]).toBe('/api/workspaces/ws-6/preferences');
        const opts = patchCall[1] as RequestInit;
        expect(opts.method).toBe('PATCH');
        expect(JSON.parse(opts.body as string)).toEqual({ filesViewMode: 'flat' });
    });

    it('does not send PATCH when no workspaceId', async () => {
        const { result } = renderHook(() => useFilesViewMode());

        act(() => {
            result.current.setMode('flat');
        });

        expect(result.current.mode).toBe('flat');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('resets to default when workspaceId changes', async () => {
        fetchSpy
            .mockResolvedValueOnce(new Response(JSON.stringify({ filesViewMode: 'flat' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ filesViewMode: 'tree' }), { status: 200 }));

        const { result, rerender } = renderHook(
            ({ wsId }) => useFilesViewMode(wsId),
            { initialProps: { wsId: 'ws-a' } }
        );

        await waitFor(() => {
            expect(result.current.mode).toBe('flat');
        });

        rerender({ wsId: 'ws-b' });

        // Should reset to default first
        expect(result.current.mode).toBe('tree');

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledTimes(2);
        });
    });
});
