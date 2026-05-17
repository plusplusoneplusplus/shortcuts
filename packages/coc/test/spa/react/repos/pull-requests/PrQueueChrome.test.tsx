/**
 * Unit tests for the chrome of the redesigned PR review command queue:
 *  - PrQueueFilters (4 filter pills with counts and active state)
 *  - PrQueueGroupSection (labeled section wrapper)
 *  - PrQueueFooter (queue rule explanation)
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PrQueueFilters } from '../../../../../src/server/spa/client/react/features/pull-requests/PrQueueFilters';
import { PrQueueGroupSection } from '../../../../../src/server/spa/client/react/features/pull-requests/PrQueueGroupSection';
import { PrQueueFooter } from '../../../../../src/server/spa/client/react/features/pull-requests/PrQueueFooter';

describe('PrQueueFilters', () => {
    it('renders all four pills with their counts', () => {
        render(
            <PrQueueFilters
                active="all"
                counts={{ all: 18, mine: 7, blocked: 3, ready: 5 }}
                onChange={vi.fn()}
            />,
        );
        expect(screen.getByTestId('pr-queue-filter-all').textContent).toContain('All');
        expect(screen.getByTestId('pr-queue-filter-all').textContent).toContain('18');
        expect(screen.getByTestId('pr-queue-filter-mine').textContent).toContain('7');
        expect(screen.getByTestId('pr-queue-filter-blocked').textContent).toContain('3');
        expect(screen.getByTestId('pr-queue-filter-ready').textContent).toContain('5');
    });

    it('marks the active pill via aria-pressed and data-active', () => {
        render(
            <PrQueueFilters
                active="blocked"
                counts={{ all: 1, mine: 1, blocked: 1, ready: 0 }}
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
                counts={{ all: 0, mine: 0, blocked: 0, ready: 0 }}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByTestId('pr-queue-filter-ready'));
        expect(onChange).toHaveBeenCalledWith('ready');
    });
});

describe('PrQueueGroupSection', () => {
    it('renders the label and child rows under the section', () => {
        render(
            <PrQueueGroupSection section="needs-review" label="Needs review">
                <div data-testid="row-stub">row content</div>
            </PrQueueGroupSection>,
        );
        const section = screen.getByTestId('pr-queue-group');
        expect(section.getAttribute('data-queue-section')).toBe('needs-review');
        expect(section.textContent).toContain('Needs review');
        expect(screen.getByTestId('pr-queue-group-rows').textContent).toContain('row content');
    });

    it('hides the section label when compact', () => {
        render(
            <PrQueueGroupSection section="needs-review" label="Needs review" compact>
                <div data-testid="row-stub">row content</div>
            </PrQueueGroupSection>,
        );
        const section = screen.getByTestId('pr-queue-group');
        expect(section.textContent).not.toContain('Needs review');
        expect(screen.getByTestId('pr-queue-group-rows').textContent).toContain('row content');
    });

    it('exposes both queue sections distinctly', () => {
        render(
            <>
                <PrQueueGroupSection section="needs-review" label="Needs review">
                    <span>row a</span>
                </PrQueueGroupSection>
                <PrQueueGroupSection section="ready" label="Ready after checks">
                    <span>row b</span>
                </PrQueueGroupSection>
            </>,
        );
        const sections = screen.getAllByTestId('pr-queue-group');
        expect(sections.map(s => s.getAttribute('data-queue-section'))).toEqual([
            'needs-review',
            'ready',
        ]);
    });
});

describe('PrQueueFooter', () => {
    it('renders the default queue-rule copy', () => {
        render(<PrQueueFooter />);
        const footer = screen.getByTestId('pr-queue-footer');
        expect(footer.textContent).toContain('Queue rule');
        expect(footer.textContent).toContain('release branches');
    });

    it('honors label and body overrides', () => {
        render(<PrQueueFooter label="Rule:" body="custom body" />);
        const footer = screen.getByTestId('pr-queue-footer');
        expect(footer.textContent).toContain('Rule:');
        expect(footer.textContent).toContain('custom body');
    });
});
