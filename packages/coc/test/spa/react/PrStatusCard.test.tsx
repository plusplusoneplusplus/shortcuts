/**
 * @vitest-environment jsdom
 *
 * Render tests for PrStatusCard (AC-02 — pinned PR status card in chat).
 *
 * Covers every UX state from the spec's Definition of Done:
 *   - empty   → card hidden
 *   - loading → skeleton row
 *   - success → number / title / state badge / head→base / deep-link
 *   - error   → inline error + retry control
 *   - terminal→ merged/closed styling + terminal timestamp
 *
 * Plus: two PRs stack newest-first, and the list collapses to a count when
 * there are several PRs.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import {
    PrStatusCard,
    type PrStatusCardItem,
} from '../../../src/server/spa/client/react/features/chat/conversation/PrStatusCard';

function readyItem(overrides: Partial<PrStatusCardItem> = {}): PrStatusCardItem {
    return {
        key: 'origin-1:101',
        repoId: 'ws-abc',
        number: 101,
        state: 'ready',
        pr: {
            number: 101,
            title: 'Add PR status card',
            status: 'open',
            sourceBranch: 'feature/card',
            targetBranch: 'main',
        },
        ...overrides,
    };
}

describe('PrStatusCard', () => {
    it('empty state: renders nothing when there are no items', () => {
        const { container } = render(<PrStatusCard items={[]} />);
        expect(container.firstChild).toBeNull();
        expect(container.querySelector('[data-testid="pr-status-card"]')).toBeNull();
    });

    it('loading state: shows a skeleton row with the PR number', () => {
        const item = readyItem({ state: 'loading', pr: undefined });
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        const row = getByTestId(`pr-status-card-row-${item.key}`);
        expect(row.getAttribute('data-state')).toBe('loading');
        expect(getByTestId(`pr-status-card-loading-${item.key}`)).toBeTruthy();
        expect(row.textContent).toContain('#101');
        expect(row.textContent).toContain('Loading');
    });

    it('success state: shows number, title, state badge, branches, and deep-link', () => {
        const item = readyItem();
        const { getByTestId } = render(<PrStatusCard items={[item]} />);

        const row = getByTestId(`pr-status-card-row-${item.key}`);
        expect(within(row).getByTestId('pr-status-card-state-badge').textContent).toContain('Open');
        expect(row.textContent).toContain('Add PR status card');
        expect(getByTestId(`pr-status-card-branches-${item.key}`).textContent).toBe('feature/card → main');

        const link = getByTestId(`pr-status-card-open-${item.key}`) as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('#repos/ws-abc/pull-requests/101/overview');
    });

    it('error state: shows the error message, a retry button, and a deep-link', () => {
        const onRetry = vi.fn();
        const item = readyItem({ state: 'error', pr: undefined, error: 'Network error' });
        const { getByTestId } = render(<PrStatusCard items={[item]} onRetry={onRetry} />);

        expect(getByTestId(`pr-status-card-error-${item.key}`).textContent).toContain('Network error');
        fireEvent.click(getByTestId(`pr-status-card-retry-${item.key}`));
        expect(onRetry).toHaveBeenCalledWith(item.key);
        expect(getByTestId(`pr-status-card-open-${item.key}`).getAttribute('href'))
            .toBe('#repos/ws-abc/pull-requests/101/overview');
    });

    it('error state: omits the retry button when no onRetry handler is provided', () => {
        const item = readyItem({ state: 'error', pr: undefined, error: 'boom' });
        const { queryByTestId } = render(<PrStatusCard items={[item]} />);
        expect(queryByTestId(`pr-status-card-retry-${item.key}`)).toBeNull();
    });

    it('terminal state: merged PR shows merged badge, timestamp, and muted styling', () => {
        const item = readyItem({
            key: 'origin-1:55',
            number: 55,
            pr: {
                number: 55,
                title: 'Merged work',
                status: 'merged',
                sourceBranch: 'feature/done',
                targetBranch: 'main',
                mergedAt: '2026-01-02T14:00:00Z',
            },
        });
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        const row = getByTestId(`pr-status-card-row-${item.key}`);
        expect(row.className).toContain('opacity-70');
        expect(within(row).getByTestId('pr-status-card-state-badge').textContent).toContain('Merged');
        expect(getByTestId(`pr-status-card-terminal-time-${item.key}`).textContent).toContain('merged');
    });

    it('terminal state: closed PR shows closed badge and timestamp', () => {
        const item = readyItem({
            key: 'origin-1:60',
            number: 60,
            pr: {
                number: 60,
                title: 'Abandoned work',
                status: 'closed',
                sourceBranch: 'feature/wip',
                targetBranch: 'main',
                closedAt: '2026-01-03T09:30:00Z',
            },
        });
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        expect(within(getByTestId(`pr-status-card-row-${item.key}`)).getByTestId('pr-status-card-state-badge').textContent).toContain('Closed');
        expect(getByTestId(`pr-status-card-terminal-time-${item.key}`).textContent).toContain('closed');
    });

    it('two PRs stack newest-first by createdAt', () => {
        const older = readyItem({ key: 'o:1', number: 1, createdAt: '2026-01-01T00:00:00Z', pr: { number: 1, title: 'Older', status: 'open', sourceBranch: 'a', targetBranch: 'main' } });
        const newer = readyItem({ key: 'o:2', number: 2, createdAt: '2026-02-01T00:00:00Z', pr: { number: 2, title: 'Newer', status: 'open', sourceBranch: 'b', targetBranch: 'main' } });

        // Pass oldest-first to prove the card reorders.
        const { getAllByTestId } = render(<PrStatusCard items={[older, newer]} />);
        const rows = getAllByTestId(/^pr-status-card-row-/);
        expect(rows[0].textContent).toContain('Newer');
        expect(rows[1].textContent).toContain('Older');
    });

    it('collapses to a count when there are more PRs than the threshold', () => {
        const items = [1, 2, 3].map(n => readyItem({
            key: `o:${n}`,
            number: n,
            pr: { number: n, title: `PR ${n}`, status: 'open', sourceBranch: `b${n}`, targetBranch: 'main' },
        }));
        const { getByTestId, queryByTestId } = render(<PrStatusCard items={items} collapseThreshold={2} />);

        const toggle = getByTestId('pr-status-card-toggle');
        expect(toggle.textContent).toContain('3 pull requests');
        // Collapsed by default → rows hidden.
        expect(queryByTestId('pr-status-card-row-o:1')).toBeNull();

        // Expanding reveals the rows.
        fireEvent.click(toggle);
        expect(getByTestId('pr-status-card-row-o:1')).toBeTruthy();
    });

    it('singular vs plural count label', () => {
        const { getByTestId } = render(<PrStatusCard items={[readyItem()]} />);
        expect(getByTestId('pr-status-card-toggle').textContent).toContain('1 pull request');
    });
});
