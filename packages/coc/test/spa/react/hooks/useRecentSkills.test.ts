/**
 * Tests for useRecentSkills — loads and persists recently-used skills.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRecentSkills } from '../../../../src/server/spa/client/react/features/skills/hooks/useRecentSkills';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock as any;

// Mock getApiBase
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
}));

function makePrefsResponse(recentFollowPrompts: any[] = []) {
    return {
        ok: true,
        json: async () => ({ recentFollowPrompts }),
    } as Response;
}

function makePatchResponse() {
    return { ok: true, json: async () => ({}) } as Response;
}

describe('useRecentSkills', () => {
    beforeEach(() => {
        fetchMock.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
        resetCloneRegistryForTests();
    });

    // ── Initial load ──────────────────────────────────────────────

    it('starts with empty items and loaded=false, then loaded=true after fetch', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());
        const { result } = renderHook(() => useRecentSkills('ws1'));

        expect(result.current.loaded).toBe(false);
        expect(result.current.recentItems).toHaveLength(0);

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.recentItems).toHaveLength(0);
    });

    it('loads recent items from server preferences', async () => {
        const saved = [
            { type: 'skill', name: 'impl', description: 'Implement', timestamp: 1000 },
            { type: 'prompt', name: 'my prompt', timestamp: 2000 },
        ];
        fetchMock.mockResolvedValue(makePrefsResponse(saved));
        const { result } = renderHook(() => useRecentSkills('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.recentItems).toHaveLength(2);
        expect(result.current.recentItems[0].name).toBe('impl');
        expect(result.current.recentItems[0].type).toBe('skill');
        expect(result.current.recentItems[1].name).toBe('my prompt');
    });

    it('filters out entries with no name', async () => {
        const saved = [
            { type: 'skill', name: 'impl', timestamp: 1000 },
            { type: 'prompt', timestamp: 2000 }, // missing name — invalid
        ];
        fetchMock.mockResolvedValue(makePrefsResponse(saved));
        const { result } = renderHook(() => useRecentSkills('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.recentItems).toHaveLength(1);
        expect(result.current.recentItems[0].name).toBe('impl');
    });

    it('defaults type to "skill" when absent', async () => {
        const saved = [{ name: 'my-skill', timestamp: 1000 }];
        fetchMock.mockResolvedValue(makePrefsResponse(saved));
        const { result } = renderHook(() => useRecentSkills('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.recentItems[0].type).toBe('skill');
    });

    it('handles fetch error gracefully — loaded becomes true, items stays empty', async () => {
        fetchMock.mockRejectedValue(new Error('network error'));
        const { result } = renderHook(() => useRecentSkills('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.recentItems).toHaveLength(0);
    });

    it('handles non-ok fetch response gracefully', async () => {
        fetchMock.mockResolvedValue({ ok: false } as Response);
        const { result } = renderHook(() => useRecentSkills('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.recentItems).toHaveLength(0);
    });

    // ── URL construction — regression for deduplication refactor ──

    it('uses global preferences endpoint when wsId is undefined', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());
        renderHook(() => useRecentSkills(undefined));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toBe('/preferences');
    });

    it('uses per-workspace preferences endpoint when wsId is provided', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());
        renderHook(() => useRecentSkills('my-repo'));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toContain('/workspaces/my-repo/preferences');
    });

    it('encodes wsId in the URL', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());
        renderHook(() => useRecentSkills('my repo/path'));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent('my repo/path'));
    });

    // ── Remote-clone routing (AC-07) ──────────────────────────────

    it('routes preferences to the remote clone server when wsId is a registered remote workspace', async () => {
        // Regression: recent-skills preferences for a remote clone must hit the
        // clone's own server, not the page origin (which 404s "Workspace not found").
        registerCloneBaseUrls([{ workspaceId: 'remote-ws', baseUrl: 'http://127.0.0.1:9999' }]);
        fetchMock.mockResolvedValue(makePrefsResponse());

        renderHook(() => useRecentSkills('remote-ws'));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const url = String(fetchMock.mock.calls[0][0]);
        expect(url).toContain('http://127.0.0.1:9999');
        expect(url).toContain('/workspaces/remote-ws/preferences');
    });

    it('keeps an unregistered (local) wsId on the page origin — no remote leakage', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());

        renderHook(() => useRecentSkills('local-ws'));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const url = String(fetchMock.mock.calls[0][0]);
        expect(url.startsWith('/workspaces/local-ws/preferences')).toBe(true);
    });

    // ── trackUsage ────────────────────────────────────────────────

    it('trackUsage prepends an entry and PATCHes the same prefsUrl used by the GET', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse())  // initial GET
            .mockResolvedValue(makePatchResponse());      // subsequent PATCHes

        const { result } = renderHook(() => useRecentSkills('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => {
            result.current.trackUsage('impl', { description: 'Implement', prompt: 'do impl', skills: ['impl'], model: 'gpt-4', mode: 'task' });
        });

        expect(result.current.recentItems).toHaveLength(1);
        expect(result.current.recentItems[0].name).toBe('impl');
        expect(result.current.recentItems[0].type).toBe('prompt');

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const [patchUrl, patchOpts] = fetchMock.mock.calls[1];
        // PATCH must use the same URL as the initial GET (both derived from prefsUrl)
        expect(patchUrl).toBe(fetchMock.mock.calls[0][0]);
        expect(patchOpts.method).toBe('PATCH');
        const body = JSON.parse(patchOpts.body);
        expect(body.recentFollowPrompts).toHaveLength(1);
        expect(body.recentFollowPrompts[0].name).toBe('impl');
    });

    it('trackUsage with wsId undefined PATCHes global preferences endpoint', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse())
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useRecentSkills(undefined));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.trackUsage('my-skill'); });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock.mock.calls[1][0]).toBe('/preferences');
    });

    it('trackUsage deduplicates entries by name (moves existing to front)', async () => {
        const saved = [
            { type: 'skill', name: 'impl', timestamp: 1000 },
            { type: 'skill', name: 'code-review', timestamp: 2000 },
        ];
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse(saved))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useRecentSkills('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.trackUsage('impl'); });

        expect(result.current.recentItems).toHaveLength(2);
        expect(result.current.recentItems[0].name).toBe('impl');
        expect(result.current.recentItems[1].name).toBe('code-review');
    });

    it('trackUsage caps recent items at 5', async () => {
        const saved = Array.from({ length: 5 }, (_, i) => ({
            type: 'skill', name: `skill-${i}`, timestamp: i,
        }));
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse(saved))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useRecentSkills('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.trackUsage('new-skill'); });

        expect(result.current.recentItems).toHaveLength(5);
        expect(result.current.recentItems[0].name).toBe('new-skill');
    });

    // ── wsId change ───────────────────────────────────────────────

    it('reloads items when wsId changes', async () => {
        const items1 = [{ type: 'skill', name: 'impl', timestamp: 1000 }];
        const items2 = [{ type: 'skill', name: 'code-review', timestamp: 2000 }];
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse(items1))
            .mockResolvedValueOnce(makePrefsResponse(items2));

        const { result, rerender } = renderHook(
            ({ id }) => useRecentSkills(id),
            { initialProps: { id: 'ws1' } },
        );
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.recentItems[0].name).toBe('impl');

        rerender({ id: 'ws2' });
        await waitFor(() => expect(result.current.recentItems[0]?.name).toBe('code-review'));
    });
});
