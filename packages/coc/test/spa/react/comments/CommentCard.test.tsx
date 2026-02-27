/**
 * Tests for CommentCard React component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

    it('calls onAskAI when Ask AI menu command is clicked', () => {
        const onAskAI = vi.fn();
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={onAskAI} onClick={noop}
            />
        );
        fireEvent.click(screen.getByTestId('ai-menu-trigger'));
        fireEvent.click(screen.getByTestId('ai-cmd-clarify'));
        expect(onAskAI).toHaveBeenCalledWith('clarify');
    });

    it('opens dropdown on 🤖 click', () => {
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        fireEvent.click(screen.getByTestId('ai-menu-trigger'));
        expect(screen.getByTestId('ai-command-menu')).toBeTruthy();
    });

    it('Clarify command calls onAskAI("clarify")', () => {
        const onAskAI = vi.fn();
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={onAskAI} onClick={noop}
            />
        );
        fireEvent.click(screen.getByTestId('ai-menu-trigger'));
        fireEvent.click(screen.getByTestId('ai-cmd-clarify'));
        expect(onAskAI).toHaveBeenCalledWith('clarify');
    });

    it('Go Deeper command calls onAskAI("go-deeper")', () => {
        const onAskAI = vi.fn();
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={onAskAI} onClick={noop}
            />
        );
        fireEvent.click(screen.getByTestId('ai-menu-trigger'));
        fireEvent.click(screen.getByTestId('ai-cmd-go-deeper'));
        expect(onAskAI).toHaveBeenCalledWith('go-deeper');
    });

    it('Custom… shows input and submits', () => {
        const onAskAI = vi.fn();
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={onAskAI} onClick={noop}
            />
        );
        fireEvent.click(screen.getByTestId('ai-menu-trigger'));
        fireEvent.click(screen.getByTestId('ai-cmd-custom'));
        const input = screen.getByTestId('ai-custom-input');
        expect(input).toBeTruthy();
        fireEvent.change(input, { target: { value: 'my question' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onAskAI).toHaveBeenCalledWith('custom', 'my question');
    });

    it('renders loading spinner when aiLoading=true', () => {
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
                aiLoading={true}
            />
        );
        const trigger = screen.getByTestId('ai-menu-trigger');
        expect(trigger).toHaveProperty('disabled', true);
        expect(trigger.querySelector('[aria-label="Loading"]')).toBeTruthy();
    });

    it('renders error banner when aiError is set', () => {
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
                aiError="Something went wrong"
            />
        );
        const banner = screen.getByTestId('ai-error-banner');
        expect(banner.textContent).toContain('Something went wrong');
    });

    it('error banner dismiss calls onClearAiError', () => {
        const onClearAiError = vi.fn();
        render(
            <CommentCard
                comment={makeComment()}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
                aiError="err"
                onClearAiError={onClearAiError}
            />
        );
        fireEvent.click(screen.getByLabelText('Dismiss error'));
        expect(onClearAiError).toHaveBeenCalledOnce();
    });

    it('renders markdown for aiResponse', () => {
        const { container } = render(
            <CommentCard
                comment={makeComment({ aiResponse: '# Hello\n\nworld' })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        const response = screen.getByTestId('ai-response');
        expect(response).toBeTruthy();
        // MarkdownView renders with markdown-body class
        expect(response.querySelector('.markdown-body')).toBeTruthy();
    });

    it('expand/collapse toggle for AI response', () => {
        render(
            <CommentCard
                comment={makeComment({ aiResponse: 'Some AI response text' })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        const response = screen.getByTestId('ai-response');
        // Initially collapsed
        expect(response.querySelector('.line-clamp-3')).toBeTruthy();
        // Expand
        fireEvent.click(screen.getByTestId('ai-response-expand'));
        expect(response.querySelector('.line-clamp-3')).toBeNull();
        // Collapse again
        fireEvent.click(screen.getByTestId('ai-response-expand'));
        expect(response.querySelector('.line-clamp-3')).toBeTruthy();
    });

    it('copy button present when aiResponse is set', () => {
        render(
            <CommentCard
                comment={makeComment({ aiResponse: 'hello' })}
                onResolve={noop} onUnresolve={noop} onEdit={noop}
                onDelete={noop} onAskAI={noop} onClick={noop}
            />
        );
        expect(screen.getByTestId('ai-response-copy')).toBeTruthy();
    });

    describe('Fix with AI button', () => {
        it('renders 🔧 button for open comment with onFixWithAI provided', () => {
            render(
                <CommentCard
                    comment={makeComment({ status: 'open' })}
                    onResolve={noop} onUnresolve={noop} onEdit={noop}
                    onDelete={noop} onAskAI={noop} onClick={noop}
                    onFixWithAI={vi.fn()}
                />
            );
            expect(screen.getByTestId('fix-with-ai')).toBeTruthy();
        });

        it('does NOT render 🔧 button for resolved comment', () => {
            render(
                <CommentCard
                    comment={makeComment({ status: 'resolved' })}
                    onResolve={noop} onUnresolve={noop} onEdit={noop}
                    onDelete={noop} onAskAI={noop} onClick={noop}
                    onFixWithAI={vi.fn()}
                />
            );
            expect(screen.queryByTestId('fix-with-ai')).toBeNull();
        });

        it('does NOT render 🔧 button when onFixWithAI is undefined', () => {
            render(
                <CommentCard
                    comment={makeComment({ status: 'open' })}
                    onResolve={noop} onUnresolve={noop} onEdit={noop}
                    onDelete={noop} onAskAI={noop} onClick={noop}
                />
            );
            expect(screen.queryByTestId('fix-with-ai')).toBeNull();
        });

        it('clicking 🔧 button calls onFixWithAI', () => {
            const onFixWithAI = vi.fn();
            render(
                <CommentCard
                    comment={makeComment({ status: 'open' })}
                    onResolve={noop} onUnresolve={noop} onEdit={noop}
                    onDelete={noop} onAskAI={noop} onClick={noop}
                    onFixWithAI={onFixWithAI}
                />
            );
            fireEvent.click(screen.getByLabelText('Fix with AI'));
            expect(onFixWithAI).toHaveBeenCalledOnce();
        });

        it('shows spinner when fixLoading=true', () => {
            render(
                <CommentCard
                    comment={makeComment({ status: 'open' })}
                    onResolve={noop} onUnresolve={noop} onEdit={noop}
                    onDelete={noop} onAskAI={noop} onClick={noop}
                    onFixWithAI={noop}
                    fixLoading={true}
                />
            );
            const btn = screen.getByTestId('fix-with-ai');
            expect(btn.querySelector('[aria-label="Loading"]')).toBeTruthy();
        });

        it('🔧 button is disabled when fixLoading=true', () => {
            render(
                <CommentCard
                    comment={makeComment({ status: 'open' })}
                    onResolve={noop} onUnresolve={noop} onEdit={noop}
                    onDelete={noop} onAskAI={noop} onClick={noop}
                    onFixWithAI={noop}
                    fixLoading={true}
                />
            );
            expect(screen.getByTestId('fix-with-ai')).toHaveProperty('disabled', true);
        });

        it('Resolve button is disabled when fixLoading=true', () => {
            render(
                <CommentCard
                    comment={makeComment({ status: 'open' })}
                    onResolve={noop} onUnresolve={noop} onEdit={noop}
                    onDelete={noop} onAskAI={noop} onClick={noop}
                    onFixWithAI={noop}
                    fixLoading={true}
                />
            );
            expect(screen.getByLabelText('Resolve')).toHaveProperty('disabled', true);
        });
    });
});
