/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the composer PR banner's origin resolution.
 *
 * The chat's canonical origin is resolved on the client from the workspace's
 * `remoteUrl`, read out of the (async) dashboard workspace list. Treating the
 * pre-load window as "this workspace has no remote" resolves the origin to
 * `local_<workspaceId>` — an origin no PR data lives under — so the bindings GET
 * queries the wrong origin and `unionAssociations` drops the chat's own detected
 * PRs as belonging to another repo. The banner then renders nothing.
 *
 * `resolveWorkspaceRemoteUrl` keeps "unknown" (`undefined`) distinct from
 * "no remote" (`null`), and `usePrChatStatusItems` holds its origin empty while
 * the remote identity is unknown, so no work is scoped to the bogus origin and
 * the banner appears as soon as the real origin arrives.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

const mocks = vi.hoisted(() => ({
    pullRequests: {
        listChatBindingsForOrigin: vi.fn(),
        createChatBindingForOrigin: vi.fn(),
        getForOrigin: vi.fn(),
        getReviewersForOrigin: vi.fn(),
        getChecksForOrigin: vi.fn(),
        deleteChatBindingForOrigin: vi.fn(),
    },
    getCocClientForWorkspace: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ pullRequests: mocks.pullRequests }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        (err instanceof Error && err.message) || fallback,
}));

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: mocks.getCocClientForWorkspace,
}));

import { ChatComposerPrChips } from '../../../src/server/spa/client/react/features/chat/conversation/ChatComposerPrChips';
import {
    resolveWorkspaceRemoteUrl,
    resolveCanonicalOriginId,
} from '../../../src/server/spa/client/react/repos/originScope';

const WS = 'ws-v2-8777024115df4e9eb71f789e';
const GH_REMOTE = 'https://github.com/plusplusoneplusplus/shortcuts.git';
const GH_ORIGIN = 'gh_plusplusoneplusplus_shortcuts';
const LOCAL_ORIGIN = `local_${WS.replace(/_/g, '_u')}`;
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

describe('resolveWorkspaceRemoteUrl', () => {
    it('is undefined (unknown) while the workspace list has not loaded', () => {
        expect(resolveWorkspaceRemoteUrl([], WS)).toBeUndefined();
        expect(resolveWorkspaceRemoteUrl(undefined, WS)).toBeUndefined();
    });

    it('is undefined (unknown) when the loaded list does not contain the workspace', () => {
        expect(resolveWorkspaceRemoteUrl([{ id: 'other', remoteUrl: GH_REMOTE }], WS)).toBeUndefined();
    });

    it('is null (known: no remote) for a loaded workspace without a remoteUrl', () => {
        expect(resolveWorkspaceRemoteUrl([{ id: WS }], WS)).toBeNull();
        expect(resolveWorkspaceRemoteUrl([{ id: WS, remoteUrl: 42 }], WS)).toBeNull();
    });

    it('returns the remote URL for a loaded workspace that has one', () => {
        expect(resolveWorkspaceRemoteUrl([{ id: WS, remoteUrl: GH_REMOTE }], WS)).toBe(GH_REMOTE);
    });

    it('feeds the canonical GitHub origin, not the local_ fallback', () => {
        const remoteUrl = resolveWorkspaceRemoteUrl([{ id: WS, remoteUrl: GH_REMOTE }], WS);
        expect(resolveCanonicalOriginId({ workspaceId: WS, remoteUrl })).toBe(GH_ORIGIN);
        // The pre-load window is exactly what used to produce this.
        expect(resolveCanonicalOriginId({ workspaceId: WS, remoteUrl: null })).toBe(LOCAL_ORIGIN);
    });
});

describe('composer PR banner origin scoping', () => {
    beforeEach(() => {
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
        mocks.getCocClientForWorkspace.mockReset();
        mocks.getCocClientForWorkspace.mockReturnValue({ pullRequests: mocks.pullRequests });
    });

    it('renders one chip under the gh_ origin for a chat whose workspace has a GitHub remote', async () => {
        const remoteUrl = resolveWorkspaceRemoteUrl([{ id: WS, remoteUrl: GH_REMOTE }], WS);

        const { findByText, getByTestId } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(PR_URL)]} workspaceId={WS} remoteUrl={remoteUrl} taskId="t1" />,
        );

        await findByText('Re-render the editor toolbar');
        expect(getByTestId('composer-pr-chips')).toBeTruthy();
        expect(getByTestId(`composer-pr-chip-view-${GH_ORIGIN}:673`)).toBeTruthy();
        expect(mocks.pullRequests.listChatBindingsForOrigin).toHaveBeenCalledWith(GH_ORIGIN, { taskId: 't1' });
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '673', { workspaceId: WS });
    });

    it('does no origin-scoped work while the workspace remote is still unknown', async () => {
        const { queryByTestId } = render(
            <ChatComposerPrChips
                turns={[turnWithPrCreate(PR_URL)]}
                workspaceId={WS}
                remoteUrl={resolveWorkspaceRemoteUrl([], WS)}
                taskId="t1"
            />,
        );

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(queryByTestId('composer-pr-chips')).toBeNull();
        // Before the fix this queried (and wrote bindings under) `local_<ws>`.
        expect(mocks.pullRequests.listChatBindingsForOrigin).not.toHaveBeenCalled();
        expect(mocks.pullRequests.createChatBindingForOrigin).not.toHaveBeenCalled();
        expect(mocks.pullRequests.getForOrigin).not.toHaveBeenCalled();
    });

    it('recovers and renders under gh_ once the workspace list loads', async () => {
        const workspaces: Array<{ id: string; remoteUrl?: string }> = [];
        const { rerender, findByText } = render(
            <ChatComposerPrChips
                turns={[turnWithPrCreate(PR_URL)]}
                workspaceId={WS}
                remoteUrl={resolveWorkspaceRemoteUrl(workspaces, WS)}
                taskId="t1"
            />,
        );

        workspaces.push({ id: WS, remoteUrl: GH_REMOTE });
        rerender(
            <ChatComposerPrChips
                turns={[turnWithPrCreate(PR_URL)]}
                workspaceId={WS}
                remoteUrl={resolveWorkspaceRemoteUrl(workspaces, WS)}
                taskId="t1"
            />,
        );

        await findByText('Re-render the editor toolbar');
        await waitFor(() =>
            expect(mocks.pullRequests.createChatBindingForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '673', 't1'),
        );
        // The bogus origin was never touched, on any render.
        for (const call of mocks.pullRequests.listChatBindingsForOrigin.mock.calls) {
            expect(call[0]).toBe(GH_ORIGIN);
        }
    });

    it('still resolves the local_ origin for a loaded workspace that genuinely has no remote', async () => {
        const remoteUrl = resolveWorkspaceRemoteUrl([{ id: WS }], WS);
        render(
            <ChatComposerPrChips turns={[]} workspaceId={WS} remoteUrl={remoteUrl} taskId="t1" />,
        );
        await waitFor(() =>
            expect(mocks.pullRequests.listChatBindingsForOrigin).toHaveBeenCalledWith(LOCAL_ORIGIN, { taskId: 't1' }),
        );
    });
});
