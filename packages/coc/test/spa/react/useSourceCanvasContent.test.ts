/**
 * Tests for useSourceCanvasContent — the loading/success/error state machine
 * for the docked source canvas body (AC-06). Mocks the app workspaces and the
 * preview API to cover: loading→success (content + lines fallback + language),
 * fetch failure → error, no-workspace → error without fetching, null ref, and
 * that the resolved path is passed to the preview API.
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

const { previewMock, remotePreviewMock, getSpaCocClientMock, getCocClientForMock, workspacesRef, reposRef } = vi.hoisted(() => ({
    previewMock: vi.fn(),
    remotePreviewMock: vi.fn(),
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

import { useSourceCanvasContent } from '../../../src/server/spa/client/react/features/chat/source-canvas/useSourceCanvasContent';
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

beforeEach(() => {
    previewMock.mockReset();
    remotePreviewMock.mockReset();
    getSpaCocClientMock.mockReset();
    getCocClientForMock.mockReset();
    getSpaCocClientMock.mockReturnValue({ tasks: { previewWorkspaceFile: previewMock } });
    getCocClientForMock.mockReturnValue({ tasks: { previewWorkspaceFile: remotePreviewMock } });
    resetCloneRegistryForTests();
    workspacesRef.current = [{ id: 'ws1', rootPath: '/home/u/proj' }];
    reposRef.current = null;
});

describe('useSourceCanvasContent', () => {
    it('returns loading then success with content + language', async () => {
        previewMock.mockResolvedValue({ content: 'hello world\n', language: 'typescript' });
        const { result } = renderHook(() =>
            useSourceCanvasContent({ fullPath: '/home/u/proj/src/a.ts' }),
        );
        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.content).toBe('hello world\n');
        expect(result.current.language).toBe('typescript');
        expect(result.current.resolvedPath).toBe('/home/u/proj/src/a.ts');
        // Local workspace ids route through the clone registry's default SPA client.
        expect(getSpaCocClientMock).toHaveBeenCalled();
        expect(getCocClientForMock).not.toHaveBeenCalled();
        expect(previewMock).toHaveBeenCalledWith('ws1', '/home/u/proj/src/a.ts', { lines: 0 });
    });

    it('reconstructs content from the lines array when content is absent', async () => {
        previewMock.mockResolvedValue({ lines: ['line1', 'line2'] });
        const { result } = renderHook(() =>
            useSourceCanvasContent({ fullPath: '/home/u/proj/src/b.ts' }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.content).toBe('line1\nline2');
        expect(result.current.language).toBe('');
    });

    it('enters the error state when the fetch rejects', async () => {
        previewMock.mockRejectedValue(new Error('boom'));
        const { result } = renderHook(() =>
            useSourceCanvasContent({ fullPath: '/home/u/proj/missing.ts' }),
        );
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.error).toBe('Failed to load file');
        expect(result.current.resolvedPath).toBe('/home/u/proj/missing.ts');
    });

    it('errors without fetching when no workspace can be resolved', async () => {
        workspacesRef.current = [];
        const { result } = renderHook(() =>
            useSourceCanvasContent({ fullPath: '/x/y.ts' }),
        );
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.error).toBe('No workspace available');
        expect(result.current.resolvedPath).toBe('/x/y.ts');
        expect(previewMock).not.toHaveBeenCalled();
    });

    it('stays in loading and does not fetch for a null ref', () => {
        const { result } = renderHook(() => useSourceCanvasContent(null));
        expect(result.current.status).toBe('loading');
        expect(previewMock).not.toHaveBeenCalled();
    });

    it('fetches the relative-resolved path against the source file', async () => {
        previewMock.mockResolvedValue({ content: 'x' });
        renderHook(() =>
            useSourceCanvasContent({
                fullPath: './util/c.ts',
                sourceFilePath: '/home/u/proj/src/index.ts',
            }),
        );
        await waitFor(() =>
            expect(previewMock).toHaveBeenCalledWith('ws1', '/home/u/proj/src/util/c.ts', {
                lines: 0,
            }),
        );
    });

    it('fetches a workspace-relative chat path as an absolute workspace path', async () => {
        previewMock.mockResolvedValue({ content: 'x' });
        const { result } = renderHook(() =>
            useSourceCanvasContent({ fullPath: 'src/from-chat.ts', wsId: 'ws1' }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.resolvedPath).toBe('/home/u/proj/src/from-chat.ts');
        expect(previewMock).toHaveBeenCalledWith('ws1', '/home/u/proj/src/from-chat.ts', {
            lines: 0,
        });
    });

    // Regression: a chat link clicked in a REMOTE conversation carries the remote
    // workspace id. That workspace lives only in the repos list (not
    // `state.workspaces`), so before the fix resolution failed with "No workspace
    // root available" and never reached a fetch. The hook must fold remote
    // workspaces in, anchor the relative path against the remote rootPath, and
    // fetch via the clone-routed client (not the local default).
    it('resolves a remote-workspace chat link and fetches via the clone-routed client', async () => {
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
        remotePreviewMock.mockResolvedValue({ content: 'remote!', language: 'typescript' });
        const { result } = renderHook(() =>
            useSourceCanvasContent({
                fullPath: 'packages/coc/RalphWorkflowPane.tsx',
                wsId: 'remote-ws',
            }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.content).toBe('remote!');
        expect(result.current.resolvedPath).toBe(
            '/home/remote/repo/packages/coc/RalphWorkflowPane.tsx',
        );
        expect(getCocClientForMock).toHaveBeenCalledWith(REMOTE_BASE_URL);
        expect(remotePreviewMock).toHaveBeenCalledWith(
            'remote-ws',
            '/home/remote/repo/packages/coc/RalphWorkflowPane.tsx',
            { lines: 0 },
        );
    });

    // Regression guard for the original failure: with the remote workspace absent
    // from BOTH state.workspaces and the repos list, a remote-id relative ref has
    // no rootPath to anchor against and must still surface a clear error.
    it('errors with "No workspace root available" when the hinted workspace is unknown', async () => {
        const { result } = renderHook(() =>
            useSourceCanvasContent({
                fullPath: 'packages/coc/RalphWorkflowPane.tsx',
                wsId: 'remote-ws',
            }),
        );
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.error).toBe('No workspace root available');
        expect(previewMock).not.toHaveBeenCalled();
    });
});
