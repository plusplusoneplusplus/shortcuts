/**
 * Tests for CommentSidebar React component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CommentSidebar } from '../../../../src/server/spa/client/react/tasks/comments/CommentSidebar';
import type { TaskComment } from '../../../../src/server/spa/client/task-comments-types';

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
        // Click Open filter
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

        it('shows spinner and is disabled when resolving=true', () => {
            const comments = [makeComment({ id: 'c1', status: 'open' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                    onResolveAllWithAI={vi.fn()}
                    resolving={true}
                />
            );
            const btn = screen.getByTestId('resolve-all-ai-btn');
            expect(btn).toHaveProperty('disabled', true);
            // Spinner renders with role="status"
            expect(btn.querySelector('[role="status"]') ?? btn.querySelector('.animate-spin')).toBeTruthy();
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
            fireEvent.click(screen.getByTestId('copy-prompt-btn'));
            expect(screen.getByTestId('copy-prompt-btn').textContent).toBe('✓');
            act(() => { vi.advanceTimersByTime(2000); });
            expect(screen.getByTestId('copy-prompt-btn').textContent).toBe('📋');
            vi.useRealTimers();
        });
    });

    describe('disabled prop propagation', () => {
        it('disables individual comment actions when resolving=true', () => {
            const comments = [makeComment({ id: 'c1', status: 'open' })];
            render(
                <CommentSidebar
                    taskId="task1" filePath="task1.md" comments={comments} loading={false}
                    onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                    onAskAI={noop} onCommentClick={noop}
                    onResolveAllWithAI={vi.fn()}
                    resolving={true}
                />
            );
            const card = screen.getByTestId('comment-card-c1');
            const resolveBtn = card.querySelector('button[aria-label="Resolve"]') as HTMLButtonElement;
            const editBtn = card.querySelector('button[aria-label="Edit"]') as HTMLButtonElement;
            const deleteBtn = card.querySelector('button[aria-label="Delete"]') as HTMLButtonElement;
            expect(resolveBtn?.disabled).toBe(true);
            expect(editBtn?.disabled).toBe(true);
            expect(deleteBtn?.disabled).toBe(true);
        });
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
