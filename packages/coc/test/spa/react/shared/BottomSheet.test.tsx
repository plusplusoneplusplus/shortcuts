/**
 * Tests for BottomSheet shared component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// No external hooks needed — BottomSheet is self-contained
import { BottomSheet } from '../../../../src/server/spa/client/react/shared/BottomSheet';

describe('BottomSheet', () => {
    let originalOverflow: string;

    beforeEach(() => {
        originalOverflow = document.body.style.overflow;
    });

    afterEach(() => {
        document.body.style.overflow = originalOverflow;
    });

    it('renders nothing when isOpen is false', () => {
        const { container } = render(
            <BottomSheet isOpen={false} onClose={vi.fn()}>
                <div>Content</div>
            </BottomSheet>
        );
        expect(container.innerHTML).toBe('');
        expect(screen.queryByTestId('bottomsheet-backdrop')).toBeNull();
    });

    it('renders backdrop, sheet, title, and children when isOpen is true', () => {
        render(
            <BottomSheet isOpen={true} onClose={vi.fn()} title="My Title">
                <div data-testid="child">Hello</div>
            </BottomSheet>
        );
        expect(screen.getByTestId('bottomsheet-backdrop')).toBeTruthy();
        expect(screen.getByTestId('bottomsheet-panel')).toBeTruthy();
        expect(screen.getByText('My Title')).toBeTruthy();
        expect(screen.getByTestId('child')).toBeTruthy();
    });

    it('clicking backdrop calls onClose', () => {
        const onClose = vi.fn();
        render(
            <BottomSheet isOpen={true} onClose={onClose}>
                <div>Content</div>
            </BottomSheet>
        );
        fireEvent.click(screen.getByTestId('bottomsheet-backdrop'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking inside the sheet does NOT call onClose', () => {
        const onClose = vi.fn();
        render(
            <BottomSheet isOpen={true} onClose={onClose}>
                <div data-testid="inner">Content</div>
            </BottomSheet>
        );
        fireEvent.click(screen.getByTestId('inner'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('pressing Escape calls onClose', () => {
        const onClose = vi.fn();
        render(
            <BottomSheet isOpen={true} onClose={onClose}>
                <div>Content</div>
            </BottomSheet>
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('sheet has correct z-index (9500)', () => {
        render(
            <BottomSheet isOpen={true} onClose={vi.fn()}>
                <div>Content</div>
            </BottomSheet>
        );
        const backdrop = screen.getByTestId('bottomsheet-backdrop');
        expect(backdrop.style.zIndex).toBe('9500');
    });

    it('custom height prop applies as max-height style', () => {
        render(
            <BottomSheet isOpen={true} onClose={vi.fn()} height={80}>
                <div>Content</div>
            </BottomSheet>
        );
        const panel = screen.getByTestId('bottomsheet-panel');
        expect(panel.style.maxHeight).toBe('80vh');
    });

    it('default height is 60vh when no height prop provided', () => {
        render(
            <BottomSheet isOpen={true} onClose={vi.fn()}>
                <div>Content</div>
            </BottomSheet>
        );
        const panel = screen.getByTestId('bottomsheet-panel');
        expect(panel.style.maxHeight).toBe('60vh');
    });

    it('drag handle element is present', () => {
        render(
            <BottomSheet isOpen={true} onClose={vi.fn()}>
                <div>Content</div>
            </BottomSheet>
        );
        expect(screen.getByTestId('bottomsheet-drag-handle')).toBeTruthy();
    });

    it('body gets overflow:hidden when open, restored on close', () => {
        document.body.style.overflow = '';
        const { rerender } = render(
            <BottomSheet isOpen={true} onClose={vi.fn()}>
                <div>Content</div>
            </BottomSheet>
        );
        expect(document.body.style.overflow).toBe('hidden');

        rerender(
            <BottomSheet isOpen={false} onClose={vi.fn()}>
                <div>Content</div>
            </BottomSheet>
        );
        expect(document.body.style.overflow).toBe('');
    });
});
