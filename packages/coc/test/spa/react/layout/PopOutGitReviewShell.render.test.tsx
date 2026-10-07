import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
    getCommit: vi.fn(),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../../../../src/server/spa/client/react/utils/format', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/utils/format')>(),
    copyToClipboard: mocks.copyToClipboard,
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

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => {
    const createClient = () => ({
        git: {
            getCommit: (...args: unknown[]) => mocks.getCommit(...args),
            commitDiffPath: (...args: unknown[]) => mocks.commitDiffPath(...args),
            getBranchRange: (...args: unknown[]) => mocks.getBranchRange(...args),
            listBranchRangeFiles: (...args: unknown[]) => mocks.listBranchRangeFiles(...args),
        },
        pullRequests: {
            getForOrigin: (...args: unknown[]) => mocks.getPr(...args),
            getDiffForOrigin: (...args: unknown[]) => mocks.getPrDiff(...args),
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
    });
    return {
        getSpaCocClient: createClient,
        getCocClientFor: createClient,
        requestSpaApi: vi.fn().mockResolvedValue(null),
    };
});

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
    FileDiffPanel: ({ workspaceId, attachmentDestinationId, filePath, source, onBack }: {
        workspaceId: string;
        attachmentDestinationId?: string;
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
                data-workspace={workspaceId}
                data-destination={attachmentDestinationId ?? ''}
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
        sourceSelectionId?: string;
        newChatSeedDestinationId?: string;
    }) => (
        <div
            data-testid="commit-chat-panel"
            data-workspace-id={props.workspaceId}
            data-commit-hash={props.commitHash}
            data-commit-message={props.commitMessage ?? ''}
            data-hide-empty-header={props.hideEmptyHeader ? 'true' : 'false'}
            data-owner={props.sourceSelectionId}
            data-seed-owner={props.newChatSeedDestinationId}
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
        sourceSelectionId?: string;
        newChatSeedDestinationId?: string;
    }) => (
        <div
            data-testid="pr-chat-panel"
            data-workspace-id={props.workspaceId}
            data-pr-id={props.prId}
            data-file-path={props.filePath ?? ''}
            data-repo-id={props.repoId ?? ''}
            data-pr-title={props.prTitle ?? ''}
            data-hide-empty-header={props.hideEmptyHeader ? 'true' : 'false'}
            data-owner={props.sourceSelectionId}
            data-seed-owner={props.newChatSeedDestinationId}
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
import { resetCloneRegistryForTests, lookupCloneBaseUrl } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import {
    buildGitReviewPopOutUrl, buildGitBranchRangePopOutUrl, buildGitPrPopOutUrl,
} from '../../../../src/server/spa/client/react/layout/dashboardRoutes';

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
    afterEach(() => resetCloneRegistryForTests());

    beforeEach(() => {
        resetCloneRegistryForTests();
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

    it.each(['commit', 'branch-range', 'pr'] as const)(
        'preserves %s selection ownership through the real shell and adapter',
        async reviewType => {
            mocks.getCommit.mockResolvedValue({ hash: 'abc123', shortHash: 'abc123', subject: 'Fix app', parentHashes: [] });
            mocks.listBranchRangeFiles.mockResolvedValue({
                files: [
                    { path: 'src/branch.ts', status: 'modified', additions: 1, deletions: 1 },
                    { path: 'src/other.ts', status: 'modified', additions: 1, deletions: 1 },
                ],
            });
            const filePath = reviewType === 'commit' ? 'src/app.ts' : reviewType === 'pr' ? 'src/pr.ts' : 'src/branch.ts';
            const urlFor = (owner?: string, endpoint?: string) => {
                if (reviewType === 'commit') return buildGitReviewPopOutUrl('ws1', 'abc123', endpoint, owner);
                if (reviewType === 'pr') return buildGitPrPopOutUrl('ws1', 'repo1', 42, 'origin1', endpoint, owner);
                return buildGitBranchRangePopOutUrl('ws1', endpoint, 'upstream', owner);
            };
            window.history.pushState({}, '', urlFor('ws1'));
            const view = render(<PopOutGitReviewShell />);
            await screen.findByTestId('popout-file-panel');
            fireEvent.click(screen.getByText(filePath));
            const panel = await screen.findByTestId('file-diff-panel');
            expect(panel.getAttribute('data-workspace')).toBe('ws1');
            expect(panel.getAttribute('data-destination')).toBe('ws1');

            for (const [owner, endpoint] of [
                ['remote:server-a:ws1', 'https://clone-a.example.test'],
                ['remote:server-b:ws1', 'https://clone-b.example.test'],
            ]) {
                window.history.pushState({}, '', urlFor(owner, endpoint));
                view.rerender(<PopOutGitReviewShell />);
                expect(screen.getByTestId('file-diff-panel').getAttribute('data-destination')).toBe(owner);
                expect(screen.getByTestId('file-diff-panel').getAttribute('data-workspace')).toBe('ws1');
                expect(lookupCloneBaseUrl(owner)).toBe(endpoint);
            }
            if (reviewType === 'branch-range') {
                fireEvent.click(screen.getByText('src/other.ts'));
                expect(screen.getByTestId('file-diff-panel').getAttribute('data-destination')).toBe('remote:server-b:ws1');
            }
            window.history.pushState({}, '', urlFor());
            view.rerender(<PopOutGitReviewShell />);
            expect(screen.getByTestId('file-diff-panel').getAttribute('data-destination')).toBe('');
        },
    );

    it('keeps the commit subject, full body and copyable metadata above selected-file diffs', async () => {
        window.history.pushState({}, '', buildGitReviewPopOutUrl('ws1', 'abc123'));
        mocks.getCommit.mockResolvedValue({
            hash: 'abc123456789', shortHash: 'abc1234', subject: 'Explain the real commit',
            author: 'Commit Author', authorEmail: 'author@example.test', date: '2026-01-01T00:00:00Z',
            parentHashes: ['parent123456'], body: 'First paragraph\n\nSecond paragraph with details.',
        });
        render(<PopOutGitReviewShell />);
        await screen.findByTestId('commit-info-header');
        expect(screen.getByTestId('popout-git-review-title')).toHaveTextContent('Explain the real commit');
        expect(screen.getByTestId('popout-git-review-identifier')).toHaveTextContent('Commit abc123');
        expect(document.title).toContain('Explain the real commit');
        expect(screen.getByTestId('commit-info-author')).toHaveTextContent('Commit Author');
        expect(screen.getByTestId('commit-info-email')).toHaveTextContent('author@example.test');
        expect(screen.getByTestId('commit-info-parents')).toHaveTextContent('parent1');
        expect(screen.getByTestId('commit-info-body').textContent).toBe('First paragraph\n\nSecond paragraph with details.');
        fireEvent.click(screen.getByText('src/app.ts'));
        expect(await screen.findByTestId('file-diff-panel')).toHaveAttribute('data-file', 'src/app.ts');
        expect(screen.getByTestId('commit-info-body')).toBeVisible();
        fireEvent.click(screen.getByTestId('commit-info-copy-hash'));
        expect(mocks.copyToClipboard).toHaveBeenCalledWith('abc123456789');
        await waitFor(() => expect(screen.getByTestId('commit-info-copy-hash')).toHaveAttribute('aria-label', 'Copied!'));
        fireEvent.click(screen.getByTestId('commit-info-collapse-btn'));
        expect(screen.getByTestId('commit-info-body')).not.toBeVisible();
        expect(screen.getByTestId('commit-info-summary')).toHaveTextContent('Explain the real commit');
        expect(screen.getByTestId('commit-summary-copy-hash')).toHaveTextContent('abc12345');
        fireEvent.click(screen.getByTestId('commit-info-summary'));
        expect(screen.getByTestId('commit-info-body')).toBeVisible();
        expect(screen.getByTestId('file-diff-panel')).toHaveAttribute('data-file', 'src/app.ts');
    });

    it.each(['**Markdown description**\n\n[Email](mailto:user@example.test)', '   '])(
        'uses inline PR description resolution and rendering for %j', async description => {
            window.history.pushState({}, '', buildGitPrPopOutUrl('ws1', 'repo1', 42, 'origin1', 'https://remote.example.test', 'remote:server:ws1'));
            mocks.getPr.mockResolvedValue({
                title: 'Describe the PR', description, headSha: 'head42',
                author: { displayName: 'PR Author' }, sourceBranch: 'feature', targetBranch: 'main',
                url: 'https://example.test/pr/42',
            });
            render(<PopOutGitReviewShell />);
            await screen.findByTestId('popout-pr-details');
            expect(mocks.getPr).toHaveBeenCalledWith('origin1', '42', { workspaceId: 'ws1', repoId: 'repo1' });
            expect(lookupCloneBaseUrl('remote:server:ws1')).toBe('https://remote.example.test');
            expect(screen.getByTestId('popout-git-review-title')).toHaveTextContent('Describe the PR');
            expect(screen.getByTestId('popout-git-review-identifier')).toHaveTextContent('PR #42');
            const body = screen.getByTestId('pr-review-summary-copy');
            if (description.trim()) {
                expect(body.querySelector('strong')).toHaveTextContent('Markdown description');
                expect(body.querySelector('a')).toBeNull();
                expect(body).toHaveTextContent('Email');
            } else {
                expect(body).toHaveTextContent('No PR description provided.');
            }
            expect(screen.getByTestId('popout-pr-details')).toHaveTextContent('feature → main');
            fireEvent.click(screen.getByText('src/pr.ts'));
            const panel = await screen.findByTestId('file-diff-panel');
            expect(panel).toHaveAttribute('data-destination', 'remote:server:ws1');
            fireEvent.click(screen.getByTestId('popout-pr-title-toggle'));
            expect(screen.queryByTestId('popout-pr-details')).toBeNull();
            expect(screen.getByTestId('popout-git-review-title')).toHaveTextContent('Describe the PR');
            expect(panel).toHaveAttribute('data-file', 'src/pr.ts');
            fireEvent.click(screen.getByTestId('popout-pr-title-toggle'));
            expect(screen.getByTestId('pr-review-summary-copy')).toBeVisible();
        },
    );

    it.each(['commit', 'pr'] as const)('ignores late %s descriptions after changing workspace', async reviewType => {
        let resolveOld!: (value: any) => void;
        const pending = new Promise(resolve => { resolveOld = resolve; });
        const api = reviewType === 'commit' ? mocks.getCommit : mocks.getPr;
        const oldData = { hash: 'abc123', shortHash: 'abc123', parentHashes: [], subject: 'Old commit', title: 'Old PR', description: 'Old body' };
        const newData = { ...oldData, subject: 'New commit', title: 'New PR', description: 'New body' };
        api.mockReturnValueOnce(pending).mockResolvedValue(newData);
        const url = (ws: string) => reviewType === 'commit'
            ? buildGitReviewPopOutUrl(ws, 'abc123')
            : buildGitPrPopOutUrl(ws, 'repo1', 42, 'origin1');
        window.history.pushState({}, '', url('ws1'));
        const view = render(<PopOutGitReviewShell />);
        window.history.pushState({}, '', url('ws2'));
        view.rerender(<PopOutGitReviewShell />);
        await waitFor(() => expect(screen.getByTestId('popout-git-review-title')).toHaveTextContent(reviewType === 'commit' ? 'New commit' : 'New PR'));
        resolveOld(oldData);
        await waitFor(() => expect(screen.getByTestId('popout-git-review-title')).toHaveTextContent(reviewType === 'commit' ? 'New commit' : 'New PR'));
        expect(screen.queryByText('Old body')).toBeNull();
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
        // The popout defaults to comparing against the default branch, so both
        // branch-range reads carry the base mode.
        expect(mocks.getBranchRange).toHaveBeenCalledWith('ws1', { base: 'default-branch' });
        expect(mocks.listBranchRangeFiles).toHaveBeenCalledWith('ws1', { base: 'default-branch' });
        fireEvent.click(screen.getByText('src/branch.ts'));

        const panel = await screen.findByTestId('file-diff-panel');
        expect(panel.getAttribute('data-file')).toBe('src/branch.ts');
        // Cache key carries the base mode so an upstream comparison can't reuse
        // the default-branch diff.
        expect(panel.getAttribute('data-cache-key')).toBe('branch-range:default-branch');
        expect(panel.getAttribute('data-old-ref')).toBe('branch-base');
        expect(panel.getAttribute('data-new-ref')).toBe('branch-head');
        expect(screen.queryByTestId('branch-range-overview')).toBeNull();
    });

    it('opens commit popout chat as a desktop lens and pins back to the right column', async () => {
        mocks.isCommitChatLensEnabled.mockReturnValue(true);
        window.history.pushState({}, '', '/?workspace=ws1&sourceSelectionId=remote%3Aone%3Aws1&cloneBaseUrl=https%3A%2F%2Fone.example#popout/git-review/abc123');
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
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-owner')).toBe('remote:one:ws1');
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-seed-owner')).toBe('remote:one:ws1');

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
        window.history.pushState({}, '', '/?workspace=ws1&repo=repo1&sourceSelectionId=remote%3Aone%3Aws1&cloneBaseUrl=https%3A%2F%2Fone.example#popout/git-review/pr/42');

        render(<PopOutGitReviewShell />);

        await screen.findByTestId('popout-file-panel');
        expect(mocks.getPr).toHaveBeenCalledWith('local_ws1', '42', { workspaceId: 'ws1', repoId: 'repo1' });
        expect(mocks.getPrDiff).toHaveBeenCalledWith('local_ws1', '42', { workspaceId: 'ws1', repoId: 'repo1' });
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
        expect(panel.getAttribute('data-owner')).toBe('remote:one:ws1');
        expect(panel.getAttribute('data-seed-owner')).toBe('remote:one:ws1');

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
