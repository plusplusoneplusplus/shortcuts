import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
    getCommit: vi.fn(),
    commitDiffPath: vi.fn(),
    getPr: vi.fn(),
    getPrDiff: vi.fn(),
    getBranchRange: vi.fn(),
    listBranchRangeFiles: vi.fn(),
    useCachedDiff: vi.fn(),
    isCommitChatLensEnabled: vi.fn(() => false),
    useBreakpoint: vi.fn(),
    postMessage: vi.fn(),
    commentCounts: new Map<string, number>(),
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

vi.mock('../../../../src/server/spa/client/react/utils/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/utils/config')>();
    return {
        ...actual,
        getHostname: () => '',
        isCommitChatLensEnabled: mocks.isCommitChatLensEnabled,
    };
});

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: mocks.useBreakpoint,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        git: {
            getCommit: (...args: unknown[]) => mocks.getCommit(...args),
            commitDiffPath: (...args: unknown[]) => mocks.commitDiffPath(...args),
            getBranchRange: (...args: unknown[]) => mocks.getBranchRange(...args),
            listBranchRangeFiles: (...args: unknown[]) => mocks.listBranchRangeFiles(...args),
        },
        pullRequests: {
            get: (...args: unknown[]) => mocks.getPr(...args),
            getDiff: (...args: unknown[]) => mocks.getPrDiff(...args),
            getReviewProgressForOrigin: vi.fn().mockResolvedValue({
                repoId: 'repo1',
                prId: '42',
                headSha: 'head123',
                reviewedFiles: [],
                visitedFiles: [],
                lastSelectedFile: null,
                updatedAt: new Date(0).toISOString(),
            }),
            saveReviewProgressForOrigin: vi.fn().mockResolvedValue({
                repoId: 'repo1',
                prId: '42',
                headSha: 'head123',
                reviewedFiles: [],
                visitedFiles: [],
                lastSelectedFile: null,
                updatedAt: new Date(0).toISOString(),
            }),
        },
        preferences: {
            getRepo: vi.fn().mockResolvedValue({}),
            patchRepo: vi.fn().mockResolvedValue({}),
        },
        agentProviders: {
            getReasoningEfforts: vi.fn().mockResolvedValue({ reasoningEfforts: {} }),
            getEffortTiers: vi.fn().mockResolvedValue({ effortTiers: {}, defaults: {} }),
        },
    }),
    requestSpaApi: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useCommitDiffCache', () => ({
    useCachedDiff: (...args: unknown[]) => mocks.useCachedDiff(...args),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => ({
    useFileCommentCounts: () => mocks.commentCounts,
}));

