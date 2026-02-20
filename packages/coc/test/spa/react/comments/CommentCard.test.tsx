/**
 * Tests for CommentCard React component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommentCard } from '../../../../src/server/spa/client/react/tasks/comments/CommentCard';
import type { TaskComment } from '../../../../src/server/spa/client/task-comments-types';

function makeComment(overrides: Partial<TaskComment> = {}): TaskComment {
    return {
        id: 'c1',
        taskId: 'task1',
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello world',
        comment: 'This is a test comment',
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'tester',
        category: 'bug',
        ...overrides,
    };
}

const noop = () => {};

describe('CommentCard', () => {
    it('renders selected text quote', () => {
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(screen.getByText('hello world')).toBeTruthy();
    });

    it('truncates selected text at 120 chars', () => {
        const longText = 'a'.repeat(150);
        render(
            <CommentCard
                comment={makeComment({ selectedText: longText })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(screen.getByText('a'.repeat(120) + '…')).toBeTruthy();
    });

    it('renders comment body', () => {
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(screen.getByText('This is a test comment')).toBeTruthy();
    });

    it('shows status dot for open comment', () => {
        const { container } = render(
            <CommentCard
                comment={makeComment({ status: 'open' })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(container.querySelector('[title="Open"]')).toBeTruthy();
    });

    it('shows status dot for resolved comment', () => {
        const { container } = render(
            <CommentCard
                comment={makeComment({ status: 'resolved' })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(container.querySelector('[title="Resolved"]')).toBeTruthy();
    });

    it('renders category icon', () => {
        render(
            <CommentCard
                comment={makeComment({ category: 'bug' })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(screen.getByTitle('Bug')).toBeTruthy();
    });

    it('shows Resolve button for open comment', () => {
        render(
            <CommentCard
                comment={makeComment({ status: 'open' })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(screen.getByLabelText('Resolve')).toBeTruthy();
    });

    it('shows Reopen button for resolved comment', () => {
        render(
            <CommentCard
                comment={makeComment({ status: 'resolved' })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(screen.getByLabelText('Reopen')).toBeTruthy();
    });

    it('calls onResolve when Resolve button is clicked', () => {
        const onResolve = vi.fn();
        render(
            <CommentCard
                comment={makeComment({ status: 'open' })}
                onResolve={onResolve} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        fireEvent.click(screen.getByLabelText('Resolve'));
        expect(onResolve).toHaveBeenCalledOnce();
    });

    it('calls onUnresolve when Reopen button is clicked', () => {
        const onUnresolve = vi.fn();
        render(
            <CommentCard
                comment={makeComment({ status: 'resolved' })}
                onResolve={noop} onUnresolve={onUnresolve} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        fireEvent.click(screen.getByLabelText('Reopen'));
        expect(onUnresolve).toHaveBeenCalledOnce();
    });

    it('shows delete confirmation on delete click', () => {
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        fireEvent.click(screen.getByLabelText('Delete'));
        expect(screen.getByText('Confirm')).toBeTruthy();
    });

    it('calls onDelete on confirm', () => {
        const onDelete = vi.fn();
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={onDelete} onAskAI={noop} onClick={noop}
            />
        );
        fireEvent.click(screen.getByLabelText('Delete'));
        fireEvent.click(screen.getByText('Confirm'));
        expect(onDelete).toHaveBeenCalledOnce();
    });

    it('hides AI response section when not present', () => {
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(screen.queryByTestId('ai-response')).toBeNull();
    });

    it('shows AI response when present', () => {
        render(
            <CommentCard
                comment={makeComment({ aiResponse: 'AI says hello' })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(screen.getByTestId('ai-response')).toBeTruthy();
        expect(screen.getByText('AI says hello')).toBeTruthy();
    });

    it('calls onClick when card is clicked', () => {
        const onClick = vi.fn();
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={onClick}
            />
        );
        fireEvent.click(screen.getByTestId('comment-card-c1'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('renders author name', () => {
        render(
            <CommentCard
                comment={makeComment({ author: 'Alice' })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(screen.getByText('Alice')).toBeTruthy();
    });

    it('renders Anonymous when no author', () => {
        render(
            <CommentCard
                comment={makeComment({ author: undefined })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(screen.getByText('Anonymous')).toBeTruthy();
    });

    it('calls onAskAI when Ask AI is clicked', () => {
        const onAskAI = vi.fn();
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={onAskAI} onClick={noop}
            />
        );
        fireEvent.click(screen.getByLabelText('Ask AI'));
        expect(onAskAI).toHaveBeenCalledOnce();
    });
});
