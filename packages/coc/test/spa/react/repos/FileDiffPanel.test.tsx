/**
 * Tests for FileDiffPanel — unified single-file diff viewer component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

const mockAddComment = vi.fn();
const mockUseDiffComments = vi.fn();
const mockUseFileDiff = vi.fn();
const mockQueueDispatch = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: (...args: any[]) => mockUseDiffComments(...args),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileDiff', () => ({
    useFileDiff: (...args: any[]) => mockUseFileDiff(...args),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: mockQueueDispatch }),
}));

// Mock view mode
let mockViewMode = 'unified';
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffViewMode', () => ({
    useDiffViewMode: () => [mockViewMode, (mode: string) => { mockViewMode = mode; }],
}));

// Mock UnifiedDiffViewer
vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ onAddComment, onCommentClick, onAskAI, comments, 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-diff-viewer'} data-comment-count={String(comments?.length ?? 0)}>
            <button
                data-testid="trigger-add-comment"
                onClick={() => onAddComment?.(
                    { diffLineStart: 0, diffLineEnd: 0, side: 'context', oldLineStart: 1, oldLineEnd: 1, newLineStart: 1, newLineEnd: 1, startColumn: 0, endColumn: 5 },
                    'selected text',
                    { top: 100, left: 200 },
                )}
            >Add Comment</button>
            <button
                data-testid="trigger-comment-click"
                onClick={(e) => {
                    Object.defineProperty(e, 'currentTarget', {
                        value: { getBoundingClientRect: () => ({ top: 50, bottom: 70, left: 100, right: 200, width: 100, height: 20 }) },
                    });
                    onCommentClick?.({ id: 'c1', context: {}, selection: {}, comment: 'test', status: 'open', createdAt: '', updatedAt: '', selectedText: '' }, e);
                }}
            >Click Comment</button>
            <button
                data-testid="trigger-ask-ai-diff"
                onClick={() => onAskAI?.(
                    { diffLineStart: 0, diffLineEnd: 5, side: 'added', newLineStart: 1, newLineEnd: 5, startColumn: 0, endColumn: 10 },
                    'some code',
                )}
            >Ask AI</button>
        </div>
    ),
    HunkNavButtons: () => <div data-testid="hunk-nav-buttons" />,
}));

// Mock SideBySideDiffViewer
vi.mock('../../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer', () => ({
    SideBySideDiffViewer: ({ 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-sbs-diff-viewer'}>SideBySide</div>
    ),
}));

// Mock DiffViewToggle
vi.mock('../../../../src/server/spa/client/react/features/git/diff/DiffViewToggle', () => ({
    DiffViewToggle: ({ mode, onChange }: any) => (
        <button data-testid="diff-view-toggle" onClick={() => onChange(mode === 'unified' ? 'split' : 'unified')}>
            {mode}
        </button>
    ),
}));

// Mock DiffMiniMap
vi.mock('../../../../src/server/spa/client/react/features/git/diff/DiffMiniMap', () => ({
    DiffMiniMap: () => <div data-testid="diff-mini-map" />,
}));

// Mock CommitChatPanel
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({
    CommitChatPanel: ({ workspaceId, commitHash, commitMessage, onClose }: any) => (
        <div data-testid="commit-chat-panel" data-ws={workspaceId} data-hash={commitHash} data-msg={commitMessage}>
            <button data-testid="close-chat" onClick={onClose}>Close</button>
        </div>
    ),
}));

// Mock useResizablePanel
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 360,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        resetWidth: vi.fn(),
    }),
}));

// Mock TruncatedPath in ui
vi.mock('../../../../src/server/spa/client/react/ui', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        TruncatedPath: ({ path, className }: { path: string; className?: string }) => (
            <span className={className} data-testid="truncated-path">{path}</span>
        ),
    };
});

// Mock useCrossFileNav
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useCrossFileNav', () => ({
    useCrossFileNav: () => ({ handleNext: vi.fn(), handlePrev: vi.fn() }),
}));

// Mock shared/ResolveContextDialog
vi.mock('../../../../src/server/spa/client/react/shared/ResolveContextDialog', () => ({
    shouldSkipResolveDialog: () => false,
    ResolveContextDialog: () => null,
    resetSkipResolveDialog: () => {},
}));

// Mock diff-context-utils
const mockBuildDiffContext = vi.fn().mockReturnValue('context-string');
vi.mock('../../../../src/server/spa/client/comments/diff-context-utils', () => ({
    buildDiffContext: (...args: any[]) => mockBuildDiffContext(...args),
}));

// Mock copyToClipboard
vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

import { FileDiffPanel } from '../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel';
import type { DiffSource } from '../../../../src/server/spa/client/react/features/git/diff/diffSource';

// --- Helpers ---

function makeCommentsHook(overrides: Record<string, unknown> = {}) {
    return {
        comments: [],
        loading: false,
        error: null,
        isEphemeral: false,
        addComment: mockAddComment,
        updateComment: vi.fn().mockResolvedValue({}),
        deleteComment: vi.fn().mockResolvedValue(undefined),
        resolveComment: vi.fn().mockResolvedValue({}),
        unresolveComment: vi.fn().mockResolvedValue({}),
        askAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),
        resolvingIds: new Set(),
        deletingIds: new Set(),
        runRelocation: vi.fn(),
        copyAllCommentsAsPrompt: vi.fn(),
        resolveWithAI: vi.fn(),
        fixWithAI: vi.fn(),
        refresh: vi.fn(),
        ...overrides,
    };
}

function makeFileDiffHook(overrides: Record<string, unknown> = {}) {
    return {
        diff: '+added\n context',
        loading: false,
        error: null,
        retry: vi.fn(),
        truncated: false,
        totalLines: 0,
        requestFullDiff: vi.fn(),
        ...overrides,
    };
}

function makeBranchSource(overrides: Partial<DiffSource> = {}): DiffSource {
    return {
        label: 'Branch diff',
        fileDiffUrl: (fp: string, full?: boolean) => `/ws/branch-range/files/${fp}/diff${full ? '?full=true' : ''}`,
        fullDiffUrl: () => null,
        commentContext: (fp: string) => ({ repositoryId: 'ws1', filePath: fp, oldRef: 'branch-base', newRef: 'branch-head' }),
        files: [],
        chat: null,
        supportsTruncation: true,
        cacheKey: 'branch-range',
        ...overrides,
    };
}

function makeCommitSource(overrides: Partial<DiffSource> = {}): DiffSource {
    return {
        label: '',
        fileDiffUrl: (fp: string, full?: boolean) => `/ws/commits/abc123/files/${fp}/diff${full ? '?full=true' : ''}`,
        fullDiffUrl: () => '/ws/commits/abc123/diff',
        commentContext: (fp: string) => ({ repositoryId: 'ws1', filePath: fp, oldRef: 'abc123^', newRef: 'abc123' }),
        files: [],
        chat: { workspaceId: 'ws1', commitHash: 'abc123', commitMessage: 'fix: something' },
        supportsTruncation: false,
        cacheKey: 'commit:abc123',
        ...overrides,
    };
}

// --- Tests ---

describe('FileDiffPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockViewMode = 'unified';
        mockUseDiffComments.mockReturnValue(makeCommentsHook());
        mockUseFileDiff.mockReturnValue(makeFileDiffHook());
        // Reset localStorage
        try { localStorage.removeItem('coc.commitChat.open'); } catch { /* ignore */ }
    });

    // ── Loading state ──

    it('renders loading state', () => {
        mockUseFileDiff.mockReturnValue(makeFileDiffHook({ diff: null, loading: true }));

        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.getByTestId('file-diff-loading')).toBeTruthy();
        expect(screen.getByText(/Loading diff/)).toBeTruthy();
    });

    // ── Error state ──

    it('renders error state with retry button', () => {
        const retry = vi.fn();
        mockUseFileDiff.mockReturnValue(makeFileDiffHook({ diff: null, loading: false, error: 'Network error', retry }));

        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.getByTestId('file-diff-error')).toBeTruthy();
        expect(screen.getByText('Network error')).toBeTruthy();

        fireEvent.click(screen.getByTestId('file-diff-retry-btn'));
        expect(retry).toHaveBeenCalled();
    });

    // ── Diff rendering ──

    it('renders unified diff viewer by default', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.getByTestId('file-diff-content')).toBeTruthy();
    });

    it('renders split diff viewer when mode is split', () => {
        mockViewMode = 'split';

        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.getByText('SideBySide')).toBeTruthy();
    });

    // ── Empty diff ──

    it('shows empty diff message when diff is falsy', () => {
        mockUseFileDiff.mockReturnValue(makeFileDiffHook({ diff: '', loading: false }));

        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.getByTestId('file-diff-empty')).toBeTruthy();
        expect(screen.getByText('(empty diff)')).toBeTruthy();
    });

    // ── Truncation banner ──

    it('shows truncation banner when truncated', () => {
        const requestFullDiff = vi.fn();
        mockUseFileDiff.mockReturnValue(makeFileDiffHook({ truncated: true, totalLines: 10000, requestFullDiff }));

        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.getByTestId('diff-truncation-banner')).toBeTruthy();
        expect(screen.getByText(/10,000/)).toBeTruthy();

        fireEvent.click(screen.getByTestId('load-full-diff-btn'));
        expect(requestFullDiff).toHaveBeenCalled();
    });

    it('does not show truncation banner when not truncated', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.queryByTestId('diff-truncation-banner')).toBeNull();
    });

    // ── Source label ──

    it('renders source label when non-empty', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource({ label: 'Branch diff' })} />);

        expect(screen.getByText('Branch diff')).toBeTruthy();
    });

    it('does not render label when empty string', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeCommitSource({ label: '' })} />);

        const header = screen.getByTestId('file-diff-header');
        // No label span should be present
        const labels = header.querySelectorAll('.text-xs.text-\\[\\#616161\\]');
        expect(labels.length).toBe(0);
    });

    it('does not render label when showSourceLabel is false', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource({ label: 'Branch diff' })} showSourceLabel={false} />);

        expect(screen.queryByText('Branch diff')).toBeNull();
    });

    // ── Comment sidebar toggle ──

    it('toggles comment sidebar on button click', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        // Not visible initially
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();

        // Toggle open
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();

        // Toggle closed
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    it('shows comment count in toggle button', () => {
        mockUseDiffComments.mockReturnValue(makeCommentsHook({
            comments: [
                { id: '1', status: 'open', comment: 'c1' },
                { id: '2', status: 'open', comment: 'c2' },
                { id: '3', status: 'resolved', comment: 'c3' },
            ],
        }));

        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        const btn = screen.getByTestId('toggle-comments-btn');
        expect(btn.textContent).toContain('3');
    });

    // ── AI chat button ──

    it('shows AI chat button only when source supports chat', () => {
        // Branch source: no chat
        const { unmount } = render(
            <FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />,
        );
        expect(screen.queryByTestId('toggle-chat-btn')).toBeNull();
        unmount();

        // Commit source: has chat
        render(
            <FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeCommitSource()} />,
        );
        expect(screen.getByTestId('toggle-chat-btn')).toBeTruthy();
    });

    it('opens and closes AI chat panel', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeCommitSource()} />);

        // Not open initially
        expect(screen.queryByTestId('commit-chat-panel')).toBeNull();

        // Open
        fireEvent.click(screen.getByTestId('toggle-chat-btn'));
        expect(screen.getByTestId('commit-chat-panel')).toBeTruthy();
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-hash')).toBe('abc123');
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-msg')).toBe('fix: something');

        // Close via toggle
        fireEvent.click(screen.getByTestId('toggle-chat-btn'));
        expect(screen.queryByTestId('commit-chat-panel')).toBeNull();
    });

    it('persists chat open state in localStorage', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeCommitSource()} />);

        fireEvent.click(screen.getByTestId('toggle-chat-btn'));
        expect(localStorage.getItem('coc.commitChat.open')).toBe('true');

        fireEvent.click(screen.getByTestId('toggle-chat-btn'));
        expect(localStorage.getItem('coc.commitChat.open')).toBe('false');
    });

    // ── File position indicator ──

    it('shows file position indicator for multiple files', () => {
        const source = makeBranchSource({ files: ['a.ts', 'b.ts', 'c.ts'] });

        render(<FileDiffPanel workspaceId="ws1" filePath="b.ts" source={source} />);

        const indicator = screen.getByTestId('file-position-indicator');
        expect(indicator.textContent).toBe('2/3');
    });

    it('hides file position indicator for single file', () => {
        const source = makeBranchSource({ files: ['a.ts'] });

        render(<FileDiffPanel workspaceId="ws1" filePath="a.ts" source={source} />);

        expect(screen.queryByTestId('file-position-indicator')).toBeNull();
    });

    it('hides file position indicator when no files', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.queryByTestId('file-position-indicator')).toBeNull();
    });

    // ── File path display ──

    it('renders file path in header', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.getByTestId('truncated-path').textContent).toBe('src/foo.ts');
    });

    it('does not render a back button by default', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.queryByTestId('file-diff-back-btn')).toBeNull();
    });

    it('renders and invokes optional back button', () => {
        const onBack = vi.fn();

        render(
            <FileDiffPanel
                workspaceId="ws1"
                filePath="src/foo.ts"
                source={makeBranchSource()}
                onBack={onBack}
            />,
        );

        const button = screen.getByTestId('file-diff-back-btn');
        expect(button.textContent).toContain('All files');
        fireEvent.click(button);
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('supports custom back label and test id', () => {
        render(
            <FileDiffPanel
                workspaceId="ws1"
                filePath="src/foo.ts"
                source={makeBranchSource()}
                onBack={() => {}}
                backLabel="Back to overview"
                backTestId="custom-back-btn"
            />,
        );

        expect(screen.getByTestId('custom-back-btn').textContent).toContain('Back to overview');
        expect(screen.queryByTestId('file-diff-back-btn')).toBeNull();
    });

    it('keeps existing header controls when back button is shown', () => {
        render(
            <FileDiffPanel
                workspaceId="ws1"
                filePath="src/foo.ts"
                source={makeCommitSource({ files: ['src/foo.ts', 'src/bar.ts'] })}
                onBack={() => {}}
            />,
        );

        expect(screen.getByTestId('file-diff-back-btn')).toBeTruthy();
        expect(screen.getByTestId('truncated-path')).toBeTruthy();
        expect(screen.getByTestId('file-position-indicator').textContent).toBe('1/2');
        expect(screen.getByTestId('hunk-nav-buttons')).toBeTruthy();
        expect(screen.getByTestId('diff-view-toggle')).toBeTruthy();
        expect(screen.getByTestId('toggle-comments-btn')).toBeTruthy();
        expect(screen.getByTestId('toggle-chat-btn')).toBeTruthy();
    });

    // ── DiffMiniMap ──

    it('renders DiffMiniMap when diff is loaded', () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.getByTestId('diff-mini-map')).toBeTruthy();
    });

    it('does not render DiffMiniMap when loading', () => {
        mockUseFileDiff.mockReturnValue(makeFileDiffHook({ diff: null, loading: true }));

        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.queryByTestId('diff-mini-map')).toBeNull();
    });

    it('does not render DiffMiniMap on error', () => {
        mockUseFileDiff.mockReturnValue(makeFileDiffHook({ diff: null, loading: false, error: 'fail' }));

        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.queryByTestId('diff-mini-map')).toBeNull();
    });

    // ── Overlay components ──

    it('shows InlineCommentPopup when add-comment triggers', async () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('trigger-add-comment'));
        });

        expect(screen.getByTestId('inline-comment-popup')).toBeTruthy();
    });

    it('shows CommentPopover when comment-click triggers', async () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        expect(screen.queryByTestId('comment-popover')).toBeNull();

        await act(async () => {
            fireEvent.click(screen.getByTestId('trigger-comment-click'));
        });

        expect(screen.getByTestId('comment-popover')).toBeTruthy();
    });

    // ── Comment context ──

    it('passes correct context to useDiffComments', () => {
        const source = makeBranchSource();
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={source} />);

        expect(mockUseDiffComments).toHaveBeenCalledWith('ws1', {
            repositoryId: 'ws1',
            filePath: 'src/foo.ts',
            oldRef: 'branch-base',
            newRef: 'branch-head',
        });
    });

    // ── handleAskAIDiff ──

    it('handleAskAIDiff includes commitHash when available', async () => {
        const source = makeCommitSource();
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={source} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('trigger-ask-ai-diff'));
        });

        expect(mockBuildDiffContext).toHaveBeenCalledWith(
            expect.objectContaining({ commitHash: 'abc123', filePath: 'src/foo.ts' }),
        );
        expect(mockQueueDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'OPEN_DIALOG', workspaceId: 'ws1', mode: 'ask' }),
        );
        // Commit source has chat, so no floating-chat launchMode
        expect(mockQueueDispatch).toHaveBeenCalledWith(
            expect.not.objectContaining({ launchMode: 'floating-chat' }),
        );
    });

    it('handleAskAIDiff uses floating-chat when no embedded chat', async () => {
        const source = makeBranchSource(); // no chat
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={source} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('trigger-ask-ai-diff'));
        });

        expect(mockBuildDiffContext).toHaveBeenCalledWith(
            expect.objectContaining({ commitHash: undefined, filePath: 'src/foo.ts' }),
        );
        expect(mockQueueDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ launchMode: 'floating-chat' }),
        );
    });

    // ── useFileDiff integration ──

    it('passes correct URLs to useFileDiff for branch source', () => {
        const source = makeBranchSource();
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={source} />);

        expect(mockUseFileDiff).toHaveBeenCalledWith(
            '/ws/branch-range/files/src/foo.ts/diff',
            '/ws/branch-range/files/src/foo.ts/diff?full=true',
        );
    });

    it('passes null fullUrl to useFileDiff for commit source', () => {
        const source = makeCommitSource();
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={source} />);

        expect(mockUseFileDiff).toHaveBeenCalledWith(
            '/ws/commits/abc123/files/src/foo.ts/diff',
            null,
        );
    });

    // ── Popup submit ──

    it('popup submit calls addComment and closes popup', async () => {
        mockAddComment.mockResolvedValue({ id: 'new-c' });

        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        // Trigger add comment
        await act(async () => {
            fireEvent.click(screen.getByTestId('trigger-add-comment'));
        });

        // Fill and submit
        const textarea = screen.getByTestId('comment-textarea');
        fireEvent.change(textarea, { target: { value: 'my comment' } });
        await act(async () => {
            fireEvent.click(screen.getByText(/Submit/));
        });

        expect(mockAddComment).toHaveBeenCalledWith(
            expect.objectContaining({ diffLineStart: 0 }),
            'selected text',
            'my comment',
            'general',
        );
        await waitFor(() => expect(screen.queryByTestId('inline-comment-popup')).toBeNull());
    });

    // ── Popup cancel ──

    it('popup cancel closes without saving', async () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={makeBranchSource()} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('trigger-add-comment'));
        });

        expect(screen.getByTestId('inline-comment-popup')).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByText('Cancel'));
        });

        expect(screen.queryByTestId('inline-comment-popup')).toBeNull();
        expect(mockAddComment).not.toHaveBeenCalled();
    });
});
