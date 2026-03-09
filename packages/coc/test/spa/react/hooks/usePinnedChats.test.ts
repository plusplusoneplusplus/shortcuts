/**
 * Tests for usePinnedChats — persists pinned chat IDs to the server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePinnedChats } from '../../../../src/server/spa/client/react/hooks/usePinnedChats';

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock as any;

// Mock getApiBase to return empty string
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

function makePrefsResponse(pinnedChats: Record<string, string[]> = {}) {
    return {
        ok: true,
        json: async () => ({ pinnedChats }),
    } as Response;
}

function makePatchResponse(merged: any = {}) {
    return {
        ok: true,
        json: async () => merged,
    } as Response;
}

describe('usePinnedChats', () => {
    beforeEach(() => {
        fetchMock.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('starts with empty pinnedChatIds and loaded=false, then loaded=true after fetch', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());
        const { result } = renderHook(() => usePinnedChats('ws1'));

        expect(result.current.loaded).toBe(false);
        expect(result.current.pinnedChatIds.size).toBe(0);

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.pinnedChatIds.size).toBe(0);
    });

    it('loads pinned chats from server preferences', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse({ ws1: ['task-a', 'task-b'] }));
        const { result } = renderHook(() => usePinnedChats('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.pinnedChatIds.has('task-a')).toBe(true);
        expect(result.current.pinnedChatIds.has('task-b')).toBe(true);
        expect(result.current.pinnedChatIds.size).toBe(2);
    });

    it('ignores pinned chats from a different workspace key', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse({ 'other-ws': ['task-a'] }));
        const { result } = renderHook(() => usePinnedChats('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.pinnedChatIds.size).toBe(0);
    });

    it('pinChat adds a task ID and PATCHes the server', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse()) // initial GET
            .mockResolvedValue(makePatchResponse()); // subsequent PATCHes

        const { result } = renderHook(() => usePinnedChats('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.pinChat('task-x'); });
        expect(result.current.pinnedChatIds.has('task-x')).toBe(true);

        // Should PATCH to server
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const [patchUrl, patchOpts] = fetchMock.mock.calls[1];
        expect(patchUrl).toContain('/workspaces/ws1/preferences');
        expect(patchOpts.method).toBe('PATCH');
        const body = JSON.parse(patchOpts.body);
        expect(body.pinnedChats).toEqual({ ws1: ['task-x'] });
    });

    it('unpinChat removes a task ID and PATCHes the server', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-a', 'task-b'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => usePinnedChats('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.pinnedChatIds.size).toBe(2);

        act(() => { result.current.unpinChat('task-a'); });
        expect(result.current.pinnedChatIds.has('task-a')).toBe(false);
        expect(result.current.pinnedChatIds.has('task-b')).toBe(true);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.pinnedChats).toEqual({ ws1: ['task-b'] });
    });

    it('sends empty pinnedChats object when last pin is removed', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-a'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => usePinnedChats('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unpinChat('task-a'); });
        expect(result.current.pinnedChatIds.size).toBe(0);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        // Empty object triggers server-side clear of pinnedChats
        expect(body.pinnedChats).toEqual({});
    });

    it('pinChat is a no-op for already-pinned task', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-a'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => usePinnedChats('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.pinChat('task-a'); }); // already pinned
        // Should not call PATCH
        expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET
    });

    it('unpinChat is a no-op for non-pinned task', async () => {
        fetchMock.mockResolvedValueOnce(makePrefsResponse());

        const { result } = renderHook(() => usePinnedChats('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unpinChat('task-nonexistent'); });
        expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET
    });

    it('newest pinned task appears first in the set', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-b'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => usePinnedChats('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.pinChat('task-a'); }); // newer pin

        // task-a added first in the array
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.pinnedChats.ws1[0]).toBe('task-a');
        expect(body.pinnedChats.ws1[1]).toBe('task-b');
    });

    it('is loaded immediately with empty state when no workspaceId', async () => {
        const { result } = renderHook(() => usePinnedChats(''));
        expect(result.current.loaded).toBe(true);
        expect(result.current.pinnedChatIds.size).toBe(0);
        // Should not call fetch
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('resets when workspaceId changes', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-a'] }))
            .mockResolvedValueOnce(makePrefsResponse({ ws2: ['task-b'] }));

        const { result, rerender } = renderHook(
            ({ id }) => usePinnedChats(id),
            { initialProps: { id: 'ws1' } }
        );
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.pinnedChatIds.has('task-a')).toBe(true);

        rerender({ id: 'ws2' });
        await waitFor(() => expect(result.current.pinnedChatIds.has('task-b')).toBe(true));
        expect(result.current.pinnedChatIds.has('task-a')).toBe(false);
    });
});
