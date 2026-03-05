/**
 * Tests for WorkingTreeFileDiff — diff comment integration.
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
}));

import { WorkingTreeFileDiff } from '../../../../src/server/spa/client/react/repos/WorkingTreeFileDiff';

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

describe('WorkingTreeFileDiff — comment integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAddComment.mockResolvedValue({ id: 'new-c' });
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    async function renderDiff(stage: 'staged' | 'unstaged' | 'untracked' = 'staged') {
        await act(async () => {
            render(
                <WorkingTreeFileDiff
                    workspaceId="ws1"
                    filePath="src/foo.ts"
                    stage={stage}
                />
            );
        });
    }

    // 1. No sidebar by default
    it('renders without sidebar by default', async () => {
        await renderDiff('staged');
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    // 2. Sidebar toggle shows sidebar
    it('clicking toggle button shows comment sidebar', async () => {
        await renderDiff('staged');
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
    });

    // 2b. Sidebar toggle hides sidebar on second click
    it('clicking toggle button again hides comment sidebar', async () => {
        await renderDiff('staged');
        const btn = screen.getByTestId('toggle-comments-btn');
        fireEvent.click(btn);
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
        fireEvent.click(btn);
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    // 3. Popup appears when onAddComment fires
    it('popup appears when UnifiedDiffViewer fires onAddComment', async () => {
        await renderDiff('staged');
        const trigger = await screen.findByTestId('trigger-add-comment');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('inline-comment-popup')).toBeTruthy();
    });

    // 4. Popup submit calls addComment and closes popup
    it('popup submit calls addComment with correct args and closes popup', async () => {
        await renderDiff('staged');
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
        await renderDiff('staged');
        const trigger = await screen.findByTestId('trigger-add-comment');
        await act(async () => { fireEvent.click(trigger); });

        expect(screen.getByTestId('inline-comment-popup')).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
        expect(screen.queryByTestId('inline-comment-popup')).toBeNull();
        expect(mockAddComment).not.toHaveBeenCalled();
    });

    // 6. onCommentClick opens sidebar
    it('onCommentClick opens sidebar if closed', async () => {
        await renderDiff('staged');
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
        await renderDiff('staged');
        const viewer = await screen.findByTestId('working-tree-file-diff-content');
        expect(viewer.getAttribute('data-comment-count')).toBe('2');
    });

    // 8. Untracked files: no toggle button or sidebar
    it('does not show toggle button or sidebar for untracked files', async () => {
        await renderDiff('untracked');
        expect(screen.queryByTestId('toggle-comments-btn')).toBeNull();
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    // 8b. Untracked files: shows untracked placeholder, no diff viewer
    it('shows untracked placeholder for untracked stage', async () => {
        await renderDiff('untracked');
        expect(screen.getByTestId('working-tree-file-diff-untracked')).toBeTruthy();
        expect(screen.queryByTestId('trigger-add-comment')).toBeNull();
    });
});
