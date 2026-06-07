import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { DiffSource } from '../../../../src/server/spa/client/react/features/git/diff/diffSource';

const mockQueueDispatch = vi.fn();

vi.mock('../../../../src/server/spa/client/react/utils/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/utils/config')>();
    return {
        ...actual,
        isCommitChatLensEnabled: () => true,
    };
});

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        git: {
            commitDiffPath: (workspaceId: string, hash: string) =>
                `/api/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${encodeURIComponent(hash)}/diff`,
            commitFileDiffPath: (workspaceId: string, hash: string, filePath: string) =>
                `/api/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${encodeURIComponent(hash)}/files/${encodeURIComponent(filePath)}/diff`,
            listCommitFiles: vi.fn().mockResolvedValue({ files: [{ path: 'src/example.ts' }] }),
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
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: mockQueueDispatch }),
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
    formatRelativeTime: (value: string) => value,
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

import { CommitDetail } from '../../../../src/server/spa/client/react/features/git/commits/CommitDetail';
import { FileDiffPanel } from '../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel';
import { getReviewChatPlacementStorageKey } from '../../../../src/server/spa/client/react/features/git/commits/commitChatPlacement';

function makeCommitSource(overrides: Partial<DiffSource> = {}): DiffSource {
    return {
        label: 'Commit abc1234',
        fileDiffUrl: (filePath: string) => `/diff/${filePath}`,
        fullDiffUrl: () => '/diff',
        commentContext: (filePath: string) => ({
            repositoryId: 'ws1',
            filePath,
            oldRef: 'abc123^',
            newRef: 'abc123',
        }),
        files: ['src/example.ts'],
        chat: { workspaceId: 'ws1', commitHash: 'abc123', commitMessage: 'fix: lens' },
        supportsTruncation: false,
        cacheKey: 'commit:abc123',
        ...overrides,
    };
}

function makeCommit(subject: string) {
    return {
        hash: 'abc123def456abc123def456abc123def456abc1',
        shortHash: 'abc123d',
        subject,
        author: 'Test Author',
        authorEmail: 'test@example.com',
        date: '2026-03-07T12:00:00Z',
        parentHashes: ['parent1234567890'],
        body: '',
    };
}

async function openCommitChat() {
    await act(async () => {
        fireEvent.click(screen.getByTestId('toggle-chat-btn'));
    });
}

describe('commit chat lens surfaces with feature flag enabled', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('opens CommitDetail chat as a lens by default and persists pin/unpin placement by commit', async () => {
        const { unmount } = render(
            <CommitDetail
                workspaceId="ws1"
                hash="abc123"
                commit={makeCommit('fix: lens') as any}
            />,
        );

        await openCommitChat();

        expect(screen.getByTestId('commit-chat-lens')).toBeTruthy();
        expect(screen.queryByTestId('commit-chat-side-panel')).toBeNull();
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-commit-hash')).toBe('abc123');
        expect(screen.getByTestId('diff-section').className).toContain('overflow-auto');

        fireEvent.click(screen.getByTestId('commit-chat-pin-btn'));

        const storageKey = getReviewChatPlacementStorageKey({ type: 'commit', workspaceId: 'ws1', commitHash: 'abc123' });
        expect(localStorage.getItem(storageKey)).toBe('side-panel');
        expect(screen.getByTestId('commit-chat-side-panel')).toBeTruthy();
        expect(screen.queryByTestId('commit-chat-lens')).toBeNull();

        fireEvent.click(screen.getByTestId('commit-chat-frame-close-btn'));
        expect(screen.queryByTestId('commit-chat-side-panel')).toBeNull();
        expect(localStorage.getItem(storageKey)).toBe('side-panel');

        await openCommitChat();
        expect(screen.getByTestId('commit-chat-side-panel')).toBeTruthy();

        fireEvent.click(screen.getByTestId('commit-chat-unpin-btn'));
        expect(localStorage.getItem(storageKey)).toBeNull();
        expect(screen.getByTestId('commit-chat-lens')).toBeTruthy();

        fireEvent.click(screen.getByTestId('commit-chat-frame-close-btn'));
        unmount();

        render(<CommitDetail workspaceId="ws1" hash="def456" commit={{ ...makeCommit('fix: other'), hash: 'def456abc123' } as any} />);
        await openCommitChat();

        expect(screen.getByTestId('commit-chat-lens')).toBeTruthy();
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-commit-hash')).toBe('def456');
        expect(localStorage.getItem(getReviewChatPlacementStorageKey({ type: 'commit', workspaceId: 'ws1', commitHash: 'def456' }))).toBeNull();
    });

    it('opens commit-backed FileDiffPanel chat as a lens and pins back to the side panel', async () => {
        render(
            <FileDiffPanel
                workspaceId="ws1"
                filePath="src/example.ts"
                source={makeCommitSource()}
            />,
        );

        await openCommitChat();

        expect(screen.getByTestId('commit-chat-lens')).toBeTruthy();
        expect(screen.queryByTestId('commit-chat-side-panel')).toBeNull();
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-commit-hash')).toBe('abc123');
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-commit-message')).toBe('fix: lens');
        expect(screen.getByTestId('file-diff-section').className).toContain('overflow-auto');

        fireEvent.click(screen.getByTestId('commit-chat-pin-btn'));

        expect(localStorage.getItem(getReviewChatPlacementStorageKey({ type: 'commit', workspaceId: 'ws1', commitHash: 'abc123' }))).toBe('side-panel');
        expect(screen.getByTestId('commit-chat-side-panel')).toBeTruthy();
    });

});
