/**
 * Tests for CommentSidebar React component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

    it('filters by category', () => {
        const comments = [
            makeComment({ id: 'c1', category: 'bug', comment: 'bug comment' }),
            makeComment({ id: 'c2', category: 'question', comment: 'question comment' }),
        ];
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={comments} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        fireEvent.click(screen.getByTestId('category-filter-bug'));
        expect(screen.getByText('bug comment')).toBeTruthy();
        expect(screen.queryByText('question comment')).toBeNull();
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

    it('renders category filter chips', () => {
        render(
            <CommentSidebar
                taskId="task1" filePath="task1.md" comments={[]} loading={false}
                onResolve={noop} onUnresolve={noop} onDelete={noop} onEdit={noop}
                onAskAI={noop} onCommentClick={noop}
            />
        );
        expect(screen.getByTestId('category-filter-all')).toBeTruthy();
        expect(screen.getByTestId('category-filter-bug')).toBeTruthy();
        expect(screen.getByTestId('category-filter-question')).toBeTruthy();
    });
});
