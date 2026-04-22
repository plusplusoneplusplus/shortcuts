/**
 * Tests for SwipeableHistoryItem component.
 *
 * Covers:
 * - Renders children directly on desktop (isMobile=false)
 * - Renders swipe wrapper on mobile
 * - Reveal layer shows archive label for non-archived items
 * - Reveal layer shows unarchive label for archived items
 * - Does not render swipe wrapper when no action is provided
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SwipeableHistoryItem } from '../../../../src/server/spa/client/react/features/chat/SwipeableHistoryItem';

describe('SwipeableHistoryItem', () => {
    it('renders children directly on desktop (no swipe wrapper)', () => {
        const { container } = render(
            <SwipeableHistoryItem isMobile={false} onArchive={vi.fn()}>
                <div data-testid="child">Hello</div>
            </SwipeableHistoryItem>,
        );

        expect(screen.getByTestId('child')).toBeDefined();
        // No swipe reveal layer on desktop
        expect(container.querySelector('[data-testid="swipe-reveal-layer"]')).toBeNull();
    });

    it('renders swipe wrapper on mobile with archive action', () => {
        const { container } = render(
            <SwipeableHistoryItem isMobile={true} onArchive={vi.fn()}>
                <div data-testid="child">Hello</div>
            </SwipeableHistoryItem>,
        );

        expect(screen.getByTestId('child')).toBeDefined();
        expect(container.querySelector('[data-testid="swipe-reveal-layer"]')).toBeDefined();
        expect(container.querySelector('[data-testid="swipe-foreground"]')).toBeDefined();
    });

    it('shows archive label on reveal layer for non-archived items', () => {
        render(
            <SwipeableHistoryItem isMobile={true} onArchive={vi.fn()}>
                <div>content</div>
            </SwipeableHistoryItem>,
        );

        const reveal = screen.getByTestId('swipe-reveal-layer');
        expect(reveal.textContent).toContain('Archive');
    });

    it('shows unarchive label on reveal layer for archived items', () => {
        render(
            <SwipeableHistoryItem isMobile={true} onUnarchive={vi.fn()} isArchived>
                <div>content</div>
            </SwipeableHistoryItem>,
        );

        const reveal = screen.getByTestId('swipe-reveal-layer');
        expect(reveal.textContent).toContain('Unarchive');
    });

    it('renders children directly when no action is provided even on mobile', () => {
        const { container } = render(
            <SwipeableHistoryItem isMobile={true}>
                <div data-testid="child">Hello</div>
            </SwipeableHistoryItem>,
        );

        expect(screen.getByTestId('child')).toBeDefined();
        expect(container.querySelector('[data-testid="swipe-reveal-layer"]')).toBeNull();
    });

    it('uses red background for archive reveal layer', () => {
        const { container } = render(
            <SwipeableHistoryItem isMobile={true} onArchive={vi.fn()}>
                <div>content</div>
            </SwipeableHistoryItem>,
        );

        const reveal = container.querySelector('[data-testid="swipe-reveal-layer"]') as HTMLElement;
        expect(reveal.className).toContain('bg-red-500');
    });

    it('uses blue background for unarchive reveal layer', () => {
        const { container } = render(
            <SwipeableHistoryItem isMobile={true} onUnarchive={vi.fn()} isArchived>
                <div>content</div>
            </SwipeableHistoryItem>,
        );

        const reveal = container.querySelector('[data-testid="swipe-reveal-layer"]') as HTMLElement;
        expect(reveal.className).toContain('bg-blue-500');
    });
});
