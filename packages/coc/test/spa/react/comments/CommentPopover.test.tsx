/**
 * Tests for CommentPopover React component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CommentPopover } from '../../../../src/server/spa/client/react/tasks/comments/CommentPopover';
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

describe('CommentPopover', () => {
    it('renders the popover with comment content', () => {
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        expect(screen.getByTestId('comment-popover')).toBeTruthy();
        expect(screen.getByTestId('popover-comment-body').textContent).toBe('This is a test comment');
    });

    it('shows selected text blockquote', () => {
        render(
            <CommentPopover
                comment={makeComment({ selectedText: 'some selected text' })}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        expect(screen.getByText('some selected text')).toBeTruthy();
    });

    it('shows status dot for open comments', () => {
        render(
            <CommentPopover
                comment={makeComment({ status: 'open' })}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        const popover = screen.getByTestId('comment-popover');
        expect(popover.querySelector('[title="Open"]')).toBeTruthy();
    });

    it('shows status dot for resolved comments', () => {
        render(
            <CommentPopover
                comment={makeComment({ status: 'resolved' })}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        const popover = screen.getByTestId('comment-popover');
        expect(popover.querySelector('[title="Resolved"]')).toBeTruthy();
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={onClose}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        fireEvent.click(screen.getByTestId('popover-close'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onResolve when Resolve button is clicked', () => {
        const onResolve = vi.fn();
        render(
            <CommentPopover
                comment={makeComment({ status: 'open' })}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={onResolve}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        fireEvent.click(screen.getByLabelText('Resolve'));
        expect(onResolve).toHaveBeenCalledWith('c1');
    });

    it('calls onUnresolve when Reopen button is clicked', () => {
        const onUnresolve = vi.fn();
        render(
            <CommentPopover
                comment={makeComment({ status: 'resolved' })}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={onUnresolve}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        fireEvent.click(screen.getByLabelText('Reopen'));
        expect(onUnresolve).toHaveBeenCalledWith('c1');
    });

    it('calls onDelete when Delete button is clicked', () => {
        const onDelete = vi.fn();
        const onClose = vi.fn();
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={onClose}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={onDelete}
                onEdit={noop}
            />,
        );
        fireEvent.click(screen.getByLabelText('Delete'));
        expect(onDelete).toHaveBeenCalledWith('c1');
        expect(onClose).toHaveBeenCalled();
    });

    it('enters edit mode and saves', () => {
        const onEdit = vi.fn();
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={onEdit}
            />,
        );

        fireEvent.click(screen.getByLabelText('Edit'));
        expect(screen.getByTestId('popover-edit-textarea')).toBeTruthy();

        fireEvent.change(screen.getByTestId('popover-edit-textarea'), {
            target: { value: 'Updated comment' },
        });
        fireEvent.click(screen.getByText('Save'));
        expect(onEdit).toHaveBeenCalledWith('c1', 'Updated comment');
    });

    it('cancels edit mode without saving', () => {
        const onEdit = vi.fn();
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={onEdit}
            />,
        );

        fireEvent.click(screen.getByLabelText('Edit'));
        fireEvent.change(screen.getByTestId('popover-edit-textarea'), {
            target: { value: 'Changed text' },
        });
        fireEvent.click(screen.getByText('Cancel'));
        expect(onEdit).not.toHaveBeenCalled();
        expect(screen.getByTestId('popover-comment-body')).toBeTruthy();
    });

    it('shows author and timestamp', () => {
        render(
            <CommentPopover
                comment={makeComment({ author: 'Alice' })}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        expect(screen.getByText('Alice')).toBeTruthy();
    });

    it('shows AI response when present', () => {
        render(
            <CommentPopover
                comment={makeComment({ aiResponse: 'AI says hello' })}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        expect(screen.getByTestId('popover-ai-response')).toBeTruthy();
        expect(screen.getByText('AI says hello')).toBeTruthy();
    });

    it('does not show AI response section when absent', () => {
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        expect(screen.queryByTestId('popover-ai-response')).toBeNull();
    });

    it('closes on Escape key', () => {
        const onClose = vi.fn();
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={onClose}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('shows category icon', () => {
        render(
            <CommentPopover
                comment={makeComment({ category: 'suggestion' })}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        expect(screen.getByTitle('Suggestion')).toBeTruthy();
    });

    // --- AI integration tests ---

    it('renders Ask AI button when onAskAI is provided', () => {
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
                onAskAI={vi.fn()}
            />,
        );
        expect(screen.getByLabelText('Ask AI')).toBeTruthy();
    });

    it('does not render Ask AI button when onAskAI is not provided', () => {
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        expect(screen.queryByLabelText('Ask AI')).toBeNull();
    });

    it('clicking Ask AI opens AI command menu', () => {
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
                onAskAI={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByTestId('popover-ai-menu-trigger'));
        expect(screen.getByTestId('popover-ai-command-menu')).toBeTruthy();
    });

    it('Clarify option calls onAskAI with correct args', () => {
        const onAskAI = vi.fn();
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
                onAskAI={onAskAI}
            />,
        );
        fireEvent.click(screen.getByTestId('popover-ai-menu-trigger'));
        fireEvent.click(screen.getByTestId('popover-ai-cmd-clarify'));
        expect(onAskAI).toHaveBeenCalledWith('c1', 'clarify', undefined);
    });

    it('Go Deeper option calls onAskAI with correct args', () => {
        const onAskAI = vi.fn();
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
                onAskAI={onAskAI}
            />,
        );
        fireEvent.click(screen.getByTestId('popover-ai-menu-trigger'));
        fireEvent.click(screen.getByTestId('popover-ai-cmd-go-deeper'));
        expect(onAskAI).toHaveBeenCalledWith('c1', 'go-deeper', undefined);
    });

    it('Custom question calls onAskAI with question text', () => {
        const onAskAI = vi.fn();
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
                onAskAI={onAskAI}
            />,
        );
        fireEvent.click(screen.getByTestId('popover-ai-menu-trigger'));
        fireEvent.click(screen.getByTestId('popover-ai-cmd-custom'));
        const input = screen.getByTestId('popover-ai-custom-input');
        fireEvent.change(input, { target: { value: 'my question' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onAskAI).toHaveBeenCalledWith('c1', 'custom', 'my question');
    });

    it('shows loading spinner when aiLoading=true', () => {
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
                onAskAI={vi.fn()}
                aiLoading={true}
            />,
        );
        expect(screen.getByTestId('popover-ai-loading')).toBeTruthy();
    });

    it('shows error state when aiError is set', () => {
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
                aiError="AI failed"
            />,
        );
        const errorEl = screen.getByTestId('popover-ai-error');
        expect(errorEl.textContent).toContain('AI failed');
    });

    it('dismiss error calls onClearAiError', () => {
        const onClearAiError = vi.fn();
        render(
            <CommentPopover
                comment={makeComment()}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
                aiError="oops"
                onClearAiError={onClearAiError}
            />,
        );
        fireEvent.click(screen.getByLabelText('Dismiss error'));
        expect(onClearAiError).toHaveBeenCalledWith('c1');
    });

    it('renders markdown in aiResponse', () => {
        render(
            <CommentPopover
                comment={makeComment({ aiResponse: '**bold**' })}
                position={{ top: 100, left: 200 }}
                onClose={noop}
                onResolve={noop}
                onUnresolve={noop}
                onDelete={noop}
                onEdit={noop}
            />,
        );
        const response = screen.getByTestId('popover-ai-response');
        expect(response).toBeTruthy();
        expect(response.querySelector('.markdown-body')).toBeTruthy();
    });
});
