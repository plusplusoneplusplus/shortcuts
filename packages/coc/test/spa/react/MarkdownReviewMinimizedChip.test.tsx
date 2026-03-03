/**
 * Tests for MarkdownReviewMinimizedChip component.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { MarkdownReviewMinimizedChip } from '../../../src/server/spa/client/react/processes/MarkdownReviewMinimizedChip';

afterEach(cleanup);

describe('MarkdownReviewMinimizedChip', () => {
    it('renders the file name', () => {
        render(
            <MarkdownReviewMinimizedChip
                fileName="plan.md"
                onRestore={vi.fn()}
                onClose={vi.fn()}
            />
        );
        const chip = document.querySelector('[data-testid="minimized-chip"]');
        expect(chip).not.toBeNull();
        expect(chip!.textContent).toContain('plan.md');
    });

    it('calls onRestore when the file name button is clicked', () => {
        const onRestore = vi.fn();
        render(
            <MarkdownReviewMinimizedChip
                fileName="notes.md"
                onRestore={onRestore}
                onClose={vi.fn()}
            />
        );
        const restoreBtn = document.querySelector('[data-testid="minimized-chip-restore"]') as HTMLElement;
        fireEvent.click(restoreBtn);
        expect(onRestore).toHaveBeenCalledOnce();
    });

    it('calls onRestore when the restore icon button is clicked', () => {
        const onRestore = vi.fn();
        render(
            <MarkdownReviewMinimizedChip
                fileName="notes.md"
                onRestore={onRestore}
                onClose={vi.fn()}
            />
        );
        const restoreIcon = document.querySelector('[data-testid="minimized-chip-restore-icon"]') as HTMLElement;
        fireEvent.click(restoreIcon);
        expect(onRestore).toHaveBeenCalledOnce();
    });

    it('calls onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        render(
            <MarkdownReviewMinimizedChip
                fileName="notes.md"
                onRestore={vi.fn()}
                onClose={onClose}
            />
        );
        const closeBtn = document.querySelector('[data-testid="minimized-chip-close"]') as HTMLElement;
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('close button does not call onRestore', () => {
        const onRestore = vi.fn();
        const onClose = vi.fn();
        render(
            <MarkdownReviewMinimizedChip
                fileName="notes.md"
                onRestore={onRestore}
                onClose={onClose}
            />
        );
        const closeBtn = document.querySelector('[data-testid="minimized-chip-close"]') as HTMLElement;
        fireEvent.click(closeBtn);
        expect(onRestore).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('chip has fixed positioning', () => {
        render(
            <MarkdownReviewMinimizedChip
                fileName="plan.md"
                onRestore={vi.fn()}
                onClose={vi.fn()}
            />
        );
        const chip = document.querySelector('[data-testid="minimized-chip"]') as HTMLElement;
        expect(chip.className).toContain('fixed');
        expect(chip.className).toContain('right-4');
    });

    it('chip is positioned at bottom-16 on mobile viewport', () => {
        // Simulate mobile by setting window.matchMedia to return isMobile=true
        const original = window.matchMedia;
        window.matchMedia = (query: string) => ({
            matches: query.includes('max-width: 767px'),
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }) as MediaQueryList;

        render(
            <MarkdownReviewMinimizedChip
                fileName="plan.md"
                onRestore={vi.fn()}
                onClose={vi.fn()}
            />
        );
        const chip = document.querySelector('[data-testid="minimized-chip"]') as HTMLElement;
        expect(chip.className).toContain('bottom-16');

        window.matchMedia = original;
    });

    it('chip is positioned at bottom-4 on desktop viewport', () => {
        const original = window.matchMedia;
        window.matchMedia = (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }) as MediaQueryList;

        render(
            <MarkdownReviewMinimizedChip
                fileName="plan.md"
                onRestore={vi.fn()}
                onClose={vi.fn()}
            />
        );
        const chip = document.querySelector('[data-testid="minimized-chip"]') as HTMLElement;
        expect(chip.className).toContain('bottom-4');

        window.matchMedia = original;
    });

    it('restore button has accessible aria-label containing file name', () => {
        render(
            <MarkdownReviewMinimizedChip
                fileName="spec.md"
                onRestore={vi.fn()}
                onClose={vi.fn()}
            />
        );
        const restoreBtn = document.querySelector('[data-testid="minimized-chip-restore"]') as HTMLElement;
        expect(restoreBtn.getAttribute('aria-label')).toContain('spec.md');
    });

    it('close button has accessible aria-label', () => {
        render(
            <MarkdownReviewMinimizedChip
                fileName="spec.md"
                onRestore={vi.fn()}
                onClose={vi.fn()}
            />
        );
        const closeBtn = document.querySelector('[data-testid="minimized-chip-close"]') as HTMLElement;
        expect(closeBtn.getAttribute('aria-label')).toBeTruthy();
    });
});
