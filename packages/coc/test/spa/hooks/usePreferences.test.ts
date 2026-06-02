/**
 * Tests for usePreferences hook — load, defaults, optimistic update, PATCH.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePreferences } from '../../../src/server/spa/client/react/hooks/preferences/usePreferences';

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

describe('usePreferences', () => {
    it('returns loaded=true immediately when no repoId provided', () => {
        const { result } = renderHook(() => usePreferences());
        expect(result.current.loaded).toBe(true);
    });

    it('returns empty defaults when no repoId provided', () => {
        const { result } = renderHook(() => usePreferences());
        expect(result.current.models.task).toBe('');
        expect(result.current.models.ask).toBe('');
        expect(result.current.depth).toBe('');
    });

    it('fetches GET /api/workspaces/:id/preferences on mount with repoId', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
        renderHook(() => usePreferences('repo-1'));
        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/workspaces/repo-1/preferences'),
                expect.any(Object),
            );
        });
    });

    it('loads active lastModels from server response and ignores legacy plan', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ lastModels: { task: 'gpt-4', ask: 'claude-3', plan: 'gemini' } }),
        });
        const { result } = renderHook(() => usePreferences('repo-1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.models.task).toBe('gpt-4');
        expect(result.current.models.ask).toBe('claude-3');
        expect(result.current.models).not.toHaveProperty('plan');
    });

    it('backward-compat: uses lastModel for all modes when lastModels is absent', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ lastModel: 'gpt-3.5' }),
        });
        const { result } = renderHook(() => usePreferences('repo-1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.models.task).toBe('gpt-3.5');
        expect(result.current.models.ask).toBe('gpt-3.5');
        expect(result.current.model).toBe('gpt-3.5');
    });

    it('returns empty models when API returns empty object', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
        const { result } = renderHook(() => usePreferences('repo-1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.models.task).toBe('');
    });

    it('sets loaded=true even when API returns non-ok', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false });
        const { result } = renderHook(() => usePreferences('repo-1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
    });

    it('sets loaded=true even when fetch throws', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        const { result } = renderHook(() => usePreferences('repo-1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
    });

    it('setModel applies optimistic update immediately', async () => {
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        const { result } = renderHook(() => usePreferences('repo-1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => { result.current.setModel('task', 'new-model'); });
        expect(result.current.models.task).toBe('new-model');
    });

    it('setModel sends PATCH to server', async () => {
        mockFetch
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) // GET
            .mockResolvedValueOnce({ ok: true }); // PATCH
        const { result } = renderHook(() => usePreferences('repo-1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => { result.current.setModel('ask', 'new-model'); });
        await waitFor(() => {
            const patchCall = mockFetch.mock.calls.find(c => c[1]?.method === 'PATCH');
            expect(patchCall).toBeDefined();
            const body = JSON.parse(patchCall![1].body);
            expect(body.lastModels.ask).toBe('new-model');
        });
    });

    it('setDepth applies optimistic update immediately', async () => {
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        const { result } = renderHook(() => usePreferences('repo-1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => { result.current.setDepth('deep'); });
        expect(result.current.depth).toBe('deep');
    });

    it('loads lastDepth and lastEffort from server', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ lastDepth: 'normal', lastEffort: 'high' }),
        });
        const { result } = renderHook(() => usePreferences('repo-1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.depth).toBe('normal');
        expect(result.current.effort).toBe('high');
    });
});
