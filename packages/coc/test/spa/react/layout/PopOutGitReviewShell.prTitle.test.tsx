/**
 * Tests for PR title collapsible header in PopOutGitReviewShell.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
    getPr: vi.fn(),
    getPrDiff: vi.fn(),
    postMessage: vi.fn(),
    classificationState: {
        status: 'idle' as const,
        error: null as string | null,
        activeFilters: new Set<string>(),
    },
    reviewProgressState: {
        reviewedFiles: new Set<string>(),
        visitedFiles: new Set<string>(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    AppProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    QueueProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    ToastProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useToast: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    Spinner: () => <span data-testid="spinner" />,
    ToastContainer: () => null,
    useToast: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        git: {
            getBranchRange: () => new Promise(() => {}),
            listBranchRangeFiles: () => new Promise(() => {}),
            commitDiffPath: () => '/diff',
        },
        pullRequests: {
            get: (...args: unknown[]) => mocks.getPr(...args),
            getDiff: (...args: unknown[]) => mocks.getPrDiff(...args),
        },
        agentProviders: {
            list: () => Promise.resolve({ providers: [] }),
            listModels: () => Promise.resolve({ models: [] }),
            getReasoningEfforts: () => Promise.resolve([]),
            getEffortTiers: () => Promise.resolve({ effortTiers: {}, defaults: {} }),
            setEnabledModels: () => Promise.resolve(),
            setReasoningEffort: () => Promise.resolve(),
        },
        preferences: {
            getRepo: () => Promise.resolve({}),
            patchRepo: () => Promise.resolve(),
        },
    }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/GitReviewPopOutContext', () => ({
    useGitReviewPopOutChannel: () => ({ postMessage: mocks.postMessage }),
    gitReviewPopOutKey: (wsId: string, hash: string) => `${wsId}:commit:${hash}`,
    gitReviewBranchPopOutKey: (wsId: string) => `${wsId}:branch`,
    gitReviewPrPopOutKey: (wsId: string, prId: string) => `${wsId}:pr:${prId}`,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/PopOutFilePanel', () => ({
    PopOutFilePanel: ({ files }: { files: Array<{ path: string }> }) => (
        <div data-testid="popout-file-panel">
            {files.map(f => <span key={f.path}>{f.path}</span>)}
        </div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    FileDiffPanel: ({ filePath }: { filePath: string }) => (
        <div data-testid="file-diff-panel" data-file={filePath} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useCommitDiffCache', () => ({
    useCachedDiff: vi.fn().mockReturnValue({ diff: null }),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => ({
    useFileCommentCounts: vi.fn().mockReturnValue(new Map()),
}));
vi.mock('../../../../src/server/spa/client/comments/diff-comment-utils', () => ({
    computeDiffCommentKey: vi.fn().mockResolvedValue('key'),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/useClassification', () => ({
    useClassification: () => ({
        state: mocks.classificationState,
        classify: vi.fn(),
        toggleFilter: vi.fn(),
        setFilters: vi.fn(),
        isFileDimmed: vi.fn().mockReturnValue(false),
        getFileBadge: vi.fn().mockReturnValue(null),
        getHunkClassification: vi.fn().mockReturnValue(null),
    }),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/usePrReviewProgress', () => ({
    usePrReviewProgress: () => ({
        state: mocks.reviewProgressState,
        markVisited: vi.fn(),
        setLastSelectedFile: vi.fn(),
        isReviewed: vi.fn().mockReturnValue(false),
        toggleReviewed: vi.fn(),
    }),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/commits/PrChatPanel', () => ({
    PrChatPanel: () => <div data-testid="pr-chat-panel" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/prPopoutPriority', () => ({
    pickPriorityFile: vi.fn().mockReturnValue({ path: null }),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/diffSource', () => ({
    createPrDiffSource: vi.fn().mockReturnValue({
        cacheKey: 'pr-cache',
        commentContext: () => ({ oldRef: 'base', newRef: 'head' }),
    }),
    extractFileStatsFromDiff: vi.fn().mockReturnValue([]),
}));
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getHostname: () => 'localhost',
    getActiveProvider: () => 'copilot',
    getDefaultProvider: () => 'copilot',
    getConfiguredDefaultProvider: () => 'copilot',
    isAutoAgentProviderRoutingEnabled: () => false,
    isEffortLevelsEnabled: () => false,
    isCommitChatLensEnabled: () => false,
}));

import { PopOutGitReviewShell } from '../../../../src/server/spa/client/react/layout/PopOutGitReviewShell';

describe('PopOutGitReviewShell PR title collapsible', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPrDiff.mockResolvedValue('');
    });

    it('shows PR title below PR number when loaded', async () => {
        window.history.pushState({}, '', '/?workspace=ws1&repo=repo1#popout/git-review/pr/42');
        mocks.getPr.mockResolvedValue({ title: 'Fix the critical bug', headSha: 'deadbeef' });

        render(<PopOutGitReviewShell />);

        await waitFor(() => {
            expect(screen.getByTestId('popout-pr-title-description')).toBeTruthy();
        });
        expect(screen.getByTestId('popout-pr-title-description').textContent).toBe('Fix the critical bug');
        expect(screen.getByTestId('popout-git-review-title').textContent).toBe('PR #42');
    });

    it('does not show title row before PR data is fetched', async () => {
        window.history.pushState({}, '', '/?workspace=ws1&repo=repo1#popout/git-review/pr/42');
        // Never resolves in this test
        mocks.getPr.mockReturnValue(new Promise(() => {}));

        render(<PopOutGitReviewShell />);

        expect(screen.queryByTestId('popout-pr-title-description')).toBeNull();
        expect(screen.queryByTestId('popout-pr-title-toggle')).toBeNull();
    });

    it('collapses PR title when toggle button is clicked', async () => {
        window.history.pushState({}, '', '/?workspace=ws1&repo=repo1#popout/git-review/pr/42');
        mocks.getPr.mockResolvedValue({ title: 'Add new feature', headSha: 'cafebabe' });

        render(<PopOutGitReviewShell />);

        // Wait for title to appear
        await waitFor(() => {
            expect(screen.getByTestId('popout-pr-title-description')).toBeTruthy();
        });

        // Toggle should be visible
        const toggle = screen.getByTestId('popout-pr-title-toggle');
        expect(toggle).toBeTruthy();

        // Click to collapse
        fireEvent.click(toggle);
        expect(screen.queryByTestId('popout-pr-title-description')).toBeNull();
    });

    it('re-expands PR title when toggle is clicked again', async () => {
        window.history.pushState({}, '', '/?workspace=ws1&repo=repo1#popout/git-review/pr/42');
        mocks.getPr.mockResolvedValue({ title: 'Another fix', headSha: 'abc123' });

        render(<PopOutGitReviewShell />);

        await waitFor(() => {
            expect(screen.getByTestId('popout-pr-title-description')).toBeTruthy();
        });

        const toggle = screen.getByTestId('popout-pr-title-toggle');
        fireEvent.click(toggle);
        expect(screen.queryByTestId('popout-pr-title-description')).toBeNull();

        fireEvent.click(toggle);
        await waitFor(() => {
            expect(screen.getByTestId('popout-pr-title-description')).toBeTruthy();
        });
    });

    it('does not show toggle for non-PR review types', () => {
        window.history.pushState({}, '', '/?workspace=ws1#popout/git-review/branch-range');

        render(<PopOutGitReviewShell />);

        expect(screen.queryByTestId('popout-pr-title-toggle')).toBeNull();
        expect(screen.queryByTestId('popout-pr-title-description')).toBeNull();
    });

    it('does not show title row when PR has no title', async () => {
        window.history.pushState({}, '', '/?workspace=ws1&repo=repo1#popout/git-review/pr/42');
        mocks.getPr.mockResolvedValue({ title: undefined, headSha: 'abc123' });

        render(<PopOutGitReviewShell />);

        await waitFor(() => {
            // Spinner should disappear (PR loaded)
            expect(screen.queryByTestId('spinner')).toBeNull();
        });

        expect(screen.queryByTestId('popout-pr-title-description')).toBeNull();
        expect(screen.queryByTestId('popout-pr-title-toggle')).toBeNull();
    });
});
