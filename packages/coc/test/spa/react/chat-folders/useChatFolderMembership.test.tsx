/**
 * useChatFolderMembership — the workspace-scoped `processId -> folderId` read.
 *
 * Membership is fetched from the server that owns the workspace (via the clone
 * registry), seeded from `processes.summaries`, patched optimistically through
 * `applyOverride`, and reconciled by `refresh()`. A failed fetch must never
 * blank the map, and an override landed while a fetch is in flight must survive
 * that fetch's (stale) resolution.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { summaries, clientHolder } = vi.hoisted(() => {
    const summaries = vi.fn(async () => ({ summaries: [] as any[] }));
    return { summaries, clientHolder: { client: { processes: { summaries } } as any } };
});

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => clientHolder.client,
    getCocClientFor: () => clientHolder.client,
    toSpaCocRequestOptions: (options?: unknown) => options ?? {},
    translateSpaCocClientError: (error: unknown) => { throw error; },
}));

import { useChatFolderMembership } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatFolderMembership';

const WS = 'ws-test';

beforeEach(() => {
    summaries.mockReset();
    summaries.mockResolvedValue({ summaries: [] });
    clientHolder.client = { processes: { summaries } };
});

describe('useChatFolderMembership', () => {
    it('seeds the map from a workspace-scoped summaries fetch', async () => {
        summaries.mockResolvedValue({ summaries: [
            { id: 'p1', folderId: 'f1' },
            { id: 'p2', folderId: null },
            { id: 'p3', folderId: 'f2' },
        ] });

        const { result } = renderHook(() => useChatFolderMembership(WS, true));

        await waitFor(() => expect(result.current.folderIdByProcess.size).toBe(2));
        expect(result.current.folderIdByProcess.get('p1')).toBe('f1');
        expect(result.current.folderIdByProcess.get('p3')).toBe('f2');
        expect(summaries).toHaveBeenCalledWith({ workspace: WS, limit: 5000 });
    });

    it('is inert when disabled or without a workspace', async () => {
        const { result: disabled } = renderHook(() => useChatFolderMembership(WS, false));
        const { result: noWs } = renderHook(() => useChatFolderMembership(undefined, true));

        await act(async () => {});
        expect(disabled.current.folderIdByProcess.size).toBe(0);
        expect(noWs.current.folderIdByProcess.size).toBe(0);
        expect(summaries).not.toHaveBeenCalled();
    });

    it('shows an optimistic override immediately and reconciles it on refresh', async () => {
        summaries.mockResolvedValue({ summaries: [{ id: 'p1', folderId: 'f1' }] });
        const { result } = renderHook(() => useChatFolderMembership(WS, true));
        await waitFor(() => expect(result.current.folderIdByProcess.get('p1')).toBe('f1'));

        act(() => { result.current.applyOverride(['p1', 'p2'], 'f2'); });
        expect(result.current.folderIdByProcess.get('p1')).toBe('f2');
        expect(result.current.folderIdByProcess.get('p2')).toBe('f2');

        // The server now agrees with the write; refresh clears the overrides.
        summaries.mockResolvedValue({ summaries: [
            { id: 'p1', folderId: 'f2' },
            { id: 'p2', folderId: 'f2' },
        ] });
        act(() => { result.current.refresh(); });
        await waitFor(() => expect(summaries).toHaveBeenCalledTimes(2));
        expect(result.current.folderIdByProcess.get('p1')).toBe('f2');
        expect(result.current.folderIdByProcess.get('p2')).toBe('f2');
    });

    it('rolls an override back when the refresh disagrees (failed write)', async () => {
        summaries.mockResolvedValue({ summaries: [{ id: 'p1', folderId: 'f1' }] });
        const { result } = renderHook(() => useChatFolderMembership(WS, true));
        await waitFor(() => expect(result.current.folderIdByProcess.get('p1')).toBe('f1'));

        act(() => { result.current.applyOverride(['p1'], 'f2'); });
        expect(result.current.folderIdByProcess.get('p1')).toBe('f2');

        act(() => { result.current.refresh(); });
        await waitFor(() => expect(summaries).toHaveBeenCalledTimes(2));
        // Server still says f1 — the optimistic move is rolled back.
        expect(result.current.folderIdByProcess.get('p1')).toBe('f1');
    });

    it('a null override unfiles a row the server still has filed', async () => {
        summaries.mockResolvedValue({ summaries: [{ id: 'p1', folderId: 'f1' }] });
        const { result } = renderHook(() => useChatFolderMembership(WS, true));
        await waitFor(() => expect(result.current.folderIdByProcess.get('p1')).toBe('f1'));

        act(() => { result.current.applyOverride(['p1'], null); });
        expect(result.current.folderIdByProcess.has('p1')).toBe(false);
    });

    it('keeps the prior map when a fetch fails', async () => {
        summaries.mockResolvedValue({ summaries: [{ id: 'p1', folderId: 'f1' }] });
        const { result } = renderHook(() => useChatFolderMembership(WS, true));
        await waitFor(() => expect(result.current.folderIdByProcess.get('p1')).toBe('f1'));

        summaries.mockRejectedValue(new Error('boom'));
        act(() => { result.current.refresh(); });
        await waitFor(() => expect(summaries).toHaveBeenCalledTimes(2));
        expect(result.current.folderIdByProcess.get('p1')).toBe('f1');
    });

    it('an override landed mid-flight survives the stale fetch resolution', async () => {
        let resolveFetch!: (value: { summaries: any[] }) => void;
        summaries.mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));

        const { result } = renderHook(() => useChatFolderMembership(WS, true));
        // The drop lands while the summaries request is still in the air.
        act(() => { result.current.applyOverride(['p1'], 'f2'); });

        await act(async () => { resolveFetch({ summaries: [{ id: 'p1', folderId: 'f1' }] }); });
        // The response predates the write; the optimistic move must not revert.
        expect(result.current.folderIdByProcess.get('p1')).toBe('f2');
    });

    it('degrades to an empty map when the client has no summaries API', async () => {
        clientHolder.client = { processes: {} };
        const { result } = renderHook(() => useChatFolderMembership(WS, true));

        await act(async () => {});
        expect(result.current.folderIdByProcess.size).toBe(0);
        expect(summaries).not.toHaveBeenCalled();
    });
});
