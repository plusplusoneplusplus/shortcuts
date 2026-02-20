/**
 * Tests for InlineCommentPopup React component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
    InlineCommentPopup,
    clampToViewport,
} from '../../../../src/server/spa/client/react/tasks/comments/InlineCommentPopup';

describe('clampToViewport', () => {
    const vw = 1024;
    const vh = 768;
    const pw = 300;
    const ph = 200;
    const margin = 8;

    it('returns original position when fully inside viewport', () => {
        const result = clampToViewport({ top: 100, left: 100 }, pw, ph, vw, vh, margin);
        expect(result).toEqual({ top: 100, left: 100 });
    });

    it('clamps popup that overflows the right edge', () => {
        const result = clampToViewport({ top: 100, left: 900 }, pw, ph, vw, vh, margin);
        expect(result.left).toBe(vw - pw - margin);
        expect(result.top).toBe(100);
    });

    it('clamps popup that overflows the bottom edge', () => {
        const result = clampToViewport({ top: 700, left: 100 }, pw, ph, vw, vh, margin);
        expect(result.top).toBe(vh - ph - margin);
        expect(result.left).toBe(100);
    });

    it('clamps popup that overflows both right and bottom', () => {
        const result = clampToViewport({ top: 700, left: 900 }, pw, ph, vw, vh, margin);
        expect(result.top).toBe(vh - ph - margin);
        expect(result.left).toBe(vw - pw - margin);
    });

    it('clamps negative top to margin', () => {
        const result = clampToViewport({ top: -50, left: 100 }, pw, ph, vw, vh, margin);
        expect(result.top).toBe(margin);
        expect(result.left).toBe(100);
    });

    it('clamps negative left to margin', () => {
        const result = clampToViewport({ top: 100, left: -20 }, pw, ph, vw, vh, margin);
        expect(result.left).toBe(margin);
        expect(result.top).toBe(100);
    });

    it('clamps all four edges when popup is larger than viewport', () => {
        const result = clampToViewport({ top: -10, left: -10 }, 2000, 2000, vw, vh, margin);
        expect(result.top).toBe(margin);
        expect(result.left).toBe(margin);
    });

    it('handles zero-size popup', () => {
        const result = clampToViewport({ top: 100, left: 100 }, 0, 0, vw, vh, margin);
        expect(result).toEqual({ top: 100, left: 100 });
    });

    it('handles position exactly at bottom-right boundary', () => {
        const result = clampToViewport(
            { top: vh - ph - margin, left: vw - pw - margin },
            pw, ph, vw, vh, margin,
        );
        expect(result).toEqual({ top: vh - ph - margin, left: vw - pw - margin });
    });

    it('handles custom margin', () => {
        const customMargin = 20;
        const result = clampToViewport({ top: 760, left: 1010 }, pw, ph, vw, vh, customMargin);
        expect(result.top).toBe(vh - ph - customMargin);
        expect(result.left).toBe(vw - pw - customMargin);
    });
});

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
