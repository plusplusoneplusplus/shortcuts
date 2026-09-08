/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the PR banner on a REMOTE workspace.
 *
 * `appState.workspaces` only ever holds the LOCAL server's workspaces —
 * `ReposContext` dispatches `WORKSPACES_LOADED` from `listWorkspaces()` and keeps
 * the aggregated remote-server rows in `repos` alone. Resolving the chat's remote
 * URL from that list only meant a chat owned by a remote clone resolved
 * `undefined` (remote identity UNKNOWN) forever, so `usePrChatStatusItems` held
 * its origin empty and the composer chips / PR status card rendered nothing at
 * all — no request, no error.
 *
 * `useWorkspaceRemoteUrl` falls back to the repos list (which carries the remote
 * rows and their git-info) and then to a one-shot `git-info` probe against the
 * server that owns the workspace, while preserving the tri-state:
 * `undefined` = unknown, `null` = known to have no remote, `string` = the URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({
    gitInfo: vi.fn(),
    getCocClientForWorkspace: vi.fn(),
    pullRequests: {
        listChatBindingsForOrigin: vi.fn(),
        createChatBindingForOrigin: vi.fn(),
        getForOrigin: vi.fn(),
        getReviewersForOrigin: vi.fn(),
        getChecksForOrigin: vi.fn(),
        deleteChatBindingForOrigin: vi.fn(),
    },
}));

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: mocks.getCocClientForWorkspace,
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ pullRequests: mocks.pullRequests }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        (err instanceof Error && err.message) || fallback,
}));

import {
    resolveRepoListRemoteUrl,
    useWorkspaceRemoteUrl,
    clearWorkspaceRemoteUrlProbeCache,
} from '../../../src/server/spa/client/react/repos/useWorkspaceRemoteUrl';
import { resolveCanonicalOriginId } from '../../../src/server/spa/client/react/repos/originScope';
import type { RepoData } from '../../../src/server/spa/client/react/repos/repoGrouping';
import { ChatComposerPrChips } from '../../../src/server/spa/client/react/features/chat/conversation/ChatComposerPrChips';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

const LOCAL_WS = 'ws-v2-local0000000000000000';
const REMOTE_WS = 'ws-v2-remote000000000000000';
const GH_REMOTE = 'https://github.com/plusplusoneplusplus/shortcuts.git';
const GH_ORIGIN = 'gh_plusplusoneplusplus_shortcuts';

/** The local server's workspace list — never contains the remote clone. */
const localWorkspaces = [{ id: LOCAL_WS, remoteUrl: GH_REMOTE }];

function remoteRepo(overrides: Partial<RepoData> = {}): RepoData {
    return {
        workspace: { id: REMOTE_WS, baseUrl: 'https://remote.example', remote: { serverLabel: 'box' } },
        gitInfo: { branch: 'main', dirty: false, isGitRepo: true, remoteUrl: GH_REMOTE },
        gitInfoLoading: false,
        ...overrides,
    };
}

describe('resolveRepoListRemoteUrl', () => {
    it('is undefined (unknown) with no repo list, or when the workspace is absent', () => {
        expect(resolveRepoListRemoteUrl(undefined, REMOTE_WS)).toBeUndefined();
        expect(resolveRepoListRemoteUrl([], REMOTE_WS)).toBeUndefined();
        expect(resolveRepoListRemoteUrl([remoteRepo()], 'someone-else')).toBeUndefined();
        expect(resolveRepoListRemoteUrl([remoteRepo()], undefined)).toBeUndefined();
    });

    it('reads the remote URL off an aggregated remote row', () => {
        expect(resolveRepoListRemoteUrl([remoteRepo()], REMOTE_WS)).toBe(GH_REMOTE);
    });

    it('falls back to the workspace record when git-info carries no remote', () => {
        const repo = remoteRepo({
            workspace: { id: REMOTE_WS, remoteUrl: GH_REMOTE },
            gitInfo: { branch: 'main', dirty: false, isGitRepo: true },
        });
        expect(resolveRepoListRemoteUrl([repo], REMOTE_WS)).toBe(GH_REMOTE);
    });

    it('is undefined (unknown) while the row is still resolving its git-info', () => {
        const repo = remoteRepo({
            gitInfo: { branch: null, dirty: false, isGitRepo: true },
            gitInfoLoading: true,
        });
        expect(resolveRepoListRemoteUrl([repo], REMOTE_WS)).toBeUndefined();
    });

    it('is null (known: no remote) for a resolved row with no remote URL', () => {
        const repo = remoteRepo({
            workspace: { id: REMOTE_WS },
            gitInfo: { branch: 'main', dirty: false, isGitRepo: true, remoteUrl: null },
        });
        expect(resolveRepoListRemoteUrl([repo], REMOTE_WS)).toBeNull();
    });
});

