/**
 * Tests for useChatPreferences — persists pinned and archived chat IDs to the server
 * via a single GET /preferences on mount.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatPreferences } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatPreferences';

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock as any;

// Mock getApiBase to return empty string
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
}));

function makePrefsResponse(
    pinnedChats: Record<string, string[]> = {},
    archivedChats: Record<string, string[]> = {}
) {
    return {
        ok: true,
        json: async () => ({ pinnedChats, archivedChats }),
    } as Response;
}

function makePatchResponse(merged: any = {}) {
    return {
        ok: true,
        json: async () => merged,
    } as Response;
}

describe('useChatPreferences', () => {
    beforeEach(() => {
        fetchMock.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // ---- pinned tests ----

    it('starts with empty pinnedChatIds and loaded=false, then loaded=true after fetch', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());
        const { result } = renderHook(() => useChatPreferences('ws1'));

        expect(result.current.loaded).toBe(false);
        expect(result.current.pinnedChatIds.size).toBe(0);

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.pinnedChatIds.size).toBe(0);
    });

    it('loads pinned chats from server preferences', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse({ ws1: ['task-a', 'task-b'] }));
        const { result } = renderHook(() => useChatPreferences('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.pinnedChatIds.has('task-a')).toBe(true);
        expect(result.current.pinnedChatIds.has('task-b')).toBe(true);
        expect(result.current.pinnedChatIds.size).toBe(2);
    });

    it('ignores pinned chats from a different workspace key', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse({ 'other-ws': ['task-a'] }));
        const { result } = renderHook(() => useChatPreferences('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.pinnedChatIds.size).toBe(0);
    });

    it('pinChat adds a task ID and PATCHes only pinnedChats', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse()) // initial GET
            .mockResolvedValue(makePatchResponse()); // subsequent PATCHes

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.pinChat('task-x'); });
        expect(result.current.pinnedChatIds.has('task-x')).toBe(true);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const [patchUrl, patchOpts] = fetchMock.mock.calls[1];
        expect(patchUrl).toContain('/workspaces/ws1/preferences');
        expect(patchOpts.method).toBe('PATCH');
        const body = JSON.parse(patchOpts.body);
        expect(body.pinnedChats).toEqual({ ws1: ['task-x'] });
        expect(body.archivedChats).toBeUndefined();
    });

    it('unpinChat removes a task ID and PATCHes the server', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-a', 'task-b'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
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

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unpinChat('task-a'); });
        expect(result.current.pinnedChatIds.size).toBe(0);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.pinnedChats).toEqual({});
    });

    it('pinChat is a no-op for already-pinned task', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-a'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.pinChat('task-a'); }); // already pinned
        expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET
    });

    it('unpinChat is a no-op for non-pinned task', async () => {
        fetchMock.mockResolvedValueOnce(makePrefsResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unpinChat('task-nonexistent'); });
        expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET
    });

    it('newest pinned task appears first in the set', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-b'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.pinChat('task-a'); }); // newer pin

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.pinnedChats.ws1[0]).toBe('task-a');
        expect(body.pinnedChats.ws1[1]).toBe('task-b');
    });

    it('is loaded immediately with empty pinnedChatIds when no workspaceId', async () => {
        const { result } = renderHook(() => useChatPreferences(''));
        expect(result.current.loaded).toBe(true);
        expect(result.current.pinnedChatIds.size).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('resets pinnedChatIds when workspaceId changes', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-a'] }))
            .mockResolvedValueOnce(makePrefsResponse({ ws2: ['task-b'] }));

        const { result, rerender } = renderHook(
            ({ id }) => useChatPreferences(id),
            { initialProps: { id: 'ws1' } }
        );
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.pinnedChatIds.has('task-a')).toBe(true);

        rerender({ id: 'ws2' });
        await waitFor(() => expect(result.current.pinnedChatIds.has('task-b')).toBe(true));
        expect(result.current.pinnedChatIds.has('task-a')).toBe(false);
    });

    // ---- archived tests ----

    it('starts with empty archivedChatIds and loaded=false, then loaded=true after fetch', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());
        const { result } = renderHook(() => useChatPreferences('ws1'));

        expect(result.current.loaded).toBe(false);
        expect(result.current.archivedChatIds.size).toBe(0);

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.archivedChatIds.size).toBe(0);
    });

    it('loads archived chats from server preferences', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse({}, { ws1: ['task-a', 'task-b'] }));
        const { result } = renderHook(() => useChatPreferences('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.archivedChatIds.has('task-a')).toBe(true);
        expect(result.current.archivedChatIds.has('task-b')).toBe(true);
        expect(result.current.archivedChatIds.size).toBe(2);
    });

    it('ignores archived chats from a different workspace key', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse({}, { 'other-ws': ['task-a'] }));
        const { result } = renderHook(() => useChatPreferences('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.archivedChatIds.size).toBe(0);
    });

    it('archiveChat adds a task ID and PATCHes only archivedChats', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse()) // initial GET
            .mockResolvedValue(makePatchResponse()); // subsequent PATCHes

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.archiveChat('task-x'); });
        expect(result.current.archivedChatIds.has('task-x')).toBe(true);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const [patchUrl, patchOpts] = fetchMock.mock.calls[1];
        expect(patchUrl).toContain('/workspaces/ws1/preferences');
        expect(patchOpts.method).toBe('PATCH');
        const body = JSON.parse(patchOpts.body);
        expect(body.archivedChats).toEqual({ ws1: ['task-x'] });
        expect(body.pinnedChats).toBeUndefined();
    });

    it('unarchiveChat removes a task ID and PATCHes the server', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({}, { ws1: ['task-a', 'task-b'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.archivedChatIds.size).toBe(2);

        act(() => { result.current.unarchiveChat('task-a'); });
        expect(result.current.archivedChatIds.has('task-a')).toBe(false);
        expect(result.current.archivedChatIds.has('task-b')).toBe(true);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.archivedChats).toEqual({ ws1: ['task-b'] });
    });

    it('sends empty archivedChats object when last archive is removed', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({}, { ws1: ['task-a'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unarchiveChat('task-a'); });
        expect(result.current.archivedChatIds.size).toBe(0);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.archivedChats).toEqual({});
    });

    it('archiveChat is a no-op for already-archived task', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({}, { ws1: ['task-a'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.archiveChat('task-a'); }); // already archived
        expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET
    });

    it('unarchiveChat is a no-op for non-archived task', async () => {
        fetchMock.mockResolvedValueOnce(makePrefsResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unarchiveChat('task-nonexistent'); });
        expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET
    });

    it('is loaded immediately with empty archivedChatIds when no workspaceId', async () => {
        const { result } = renderHook(() => useChatPreferences(''));
        expect(result.current.loaded).toBe(true);
        expect(result.current.archivedChatIds.size).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('resets archivedChatIds when workspaceId changes', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({}, { ws1: ['task-a'] }))
            .mockResolvedValueOnce(makePrefsResponse({}, { ws2: ['task-b'] }));

        const { result, rerender } = renderHook(
            ({ id }) => useChatPreferences(id),
            { initialProps: { id: 'ws1' } }
        );
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.archivedChatIds.has('task-a')).toBe(true);

        rerender({ id: 'ws2' });
        await waitFor(() => expect(result.current.archivedChatIds.has('task-b')).toBe(true));
        expect(result.current.archivedChatIds.has('task-a')).toBe(false);
    });

    // ---- batch archive tests ----

    it('archiveChats archives multiple IDs with a single PATCH', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse()) // initial GET
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.archiveChats(['task-a', 'task-b', 'task-c']); });
        expect(result.current.archivedChatIds.has('task-a')).toBe(true);
        expect(result.current.archivedChatIds.has('task-b')).toBe(true);
        expect(result.current.archivedChatIds.has('task-c')).toBe(true);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.archivedChats).toEqual({ ws1: ['task-a', 'task-b', 'task-c'] });
    });

    it('archiveChats skips already-archived IDs and sends one PATCH', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({}, { ws1: ['task-a'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.archiveChats(['task-a', 'task-b']); });
        expect(result.current.archivedChatIds.size).toBe(2);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.archivedChats.ws1).toEqual(['task-b', 'task-a']);
    });

    it('archiveChats is a no-op when all IDs are already archived', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({}, { ws1: ['task-a', 'task-b'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.archiveChats(['task-a', 'task-b']); });
        expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET
    });

    it('unarchiveChats removes multiple IDs with a single PATCH', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({}, { ws1: ['task-a', 'task-b', 'task-c'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unarchiveChats(['task-a', 'task-c']); });
        expect(result.current.archivedChatIds.has('task-a')).toBe(false);
        expect(result.current.archivedChatIds.has('task-b')).toBe(true);
        expect(result.current.archivedChatIds.has('task-c')).toBe(false);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.archivedChats).toEqual({ ws1: ['task-b'] });
    });

    it('unarchiveChats is a no-op when none of the IDs are archived', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({}, { ws1: ['task-a'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unarchiveChats(['task-x', 'task-y']); });
        expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET
    });

    it('unarchiveChats sends empty archivedChats when all are removed', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({}, { ws1: ['task-a', 'task-b'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unarchiveChats(['task-a', 'task-b']); });
        expect(result.current.archivedChatIds.size).toBe(0);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.archivedChats).toEqual({});
    });

    // ---- single fetch test ----

    it('issues only one GET on mount even with both pinnedChats and archivedChats', async () => {
        fetchMock.mockResolvedValue(
            makePrefsResponse({ ws1: ['p1'] }, { ws1: ['a1'] })
        );
        const { result } = renderHook(() => useChatPreferences('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        // Only one GET was issued
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.current.pinnedChatIds.has('p1')).toBe(true);
        expect(result.current.archivedChatIds.has('a1')).toBe(true);
    });
});
