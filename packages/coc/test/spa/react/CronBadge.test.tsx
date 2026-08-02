/**
 * Tests for CronBadge component — rendering, click handling, and visibility.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CronBadge } from '../../../src/server/spa/client/react/features/chat/CronBadge';

describe('CronBadge', () => {
    it('renders badge with count when count > 0', () => {
        const { container } = render(<CronBadge count={3} hasActiveCrons={true} />);
        expect(container.querySelector('[data-testid="cron-badge"]')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
        expect(container.querySelector('[data-testid="cron-icon"]')).toBeTruthy();
    });

    it('renders nothing when count is 0', () => {
        const { container } = render(<CronBadge count={0} hasActiveCrons={false} />);
        expect(container.querySelector('[data-testid="cron-badge"]')).toBeNull();
    });

    it('shows singular title for count of 1', () => {
        render(<CronBadge count={1} hasActiveCrons={true} />);
        const btn = screen.getByTestId('cron-badge');
        expect(btn.title).toBe('1 cron — click to manage');
    });

    it('shows plural title for count > 1', () => {
        render(<CronBadge count={5} hasActiveCrons={true} />);
        const btn = screen.getByTestId('cron-badge');
        expect(btn.title).toBe('5 crons — click to manage');
    });

    it('calls onClick when clicked', () => {
        const onClick = vi.fn();
        render(<CronBadge count={2} hasActiveCrons={true} onClick={onClick} />);
        fireEvent.click(screen.getByTestId('cron-badge'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('renders as a button element', () => {
        render(<CronBadge count={1} hasActiveCrons={true} />);
        const el = screen.getByTestId('cron-badge');
        expect(el.tagName).toBe('BUTTON');
        expect(el.getAttribute('type')).toBe('button');
    });

    it('uses active styling when at least one cron is active', () => {
        render(<CronBadge count={2} hasActiveCrons={true} />);
        expect(screen.getByTestId('cron-badge').className).toContain('bg-[#e6f4ea]');
    });

    it('uses inactive styling for paused-only or expired-only crons', () => {
        render(<CronBadge count={1} hasActiveCrons={false} />);
        expect(screen.getByTestId('cron-badge').className).toContain('bg-[#fff4ce]');
    });
});
