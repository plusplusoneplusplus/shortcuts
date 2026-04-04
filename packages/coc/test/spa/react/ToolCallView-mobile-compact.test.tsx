/**
 * Tests for ToolCallView mobile compaction:
 * - Tighter padding on headers and bodies
 * - Timestamp hidden on mobile
 * - Summary truncation on mobile
 * - Reduced outer margin and depth indentation
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';
import { mockViewport } from '../helpers/viewport-mock';

let viewportCleanup: (() => void) | undefined;

afterEach(() => {
    viewportCleanup?.();
    viewportCleanup = undefined;
});

function renderCard(overrides: Record<string, unknown> = {}, depth = 0) {
    return render(
        <ToolCallView
            toolCall={{
                id: 'tc-1',
                toolName: 'grep',
                args: { pattern: 'foo', path: '/src' },
                result: '3 matches found',
                status: 'completed',
                startTime: '2026-04-04T12:30:00.000Z',
                endTime: '2026-04-04T12:30:01.200Z',
                ...overrides,
            }}
            depth={depth}
        />
    );
}

describe('ToolCallView — mobile compact header', () => {
    it('uses compact padding classes on mobile', () => {
        viewportCleanup = mockViewport(375);
        renderCard();
        const header = document.querySelector('.tool-call-header')!;
        expect(header.className).toContain('px-2');
        expect(header.className).toContain('py-1');
        expect(header.className).toContain('gap-1.5');
        // md: overrides present for desktop
        expect(header.className).toContain('md:px-2.5');
        expect(header.className).toContain('md:py-1.5');
        expect(header.className).toContain('md:gap-2');
    });

    it('uses compact padding classes on desktop', () => {
        viewportCleanup = mockViewport(1024);
        renderCard();
        const header = document.querySelector('.tool-call-header')!;
        // Same Tailwind classes applied; desktop applies md: overrides via CSS
        expect(header.className).toContain('md:px-2.5');
        expect(header.className).toContain('md:py-1.5');
        expect(header.className).toContain('md:gap-2');
    });
});

describe('ToolCallView — timestamp hidden on mobile', () => {
    it('hides timestamp on mobile viewport', () => {
        viewportCleanup = mockViewport(375);
        renderCard();
        // startTimeLabel is not rendered on mobile
        expect(screen.queryByText(/12:30:00Z/)).toBeNull();
    });

    it('shows timestamp on desktop viewport', () => {
        viewportCleanup = mockViewport(1024);
        renderCard();
        expect(screen.getByText(/12:30:00Z/)).toBeTruthy();
    });

    it('duration gets ml-auto when timestamp is hidden on mobile', () => {
        viewportCleanup = mockViewport(375);
        renderCard();
        const duration = screen.getByText('1.2s');
        expect(duration.className).toContain('ml-auto');
    });
});

describe('ToolCallView — summary truncation on mobile', () => {
    it('uses truncate + max-w on mobile', () => {
        viewportCleanup = mockViewport(375);
        renderCard({ args: { pattern: 'foo', path: '/very/long/path/to/src/deep/nested/file.ts' } });
        const summary = document.querySelector('.tool-call-header span[title]') as HTMLElement;
        expect(summary).toBeTruthy();
        expect(summary.className).toContain('truncate');
        expect(summary.className).toContain('max-w-[40vw]');
        expect(summary.className).not.toContain('break-all');
    });

    it('uses break-all on desktop', () => {
        viewportCleanup = mockViewport(1024);
        renderCard({ args: { pattern: 'foo', path: '/very/long/path/to/src/deep/nested/file.ts' } });
        const summary = document.querySelector('.tool-call-header span[title]') as HTMLElement;
        expect(summary).toBeTruthy();
        expect(summary.className).toContain('break-all');
        expect(summary.className).not.toContain('truncate');
    });
});

describe('ToolCallView — compact outer spacing', () => {
    it('card has my-0.5 md:my-1 classes', () => {
        viewportCleanup = mockViewport(375);
        renderCard();
        const card = document.querySelector('.tool-call-card')!;
        expect(card.className).toContain('my-0.5');
        expect(card.className).toContain('md:my-1');
    });

    it('uses 8px depth indentation on mobile', () => {
        viewportCleanup = mockViewport(375);
        renderCard({}, 2);
        const card = document.querySelector('.tool-call-card') as HTMLElement;
        expect(card.style.marginLeft).toBe('16px'); // 2 * 8
    });

    it('uses 12px depth indentation on desktop', () => {
        viewportCleanup = mockViewport(1024);
        renderCard({}, 2);
        const card = document.querySelector('.tool-call-card') as HTMLElement;
        expect(card.style.marginLeft).toBe('24px'); // 2 * 12
    });
});

describe('ToolCallView — compact body', () => {
    it('body has mobile-first compact padding with md overrides', () => {
        viewportCleanup = mockViewport(375);
        renderCard();
        // Expand the card to see the body
        const header = document.querySelector('.tool-call-header') as HTMLElement;
        header.click();
        const body = document.querySelector('.tool-call-body')!;
        expect(body.className).toContain('px-2');
        expect(body.className).toContain('py-1.5');
        expect(body.className).toContain('space-y-1.5');
        expect(body.className).toContain('md:px-2.5');
        expect(body.className).toContain('md:py-2');
        expect(body.className).toContain('md:space-y-2');
    });
});
