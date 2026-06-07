import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockQueueDispatch = vi.fn();

vi.mock('../../../../src/server/spa/client/react/featureFlags', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/featureFlags')>();
    return {
        ...actual,
        SHOW_COMMIT_CHAT_LENS: true,
    };
});

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        git: {
            commitDiffPath: (workspaceId: string, hash: string) =>
                `/api/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${encodeURIComponent(hash)}/diff`,
            commitFileDiffPath: (workspaceId: string, hash: string, filePath: string) =>
                `/api/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${encodeURIComponent(hash)}/files/${encodeURIComponent(filePath)}/diff`,
            listCommitFiles: vi.fn().mockResolvedValue({
                files: [
                    { status: 'modified', path: 'src/example.ts' },
                    { status: 'modified', path: 'src/other.ts' },
                ],
            }),
        },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        breakpoint: 'desktop',
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 360,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        resetWidth: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: { dialogLaunchMode: 'default', dialogMode: 'task' },
        dispatch: mockQueueDispatch,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/GitReviewPopOutContext', () => ({
    useGitReviewPopOut: () => ({ markPoppedOut: vi.fn() }),
    gitReviewPopOutKey: (workspaceId: string, hash: string) => `${workspaceId}:${hash}`,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useCommitDiffCache', () => ({
    useCachedDiff: () => ({
        diff: 'diff --git a/src/example.ts b/src/example.ts\n@@ -1 +1 @@\n-old\n+new',
        loading: false,
        error: null,
        retry: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileDiff', () => ({
    useFileDiff: () => ({
        diff: 'diff --git a/src/example.ts b/src/example.ts\n@@ -1 +1 @@\n-old\n+new',
        loading: false,
        error: null,
        retry: vi.fn(),
        truncated: false,
        totalLines: 0,
        requestFullDiff: vi.fn(),
        fullContextUnavailable: undefined,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: () => ({
        comments: [],
        loading: false,
        error: null,
        isEphemeral: false,
        addComment: vi.fn().mockResolvedValue({}),
        updateComment: vi.fn().mockResolvedValue({}),
        deleteComment: vi.fn().mockResolvedValue(undefined),
        resolveComment: vi.fn().mockResolvedValue({}),
        unresolveComment: vi.fn().mockResolvedValue({}),
        runRelocation: vi.fn(),
        askAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),
        resolvingIds: new Set(),
        deletingIds: new Set(),
        copyAllCommentsAsPrompt: vi.fn(),
        resolveWithAI: vi.fn(),
        fixWithAI: vi.fn(),
        refresh: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useAllCommitComments', () => ({
    useAllCommitComments: () => ({
        comments: [],
        loading: false,
        resolveComment: vi.fn(),
        unresolveComment: vi.fn(),
        deleteComment: vi.fn(),
        updateComment: vi.fn(),
        copyAllCommentsAsPrompt: vi.fn(),
        resolveWithAI: vi.fn(),
        fixWithAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/usePrReviewProgress', () => ({
    usePrReviewProgress: () => ({
        state: {
            visitedFiles: new Set(),
            reviewedFiles: new Set(),
            headSha: 'abc1234567890',
            hydrated: true,
        },
        isReviewed: () => false,
        isVisited: () => false,
        markVisited: vi.fn(),
        markReviewed: vi.fn(),
        unmarkReviewed: vi.fn(),
        toggleReviewed: vi.fn(),
        setLastSelectedFile: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    useModalJobAiSelection: () => ({
        resolved: { provider: 'copilot' },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/useClassification', () => ({
    useClassification: () => ({
        state: { status: 'idle', activeFilters: new Set(), error: undefined, result: undefined },
        classify: vi.fn(),
        toggleFilter: vi.fn(),
        setFilters: vi.fn(),
        isFileDimmed: () => false,
        getFileBadge: () => undefined,
        getHunkClassification: () => null,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/ClassifyDiffAiControls', () => ({
    ClassifyDiffAiControls: () => <div data-testid="classify-diff-ai-controls" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ 'data-testid': testId }: { 'data-testid'?: string }) => (
        <div data-testid={testId ?? 'mock-diff-viewer'}>diff content</div>
    ),
    HunkNavButtons: () => <div data-testid="hunk-nav-buttons" />,
    parseDiffFileList: () => ['src/example.ts'],
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer', () => ({
    SideBySideDiffViewer: ({ 'data-testid': testId }: { 'data-testid'?: string }) => (
        <div data-testid={testId ?? 'mock-side-by-side-diff'}>split diff</div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/DiffViewToggle', () => ({
    DiffViewToggle: ({ mode }: { mode: string }) => <button data-testid="diff-view-toggle">{mode}</button>,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/DiffMiniMap', () => ({
    DiffMiniMap: () => <div data-testid="diff-mini-map" />,
}));

vi.mock('../../../../src/server/spa/client/react/tasks/comments/CommentSidebar', () => ({
    CommentSidebar: (props: any) => <div data-testid={props['data-testid'] ?? 'comment-sidebar'} />,
}));

vi.mock('../../../../src/server/spa/client/react/tasks/comments/InlineCommentPopup', () => ({
    InlineCommentPopup: () => <div data-testid="inline-comment-popup" />,
}));

vi.mock('../../../../src/server/spa/client/react/tasks/comments/CommentPopover', () => ({
    CommentPopover: () => <div data-testid="comment-popover" />,
}));

vi.mock('../../../../src/server/spa/client/react/shared/ResolveContextDialog', () => ({
    shouldSkipResolveDialog: () => false,
    ResolveContextDialog: () => null,
    resetSkipResolveDialog: () => {},
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({
    CommitChatPanel: (props: any) => (
        <div
            data-testid="commit-chat-panel"
            data-workspace-id={props.workspaceId}
            data-commit-hash={props.commitHash}
            data-commit-message={props.commitMessage ?? ''}
            data-hide-empty-header={props.hideEmptyHeader ? 'true' : 'false'}
        />
    ),
}));

import { WorkItemCommitReviewPane } from '../../../../src/server/spa/client/react/features/work-items/WorkItemCommitReviewPane';
import { getCommitChatPlacementStorageKey } from '../../../../src/server/spa/client/react/features/git/commits/commitChatPlacement';

const commitFiles = [
    { status: 'modified', path: 'src/example.ts' },
    { status: 'modified', path: 'src/other.ts' },
];

function WorkItemCommitReviewHarness() {
    const [selectedCommitFile, setSelectedCommitFile] = useState<string | null>('src/example.ts');
    return (
        <WorkItemCommitReviewPane
            workspaceId="ws-test"
            selectedCommitHash="abc1234567890"
            selectedCommitFile={selectedCommitFile}
            commitFiles={commitFiles}
            commitFilesLoading={false}
            commitFilePaths={commitFiles.map(file => file.path)}
            fileCommentMap={new Map()}
            hunkTarget={undefined}
            onBackFromCommit={() => setSelectedCommitFile(null)}
            onCommitFileSelect={setSelectedCommitFile}
            onNavigateToFile={(filePath) => setSelectedCommitFile(filePath)}
        />
    );
}

describe('WorkItemCommitReviewPane commit chat lens', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('uses lens placement in embedded file diff and overview commit review surfaces', async () => {
        render(<WorkItemCommitReviewHarness />);

        fireEvent.click(screen.getByTestId('toggle-chat-btn'));

        const placementKey = getCommitChatPlacementStorageKey('ws-test', 'abc1234567890');
        await waitFor(() => expect(screen.getByTestId('commit-chat-lens')).toBeTruthy());
        expect(screen.queryByTestId('commit-chat-side-panel')).toBeNull();
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-workspace-id')).toBe('ws-test');
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-commit-hash')).toBe('abc1234567890');
        expect(screen.getByTestId('file-diff-section').className).toContain('overflow-auto');

        fireEvent.click(screen.getByTestId('commit-chat-pin-btn'));

        await waitFor(() => expect(screen.getByTestId('commit-chat-side-panel')).toBeTruthy());
        expect(localStorage.getItem(placementKey)).toBe('side-panel');

        fireEvent.click(screen.getByTestId('commit-review-back-btn'));

        await waitFor(() => expect(screen.getByTestId('diff-section')).toBeTruthy());
        expect(screen.getByTestId('commit-chat-side-panel')).toBeTruthy();
        expect(screen.queryByTestId('commit-chat-lens')).toBeNull();

        fireEvent.click(screen.getByTestId('commit-chat-unpin-btn'));

        await waitFor(() => expect(screen.getByTestId('commit-chat-lens')).toBeTruthy());
        expect(localStorage.getItem(placementKey)).toBeNull();
        expect(screen.getByTestId('diff-section').className).toContain('overflow-auto');
    });
});
