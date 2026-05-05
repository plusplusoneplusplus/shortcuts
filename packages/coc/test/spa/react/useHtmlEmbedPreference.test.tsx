import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { invalidateHtmlEmbedPreference, useHtmlEmbedPreference } from '../../../src/server/spa/client/react/hooks/preferences/useHtmlEmbedPreference';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    invalidateHtmlEmbedPreference();
    global.fetch = mockFetch;
});

describe('useHtmlEmbedPreference', () => {
    it('loads global HTML embed preference from /preferences', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ htmlEmbed: { enabled: true } }),
        });

        const { result } = renderHook(() => useHtmlEmbedPreference('ws1'));

        await waitFor(() => expect(result.current).toBe(true));
        expect(mockFetch.mock.calls[0][0]).toContain('/preferences');
    });

    it('defaults to enabled when preference is absent', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({}),
        });

        const { result } = renderHook(() => useHtmlEmbedPreference('ws1'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalled();
            expect(result.current).toBe(true);
        });
    });

    it('preserves explicit disabled preference', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ htmlEmbed: { enabled: false } }),
        });

        const { result } = renderHook(() => useHtmlEmbedPreference('ws1'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalled();
            expect(result.current).toBe(false);
        });
    });

    it('does not fetch without a workspace id', async () => {
        const { result } = renderHook(() => useHtmlEmbedPreference());

        expect(result.current).toBe(false);
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
