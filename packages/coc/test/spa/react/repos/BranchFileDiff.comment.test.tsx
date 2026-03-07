/**
 * Tests for BranchFileDiff — diff comment integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

const mockAddComment = vi.fn();
const mockUseDiffComments = vi.fn();

vi.mock('../../../../src/server/spa/client/react/hooks/useDiffComments', () => ({
    useDiffComments: (...args: any[]) => mockUseDiffComments(...args),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve({ diff: '+added line\n context' }),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

// Mock UnifiedDiffViewer to expose controllable callback triggers
vi.mock('../../../../src/server/spa/client/react/repos/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ onAddComment, onCommentClick, comments, 'data-testid': testId }: any) => (
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
                onClick={() => onCommentClick?.({ id: 'c1', context: {}, selection: {}, comment: 'test', status: 'open', createdAt: '', updatedAt: '', selectedText: '' })}
            >Click Comment</button>
        </div>
    ),
    HunkNavButtons: () => null,
}));

// Mock TruncatedPath (used in header)
vi.mock('../../../../src/server/spa/client/react/shared', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        TruncatedPath: ({ path, className }: { path: string; className?: string }) => (
            <span className={className}>{path}</span>
        ),
    };
});

import { BranchFileDiff } from '../../../../src/server/spa/client/react/repos/BranchFileDiff';

function makeHook(overrides: Record<string, unknown> = {}) {
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
        resolving: false,
        resolvingCommentId: null,
        refresh: vi.fn(),
        ...overrides,
    };
}

describe('BranchFileDiff — comment integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAddComment.mockResolvedValue({ id: 'new-c' });
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    async function renderDiff() {
        await act(async () => {
            render(
                <BranchFileDiff
                    workspaceId="ws1"
                    filePath="src/foo.ts"
                />
            );
        });
    }

    // 1. No sidebar by default
    it('renders without sidebar by default', async () => {
        await renderDiff();
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    // 2. Sidebar toggle shows sidebar
    it('clicking toggle button shows comment sidebar', async () => {
        await renderDiff();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
    });

    // 2b. Sidebar toggle hides sidebar on second click
    it('clicking toggle button again hides comment sidebar', async () => {
        await renderDiff();
        const btn = screen.getByTestId('toggle-comments-btn');
        fireEvent.click(btn);
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
        fireEvent.click(btn);
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    // 3. Popup appears when onAddComment fires
    it('popup appears when UnifiedDiffViewer fires onAddComment', async () => {
        await renderDiff();
        const trigger = await screen.findByTestId('trigger-add-comment');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('inline-comment-popup')).toBeTruthy();
    });

    // 4. Popup submit calls addComment and closes popup
    it('popup submit calls addComment with correct args and closes popup', async () => {
        await renderDiff();
        const trigger = await screen.findByTestId('trigger-add-comment');
        await act(async () => { fireEvent.click(trigger); });

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

    // 5. Popup cancel closes without saving
    it('popup cancel closes popup without calling addComment', async () => {
        await renderDiff();
        const trigger = await screen.findByTestId('trigger-add-comment');
        await act(async () => { fireEvent.click(trigger); });

        expect(screen.getByTestId('inline-comment-popup')).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
        expect(screen.queryByTestId('inline-comment-popup')).toBeNull();
        expect(mockAddComment).not.toHaveBeenCalled();
    });

    // 6. onCommentClick opens sidebar
    it('onCommentClick opens sidebar if closed', async () => {
        await renderDiff();
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
        const trigger = await screen.findByTestId('trigger-comment-click');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
    });

    // 7. Comments passed to UnifiedDiffViewer
    it('passes comments from useDiffComments to UnifiedDiffViewer', async () => {
        const twoComments = [
            { id: 'c1', context: {}, selection: { diffLineStart: 0, diffLineEnd: 0 }, comment: 'a', status: 'open', createdAt: '', updatedAt: '', selectedText: '' },
            { id: 'c2', context: {}, selection: { diffLineStart: 1, diffLineEnd: 1 }, comment: 'b', status: 'open', createdAt: '', updatedAt: '', selectedText: '' },
        ];
        mockUseDiffComments.mockReturnValue(makeHook({ comments: twoComments }));
        await renderDiff();
        const viewer = await screen.findByTestId('branch-file-diff-content');
        expect(viewer.getAttribute('data-comment-count')).toBe('2');
    });

    // 8. useDiffComments called with branch-base / branch-head refs
    it('calls useDiffComments with branch-base/branch-head refs', async () => {
        await renderDiff();
        expect(mockUseDiffComments).toHaveBeenCalledWith(
            'ws1',
            expect.objectContaining({ oldRef: 'branch-base', newRef: 'branch-head', filePath: 'src/foo.ts' }),
        );
    });
});
