import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
    getCommit: vi.fn(),
    commitDiffPath: vi.fn(),
    getBranchRange: vi.fn(),
    listBranchRangeFiles: vi.fn(),
    useCachedDiff: vi.fn(),
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

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        git: {
            getCommit: (...args: unknown[]) => mocks.getCommit(...args),
            commitDiffPath: (...args: unknown[]) => mocks.commitDiffPath(...args),
            getBranchRange: (...args: unknown[]) => mocks.getBranchRange(...args),
            listBranchRangeFiles: (...args: unknown[]) => mocks.listBranchRangeFiles(...args),
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
        state: { activeFilters: [], activeFilterMode: 'all' },
        status: 'idle',
        classification: { getHunkClassification: undefined },
        getHunkClassification: undefined,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/branches/BranchRangeOverview', () => ({
    BranchRangeOverview: ({ isPopOut }: { isPopOut?: boolean }) => (
        <div data-testid="branch-range-overview" data-popout={String(!!isPopOut)} />
    ),
}));

import { PopOutGitReviewShell } from '../../../../src/server/spa/client/react/layout/PopOutGitReviewShell';

const COMMIT_DIFF = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1111111..2222222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
].join('\n');

describe('PopOutGitReviewShell selected-file rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
