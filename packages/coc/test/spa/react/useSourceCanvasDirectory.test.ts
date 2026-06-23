/**
 * Tests for useSourceCanvasDirectory — the loading/success/error state machine
 * for the docked source-canvas folder explorer (AC-01). Mocks the app
 * workspaces and the workspace-routed `explorer.tree` API to cover:
 * loading→success (entries + truncated), empty folder, fetch failure → error,
 * no-workspace → error without fetching, null ref, workspace-relative + relative
 * path resolution (tree is called with the workspace-relative path), and remote
 * workspace routing through the clone-routed client.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

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

import { useSourceCanvasDirectory } from '../../../src/server/spa/client/react/features/chat/source-canvas/useSourceCanvasDirectory';
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

describe('useSourceCanvasDirectory', () => {
    it('returns loading then success with entries listed via the workspace-relative path', async () => {
        treeMock.mockResolvedValue({ entries: ENTRIES, truncated: false });
        const { result } = renderHook(() =>
            useSourceCanvasDirectory({ fullPath: '/home/u/proj/src', kind: 'dir' }),
        );
        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.entries).toEqual(ENTRIES);
        expect(result.current.truncated).toBe(false);
        expect(result.current.resolvedPath).toBe('/home/u/proj/src');
        expect(result.current.relativePath).toBe('src');
        expect(result.current.wsId).toBe('ws1');
        // Local workspace ids route through the clone registry's default client.
        expect(getSpaCocClientMock).toHaveBeenCalled();
        expect(getCocClientForMock).not.toHaveBeenCalled();
        expect(treeMock).toHaveBeenCalledWith('ws1', { path: 'src' });
    });

    it('treats an empty folder as success with no entries', async () => {
        treeMock.mockResolvedValue({ entries: [], truncated: false });
        const { result } = renderHook(() =>
            useSourceCanvasDirectory({ fullPath: '/home/u/proj/empty', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.entries).toEqual([]);
    });

    it('surfaces the truncation flag from the API', async () => {
        treeMock.mockResolvedValue({ entries: ENTRIES, truncated: true });
        const { result } = renderHook(() =>
            useSourceCanvasDirectory({ fullPath: '/home/u/proj/src', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.truncated).toBe(true);
    });

    it('enters the error state when the tree fetch rejects', async () => {
        treeMock.mockRejectedValue(new Error('Not a directory'));
        const { result } = renderHook(() =>
            useSourceCanvasDirectory({ fullPath: '/home/u/proj/missing', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.error).toBe('Failed to load folder');
        expect(result.current.resolvedPath).toBe('/home/u/proj/missing');
    });

    it('errors without fetching when no workspace can be resolved', async () => {
        workspacesRef.current = [];
        const { result } = renderHook(() =>
            useSourceCanvasDirectory({ fullPath: '/x/y', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.error).toBe('No workspace available');
        expect(result.current.resolvedPath).toBe('/x/y');
        expect(treeMock).not.toHaveBeenCalled();
    });

    it('stays in loading and does not fetch for a null ref', () => {
        const { result } = renderHook(() => useSourceCanvasDirectory(null));
        expect(result.current.status).toBe('loading');
        expect(treeMock).not.toHaveBeenCalled();
    });

    it('anchors a workspace-relative folder path and lists it relative to the root', async () => {
        treeMock.mockResolvedValue({ entries: ENTRIES, truncated: false });
        const { result } = renderHook(() =>
            useSourceCanvasDirectory({ fullPath: 'src/managers', wsId: 'ws1', kind: 'dir' }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.resolvedPath).toBe('/home/u/proj/src/managers');
        expect(result.current.relativePath).toBe('src/managers');
        expect(treeMock).toHaveBeenCalledWith('ws1', { path: 'src/managers' });
    });

    it('resolves a relative folder path against the source file directory', async () => {
        treeMock.mockResolvedValue({ entries: [], truncated: false });
        renderHook(() =>
            useSourceCanvasDirectory({
                fullPath: './util',
                sourceFilePath: '/home/u/proj/src/index.ts',
                kind: 'dir',
            }),
        );
        await waitFor(() =>
            expect(treeMock).toHaveBeenCalledWith('ws1', { path: 'src/util' }),
        );
    });

    // Regression: a folder link clicked in a REMOTE conversation carries the
    // remote workspace id. That workspace lives only in the repos list (not
    // `state.workspaces`), so resolution must fold it in, anchor against its
    // remote rootPath, and fetch the tree via the clone-routed client (not the
    // local default).
    it('resolves a remote-workspace folder link and lists via the clone-routed client', async () => {
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
            useSourceCanvasDirectory({
                fullPath: 'python/sglang/srt/managers',
                wsId: 'remote-ws',
                kind: 'dir',
            }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.entries).toEqual(ENTRIES);
        expect(result.current.resolvedPath).toBe('/home/remote/repo/python/sglang/srt/managers');
        expect(result.current.relativePath).toBe('python/sglang/srt/managers');
        expect(result.current.wsId).toBe('remote-ws');
        expect(getCocClientForMock).toHaveBeenCalledWith(REMOTE_BASE_URL);
        expect(remoteTreeMock).toHaveBeenCalledWith('remote-ws', {
            path: 'python/sglang/srt/managers',
        });
        expect(treeMock).not.toHaveBeenCalled();
    });
});
