import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const pullRequests = {
        getForOrigin: vi.fn(),
        getThreadsForOrigin: vi.fn(),
        getDiffForOrigin: vi.fn(),
        getCommitsForOrigin: vi.fn(),
        getChecksForOrigin: vi.fn(),
    };
    return {
        appState: {
            workspace: 'local-stale-workspace',
            selectedRepoId: 'local-stale-repo',
            selectedPrDetailTab: null,
        },
        dispatch: vi.fn(),
        getSpaCocClient: vi.fn(() => {
            throw new Error('local SPA client should not be used for remote PR detail');
        }),
        getSpaCocClientErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
        useCocClient: vi.fn(() => ({ pullRequests })),
        pullRequests,
        reviewChatPresentation: {
            chatOpen: false,
            toggleChat: vi.fn(),
            closeChat: vi.fn(),
            minimizeChat: vi.fn(),
            restoreChat: vi.fn(),
            pinChat: vi.fn(),
            unpinChat: vi.fn(),
            isPinned: false,
            isMinimized: false,
            presentation: 'side-panel',
            lensEnabled: false,
            isDesktop: true,
        },
    };
});

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: mocks.getSpaCocClient,
    getSpaCocClientErrorMessage: mocks.getSpaCocClientErrorMessage,
}));

vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: mocks.useCocClient,
}));

vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mocks.appState, dispatch: mocks.dispatch }),
}));

vi.mock('../../../src/server/spa/client/react/features/git/hooks/useReviewChatPresentation', () => ({
    useReviewChatPresentation: () => mocks.reviewChatPresentation,
}));

vi.mock('../../../src/server/spa/client/react/layout/Router', () => ({
    buildGitPrPopOutUrl: () => 'about:blank',
}));

vi.mock('../../../src/server/spa/client/react/features/pull-requests/PrReviewSummaryPanel', () => ({
    PrReviewSummaryPanel: () => <div data-testid="mock-review-summary" />,
}));

vi.mock('../../../src/server/spa/client/react/features/pull-requests/PrConversationPanel', () => ({
    PrConversationPanel: () => <div data-testid="mock-conversation-panel" />,
}));

vi.mock('../../../src/server/spa/client/react/features/pull-requests/PrAiGroupedThreads', () => ({
    PrAiGroupedThreads: () => <div data-testid="mock-ai-grouped-threads" />,
}));

vi.mock('../../../src/server/spa/client/react/features/pull-requests/PrAiAssistantDrawer', () => ({
    PrAiAssistantDrawer: () => null,
}));

vi.mock('../../../src/server/spa/client/react/features/pull-requests/PullRequestChatPlacementFrame', () => ({
    PullRequestChatPlacementFrame: () => null,
}));

import { resolveCanonicalOriginId } from '../../../src/server/spa/client/react/repos/originScope';
import { PullRequestDetail } from '../../../src/server/spa/client/react/features/pull-requests/PullRequestDetail';

describe('PullRequestDetail', () => {
    beforeEach(() => {
        mocks.dispatch.mockClear();
        mocks.getSpaCocClient.mockClear();
        mocks.getSpaCocClientErrorMessage.mockClear();
        mocks.useCocClient.mockClear();
        mocks.useCocClient.mockReturnValue({ pullRequests: mocks.pullRequests });

        mocks.pullRequests.getForOrigin.mockReset();
        mocks.pullRequests.getThreadsForOrigin.mockReset();
        mocks.pullRequests.getDiffForOrigin.mockReset();
        mocks.pullRequests.getCommitsForOrigin.mockReset();
        mocks.pullRequests.getChecksForOrigin.mockReset();

        mocks.pullRequests.getForOrigin.mockResolvedValue({
            id: 79,
            number: 79,
            title: 'Remote PR detail',
            status: 'open',
            sourceBranch: 'feature/remote-pr',
            targetBranch: 'main',
            author: { displayName: 'Remote Dev' },
            reviewers: [],
            labels: [],
            description: 'Remote PR description',
            createdAt: '2026-06-21T00:00:00.000Z',
        });
        mocks.pullRequests.getThreadsForOrigin.mockResolvedValue({ threads: [] });
        mocks.pullRequests.getDiffForOrigin.mockResolvedValue('');
        mocks.pullRequests.getCommitsForOrigin.mockResolvedValue({ commits: [] });
        mocks.pullRequests.getChecksForOrigin.mockResolvedValue({ checks: [] });
    });

    it('routes remote PR detail fetches through the clone-routed client', async () => {
        const workspaceId = 'ws-xjvuoc';
        const repoId = 'ws-xjvuoc';
        const remoteUrl = 'https://github.com/example/shortcuts.git';
        const originId = resolveCanonicalOriginId({ workspaceId, remoteUrl });

        render(
            <PullRequestDetail
                repoId={repoId}
                workspaceId={workspaceId}
                remoteUrl={remoteUrl}
                prId={79}
                onBack={vi.fn()}
            />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('pr-title')).toHaveTextContent('Remote PR detail');
        });

        expect(mocks.useCocClient).toHaveBeenCalledWith(workspaceId);
        expect(mocks.getSpaCocClient).not.toHaveBeenCalled();
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledWith(
            originId,
            '79',
            expect.objectContaining({ workspaceId, repoId }),
        );
        expect(mocks.pullRequests.getThreadsForOrigin).toHaveBeenCalledWith(
            originId,
            '79',
            { workspaceId, repoId },
        );
        expect(mocks.pullRequests.getDiffForOrigin).toHaveBeenCalledWith(
            originId,
            '79',
            { workspaceId, repoId },
        );
        expect(mocks.pullRequests.getCommitsForOrigin).toHaveBeenCalledWith(
            originId,
            '79',
            { workspaceId, repoId },
        );
        expect(mocks.pullRequests.getChecksForOrigin).toHaveBeenCalledWith(
            originId,
            '79',
            { workspaceId, repoId },
        );
    });
});
