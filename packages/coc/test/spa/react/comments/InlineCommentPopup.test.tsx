/**
 * Tests for InlineCommentPopup React component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineCommentPopup } from '../../../../src/server/spa/client/react/tasks/comments/InlineCommentPopup';

describe('InlineCommentPopup', () => {
    it('renders the popup', () => {
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );
        expect(screen.getByTestId('inline-comment-popup')).toBeTruthy();
    });

    it('renders textarea', () => {
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );
        expect(screen.getByTestId('comment-textarea')).toBeTruthy();
    });

    it('renders category buttons', () => {
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );
        expect(screen.getByTestId('popup-category-bug')).toBeTruthy();
        expect(screen.getByTestId('popup-category-general')).toBeTruthy();
    });

    it('calls onSubmit with text and category', () => {
        const onSubmit = vi.fn();
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />
        );

        const textarea = screen.getByTestId('comment-textarea');
        fireEvent.change(textarea, { target: { value: 'My comment' } });

        // Click the bug category
        fireEvent.click(screen.getByTestId('popup-category-bug'));

        // Click Submit button
        const submitBtn = screen.getByText(/Submit/);
        fireEvent.click(submitBtn);

        expect(onSubmit).toHaveBeenCalledWith('My comment', 'bug');
    });

    it('does not call onSubmit with empty text', () => {
        const onSubmit = vi.fn();
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />
        );

        const submitBtn = screen.getByText(/Submit/);
        fireEvent.click(submitBtn);

        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('calls onCancel when Cancel button is clicked', () => {
        const onCancel = vi.fn();
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={onCancel}
            />
        );

        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('submit button is disabled when textarea is empty', () => {
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        const submitBtn = screen.getByText(/Submit/);
        expect(submitBtn.closest('button')?.disabled).toBe(true);
    });
});
