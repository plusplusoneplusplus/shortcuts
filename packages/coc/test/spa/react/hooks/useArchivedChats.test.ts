/**
 * Tests for useArchivedChats — persists archived chat IDs to the server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useArchivedChats } from '../../../../src/server/spa/client/react/hooks/useArchivedChats';

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock as any;

// Mock getApiBase to return empty string
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

function makePrefsResponse(archivedChats: Record<string, string[]> = {}) {
    return {
        ok: true,
        json: async () => ({ archivedChats }),
    } as Response;
}

function makePatchResponse(merged: any = {}) {
    return {
        ok: true,
        json: async () => merged,
    } as Response;
}

describe('useArchivedChats', () => {
    beforeEach(() => {
        fetchMock.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('starts with empty archivedChatIds and loaded=false, then loaded=true after fetch', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());
        const { result } = renderHook(() => useArchivedChats('ws1'));

        expect(result.current.loaded).toBe(false);
        expect(result.current.archivedChatIds.size).toBe(0);

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.archivedChatIds.size).toBe(0);
    });

    it('loads archived chats from server preferences', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse({ ws1: ['task-a', 'task-b'] }));
        const { result } = renderHook(() => useArchivedChats('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.archivedChatIds.has('task-a')).toBe(true);
        expect(result.current.archivedChatIds.has('task-b')).toBe(true);
        expect(result.current.archivedChatIds.size).toBe(2);
    });

    it('ignores archived chats from a different workspace key', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse({ 'other-ws': ['task-a'] }));
        const { result } = renderHook(() => useArchivedChats('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.archivedChatIds.size).toBe(0);
    });

    it('archiveChat adds a task ID and PATCHes the server', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse()) // initial GET
            .mockResolvedValue(makePatchResponse()); // subsequent PATCHes

        const { result } = renderHook(() => useArchivedChats('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.archiveChat('task-x'); });
        expect(result.current.archivedChatIds.has('task-x')).toBe(true);

        // Should PATCH to server
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const [patchUrl, patchOpts] = fetchMock.mock.calls[1];
        expect(patchUrl).toContain('/workspaces/ws1/preferences');
        expect(patchOpts.method).toBe('PATCH');
        const body = JSON.parse(patchOpts.body);
        expect(body.archivedChats).toEqual({ ws1: ['task-x'] });
    });

    it('unarchiveChat removes a task ID and PATCHes the server', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-a', 'task-b'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useArchivedChats('ws1'));
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
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-a'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useArchivedChats('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unarchiveChat('task-a'); });
        expect(result.current.archivedChatIds.size).toBe(0);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.archivedChats).toEqual({});
    });

    it('archiveChat is a no-op for already-archived task', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-a'] }))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useArchivedChats('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.archiveChat('task-a'); }); // already archived
        expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET
    });

    it('unarchiveChat is a no-op for non-archived task', async () => {
        fetchMock.mockResolvedValueOnce(makePrefsResponse());

        const { result } = renderHook(() => useArchivedChats('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unarchiveChat('task-nonexistent'); });
        expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET
    });

    it('is loaded immediately with empty state when no workspaceId', async () => {
        const { result } = renderHook(() => useArchivedChats(''));
        expect(result.current.loaded).toBe(true);
        expect(result.current.archivedChatIds.size).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('resets when workspaceId changes', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse({ ws1: ['task-a'] }))
            .mockResolvedValueOnce(makePrefsResponse({ ws2: ['task-b'] }));

        const { result, rerender } = renderHook(
            ({ id }) => useArchivedChats(id),
            { initialProps: { id: 'ws1' } }
        );
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.archivedChatIds.has('task-a')).toBe(true);

        rerender({ id: 'ws2' });
        await waitFor(() => expect(result.current.archivedChatIds.has('task-b')).toBe(true));
        expect(result.current.archivedChatIds.has('task-a')).toBe(false);
    });
});
