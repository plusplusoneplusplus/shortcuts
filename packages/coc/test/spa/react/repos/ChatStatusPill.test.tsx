/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { ChatStatusPill } from '../../../../src/server/spa/client/react/features/chat/ChatStatusPill';

describe('ChatStatusPill', () => {
    it('renders the dot, label, and duration in expanded mode', () => {
        render(<ChatStatusPill status="completed" durationMs={5_000} data-testid="pill" />);
        const pill = screen.getByTestId('pill');
        expect(pill.getAttribute('data-status')).toBe('completed');
        expect(pill.textContent).toContain('Completed');
        expect(pill.textContent).toContain('5s');
        // Title summarises label + duration for accessibility
        expect(pill.getAttribute('title')).toContain('Completed');
        expect(pill.getAttribute('title')).toContain('5s');
    });

    it('omits duration when showDuration=false', () => {
        render(<ChatStatusPill status="completed" durationMs={5_000} showDuration={false} data-testid="pill" />);
        const pill = screen.getByTestId('pill');
        expect(pill.textContent).toContain('Completed');
        // Separator and duration should not render
        expect(pill.textContent).not.toContain('5s');
    });

    it('omits duration when durationMs is null/undefined', () => {
        render(<ChatStatusPill status="completed" data-testid="pill" />);
        const pill = screen.getByTestId('pill');
        expect(pill.textContent).toContain('Completed');
        // No duration suffix when not provided
        expect(pill.textContent).not.toMatch(/\d+(?:s|m|h)/);
    });

    it('hides label and duration in iconOnly mode', () => {
        render(<ChatStatusPill status="running" durationMs={1_000} iconOnly data-testid="pill" />);
        const pill = screen.getByTestId('pill');
        expect(pill.textContent).not.toContain('Thinking');
        expect(pill.textContent).not.toContain('Running');
        expect(pill.textContent).not.toContain('1s');
        // Still has the leading dot for visual presence
        expect(pill.querySelector('span[aria-hidden="true"]')).toBeTruthy();
    });

    it('uses the running variant + animated dot for active runs', () => {
        const { container } = render(<ChatStatusPill status="running" data-testid="pill" />);
        const pill = screen.getByTestId('pill');
        // The pill border + bg should use the accent palette
        expect(pill.className).toContain('text-[#0078d4]');
        // The first child span is the dot — it should pulse
        const dot = container.querySelector('[aria-hidden="true"]');
        expect(dot?.className).toContain('animate-pulse');
    });

    it('renders failed variant in red', () => {
        render(<ChatStatusPill status="failed" data-testid="pill" />);
        const pill = screen.getByTestId('pill');
        expect(pill.className).toContain('text-[#f14c4c]');
    });

    it('renders queued variant', () => {
        render(<ChatStatusPill status="queued" data-testid="pill" />);
        const pill = screen.getByTestId('pill');
        expect(pill.textContent).toContain('Queued');
    });

    it('falls back to a neutral palette for unknown status', () => {
        render(<ChatStatusPill status="mystery" data-testid="pill" />);
        const pill = screen.getByTestId('pill');
        // Falls back to the neutral fallback palette
        expect(pill.className).toContain('bg-[#f3f3f3]');
        expect(pill.textContent).toContain('mystery');
    });

    it('respects type override for label', () => {
        render(<ChatStatusPill status="running" type="pipeline-execution" data-testid="pill" />);
        const pill = screen.getByTestId('pill');
        expect(pill.textContent).toContain('Running');
    });

    it('ignores zero-duration suffix gracefully', () => {
        render(<ChatStatusPill status="completed" durationMs={0} data-testid="pill" />);
        const pill = screen.getByTestId('pill');
        // formatDuration returns '< 1s' for 0ms; the suffix should still be visible
        expect(pill.textContent).toContain('Completed');
    });
});
