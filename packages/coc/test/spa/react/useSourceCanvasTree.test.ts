/**
 * Tests for useSourceCanvasTree — the lazy expandable-tree state machine for the
 * docked source-canvas folder explorer. Mocks the app workspaces and the
 * workspace-routed `explorer.tree` API to cover the root load
 * (loading→success/empty/truncated/error, no-workspace, null ref), path
 * resolution (workspace-relative + relative), remote-workspace routing through
 * the clone-routed client, and lazy per-folder expansion: toggling a folder
 * fetches its children once, collapsing keeps the cache, and a per-folder fetch
 * failure surfaces in `errorPaths` without tearing down the root.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

type TestWorkspace = {
    id: string;
    rootPath?: string;
    baseUrl?: string;
    remote?: Record<string, unknown>;
};

const { treeMock, remoteTreeMock, getSpaCocClientMock, getCocClientForMock, workspacesRef, reposRef } = vi.hoisted(() => ({
    treeMock: vi.fn(),
    remoteTreeMock: vi.fn(),
    getSpaCocClientMock: vi.fn(),
    getCocClientForMock: vi.fn(),
    workspacesRef: { current: [] as TestWorkspace[] },
    reposRef: {
        current: null as null | { repos: Array<{ workspace: TestWorkspace }> },
    },
}));

vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: workspacesRef.current }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => reposRef.current,
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: getSpaCocClientMock,
    getCocClientFor: getCocClientForMock,
    toSpaCocRequestOptions: (options?: RequestInit) => options ?? {},
    translateSpaCocClientError: (error: unknown) => { throw error; },
    getSpaCocClientErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import { useSourceCanvasTree } from '../../../src/server/spa/client/react/features/chat/source-canvas/useSourceCanvasTree';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_BASE_URL = 'http://127.0.0.1:4000';

function remoteMarker(baseUrl: string): Record<string, unknown> {
    return {
        baseUrl,
        serverId: 'remote-server',
        serverLabel: 'Remote Server',
        offline: false,
        connection: 'online',
        queue: 'idle',
    };
}

const ENTRIES = [
    { name: 'sub', type: 'dir' as const, path: 'src/sub' },
    { name: 'a.ts', type: 'file' as const, path: 'src/a.ts', size: 12 },
];

const CHILD_ENTRIES = [
    { name: 'deep.ts', type: 'file' as const, path: 'src/sub/deep.ts' },
];

beforeEach(() => {
    treeMock.mockReset();
    remoteTreeMock.mockReset();
    getSpaCocClientMock.mockReset();
    getCocClientForMock.mockReset();
    getSpaCocClientMock.mockReturnValue({ explorer: { tree: treeMock } });
    getCocClientForMock.mockReturnValue({ explorer: { tree: remoteTreeMock } });
    resetCloneRegistryForTests();
    workspacesRef.current = [{ id: 'ws1', rootPath: '/home/u/proj' }];
    reposRef.current = null;
});

describe('useSourceCanvasTree — root load', () => {
    it('returns loading then success with the root children listed via the workspace-relative path', async () => {
        treeMock.mockResolvedValue({ entries: ENTRIES, truncated: false });
        const { result } = renderHook(() =>
            useSourceCanvasTree({ fullPath: '/home/u/proj/src', kind: 'dir' }),
        );
        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.rootEntries).toEqual(ENTRIES);
        expect(result.current.truncated).toBe(false);
        expect(result.current.resolvedPath).toBe('/home/u/proj/src');
        expect(result.current.relativePath).toBe('src');
        expect(result.current.wsId).toBe('ws1');
        // Local workspace ids route through the clone registry's default client.
        expect(getSpaCocClientMock).toHaveBeenCalled();
        expect(getCocClientForMock).not.toHaveBeenCalled();
        expect(treeMock).toHaveBeenCalledWith('ws1', { path: 'src' });
    });

    it('treats an empty root folder as success with no entries', async () => {
        treeMock.mockResolvedValue({ entries: [], truncated: false });
        const { result } = renderHook(() =>
            useSourceCanvasTree({ fullPath: '/home/u/proj/empty', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.rootEntries).toEqual([]);
    });

    it('surfaces the root truncation flag from the API', async () => {
        treeMock.mockResolvedValue({ entries: ENTRIES, truncated: true });
        const { result } = renderHook(() =>
            useSourceCanvasTree({ fullPath: '/home/u/proj/src', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.truncated).toBe(true);
    });

    it('enters the error state when the root tree fetch rejects', async () => {
        treeMock.mockRejectedValue(new Error('Not a directory'));
        const { result } = renderHook(() =>
            useSourceCanvasTree({ fullPath: '/home/u/proj/missing', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.error).toBe('Failed to load folder');
        expect(result.current.resolvedPath).toBe('/home/u/proj/missing');
    });

    it('errors without fetching when no workspace can be resolved', async () => {
        workspacesRef.current = [];
        const { result } = renderHook(() =>
            useSourceCanvasTree({ fullPath: '/x/y', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.error).toBe('No workspace available');
        expect(result.current.resolvedPath).toBe('/x/y');
        expect(treeMock).not.toHaveBeenCalled();
    });

    it('stays in loading and does not fetch for a null ref', () => {
        const { result } = renderHook(() => useSourceCanvasTree(null));
        expect(result.current.status).toBe('loading');
        expect(treeMock).not.toHaveBeenCalled();
    });

    it('anchors a workspace-relative folder path and lists it relative to the root', async () => {
        treeMock.mockResolvedValue({ entries: ENTRIES, truncated: false });
        const { result } = renderHook(() =>
            useSourceCanvasTree({ fullPath: 'src/managers', wsId: 'ws1', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.resolvedPath).toBe('/home/u/proj/src/managers');
        expect(result.current.relativePath).toBe('src/managers');
        expect(treeMock).toHaveBeenCalledWith('ws1', { path: 'src/managers' });
    });

    it('resolves a relative folder path against the source file directory', async () => {
        treeMock.mockResolvedValue({ entries: [], truncated: false });
        renderHook(() =>
            useSourceCanvasTree({
                fullPath: './util',
                sourceFilePath: '/home/u/proj/src/index.ts',
                kind: 'dir',
            }),
        );
        await waitFor(() =>
            expect(treeMock).toHaveBeenCalledWith('ws1', { path: 'src/util' }),
        );
    });

    // Regression: a folder ref in a REMOTE conversation carries the remote
    // workspace id. That workspace lives only in the repos list (not
    // `state.workspaces`), so resolution must fold it in, anchor against its
    // remote rootPath, and fetch the tree via the clone-routed client.
    it('resolves a remote-workspace folder and lists via the clone-routed client', async () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-ws', baseUrl: REMOTE_BASE_URL }]);
        reposRef.current = {
            repos: [
                { workspace: { id: 'ws1', rootPath: '/home/u/proj' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        rootPath: '/home/remote/repo',
                        baseUrl: REMOTE_BASE_URL,
                        remote: remoteMarker(REMOTE_BASE_URL),
                    },
                },
            ],
        };
        remoteTreeMock.mockResolvedValue({ entries: ENTRIES, truncated: false });
        const { result } = renderHook(() =>
            useSourceCanvasTree({
                fullPath: 'python/sglang/srt/managers',
                wsId: 'remote-ws',
                kind: 'dir',
            }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.rootEntries).toEqual(ENTRIES);
        expect(result.current.resolvedPath).toBe('/home/remote/repo/python/sglang/srt/managers');
        expect(result.current.wsId).toBe('remote-ws');
        expect(getCocClientForMock).toHaveBeenCalledWith(REMOTE_BASE_URL);
        expect(remoteTreeMock).toHaveBeenCalledWith('remote-ws', {
            path: 'python/sglang/srt/managers',
        });
        expect(treeMock).not.toHaveBeenCalled();
    });
});

describe('useSourceCanvasTree — lazy expansion', () => {
    it('fetches a folder\'s children once on expand and caches them across collapse', async () => {
        treeMock.mockResolvedValueOnce({ entries: ENTRIES, truncated: false });
        const { result } = renderHook(() =>
            useSourceCanvasTree({ fullPath: '/home/u/proj/src', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));

        treeMock.mockResolvedValueOnce({ entries: CHILD_ENTRIES, truncated: false });
        act(() => { result.current.toggle('src/sub'); });

        await waitFor(() => expect(result.current.childrenMap.get('src/sub')).toEqual(CHILD_ENTRIES));
        expect(result.current.expanded.has('src/sub')).toBe(true);
        expect(treeMock).toHaveBeenLastCalledWith('ws1', { path: 'src/sub' });
        const callsAfterExpand = treeMock.mock.calls.length;

        // Collapse then re-expand — children stay cached, no refetch.
        act(() => { result.current.toggle('src/sub'); });
        expect(result.current.expanded.has('src/sub')).toBe(false);
        act(() => { result.current.toggle('src/sub'); });
        expect(result.current.expanded.has('src/sub')).toBe(true);
        expect(treeMock.mock.calls.length).toBe(callsAfterExpand);
    });

    it('records a per-folder error when an expansion fetch fails, keeping the root intact', async () => {
        treeMock.mockResolvedValueOnce({ entries: ENTRIES, truncated: false });
        const { result } = renderHook(() =>
            useSourceCanvasTree({ fullPath: '/home/u/proj/src', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));

        treeMock.mockRejectedValueOnce(new Error('Permission denied'));
        act(() => { result.current.toggle('src/sub'); });

        await waitFor(() => expect(result.current.errorPaths.get('src/sub')).toBe('Failed to load folder'));
        // Root listing is unaffected by a child failure.
        expect(result.current.status).toBe('success');
        expect(result.current.loadingPaths.has('src/sub')).toBe(false);
    });
});
