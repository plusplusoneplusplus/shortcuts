/**
 * useGroupFolders — the workspace-scoped `"<type>:<groupId>" -> folderId` read
 * plus the group-filing write.
 *
 * The map is fetched from the server that owns the workspace (via the clone
 * registry), patched optimistically, and reconciled by `refresh()`. A failed
 * fetch must never blank the map; a failed write must roll the group back to
 * the folder it came from; and an override landed while a fetch is in flight
 * must survive that fetch's (stale) resolution.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { listGroupFolders, setGroupFolder, clientHolder } = vi.hoisted(() => {
    const listGroupFolders = vi.fn(async () => ({ groups: {} as Record<string, string>, assignments: [] as any[] }));
    const setGroupFolder = vi.fn(async () => ({}));
    return {
        listGroupFolders,
        setGroupFolder,
        clientHolder: { client: { processes: { listGroupFolders, setGroupFolder } } as any },
    };
});

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => clientHolder.client,
    getCocClientFor: () => clientHolder.client,
    toSpaCocRequestOptions: (options?: unknown) => options ?? {},
    translateSpaCocClientError: (error: unknown) => { throw error; },
}));

import { useGroupFolders } from '../../../../src/server/spa/client/react/features/chat/hooks/useGroupFolders';

const WS = 'ws-test';

beforeEach(() => {
    listGroupFolders.mockReset();
    listGroupFolders.mockResolvedValue({ groups: {}, assignments: [] });
    setGroupFolder.mockReset();
    setGroupFolder.mockResolvedValue({});
    clientHolder.client = { processes: { listGroupFolders, setGroupFolder } };
});

describe('useGroupFolders', () => {
    it('seeds the map from a workspace-scoped group-folders fetch', async () => {
        listGroupFolders.mockResolvedValue({
            groups: { 'ralph-session:s1': 'f1', 'for-each-run:r9': 'f2' },
            assignments: [],
        } as any);

        const { result } = renderHook(() => useGroupFolders(WS, true));

        await waitFor(() => expect(result.current.groupFolderMap.size).toBe(2));
        expect(result.current.groupFolderMap.get('ralph-session:s1')).toBe('f1');
        expect(result.current.groupFolderMap.get('for-each-run:r9')).toBe('f2');
        expect(listGroupFolders).toHaveBeenCalledWith(WS);
    });

    it('stays inert with the flag off or no workspace', async () => {
        const { result } = renderHook(() => useGroupFolders(WS, false));
        await act(async () => {});
        expect(listGroupFolders).not.toHaveBeenCalled();
        expect(result.current.groupFolderMap.size).toBe(0);

        renderHook(() => useGroupFolders(undefined, true));
        await act(async () => {});
        expect(listGroupFolders).not.toHaveBeenCalled();
    });

    it('keeps the last good map when a fetch fails', async () => {
        listGroupFolders.mockResolvedValue({ groups: { 'ralph-session:s1': 'f1' }, assignments: [] } as any);
        const { result } = renderHook(() => useGroupFolders(WS, true));
        await waitFor(() => expect(result.current.groupFolderMap.size).toBe(1));

        listGroupFolders.mockRejectedValue(new Error('offline'));
        act(() => { result.current.refresh(); });
        await act(async () => {});

        expect(result.current.groupFolderMap.get('ralph-session:s1')).toBe('f1');
    });

    it('applies an optimistic move and PATCHes the group, not its children', async () => {
        const { result } = renderHook(() => useGroupFolders(WS, true));
        await act(async () => {});

        await act(async () => {
            await result.current.moveGroupToFolder('ralph-session', 's1', 'f1');
        });

        expect(setGroupFolder).toHaveBeenCalledTimes(1);
        expect(setGroupFolder).toHaveBeenCalledWith(WS, 'ralph-session', 's1', 'f1');
        expect(result.current.groupFolderMap.get('ralph-session:s1')).toBe('f1');
    });

    it('rolls the group back to its previous folder when the write fails', async () => {
        listGroupFolders.mockResolvedValue({ groups: { 'ralph-session:s1': 'f1' }, assignments: [] } as any);
        const onError = vi.fn();
        const { result } = renderHook(() => useGroupFolders(WS, true, { onError }));
        await waitFor(() => expect(result.current.groupFolderMap.get('ralph-session:s1')).toBe('f1'));

        setGroupFolder.mockRejectedValue(new Error('nope'));
        await act(async () => {
            await result.current.moveGroupToFolder('ralph-session', 's1', 'f2');
        });

        expect(result.current.groupFolderMap.get('ralph-session:s1')).toBe('f1');
        expect(onError).toHaveBeenCalledWith('Could not move to folder');
    });

    it('unfiles with null and rolls back to the old folder on failure', async () => {
        listGroupFolders.mockResolvedValue({ groups: { 'spawned-tree:p1': 'f1' }, assignments: [] } as any);
        const onError = vi.fn();
        const { result } = renderHook(() => useGroupFolders(WS, true, { onError }));
        await waitFor(() => expect(result.current.groupFolderMap.get('spawned-tree:p1')).toBe('f1'));

        await act(async () => {
            await result.current.moveGroupToFolder('spawned-tree', 'p1', null);
        });
        expect(setGroupFolder).toHaveBeenCalledWith(WS, 'spawned-tree', 'p1', null);
        expect(result.current.groupFolderMap.has('spawned-tree:p1')).toBe(false);

        setGroupFolder.mockRejectedValue(new Error('nope'));
        await act(async () => {
            await result.current.moveGroupToFolder('spawned-tree', 'p1', 'f3');
        });
        expect(result.current.groupFolderMap.has('spawned-tree:p1')).toBe(false);
        expect(onError).toHaveBeenCalledWith('Could not move to folder');
    });

    it('issues no request when the group is already in the target folder', async () => {
        listGroupFolders.mockResolvedValue({ groups: { 'map-reduce-run:r1': 'f1' }, assignments: [] } as any);
        const { result } = renderHook(() => useGroupFolders(WS, true));
        await waitFor(() => expect(result.current.groupFolderMap.get('map-reduce-run:r1')).toBe('f1'));

        await act(async () => {
            await result.current.moveGroupToFolder('map-reduce-run', 'r1', 'f1');
        });
        expect(setGroupFolder).not.toHaveBeenCalled();
    });

    it('keeps an override written while a fetch was in flight', async () => {
        let resolveFetch: (value: any) => void = () => {};
        listGroupFolders.mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));
        const { result } = renderHook(() => useGroupFolders(WS, true));

        act(() => { result.current.applyOverride('ralph-session', 's2', 'f5'); });
        await act(async () => {
            resolveFetch({ groups: { 'ralph-session:s1': 'f1' }, assignments: [] });
        });

        expect(result.current.groupFolderMap.get('ralph-session:s1')).toBe('f1');
        expect(result.current.groupFolderMap.get('ralph-session:s2')).toBe('f5');
    });
});
