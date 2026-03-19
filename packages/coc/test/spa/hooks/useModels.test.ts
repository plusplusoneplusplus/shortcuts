/**
 * Tests for useModels hook — fetch /api/models, loading states, error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useModels } from '../../../src/server/spa/client/react/hooks/useModels';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useModels', () => {
    it('returns loading=true during fetch', () => {
        // Never resolve to keep it in-flight
        mockFetch.mockReturnValueOnce(new Promise(() => {}));
        const { result } = renderHook(() => useModels());
        expect(result.current.loading).toBe(true);
    });

    it('returns loading=false and models after successful fetch', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve([
                { id: 'gpt-4', name: 'GPT-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128_000 } } },
                { id: 'claude-3', name: 'Claude 3', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 200_000 } } },
            ]),
        });
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toHaveLength(2);
        expect(result.current.models[0].id).toBe('gpt-4');
        expect(result.current.models[1].id).toBe('claude-3');
    });

    it('fetches GET /api/models', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });
        renderHook(() => useModels());
        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/models')
            );
        });
    });

    it('returns empty models array when API returns empty array', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });

    it('returns empty models on non-ok response', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false });
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });

    it('returns empty models and loading=false when fetch throws', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });

    it('maps capabilities to tokenLimit', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve([
                { id: 'gpt-4o', name: 'GPT-4o', capabilities: { supports: { vision: true, reasoningEffort: false }, limits: { max_context_window_tokens: 128_000 } } },
            ]),
        });
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0]).toMatchObject({ id: 'gpt-4o', tokenLimit: 128_000, name: 'GPT-4o' });
    });

    it('defaults tokenLimit to 0 when capabilities are missing', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve([
                { id: 'custom-model', name: 'Custom' },
            ]),
        });
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0]).toMatchObject({ id: 'custom-model', tokenLimit: 0 });
    });
});
