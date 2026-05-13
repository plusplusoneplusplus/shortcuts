/**
 * Tests for LoopBadge component — rendering, click handling, and visibility.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoopBadge } from '../../../src/server/spa/client/react/features/chat/LoopBadge';

describe('LoopBadge', () => {
    it('renders badge with count when activeCount > 0', () => {
        const { container } = render(<LoopBadge activeCount={3} />);
        expect(container.querySelector('[data-testid="loop-badge"]')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
        expect(screen.getByText('🔁')).toBeTruthy();
    });

    it('renders nothing when activeCount is 0', () => {
        const { container } = render(<LoopBadge activeCount={0} />);
        expect(container.querySelector('[data-testid="loop-badge"]')).toBeNull();
    });

    it('shows singular title for count of 1', () => {
        render(<LoopBadge activeCount={1} />);
        const btn = screen.getByTestId('loop-badge');
        expect(btn.title).toBe('1 active loop — click to manage');
    });

    it('shows plural title for count > 1', () => {
        render(<LoopBadge activeCount={5} />);
        const btn = screen.getByTestId('loop-badge');
        expect(btn.title).toBe('5 active loops — click to manage');
    });

    it('calls onClick when clicked', () => {
        const onClick = vi.fn();
        render(<LoopBadge activeCount={2} onClick={onClick} />);
        fireEvent.click(screen.getByTestId('loop-badge'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('renders as a button element', () => {
        render(<LoopBadge activeCount={1} />);
        const el = screen.getByTestId('loop-badge');
        expect(el.tagName).toBe('BUTTON');
        expect(el.getAttribute('type')).toBe('button');
    });
});
