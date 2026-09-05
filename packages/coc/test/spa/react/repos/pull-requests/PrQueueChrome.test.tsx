/**
 * Unit tests for the chrome of the redesigned PR review command queue:
 *  - PrQueueFilters (filter pills with counts and active state)

 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PrQueueFilters } from '../../../../../src/server/spa/client/react/features/pull-requests/PrQueueFilters';


describe('PrQueueFilters', () => {
    it('renders all queue pills with their counts', () => {
        render(
            <PrQueueFilters
                active="all"
                counts={{ all: 18, mine: 7, team: 2, blocked: 3, ready: 5, foryou: 0 }}
                onChange={vi.fn()}
            />,
        );
        expect(screen.getByTestId('pr-queue-filter-all').textContent).toContain('All');
        expect(screen.getByTestId('pr-queue-filter-all').textContent).toContain('18');
        expect(screen.getByTestId('pr-queue-filter-mine').textContent).toContain('7');
        expect(screen.getByTestId('pr-queue-filter-team').textContent).toContain('2');
        expect(screen.getByTestId('pr-queue-filter-blocked').textContent).toContain('3');
        expect(screen.getByTestId('pr-queue-filter-ready').textContent).toContain('5');
    });

    it('marks the active pill via aria-pressed and data-active', () => {
        render(
            <PrQueueFilters
                active="blocked"
                counts={{ all: 1, mine: 1, team: 0, blocked: 1, ready: 0, foryou: 0 }}
                onChange={vi.fn()}
            />,
        );
        const blocked = screen.getByTestId('pr-queue-filter-blocked');
        expect(blocked.getAttribute('aria-pressed')).toBe('true');
        expect(blocked.getAttribute('data-active')).toBe('true');
        expect(screen.getByTestId('pr-queue-filter-all').getAttribute('aria-pressed')).toBe('false');
    });

    it('invokes onChange with the chosen filter id', () => {
        const onChange = vi.fn();
        render(
            <PrQueueFilters
                active="mine"
                counts={{ all: 0, mine: 0, team: 0, blocked: 0, ready: 0, foryou: 0 }}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByTestId('pr-queue-filter-ready'));
        expect(onChange).toHaveBeenCalledWith('ready');
    });
});
