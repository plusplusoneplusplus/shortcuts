// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { CommentsSidebar } from '../../../../src/server/spa/client/react/features/notes/editor/CommentsSidebar';
import type { UseCommentsReturn, CommentFilter } from '../../../../src/server/spa/client/react/features/notes/editor/useComments';
import type { CommentThread } from '../../../../src/server/spa/client/react/features/notes/notesApi';

// ── Mock useBreakpoint ─────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────

const THREAD_OPEN: CommentThread = {
    id: 'thread-1',
    anchor: { quotedText: 'highlighted text here', prefix: 'some context before ', suffix: ' some context after' },
    status: 'open',
    comments: [
        { id: 'c1', body: 'This needs review', createdAt: '2024-01-15T10:00:00Z' },
        { id: 'c2', body: 'I agree', createdAt: '2024-01-15T10:05:00Z' },
    ],
    createdAt: '2024-01-15T10:00:00Z',
};

const THREAD_RESOLVED: CommentThread = {
    id: 'thread-2',
    anchor: { quotedText: 'another passage', prefix: 'before text ', suffix: ' after text' },
    status: 'resolved',
    comments: [
        { id: 'c3', body: 'Fixed the typo', createdAt: '2024-01-14T08:00:00Z' },
    ],
    createdAt: '2024-01-14T08:00:00Z',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockComments(overrides: Partial<UseCommentsReturn> = {}): UseCommentsReturn {
    return {
        threads: [],
        selectedThreadId: null,
        filter: 'all' as CommentFilter,
        loading: false,
        error: null,
        totalCount: 0,
        openCount: 0,
        resolvedCount: 0,
        setFilter: vi.fn(),
        selectThread: vi.fn(),
        createThread: vi.fn(),
        resolveThread: vi.fn(),
        reopenThread: vi.fn(),
        deleteThread: vi.fn(),
        addComment: vi.fn(),
        editComment: vi.fn(),
        deleteComment: vi.fn(),
        reload: vi.fn(),
        ...overrides,
    };
}

function renderSidebar(
    comments: UseCommentsReturn = makeMockComments(),
    notePath: string | null = 'Notebook1/Page1',
    selectedThreadId: string | null = null,
) {
    const onThreadSelect = vi.fn();
    return {
        ...render(
            <CommentsSidebar
                workspaceId="ws1"
                notePath={notePath}
                selectedThreadId={selectedThreadId}
                onThreadSelect={onThreadSelect}
                comments={comments}
            />,
        ),
        onThreadSelect,
        comments,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CommentsSidebar', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    describe('loading state', () => {
        it('shows spinner when loading=true', () => {
            renderSidebar(makeMockComments({ loading: true }));

            expect(screen.getByTestId('comments-loading')).toBeInTheDocument();
            expect(screen.getByText('Loading comments…')).toBeInTheDocument();
        });

        it('hides thread list and empty state while loading', () => {
            renderSidebar(makeMockComments({ loading: true }));

            expect(screen.queryByTestId('comments-thread-list')).not.toBeInTheDocument();
            expect(screen.queryByTestId('comments-empty')).not.toBeInTheDocument();
        });
    });

    describe('error state', () => {
        it('shows error message', () => {
            renderSidebar(makeMockComments({ error: 'Network failure' }));

            expect(screen.getByTestId('comments-error')).toBeInTheDocument();
            expect(screen.getByText('Network failure')).toBeInTheDocument();
        });

        it('shows retry button that calls reload on mousedown', () => {
            const comments = makeMockComments({ error: 'Something went wrong' });
            renderSidebar(comments);

            const retryBtn = screen.getByText('Retry');
            fireEvent.mouseDown(retryBtn);
            expect(comments.reload).toHaveBeenCalledTimes(1);
        });
    });

    describe('empty state', () => {
        it('shows empty message when no threads and not loading', () => {
            renderSidebar(makeMockComments({ threads: [], totalCount: 0 }));

            expect(screen.getByTestId('comments-empty')).toBeInTheDocument();
        });

        it('contains "Select text and click 💬" guidance text', () => {
            renderSidebar(makeMockComments());

            expect(screen.getByTestId('comments-empty')).toBeInTheDocument();
            const emptyEl = screen.getByTestId('comments-empty');
            expect(emptyEl.textContent).toContain('Select text and click 💬');
        });
    });

    describe('header', () => {
        it('shows "💬 Comments" title', () => {
            renderSidebar();

            expect(screen.getByText('💬 Comments')).toBeInTheDocument();
        });

        it('shows thread count badge with totalCount', () => {
            renderSidebar(makeMockComments({ totalCount: 5 }));

            const badge = screen.getByTestId('comments-count-badge');
            expect(badge.textContent).toBe('5');
        });

        it('updates badge when count changes via rerender', () => {
            const { rerender } = render(
                <CommentsSidebar
                    workspaceId="ws1"
                    notePath="p"
                    selectedThreadId={null}
                    onThreadSelect={vi.fn()}
                    comments={makeMockComments({ totalCount: 3 })}
                />,
            );

            expect(screen.getByTestId('comments-count-badge').textContent).toBe('3');

            rerender(
                <CommentsSidebar
                    workspaceId="ws1"
                    notePath="p"
                    selectedThreadId={null}
                    onThreadSelect={vi.fn()}
                    comments={makeMockComments({ totalCount: 7 })}
                />,
            );

            expect(screen.getByTestId('comments-count-badge').textContent).toBe('7');
        });
    });

    describe('filter tabs', () => {
        it('renders All, Open, Resolved tabs with counts', () => {
            renderSidebar(makeMockComments({ totalCount: 5, openCount: 3, resolvedCount: 2 }));

            expect(screen.getByTestId('filter-all').textContent).toBe('All (5)');
            expect(screen.getByTestId('filter-open').textContent).toBe('Open (3)');
            expect(screen.getByTestId('filter-resolved').textContent).toBe('Resolved (2)');
        });

        it('highlights active filter tab', () => {
            renderSidebar(makeMockComments({ filter: 'open' }));

            const openTab = screen.getByTestId('filter-open');
            expect(openTab.className).toContain('bg-[#0078d4]');
            expect(openTab.className).toContain('text-white');

            const allTab = screen.getByTestId('filter-all');
            expect(allTab.className).not.toContain('bg-[#0078d4]');
        });

        it('calls setFilter on tab mousedown', () => {
            const comments = makeMockComments();
            renderSidebar(comments);

            fireEvent.mouseDown(screen.getByTestId('filter-resolved'));
            expect(comments.setFilter).toHaveBeenCalledWith('resolved');
        });

        it('uses e.preventDefault() on tab mousedown', () => {
            renderSidebar();

            const tab = screen.getByTestId('filter-all');
            const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            const prevented = !tab.dispatchEvent(event);
            expect(prevented).toBe(true);
        });
    });

    describe('thread list', () => {
        it('renders a CommentThreadCard for each thread', () => {
            renderSidebar(makeMockComments({
                threads: [THREAD_OPEN, THREAD_RESOLVED],
                totalCount: 2,
                openCount: 1,
                resolvedCount: 1,
            }));

            expect(screen.getByTestId('comment-thread-thread-1')).toBeInTheDocument();
            expect(screen.getByTestId('comment-thread-thread-2')).toBeInTheDocument();
        });

        it('passes isSelected=true for matching selectedThreadId', () => {
            renderSidebar(
                makeMockComments({
                    threads: [THREAD_OPEN],
                    totalCount: 1,
                    openCount: 1,
                }),
                'Notebook1/Page1',
                'thread-1',
            );

            const card = screen.getByTestId('comment-thread-thread-1');
            expect(card.className).toContain('border-l-[#0078d4]');
        });

        it('calls selectThread when card is clicked', () => {
            const comments = makeMockComments({
                threads: [THREAD_OPEN],
                totalCount: 1,
                openCount: 1,
            });
            renderSidebar(comments);

            fireEvent.click(screen.getByTestId('comment-thread-thread-1'));
            expect(comments.selectThread).toHaveBeenCalledWith('thread-1');
        });
    });

    describe('thread actions', () => {
        it('calls resolveThread when Resolve button is clicked', () => {
            const comments = makeMockComments({
                threads: [THREAD_OPEN],
                totalCount: 1,
                openCount: 1,
            });
            renderSidebar(comments);

            fireEvent.mouseDown(screen.getByTestId('resolve-thread-thread-1'));
            expect(comments.resolveThread).toHaveBeenCalledWith('thread-1');
        });

        it('calls reopenThread when Reopen button is clicked', () => {
            const comments = makeMockComments({
                threads: [THREAD_RESOLVED],
                totalCount: 1,
                resolvedCount: 1,
            });
            renderSidebar(comments);

            fireEvent.mouseDown(screen.getByTestId('reopen-thread-thread-2'));
            expect(comments.reopenThread).toHaveBeenCalledWith('thread-2');
        });

        it('calls deleteThread when Delete button is clicked', () => {
            const comments = makeMockComments({
                threads: [THREAD_OPEN],
                totalCount: 1,
                openCount: 1,
            });
            renderSidebar(comments);

            fireEvent.mouseDown(screen.getByTestId('delete-thread-thread-1'));
            expect(comments.deleteThread).toHaveBeenCalledWith('thread-1');
        });
    });

    describe('reply', () => {
        it('calls addComment when reply input Enter is pressed', () => {
            const comments = makeMockComments({
                threads: [THREAD_OPEN],
                totalCount: 1,
                openCount: 1,
            });
            renderSidebar(comments);

            const input = screen.getByTestId('reply-input-thread-1').querySelector('input')!;
            fireEvent.change(input, { target: { value: 'My reply' } });
            fireEvent.keyDown(input, { key: 'Enter' });

            expect(comments.addComment).toHaveBeenCalledWith('thread-1', 'My reply');
        });

        it('clears reply input after submission', () => {
            const comments = makeMockComments({
                threads: [THREAD_OPEN],
                totalCount: 1,
                openCount: 1,
            });
            renderSidebar(comments);

            const input = screen.getByTestId('reply-input-thread-1').querySelector('input')! as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'My reply' } });
            fireEvent.keyDown(input, { key: 'Enter' });

            expect(input.value).toBe('');
        });

        it('does not submit empty reply', () => {
            const comments = makeMockComments({
                threads: [THREAD_OPEN],
                totalCount: 1,
                openCount: 1,
            });
            renderSidebar(comments);

            const input = screen.getByTestId('reply-input-thread-1').querySelector('input')!;
            fireEvent.keyDown(input, { key: 'Enter' });

            expect(comments.addComment).not.toHaveBeenCalled();
        });
    });

    describe('comment editing', () => {
        it('enters edit mode on edit button click', () => {
            renderSidebar(makeMockComments({
                threads: [THREAD_OPEN],
                totalCount: 1,
                openCount: 1,
            }));

            fireEvent.mouseDown(screen.getByTestId('edit-comment-c1'));

            expect(screen.getByTestId('edit-input-c1')).toBeInTheDocument();
        });

        it('calls editComment on Enter in edit input', () => {
            const comments = makeMockComments({
                threads: [THREAD_OPEN],
                totalCount: 1,
                openCount: 1,
            });
            renderSidebar(comments);

            fireEvent.mouseDown(screen.getByTestId('edit-comment-c1'));

            const editInput = screen.getByTestId('edit-input-c1') as HTMLInputElement;
            fireEvent.change(editInput, { target: { value: 'Edited text' } });
            fireEvent.keyDown(editInput, { key: 'Enter' });

            expect(comments.editComment).toHaveBeenCalledWith('thread-1', 'c1', 'Edited text');
        });

        it('exits edit mode on Escape', () => {
            renderSidebar(makeMockComments({
                threads: [THREAD_OPEN],
                totalCount: 1,
                openCount: 1,
            }));

            fireEvent.mouseDown(screen.getByTestId('edit-comment-c1'));
            expect(screen.getByTestId('edit-input-c1')).toBeInTheDocument();

            fireEvent.keyDown(screen.getByTestId('edit-input-c1'), { key: 'Escape' });
            expect(screen.queryByTestId('edit-input-c1')).not.toBeInTheDocument();
        });

        it('calls deleteComment on per-comment delete button', () => {
            const comments = makeMockComments({
                threads: [THREAD_OPEN],
                totalCount: 1,
                openCount: 1,
            });
            renderSidebar(comments);

            fireEvent.mouseDown(screen.getByTestId('delete-comment-c1'));
            expect(comments.deleteComment).toHaveBeenCalledWith('thread-1', 'c1');
        });
    });

    describe('styling', () => {
        it('selected thread has border-l-[#0078d4] class', () => {
            renderSidebar(
                makeMockComments({
                    threads: [THREAD_OPEN],
                    totalCount: 1,
                    openCount: 1,
                }),
                'Notebook1/Page1',
                'thread-1',
            );

            const card = screen.getByTestId('comment-thread-thread-1');
            expect(card.className).toContain('border-l-[#0078d4]');
        });

        it('resolved thread has opacity-60 class', () => {
            renderSidebar(makeMockComments({
                threads: [THREAD_RESOLVED],
                totalCount: 1,
                resolvedCount: 1,
            }));

            const card = screen.getByTestId('comment-thread-thread-2');
            expect(card.className).toContain('opacity-60');
        });
    });
});
