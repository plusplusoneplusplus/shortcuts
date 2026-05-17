/**
 * Tests for LoopBadge component — rendering, click handling, and visibility.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoopBadge } from '../../../src/server/spa/client/react/features/chat/LoopBadge';

describe('LoopBadge', () => {
    it('renders badge with count when count > 0', () => {
        const { container } = render(<LoopBadge count={3} hasActiveLoops={true} />);
        expect(container.querySelector('[data-testid="loop-badge"]')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
        expect(container.querySelector('[data-testid="loop-icon"]')).toBeTruthy();
    });

    it('renders nothing when count is 0', () => {
        const { container } = render(<LoopBadge count={0} hasActiveLoops={false} />);
        expect(container.querySelector('[data-testid="loop-badge"]')).toBeNull();
    });

    it('shows singular title for count of 1', () => {
        render(<LoopBadge count={1} hasActiveLoops={true} />);
        const btn = screen.getByTestId('loop-badge');
        expect(btn.title).toBe('1 loop — click to manage');
    });

    it('shows plural title for count > 1', () => {
        render(<LoopBadge count={5} hasActiveLoops={true} />);
        const btn = screen.getByTestId('loop-badge');
        expect(btn.title).toBe('5 loops — click to manage');
    });

    it('calls onClick when clicked', () => {
        const onClick = vi.fn();
        render(<LoopBadge count={2} hasActiveLoops={true} onClick={onClick} />);
        fireEvent.click(screen.getByTestId('loop-badge'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('renders as a button element', () => {
        render(<LoopBadge count={1} hasActiveLoops={true} />);
        const el = screen.getByTestId('loop-badge');
        expect(el.tagName).toBe('BUTTON');
        expect(el.getAttribute('type')).toBe('button');
    });

    it('uses active styling when at least one loop is active', () => {
        render(<LoopBadge count={2} hasActiveLoops={true} />);
        expect(screen.getByTestId('loop-badge').className).toContain('bg-[#e6f4ea]');
    });

    it('uses inactive styling for paused-only or expired-only loops', () => {
        render(<LoopBadge count={1} hasActiveLoops={false} />);
        expect(screen.getByTestId('loop-badge').className).toContain('bg-[#fff4ce]');
    });
});
