/**
 * @vitest-environment jsdom
 *
 * Tests for the useUiLayoutMode hook (server-backed via /api/preferences).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock getApiBase before importing the hook
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
}));

import { useUiLayoutMode, __resetForTesting } from '../../../../src/server/spa/client/react/hooks/preferences/useUiLayoutMode';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    __resetForTesting();
    global.fetch = mockFetch;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useUiLayoutMode', () => {
    it('returns classic as default before server fetch', () => {
        mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
        const { result } = renderHook(() => useUiLayoutMode());
        expect(result.current[0]).toBe('classic');
    });

    it('updates state after server returns dev-workflow', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ uiLayoutMode: 'dev-workflow' }),
        });
        const { result } = renderHook(() => useUiLayoutMode());

        await waitFor(() => {
            expect(result.current[0]).toBe('dev-workflow');
        });
    });

    it('updates state after server returns classic', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ uiLayoutMode: 'classic' }),
        });
        const { result } = renderHook(() => useUiLayoutMode());

        await waitFor(() => {
            expect(result.current[0]).toBe('classic');
        });
    });

    it('stays on default when server returns unknown value', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ uiLayoutMode: 'unknown-mode' }),
        });
        const { result } = renderHook(() => useUiLayoutMode());

        // Wait for effect to run
        await act(async () => {});
        expect(result.current[0]).toBe('classic');
    });

    it('stays on default when server returns no uiLayoutMode', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ theme: 'dark' }),
        });
        const { result } = renderHook(() => useUiLayoutMode());

        await act(async () => {});
        expect(result.current[0]).toBe('classic');
    });

    it('stays on default when server fetch fails', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));
        const { result } = renderHook(() => useUiLayoutMode());

        await act(async () => {});
        expect(result.current[0]).toBe('classic');
    });

    it('stays on default when server returns non-ok response', async () => {
        mockFetch.mockResolvedValue({ ok: false });
        const { result } = renderHook(() => useUiLayoutMode());

        await act(async () => {});
        expect(result.current[0]).toBe('classic');
    });

    it('setMode updates state and calls PATCH', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        });
        const { result } = renderHook(() => useUiLayoutMode());

        // Wait for initial fetch
        await act(async () => {});

        // Reset to track only the PATCH call
        mockFetch.mockClear();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

        act(() => {
            result.current[1]('dev-workflow');
        });

        expect(result.current[0]).toBe('dev-workflow');

        // Verify PATCH was called
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/preferences',
            expect.objectContaining({
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uiLayoutMode: 'dev-workflow' }),
            }),
        );
    });

    it('setMode does not throw when PATCH fails', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        });
        const { result } = renderHook(() => useUiLayoutMode());
        await act(async () => {});

        mockFetch.mockClear();
        mockFetch.mockRejectedValue(new Error('Server error'));

        // Should not throw
        act(() => {
            result.current[1]('dev-workflow');
        });

        // State should still update optimistically
        expect(result.current[0]).toBe('dev-workflow');
    });
});
