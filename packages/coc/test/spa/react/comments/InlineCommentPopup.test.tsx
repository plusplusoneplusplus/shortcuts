/**
 * Tests for InlineCommentPopup React component.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
    InlineCommentPopup,
    clampToViewport,
} from '../../../../src/server/spa/client/react/tasks/comments/InlineCommentPopup';
import { mockViewport } from '../../helpers/viewport-mock';

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

describe('InlineCommentPopup drag behaviour', () => {
    let viewportCleanup: (() => void) | undefined;

    afterEach(() => {
        viewportCleanup?.();
        viewportCleanup = undefined;
    });

    it('renders a drag handle on desktop', () => {
        viewportCleanup = mockViewport(1280);
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );
        expect(document.querySelector('[data-testid="drag-handle"]')).not.toBeNull();
    });

    it('does not render a drag handle on mobile (BottomSheet path)', () => {
        viewportCleanup = mockViewport(375);
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );
        expect(document.querySelector('[data-testid="drag-handle"]')).toBeNull();
    });

    it('dragging the handle moves the popup without closing it', () => {
        viewportCleanup = mockViewport(1280);
        const onCancel = vi.fn();
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={onCancel}
            />
        );

        const handle = document.querySelector('[data-testid="drag-handle"]') as HTMLElement;
        expect(handle).not.toBeNull();

        const popup = screen.getByTestId('inline-comment-popup');
        const initialTop = (popup as HTMLElement).style.top;
        const initialLeft = (popup as HTMLElement).style.left;

        // Simulate drag: mousedown on handle, mousemove, mouseup
        act(() => {
            fireEvent.mouseDown(handle, { clientX: 200, clientY: 100 });
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 130, bubbles: true }));
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        });

        const newTop = (popup as HTMLElement).style.top;
        const newLeft = (popup as HTMLElement).style.left;

        // Position should have changed
        expect(newTop).not.toBe(initialTop);
        expect(newLeft).not.toBe(initialLeft);

        // Popup should not have been closed
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('popup stays within viewport after drag past the right/bottom edges', () => {
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
        viewportCleanup = mockViewport(1280);

        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        const handle = document.querySelector('[data-testid="drag-handle"]') as HTMLElement;
        const popup = screen.getByTestId('inline-comment-popup') as HTMLElement;

        act(() => {
            fireEvent.mouseDown(handle, { clientX: 200, clientY: 100 });
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 9999, clientY: 9999, bubbles: true }));
        });

        const top = parseFloat(popup.style.top);
        const left = parseFloat(popup.style.left);
        expect(left).toBeLessThanOrEqual(1024 - 8);
        expect(top).toBeLessThanOrEqual(768 - 8);

        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        });
    });

    it('popup stays within viewport after drag past the left/top edges', () => {
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
        viewportCleanup = mockViewport(1280);

        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        const handle = document.querySelector('[data-testid="drag-handle"]') as HTMLElement;
        const popup = screen.getByTestId('inline-comment-popup') as HTMLElement;

        act(() => {
            fireEvent.mouseDown(handle, { clientX: 200, clientY: 100 });
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: -9999, clientY: -9999, bubbles: true }));
        });

        const top = parseFloat(popup.style.top);
        const left = parseFloat(popup.style.left);
        expect(left).toBeGreaterThanOrEqual(8);
        expect(top).toBeGreaterThanOrEqual(8);

        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        });
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

    it('calls onSubmit with text and default category general', () => {
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

        // Click Submit button
        const submitBtn = screen.getByText(/Submit/);
        fireEvent.click(submitBtn);

        expect(onSubmit).toHaveBeenCalledWith('My comment', 'general');
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

    it('renders category picker with all 6 categories', () => {
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        expect(screen.getByTestId('category-picker')).toBeTruthy();
        expect(screen.getByTestId('category-chip-bug')).toBeTruthy();
        expect(screen.getByTestId('category-chip-question')).toBeTruthy();
        expect(screen.getByTestId('category-chip-suggestion')).toBeTruthy();
        expect(screen.getByTestId('category-chip-praise')).toBeTruthy();
        expect(screen.getByTestId('category-chip-nitpick')).toBeTruthy();
        expect(screen.getByTestId('category-chip-general')).toBeTruthy();
    });

    it('defaults to general category selected', () => {
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        const generalChip = screen.getByTestId('category-chip-general');
        expect(generalChip.className).toContain('bg-[#0078d4]');
    });

    it('submits with selected category', () => {
        const onSubmit = vi.fn();
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />
        );

        // Select 'bug' category
        fireEvent.click(screen.getByTestId('category-chip-bug'));

        // Type and submit
        const textarea = screen.getByTestId('comment-textarea');
        fireEvent.change(textarea, { target: { value: 'Found a bug' } });
        fireEvent.click(screen.getByText(/Submit/));

        expect(onSubmit).toHaveBeenCalledWith('Found a bug', 'bug');
    });

    it('highlights only the selected category chip', () => {
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        // Click suggestion
        fireEvent.click(screen.getByTestId('category-chip-suggestion'));

        const suggestionChip = screen.getByTestId('category-chip-suggestion');
        const generalChip = screen.getByTestId('category-chip-general');

        expect(suggestionChip.className).toContain('bg-[#0078d4]');
        expect(generalChip.className).not.toContain('bg-[#0078d4]');
    });

    it('does not close on click outside', () => {
        const onCancel = vi.fn();
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={onCancel}
            />
        );

        // Click outside the popup
        act(() => {
            document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('category chips show icon and label', () => {
        render(
            <InlineCommentPopup
                position={{ top: 100, left: 200 }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        const bugChip = screen.getByTestId('category-chip-bug');
        expect(bugChip.textContent).toContain('🐛');
        expect(bugChip.textContent).toContain('Bug');
        expect(bugChip.getAttribute('title')).toBe('Bug');
    });
});