describe('useWorkspaceRemoteUrl', () => {
    beforeEach(() => {
        clearWorkspaceRemoteUrlProbeCache();
        mocks.gitInfo.mockReset();
        mocks.gitInfo.mockResolvedValue({ branch: 'main', dirty: false, isGitRepo: true, remoteUrl: GH_REMOTE });
        mocks.getCocClientForWorkspace.mockReset();
        mocks.getCocClientForWorkspace.mockReturnValue({ workspaces: { gitInfo: mocks.gitInfo } });
    });

    it('resolves a REMOTE workspace missing from the local list through the repos list', async () => {
        const { result } = renderHook(() =>
            useWorkspaceRemoteUrl(localWorkspaces, [remoteRepo()], REMOTE_WS),
        );

        expect(result.current).toBe(GH_REMOTE);
        // The canonical origin the PR bindings actually live under.
        expect(resolveCanonicalOriginId({ workspaceId: REMOTE_WS, remoteUrl: result.current })).toBe(GH_ORIGIN);
        // The repos list already answered — no probe needed.
        expect(mocks.gitInfo).not.toHaveBeenCalled();
    });

    it('probes the OWNING server when a remote workspace is in neither list', async () => {
        const { result } = renderHook(() => useWorkspaceRemoteUrl(localWorkspaces, [], REMOTE_WS));

        // Unknown until the probe answers — never `null`, which would scope the
        // banner to `local_<ws>`.
        expect(result.current).toBeUndefined();
        await waitFor(() => expect(result.current).toBe(GH_REMOTE));
        expect(mocks.getCocClientForWorkspace).toHaveBeenCalledWith(REMOTE_WS);
        expect(mocks.gitInfo).toHaveBeenCalledWith(REMOTE_WS);
    });

    it('reports null when the probe says the workspace genuinely has no remote', async () => {
        mocks.gitInfo.mockResolvedValue({ branch: 'main', dirty: false, isGitRepo: true, remoteUrl: null });
        const { result } = renderHook(() => useWorkspaceRemoteUrl(localWorkspaces, [], REMOTE_WS));
        await waitFor(() => expect(result.current).toBeNull());
    });

    it('stays unknown when the probe fails, rather than claiming no remote', async () => {
        mocks.gitInfo.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useWorkspaceRemoteUrl(localWorkspaces, [], REMOTE_WS));
        await waitFor(() => expect(mocks.gitInfo).toHaveBeenCalled());
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(result.current).toBeUndefined();
    });

    it('does not probe during the pre-load window (local list not loaded yet)', async () => {
        const { result } = renderHook(() => useWorkspaceRemoteUrl([], [], LOCAL_WS));
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(result.current).toBeUndefined();
        expect(mocks.gitInfo).not.toHaveBeenCalled();
    });

    it('keeps the local list authoritative — no probe for a workspace it contains', async () => {
        const { result } = renderHook(() => useWorkspaceRemoteUrl(localWorkspaces, [], LOCAL_WS));
        expect(result.current).toBe(GH_REMOTE);

        const noRemote = renderHook(() => useWorkspaceRemoteUrl([{ id: LOCAL_WS }], [], LOCAL_WS));
        expect(noRemote.result.current).toBeNull();

        await new Promise(resolve => setTimeout(resolve, 10));
        expect(mocks.gitInfo).not.toHaveBeenCalled();
    });

    it('probes a given workspace once per session and never leaks it to another', async () => {
        const first = renderHook(() => useWorkspaceRemoteUrl(localWorkspaces, [], REMOTE_WS));
        await waitFor(() => expect(first.result.current).toBe(GH_REMOTE));

        const second = renderHook(() => useWorkspaceRemoteUrl(localWorkspaces, [], REMOTE_WS));
        await waitFor(() => expect(second.result.current).toBe(GH_REMOTE));
        expect(mocks.gitInfo).toHaveBeenCalledTimes(1);

        // A different workspace must not inherit the cached answer.
        const other = renderHook(() => useWorkspaceRemoteUrl(localWorkspaces, [], 'ws-v2-other0000000000000000'));
        expect(other.result.current).toBeUndefined();
    });
});


