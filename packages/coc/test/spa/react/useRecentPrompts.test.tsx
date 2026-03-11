import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRecentSkills } from '../../../src/server/spa/client/react/hooks/useRecentSkills';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

describe('useRecentSkills', () => {
    it('loads recent items from GET /api/preferences', async () => {
        const items = [
            { name: 'review', timestamp: 1000 },
            { name: 'impl', description: 'Implement changes', timestamp: 900 },
        ];
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ recentFollowPrompts: items }),
        });

        const { result } = renderHook(() => useRecentSkills());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
            expect(result.current.recentItems).toEqual([
                { type: 'skill', name: 'review', timestamp: 1000 },
                { type: 'skill', name: 'impl', description: 'Implement changes', timestamp: 900 },
            ]);
        });
    });

    it('defaults to empty array when API fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const { result } = renderHook(() => useRecentSkills());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
            expect(result.current.recentItems).toEqual([]);
        });
    });

    it('defaults to empty array when recentFollowPrompts is not present', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ lastModel: 'gpt-4' }),
        });

        const { result } = renderHook(() => useRecentSkills());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
            expect(result.current.recentItems).toEqual([]);
        });
    });

    it('trackUsage prepends new entry and deduplicates', async () => {
        const existing = [
            { name: 'review', timestamp: 1000 },
            { name: 'impl', timestamp: 900 },
        ];
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ recentFollowPrompts: existing }),
        });
        // PATCH call
        mockFetch.mockResolvedValueOnce({ ok: true });

        const { result } = renderHook(() => useRecentSkills());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
        });

        act(() => {
            result.current.trackUsage('review');
        });

        // 'review' should be moved to front, not duplicated
        expect(result.current.recentItems.length).toBe(2);
        expect(result.current.recentItems[0].name).toBe('review');
        expect(result.current.recentItems[0].timestamp).toBeGreaterThan(1000);
        expect(result.current.recentItems[1].name).toBe('impl');
    });

    it('trackUsage adds new entry to front', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ recentFollowPrompts: [] }),
        });
        mockFetch.mockResolvedValueOnce({ ok: true });

        const { result } = renderHook(() => useRecentSkills());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
        });

        act(() => {
            result.current.trackUsage('draft', 'Draft a spec');
        });

        expect(result.current.recentItems.length).toBe(1);
        expect(result.current.recentItems[0].name).toBe('draft');
        expect(result.current.recentItems[0].description).toBe('Draft a spec');
    });

    it('trackUsage caps at 10 items', async () => {
        const items = Array.from({ length: 10 }, (_, i) => ({
            name: `skill-${i}`,
            timestamp: 1000 - i,
        }));
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ recentFollowPrompts: items }),
        });
        mockFetch.mockResolvedValueOnce({ ok: true });

        const { result } = renderHook(() => useRecentSkills());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
        });

        act(() => {
            result.current.trackUsage('new-skill');
        });

        expect(result.current.recentItems.length).toBe(10);
        expect(result.current.recentItems[0].name).toBe('new-skill');
        // The last old item should be evicted
        expect(result.current.recentItems.map(i => i.name)).not.toContain('skill-9');
    });

    it('trackUsage fires PATCH /api/preferences', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ recentFollowPrompts: [] }),
        });
        mockFetch.mockResolvedValueOnce({ ok: true });

        const { result } = renderHook(() => useRecentSkills());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
        });

        act(() => {
            result.current.trackUsage('review');
        });

        await waitFor(() => {
            const patchCalls = mockFetch.mock.calls.filter(
                ([_, opts]: [string, any]) => opts?.method === 'PATCH'
            );
            expect(patchCalls.length).toBe(1);
            const body = JSON.parse(patchCalls[0][1].body);
            expect(body.recentFollowPrompts).toBeDefined();
            expect(body.recentFollowPrompts[0].name).toBe('review');
        });
    });

    it('trackUsage does not include description when not provided', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ recentFollowPrompts: [] }),
        });
        mockFetch.mockResolvedValueOnce({ ok: true });

        const { result } = renderHook(() => useRecentSkills());

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
        });

        act(() => {
            result.current.trackUsage('impl');
        });

        expect(result.current.recentItems[0].description).toBeUndefined();
    });
});
