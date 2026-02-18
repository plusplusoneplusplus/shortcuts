import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePreferences } from '../../../src/server/spa/client/react/hooks/usePreferences';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

describe('usePreferences', () => {
    it('loads model from GET /api/preferences', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ lastModel: 'gpt-4' }),
        });

        const { result } = renderHook(() => usePreferences());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
            expect(result.current.model).toBe('gpt-4');
        });
    });

    it('defaults to empty string when API fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const { result } = renderHook(() => usePreferences());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
            expect(result.current.model).toBe('');
        });
    });

    it('setModel updates model state immediately', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ lastModel: 'gpt-4' }),
        });
        // PATCH call
        mockFetch.mockResolvedValueOnce({ ok: true });

        const { result } = renderHook(() => usePreferences());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
        });

        act(() => {
            result.current.setModel('gpt-3.5');
        });

        expect(result.current.model).toBe('gpt-3.5');
    });

    it('setModel fires PATCH /api/preferences', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ lastModel: '' }),
        });
        mockFetch.mockResolvedValueOnce({ ok: true });

        const { result } = renderHook(() => usePreferences());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
        });

        act(() => {
            result.current.setModel('claude-3');
        });

        await waitFor(() => {
            const patchCalls = mockFetch.mock.calls.filter(
                ([_, opts]: [string, any]) => opts?.method === 'PATCH'
            );
            expect(patchCalls.length).toBe(1);
            const body = JSON.parse(patchCalls[0][1].body);
            expect(body.lastModel).toBe('claude-3');
        });
    });
});