// ── End to end: the banner itself, on a remote workspace ─────────────────────

const PR_URL = 'https://github.com/plusplusoneplusplus/shortcuts/pull/673';

function turnWithPrCreate(url: string): ClientConversationTurn {
    return {
        role: 'assistant',
        content: '',
        timeline: [
            {
                type: 'tool-complete',
                timestamp: '2024-01-01T00:00:00Z',
                toolCall: {
                    id: 'tc1',
                    toolName: 'bash',
                    args: { command: 'gh pr create --fill' },
                    result: `Creating pull request...\n${url}\n`,
                    status: 'completed',
                },
            },
        ],
    };
}

/** Mirrors how ChatDetail feeds the chips: hook-resolved remote URL, same ids. */
function RemoteChatChips({ repos }: { repos: RepoData[] }) {
    const remoteUrl = useWorkspaceRemoteUrl(localWorkspaces, repos, REMOTE_WS);
    return (
        <ChatComposerPrChips
            turns={[turnWithPrCreate(PR_URL)]}
            workspaceId={REMOTE_WS}
            remoteUrl={remoteUrl}
            taskId="t1"
        />
    );
}

describe('composer PR banner on a remote workspace', () => {
    beforeEach(() => {
        clearWorkspaceRemoteUrlProbeCache();
        for (const fn of Object.values(mocks.pullRequests)) fn.mockReset();
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.createChatBindingForOrigin.mockResolvedValue({ prId: '673', taskId: 't1' });
        mocks.pullRequests.getReviewersForOrigin.mockResolvedValue({ reviewers: [] });
        mocks.pullRequests.getChecksForOrigin.mockResolvedValue({ checks: [] });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 673,
            title: 'Re-render the editor toolbar',
            status: 'merged',
            sourceBranch: 'pr/3d32522c1',
            targetBranch: 'main',
            createdAt: '2026-08-27T00:00:00Z',
            url: PR_URL,
        });
        mocks.gitInfo.mockReset();
        mocks.gitInfo.mockResolvedValue({ branch: 'main', dirty: false, isGitRepo: true, remoteUrl: GH_REMOTE });
        mocks.getCocClientForWorkspace.mockReset();
        mocks.getCocClientForWorkspace.mockReturnValue({
            pullRequests: mocks.pullRequests,
            workspaces: { gitInfo: mocks.gitInfo },
        });
    });

    it('renders the chip under the gh_ origin for a chat owned by a remote clone', async () => {
        const { findByText, getByTestId } = render(<RemoteChatChips repos={[remoteRepo()]} />);

        await findByText('Re-render the editor toolbar');
        expect(getByTestId(`composer-pr-chip-view-${GH_ORIGIN}:673`)).toBeTruthy();
        expect(mocks.pullRequests.listChatBindingsForOrigin).toHaveBeenCalledWith(GH_ORIGIN, { taskId: 't1' });
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '673', { workspaceId: REMOTE_WS });
        // Every call is scoped to the remote clone's own server.
        for (const call of mocks.getCocClientForWorkspace.mock.calls) {
            expect(call[0]).toBe(REMOTE_WS);
        }
    });

    it('renders it via the git-info probe when the repos list has no remote rows', async () => {
        const { findByText } = render(<RemoteChatChips repos={[]} />);

        await findByText('Re-render the editor toolbar');
        expect(mocks.gitInfo).toHaveBeenCalledWith(REMOTE_WS);
        // The bogus `local_<ws>` origin is never touched, on any render.
        for (const call of mocks.pullRequests.listChatBindingsForOrigin.mock.calls) {
            expect(call[0]).toBe(GH_ORIGIN);
        }
    });
});
