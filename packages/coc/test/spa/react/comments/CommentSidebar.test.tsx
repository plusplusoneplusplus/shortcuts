import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CommentSidebar } from '../../../../src/server/spa/client/react/tasks/comments/CommentSidebar';
import type { TaskComment } from '../../../../src/server/spa/client/comments/task-comments-types';
import type { DiffComment } from '../../../../src/server/spa/client/comments/diff-comment-types';

function makeComment(overrides: Partial<TaskComment> = {}): TaskComment {
    return {
        id: 'c1',
        taskId: 'task1',
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello',
        comment: 'test comment',
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        category: 'general',
        ...overrides,
    };
}

const noop = () => {};

describe('CommentSidebar', () => {
    it('renders comment count in header', () => {
        const comments = [makeComment({ id: 'c1' }), makeComment({ id: 'c2' })];
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={comments} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        expect(screen.getByText('Comments (2)')).toBeTruthy();
    });

    it('shows empty state message when no comments match filter', () => {
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        expect(screen.getByTestId('empty-comments')).toBeTruthy();
    });

    it('shows loading state', () => {
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[]} loading={true}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        expect(screen.getByText('Loading comments…')).toBeTruthy();
    });

    it('filters by status: open', () => {
        const comments = [
            makeComment({ id: 'c1', status: 'open', comment: 'open one' }),
            makeComment({ id: 'c2', status: 'resolved', comment: 'resolved one' }),
        ];
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={comments} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        fireEvent.click(screen.getByTestId('status-filter-open'));
        expect(screen.getByText('open one')).toBeTruthy();
        expect(screen.queryByText('resolved one')).toBeNull();
    });

    it('filters by status: resolved', () => {
        const comments = [
            makeComment({ id: 'c1', status: 'open', comment: 'open one' }),
            makeComment({ id: 'c2', status: 'resolved', comment: 'resolved one' }),
        ];
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={comments} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        fireEvent.click(screen.getByTestId('status-filter-resolved'));
        expect(screen.queryByText('open one')).toBeNull();
        expect(screen.getByText('resolved one')).toBeTruthy();
    });

    it('calls onCommentClick when comment card is clicked', () => {
        const onCommentClick = vi.fn();
        const comment = makeComment({ id: 'c1' });
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[comment]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={onCommentClick}
            />
        );
        fireEvent.click(screen.getByTestId('comment-card-c1'));
        expect(onCommentClick).toHaveBeenCalledWith(comment);
    });

    it('renders all status filter tabs', () => {
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        expect(screen.getByTestId('status-filter-all')).toBeTruthy();
        expect(screen.getByTestId('status-filter-open')).toBeTruthy();
        expect(screen.getByTestId('status-filter-resolved')).toBeTruthy();
    });

    describe('Resolve All button', () => {
        it('renders when onResolveAllWithAI provided and open comments > 0', () => {
            const comments = [makeComment({ id: 'c1', status: 'open' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                    onResolveAllWithAI={vi.fn()}
                />
            );
            expect(screen.getByTestId('resolve-all-ai-btn')).toBeTruthy();
        });

        it('is NOT rendered when all comments are resolved', () => {
            const comments = [makeComment({ id: 'c1', status: 'resolved' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                    onResolveAllWithAI={vi.fn()}
                />
            );
            expect(screen.queryByTestId('resolve-all-ai-btn')).toBeNull();
        });

        it('is NOT rendered when onResolveAllWithAI is undefined', () => {
            const comments = [makeComment({ id: 'c1', status: 'open' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                />
            );
            expect(screen.queryByTestId('resolve-all-ai-btn')).toBeNull();
        });

        it('calls onResolveAllWithAI when clicked', () => {
            const onResolveAllWithAI = vi.fn();
            const comments = [makeComment({ id: 'c1', status: 'open' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                    onResolveAllWithAI={onResolveAllWithAI}
                />
            );
            fireEvent.click(screen.getByTestId('resolve-all-ai-btn'));
            expect(onResolveAllWithAI).toHaveBeenCalledOnce();
        });
    });

    describe('Copy Prompt button', () => {
        it('renders when onCopyPrompt provided and open comments > 0', () => {
            const comments = [makeComment({ id: 'c1', status: 'open' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                    onCopyPrompt={vi.fn()}
                />
            );
            expect(screen.getByTestId('copy-prompt-btn')).toBeTruthy();
        });

        it('is NOT rendered when all comments are resolved', () => {
            const comments = [makeComment({ id: 'c1', status: 'resolved' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                    onCopyPrompt={vi.fn()}
                />
            );
            expect(screen.queryByTestId('copy-prompt-btn')).toBeNull();
        });

        it('calls onCopyPrompt when clicked', () => {
            const onCopyPrompt = vi.fn();
            const comments = [makeComment({ id: 'c1', status: 'open' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                    onCopyPrompt={onCopyPrompt}
                />
            );
            fireEvent.click(screen.getByTestId('copy-prompt-btn'));
            expect(onCopyPrompt).toHaveBeenCalledOnce();
        });

        it('icon changes to ✓ after click, then reverts after 2s', () => {
            vi.useFakeTimers();
            const onCopyPrompt = vi.fn();
            const comments = [makeComment({ id: 'c1', status: 'open' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                    onCopyPrompt={onCopyPrompt}
                />
            );
            expect(screen.getByTestId('copy-prompt-btn').textContent).toBe('📋 Copy as prompt');
            fireEvent.click(screen.getByTestId('copy-prompt-btn'));
            expect(screen.getByTestId('copy-prompt-btn').textContent).toBe('✓ Copied');
            act(() => { vi.advanceTimersByTime(2000); });
            expect(screen.getByTestId('copy-prompt-btn').textContent).toBe('📋 Copy as prompt');
            vi.useRealTimers();
        });

        it('shows Copied only after a returned promise resolves', async () => {
            let finish: () => void = () => undefined;
            const comments = [makeComment({ id: 'c1', status: 'open' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                    onCopyPrompt={() => new Promise<void>(r => { finish = r; })}
                />
            );
            fireEvent.click(screen.getByTestId('copy-prompt-btn'));
            expect(screen.getByTestId('copy-prompt-btn').textContent).toBe('📋 Copy as prompt');
            await act(async () => { finish(); });
            expect(screen.getByTestId('copy-prompt-btn').textContent).toBe('✓ Copied');
        });

        it('shows Copy failed, not Copied, when the copy rejects', async () => {
            const comments = [makeComment({ id: 'c1', status: 'open' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                    onCopyPrompt={() => Promise.reject(new Error('denied'))}
                />
            );
            await act(async () => { fireEvent.click(screen.getByTestId('copy-prompt-btn')); });
            expect(screen.getByTestId('copy-prompt-btn').textContent).toBe('Copy failed');
            expect(screen.getByTestId('copy-prompt-btn').getAttribute('data-copy-state')).toBe('failed');
        });
    });
});

// ============================================================================
// Grouped (aggregated review) mode
// ============================================================================

describe('CommentSidebar groupByFile', () => {
    function diffComment(id: string, filePath: string, line: number, status: DiffComment['status'] = 'open'): DiffComment {
        return {
            id, status, comment: `note ${id}`, selectedText: 'x',
            context: { repositoryId: 'ws-1', filePath, oldRef: 'abc^', newRef: 'abc' },
            selection: { diffLineStart: line, diffLineEnd: line, side: 'added', newLineStart: line, newLineEnd: line, startColumn: 0, endColumn: 1 },
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        };
    }
    const props = { loading: false, onResolve: noop, onUnresolve: noop, onDelete: noop, onEdit: noop, onAskAI: noop, onCommentClick: noop };

    it('groups comments under sorted per-file headers with counts and line locations', () => {
        const comments = [diffComment('b1', 'src/b.ts', 3), diffComment('a2', 'src/a.ts', 20), diffComment('a1', 'src/a.ts', 5)];
        render(<CommentSidebar {...props} comments={comments} showFilePath groupByFile />);
        const groups = screen.getAllByTestId('comment-file-group');
        expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(['src/a.ts, 2 comment(s)', 'src/b.ts, 1 comment(s)']);
        expect(screen.getAllByTestId('comment-location').map(e => e.textContent)).toEqual(['new line 5 (added)', 'new line 20 (added)', 'new line 3 (added)']);
        expect(screen.getByText('Comments (3 · 2 files)')).toBeTruthy();
    });

    it('keeps the status filter working in grouped mode', () => {
        const comments = [diffComment('a1', 'src/a.ts', 1), diffComment('b1', 'src/b.ts', 1, 'resolved')];
        render(<CommentSidebar {...props} comments={comments} showFilePath groupByFile />);
        fireEvent.click(screen.getByTestId('status-filter-resolved'));
        expect(screen.getAllByTestId('comment-file-group').map(g => g.getAttribute('aria-label'))).toEqual(['src/b.ts, 1 comment(s)']);
    });

    it('shows a review empty state and a load error', () => {
        const { rerender } = render(<CommentSidebar {...props} comments={[]} groupByFile />);
        expect(screen.getByTestId('empty-comments').textContent).toContain('No comments yet');
        rerender(<CommentSidebar {...props} comments={[]} groupByFile error="Failed to load comments" />);
        expect(screen.getByRole('alert').textContent).toBe('Failed to load comments');
        expect(screen.queryByTestId('empty-comments')).toBeNull();
    });
});

// ============================================================================
// Orphaned comment badge tests
// ============================================================================

describe('CommentSidebar — orphaned comments', () => {
    it('renders ⚠️ Location lost badge for orphaned comment', () => {
        const orphaned = { ...makeComment({ id: 'o1' }), status: 'orphaned' as any };
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[orphaned]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        expect(screen.getByTestId('orphaned-badge')).toBeTruthy();
        expect(screen.getByTestId('orphaned-badge').textContent).toContain('Location lost');
    });

    it('does not render orphaned badge for open comment', () => {
        const open = makeComment({ id: 'o', status: 'open' });
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[open]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        expect(screen.queryByTestId('orphaned-badge')).toBeNull();
    });

    it('does not render orphaned badge for resolved comment', () => {
        const resolved = makeComment({ id: 'r', status: 'resolved' });
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[resolved]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        expect(screen.queryByTestId('orphaned-badge')).toBeNull();
    });

    it('renders badge only for the orphaned entry in a mixed list', () => {
        const open = makeComment({ id: 'o1', status: 'open' });
        const orphaned = { ...makeComment({ id: 'o2' }), status: 'orphaned' as any };
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[open, orphaned]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        expect(screen.getAllByTestId('orphaned-badge')).toHaveLength(1);
    });
});

// ============================================================================
// Close button tests
// ============================================================================

describe('CommentSidebar — close button', () => {
    it('renders ✕ close button when onClose is provided', () => {
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[makeComment()]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
                onClose={noop}
            />
        );
        expect(screen.getByTestId('close-sidebar-btn')).toBeTruthy();
        expect(screen.getByTestId('close-sidebar-btn').textContent).toBe('✕');
    });

    it('does NOT render close button when onClose is not provided', () => {
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[makeComment()]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        expect(screen.queryByTestId('close-sidebar-btn')).toBeNull();
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[makeComment()]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
                onClose={onClose}
            />
        );
        fireEvent.click(screen.getByTestId('close-sidebar-btn'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('renders close button even when there are no comments', () => {
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
                onClose={noop}
            />
        );
        expect(screen.getByTestId('close-sidebar-btn')).toBeTruthy();
    });

    it('close button has correct title and aria-label', () => {
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[makeComment()]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
                onClose={noop}
            />
        );
        const btn = screen.getByTestId('close-sidebar-btn');
        expect(btn.getAttribute('title')).toBe('Close comments');
        expect(btn.getAttribute('aria-label')).toBe('Close comments');
    });

    it('close button is not rendered when showHeader is false', () => {
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[makeComment()]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
                onClose={noop}
                showHeader={false}
            />
        );
        expect(screen.queryByTestId('close-sidebar-btn')).toBeNull();
    });
});