vi.mock('../../../../src/server/spa/client/comments/diff-comment-utils', () => ({
    computeDiffCommentKey: vi.fn().mockResolvedValue('comment-key'),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/GitReviewPopOutContext', () => ({
    useGitReviewPopOutChannel: () => ({ postMessage: mocks.postMessage }),
    gitReviewPopOutKey: (workspaceId: string, commitHash: string) => `${workspaceId}:commit:${commitHash}`,
    gitReviewBranchPopOutKey: (workspaceId: string) => `${workspaceId}:branch`,
    gitReviewPrPopOutKey: (workspaceId: string, prId: string) => `${workspaceId}:pr:${prId}`,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/PopOutFilePanel', () => ({
    PopOutFilePanel: ({ files, selectedFilePath, onFileSelect }: {
        files: Array<{ path: string }>;
        selectedFilePath: string | null;
        onFileSelect: (filePath: string) => void;
    }) => (
        <div data-testid="popout-file-panel" data-selected={selectedFilePath ?? ''}>
            {files.map(file => (
                <button key={file.path} type="button" onClick={() => onFileSelect(file.path)}>
                    {file.path}
                </button>
            ))}
        </div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    FileDiffPanel: ({ filePath, source, onBack }: {
        filePath: string;
        source: {
            cacheKey: string;
            commentContext(filePath: string): { oldRef: string; newRef: string };
        };
        onBack?: () => void;
    }) => {
        const context = source.commentContext(filePath);
        return (
            <div
                data-testid="file-diff-panel"
                data-file={filePath}
                data-cache-key={source.cacheKey}
                data-old-ref={context.oldRef}
                data-new-ref={context.newRef}
            >
                <button type="button" data-testid="file-diff-back-btn" onClick={onBack}>
                    All files
                </button>
            </div>
        );
    },
}));

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({
    CommitChatPanel: (props: {
        workspaceId: string;
        commitHash: string;
        commitMessage?: string;
        hideEmptyHeader?: boolean;
    }) => (
        <div
            data-testid="commit-chat-panel"
            data-workspace-id={props.workspaceId}
            data-commit-hash={props.commitHash}
            data-commit-message={props.commitMessage ?? ''}
            data-hide-empty-header={props.hideEmptyHeader ? 'true' : 'false'}
        />
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/commits/PrChatPanel', () => ({
    PrChatPanel: (props: {
        workspaceId: string;
        prId: string;
        filePath?: string;
        repoId?: string;
        prTitle?: string;
        hideEmptyHeader?: boolean;
    }) => (
        <div
            data-testid="pr-chat-panel"
            data-workspace-id={props.workspaceId}
            data-pr-id={props.prId}
            data-file-path={props.filePath ?? ''}
            data-repo-id={props.repoId ?? ''}
            data-pr-title={props.prTitle ?? ''}
            data-hide-empty-header={props.hideEmptyHeader ? 'true' : 'false'}
        />
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitDetail', () => ({
    CommitDetail: ({ isPopOut }: { isPopOut?: boolean }) => (
        <div data-testid="commit-detail" data-popout={String(!!isPopOut)} />
    ),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useAgentProviders', () => ({
    useAgentProviders: () => ({
        providers: [],
        loading: false,
        error: null,
        reload: vi.fn(),
        copilot: undefined,
        codex: undefined,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/useClassification', () => ({
    useClassification: () => ({
        state: { status: 'idle', activeFilters: new Set() },
        classify: vi.fn(),
        toggleFilter: vi.fn(),
        setFilters: vi.fn(),
        getFileBadge: vi.fn(),
        getHunkClassification: undefined,
        isHunkDimmed: vi.fn(),
        isFileDimmed: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/branches/BranchRangeOverview', () => ({
    BranchRangeOverview: ({ isPopOut }: { isPopOut?: boolean }) => (
        <div data-testid="branch-range-overview" data-popout={String(!!isPopOut)} />
    ),
}));

import { PopOutGitReviewShell } from '../../../../src/server/spa/client/react/layout/PopOutGitReviewShell';
import { getReviewChatPlacementStorageKey } from '../../../../src/server/spa/client/react/features/git/commits/commitChatPlacement';

const COMMIT_DIFF = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1111111..2222222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
].join('\n');

const PR_DIFF = [
    'diff --git a/src/pr.ts b/src/pr.ts',
    'index 3333333..4444444 100644',
    '--- a/src/pr.ts',
    '+++ b/src/pr.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
].join('\n');

describe('PopOutGitReviewShell selected-file rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mocks.isCommitChatLensEnabled.mockReturnValue(false);
        mocks.useBreakpoint.mockReturnValue({
            isMobile: false,
            isTablet: false,
            isDesktop: true,
            breakpoint: 'desktop',
        });
        mocks.commitDiffPath.mockImplementation((workspaceId: string, hash: string) => (
            `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${encodeURIComponent(hash)}/diff`
        ));
        mocks.getBranchRange.mockResolvedValue({
            baseRef: 'main',
            headRef: 'feature',
            commitCount: 0,
            additions: 0,
            deletions: 0,
            mergeBase: 'abc123',
            fileCount: 1,
            commits: [],
        });
        mocks.listBranchRangeFiles.mockResolvedValue({ files: [] });
        mocks.useCachedDiff.mockReturnValue({ diff: COMMIT_DIFF });
        mocks.getPr.mockResolvedValue({ title: 'Fix PR risk', headSha: 'head-sha-42' });
        mocks.getPrDiff.mockResolvedValue(PR_DIFF);
    });

    it('switches commit popout selected files to comment-enabled FileDiffPanel', async () => {
        window.history.pushState({}, '', '/?workspace=ws1#popout/git-review/abc123');
        mocks.getCommit.mockResolvedValue({
            hash: 'abc123',
            shortHash: 'abc123',
            subject: 'Fix app',
            author: 'Test Author',
            date: '2026-01-01T00:00:00Z',
            parentHashes: [],
        });

        render(<PopOutGitReviewShell />);

        await screen.findByTestId('popout-file-panel');
        expect(mocks.getCommit).toHaveBeenCalledWith('ws1', 'abc123');
        expect(mocks.commitDiffPath).toHaveBeenCalledWith('ws1', 'abc123');
        fireEvent.click(screen.getByText('src/app.ts'));

        const panel = await screen.findByTestId('file-diff-panel');
        expect(panel.getAttribute('data-file')).toBe('src/app.ts');
        expect(panel.getAttribute('data-cache-key')).toBe('commit:abc123');
        expect(panel.getAttribute('data-old-ref')).toBe('abc123^');
        expect(panel.getAttribute('data-new-ref')).toBe('abc123');
        expect(screen.queryByTestId('commit-detail')).toBeNull();

        fireEvent.click(screen.getByTestId('file-diff-back-btn'));
        await waitFor(() => expect(screen.getByTestId('popout-file-panel')).toBeTruthy());
    });

    it('switches branch-range popout selected files to comment-enabled FileDiffPanel', async () => {
        window.history.pushState({}, '', '/?workspace=ws1#popout/git-review/branch-range');
        mocks.getBranchRange.mockResolvedValue({
            baseRef: 'main',
            headRef: 'feature',
            commitCount: 0,
            additions: 1,
            deletions: 1,
            mergeBase: 'abc123',
            fileCount: 1,
            commits: [],
        });
        mocks.listBranchRangeFiles.mockResolvedValue({
            files: [{ path: 'src/branch.ts', status: 'modified', additions: 1, deletions: 1 }],
        });

        render(<PopOutGitReviewShell />);

        await screen.findByTestId('branch-range-overview');
        expect(mocks.getBranchRange).toHaveBeenCalledWith('ws1');
        expect(mocks.listBranchRangeFiles).toHaveBeenCalledWith('ws1');
        fireEvent.click(screen.getByText('src/branch.ts'));

        const panel = await screen.findByTestId('file-diff-panel');
        expect(panel.getAttribute('data-file')).toBe('src/branch.ts');
        expect(panel.getAttribute('data-cache-key')).toBe('branch-range');
        expect(panel.getAttribute('data-old-ref')).toBe('branch-base');
        expect(panel.getAttribute('data-new-ref')).toBe('branch-head');
        expect(screen.queryByTestId('branch-range-overview')).toBeNull();
    });

    it('opens commit popout chat as a desktop lens and pins back to the right column', async () => {
        mocks.isCommitChatLensEnabled.mockReturnValue(true);
        window.history.pushState({}, '', '/?workspace=ws1#popout/git-review/abc123');
        mocks.getCommit.mockResolvedValue({
            hash: 'abc123',
            shortHash: 'abc123',
            subject: 'Fix app',
            author: 'Test Author',
            date: '2026-01-01T00:00:00Z',
            parentHashes: [],
        });

        render(<PopOutGitReviewShell />);

        await screen.findByTestId('popout-file-panel');
        fireEvent.click(screen.getByTestId('commit-popout-chat-toggle'));

        await waitFor(() => expect(screen.getByTestId('commit-chat-lens')).toBeTruthy());
        expect(screen.queryByTestId('commit-popout-chat-container')).toBeNull();
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-commit-hash')).toBe('abc123');
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-commit-message')).toBe('Fix app');
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-hide-empty-header')).toBe('true');

        fireEvent.click(screen.getByTestId('commit-chat-pin-btn'));

        const placementKey = getReviewChatPlacementStorageKey({
            type: 'commit',
            workspaceId: 'ws1',
            commitHash: 'abc123',
        });
        expect(localStorage.getItem(placementKey)).toBe('side-panel');
        expect(screen.getByTestId('commit-popout-chat-container')).toBeTruthy();
        expect(screen.getByTestId('commit-chat-side-panel')).toBeTruthy();
        expect(screen.queryByTestId('commit-chat-lens')).toBeNull();

        fireEvent.click(screen.getByTestId('commit-chat-unpin-btn'));

        expect(localStorage.getItem(placementKey)).toBeNull();
        expect(screen.getByTestId('commit-chat-lens')).toBeTruthy();
        expect(screen.queryByTestId('commit-popout-chat-container')).toBeNull();
    });

    it('keeps commit popout chat in the legacy right column when the flag is disabled', async () => {
        window.history.pushState({}, '', '/?workspace=ws1#popout/git-review/abc123');
        mocks.getCommit.mockResolvedValue({
            hash: 'abc123',
            shortHash: 'abc123',
            subject: 'Fix app',
            author: 'Test Author',
            date: '2026-01-01T00:00:00Z',
            parentHashes: [],
        });

        render(<PopOutGitReviewShell />);

        await screen.findByTestId('popout-file-panel');
        fireEvent.click(screen.getByTestId('commit-popout-chat-toggle'));

        expect(screen.getByTestId('commit-popout-chat-container')).toBeTruthy();
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-hide-empty-header')).toBe('false');
        expect(screen.queryByTestId('commit-chat-lens')).toBeNull();
        expect(screen.queryByTestId('commit-chat-side-panel')).toBeNull();
    });

    it('keeps commit popout chat in the legacy right column on mobile when the flag is enabled', async () => {
        mocks.isCommitChatLensEnabled.mockReturnValue(true);
        mocks.useBreakpoint.mockReturnValue({
            isMobile: true,
            isTablet: false,
            isDesktop: false,
            breakpoint: 'mobile',
        });
        window.history.pushState({}, '', '/?workspace=ws1#popout/git-review/abc123');
        mocks.getCommit.mockResolvedValue({
            hash: 'abc123',
            shortHash: 'abc123',
            subject: 'Fix app',
            author: 'Test Author',
            date: '2026-01-01T00:00:00Z',
            parentHashes: [],
        });

        render(<PopOutGitReviewShell />);

        await screen.findByTestId('popout-file-panel');
        fireEvent.click(screen.getByTestId('commit-popout-chat-toggle'));

        expect(screen.getByTestId('commit-popout-chat-container')).toBeTruthy();
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-hide-empty-header')).toBe('false');
        expect(screen.queryByTestId('commit-chat-lens')).toBeNull();
        expect(screen.queryByTestId('commit-chat-side-panel')).toBeNull();
        expect(screen.queryByTestId('commit-chat-unpin-btn')).toBeNull();
    });

    it('opens PR popout chat as a desktop lens and pins back to the right column', async () => {
        mocks.isCommitChatLensEnabled.mockReturnValue(true);
        window.history.pushState({}, '', '/?workspace=ws1&repo=repo1#popout/git-review/pr/42');

        render(<PopOutGitReviewShell />);

        await screen.findByTestId('popout-file-panel');
        expect(mocks.getPr).toHaveBeenCalledWith('repo1', '42');
        expect(mocks.getPrDiff).toHaveBeenCalledWith('repo1', '42');
        fireEvent.click(screen.getByText('src/pr.ts'));

        await screen.findByTestId('file-diff-panel');
        fireEvent.click(screen.getByTestId('pr-popout-chat-toggle'));

        await waitFor(() => expect(screen.getByTestId('pr-chat-lens')).toBeTruthy());
        expect(screen.getByTestId('pr-chat-lens-header')).toHaveTextContent('PR Chat');
        expect(screen.getByTestId('pr-chat-lens-header')).toHaveTextContent('#42');
        expect(screen.queryByTestId('pr-popout-chat-container')).toBeNull();

        const panel = screen.getByTestId('pr-chat-panel');
        expect(panel.getAttribute('data-workspace-id')).toBe('ws1');
        expect(panel.getAttribute('data-pr-id')).toBe('42');
        expect(panel.getAttribute('data-file-path')).toBe('src/pr.ts');
        expect(panel.getAttribute('data-repo-id')).toBe('repo1');
        expect(panel.getAttribute('data-pr-title')).toBe('Fix PR risk');
        expect(panel.getAttribute('data-hide-empty-header')).toBe('true');

        fireEvent.click(screen.getByTestId('pr-chat-pin-btn'));

        const placementKey = getReviewChatPlacementStorageKey({
            type: 'pr',
            workspaceId: 'ws1',
            repoId: 'repo1',
            prId: '42',
            headSha: 'head-sha-42',
        });
        expect(localStorage.getItem(placementKey)).toBe('side-panel');
        expect(screen.getByTestId('pr-popout-chat-container')).toBeTruthy();
        expect(screen.getByTestId('pr-chat-side-panel')).toBeTruthy();
        expect(screen.queryByTestId('pr-chat-lens')).toBeNull();
        expect(screen.getByTestId('pr-chat-panel').getAttribute('data-hide-empty-header')).toBe('true');

        fireEvent.click(screen.getByTestId('pr-chat-unpin-btn'));

        expect(localStorage.getItem(placementKey)).toBeNull();
        expect(screen.getByTestId('pr-chat-lens')).toBeTruthy();
        expect(screen.queryByTestId('pr-popout-chat-container')).toBeNull();
    });

    it('keeps PR popout chat in the legacy right column when the flag is disabled', async () => {
        window.history.pushState({}, '', '/?workspace=ws1&repo=repo1#popout/git-review/pr/42');

        render(<PopOutGitReviewShell />);

        await screen.findByTestId('popout-file-panel');
        fireEvent.click(screen.getByTestId('pr-popout-chat-toggle'));

        expect(screen.getByTestId('pr-popout-chat-container')).toBeTruthy();
        expect(screen.getByTestId('pr-chat-panel').getAttribute('data-hide-empty-header')).toBe('false');
        expect(screen.queryByTestId('pr-chat-lens')).toBeNull();
        expect(screen.queryByTestId('pr-chat-side-panel')).toBeNull();
    });

    it('keeps PR popout chat in the legacy right column on mobile when the flag is enabled', async () => {
        mocks.isCommitChatLensEnabled.mockReturnValue(true);
        mocks.useBreakpoint.mockReturnValue({
            isMobile: true,
            isTablet: false,
            isDesktop: false,
            breakpoint: 'mobile',
        });
        window.history.pushState({}, '', '/?workspace=ws1&repo=repo1#popout/git-review/pr/42');

        render(<PopOutGitReviewShell />);

        await screen.findByTestId('popout-file-panel');
        fireEvent.click(screen.getByTestId('pr-popout-chat-toggle'));

        expect(screen.getByTestId('pr-popout-chat-container')).toBeTruthy();
        expect(screen.getByTestId('pr-chat-panel').getAttribute('data-hide-empty-header')).toBe('false');
        expect(screen.queryByTestId('pr-chat-lens')).toBeNull();
        expect(screen.queryByTestId('pr-chat-side-panel')).toBeNull();
        expect(screen.queryByTestId('pr-chat-unpin-btn')).toBeNull();
    });
});
