/**
 * @vitest-environment jsdom
 *
 * Unit tests for ComposerPrChip — the presentational in-composer PR chip
 * (design 01·B). Covers the three per-item states (ready / loading / error),
 * the provider View link, the +adds/−dels diff display, and the ✕ dismiss +
 * Retry callbacks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ComposerPrChip } from '../../../src/server/spa/client/react/features/chat/conversation/ComposerPrChip';
import type { PrStatusCardItem } from '../../../src/server/spa/client/react/features/chat/conversation/PrStatusCard';
import type { PrCheckRow, CheckStatus } from '../../../src/server/spa/client/react/features/pull-requests/pr-derived-data';

const KEY = 'gh_owner_repo:42';
const GH_URL = 'https://github.com/owner/repo/pull/42';

function check(id: string, status: CheckStatus): PrCheckRow {
    return { id, name: id, status, duration: '', interpretation: '' };
}

function readyItem(overrides: Partial<PrStatusCardItem> = {}): PrStatusCardItem {
    return {
        key: KEY,
        repoId: 'ws1',
        number: 42,
        state: 'ready',
        pr: {
            number: 42,
            title: 'Dark mode: settings schedules',
            status: 'open',
            sourceBranch: 'feat/dark-settings',
            targetBranch: 'main',
            url: GH_URL,
            diffStats: { additions: 142, deletions: 38, changedFiles: 3 },
        },
        ...overrides,
    };
}

describe('ComposerPrChip', () => {
    it('ready: renders number, title, status, diff, and provider links', () => {
        const { getByTestId, getByText } = render(
            <ComposerPrChip item={readyItem()} onDismiss={() => {}} />,
        );

        const chip = getByTestId('composer-pr-chip');
        expect(chip.getAttribute('data-state')).toBe('ready');
        expect(getByTestId('composer-pr-chip-title').textContent).toBe('Dark mode: settings schedules');
        expect(getByText('#42')).toBeTruthy();

        const status = getByTestId('composer-pr-chip-status');
        expect(status.getAttribute('data-status')).toBe('open');
        expect(status.textContent).toContain('Open');

        expect(getByTestId('composer-pr-chip-diff').textContent).toContain('+142');
        expect(getByTestId('composer-pr-chip-diff').textContent).toContain('−38');

        const view = getByTestId(`composer-pr-chip-view-${KEY}`) as HTMLAnchorElement;
        expect(view.getAttribute('href')).toBe(GH_URL);
        expect(view.getAttribute('target')).toBe('_blank');
        expect(view.getAttribute('rel')).toBe('noopener noreferrer');

        const number = getByTestId(`composer-pr-chip-num-${KEY}`) as HTMLAnchorElement;
        expect(number.getAttribute('href')).toBe(GH_URL);
        expect(number.getAttribute('target')).toBe('_blank');
        expect(number.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('ready: falls back to the detected provider URL when detail omits one', () => {
        const item = readyItem({
            url: GH_URL,
            pr: { ...readyItem().pr!, url: undefined },
        });
        const { getByTestId } = render(<ComposerPrChip item={item} onDismiss={() => {}} />);

        expect((getByTestId(`composer-pr-chip-num-${KEY}`) as HTMLAnchorElement).getAttribute('href')).toBe(GH_URL);
        expect((getByTestId(`composer-pr-chip-view-${KEY}`) as HTMLAnchorElement).getAttribute('href')).toBe(GH_URL);
    });

    it('ready: falls back to the dashboard detail route when no provider URL exists', () => {
        const item = readyItem({ pr: { ...readyItem().pr!, url: undefined }, url: undefined });
        const { getByTestId } = render(<ComposerPrChip item={item} onDismiss={() => {}} />);

        const number = getByTestId(`composer-pr-chip-num-${KEY}`) as HTMLAnchorElement;
        expect(number.getAttribute('href')).toBe('#repos/ws1/pull-requests/42/overview');
        expect(number.getAttribute('target')).toBeNull();
        expect(number.getAttribute('rel')).toBeNull();
    });

    it('ready: shows the check count as passing/total once checks are loaded', () => {
        const checks: PrCheckRow[] = [
            check('a', 'success'),
            check('b', 'success'),
            check('c', 'pending'),
        ];
        const { getByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks })} onDismiss={() => {}} />,
        );
        const badge = getByTestId('composer-pr-chip-checks');
        expect(badge.getAttribute('data-passing')).toBe('2');
        expect(badge.getAttribute('data-total')).toBe('3');
        expect(badge.textContent).toContain('2/3');
        // Any pending → not the all-green glyph.
        expect(badge.textContent).toContain('●');
    });

    it('ready: uses the failing glyph when any check is failing', () => {
        const checks: PrCheckRow[] = [check('a', 'success'), check('b', 'failure')];
        const { getByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks })} onDismiss={() => {}} />,
        );
        const badge = getByTestId('composer-pr-chip-checks');
        expect(badge.textContent).toContain('1/2');
        expect(badge.textContent).toContain('✕');
    });

    it('ready: omits the check count until checks are ready, and when there are none', () => {
        const item = readyItem();
        // checksState undefined (eager fetch not yet resolved) → no badge.
        const { queryByTestId, rerender } = render(<ComposerPrChip item={item} onDismiss={() => {}} />);
        expect(queryByTestId('composer-pr-chip-checks')).toBeNull();
        // ready but zero checks reported → still no badge.
        rerender(<ComposerPrChip item={readyItem({ checksState: 'ready', checks: [] })} onDismiss={() => {}} />);
        expect(queryByTestId('composer-pr-chip-checks')).toBeNull();
    });

    it('ready: omits the diff when the detail carries no diffStats', () => {
        const item = readyItem();
        const { queryByTestId } = render(
            <ComposerPrChip item={{ ...item, pr: { ...item.pr!, diffStats: undefined } }} onDismiss={() => {}} />,
        );
        expect(queryByTestId('composer-pr-chip-diff')).toBeNull();
    });

    it('ready: the ✕ button dismisses by item key', () => {
        const onDismiss = vi.fn();
        const { getByTestId } = render(<ComposerPrChip item={readyItem()} onDismiss={onDismiss} />);
        fireEvent.click(getByTestId(`composer-pr-chip-dismiss-${KEY}`));
        expect(onDismiss).toHaveBeenCalledWith(KEY);
    });

    it('ready: the refresh button force-refreshes when clicked', () => {
        const onRefresh = vi.fn();
        const { getByTestId } = render(
            <ComposerPrChip item={readyItem()} onDismiss={() => {}} onRefresh={onRefresh} />,
        );
        const btn = getByTestId(`composer-pr-chip-refresh-${KEY}`) as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        expect(btn.getAttribute('data-refreshing')).toBe('false');
        fireEvent.click(btn);
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('ready: the refresh button is disabled and marked refreshing while a refresh is in flight', () => {
        const onRefresh = vi.fn();
        const { getByTestId } = render(
            <ComposerPrChip item={readyItem()} onDismiss={() => {}} onRefresh={onRefresh} refreshing />,
        );
        const btn = getByTestId(`composer-pr-chip-refresh-${KEY}`) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        expect(btn.getAttribute('data-refreshing')).toBe('true');
        fireEvent.click(btn);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('ready: omits the refresh button when no onRefresh handler is provided', () => {
        const { queryByTestId } = render(<ComposerPrChip item={readyItem()} onDismiss={() => {}} />);
        expect(queryByTestId(`composer-pr-chip-refresh-${KEY}`)).toBeNull();
    });

    it('loading: shows a skeleton with the number and no title', () => {
        const { getByTestId, queryByTestId } = render(
            <ComposerPrChip item={{ key: KEY, repoId: 'ws1', number: 42, state: 'loading' }} onDismiss={() => {}} />,
        );
        const chip = getByTestId('composer-pr-chip');
        expect(chip.getAttribute('data-state')).toBe('loading');
        expect(chip.textContent).toContain('#42');
        expect(chip.textContent).toContain('Loading');
        expect(queryByTestId('composer-pr-chip-title')).toBeNull();
        // Dismiss is available even while loading.
        expect(getByTestId(`composer-pr-chip-dismiss-${KEY}`)).toBeTruthy();
    });

    it('error: shows the error, a Retry, and still a provider View + dismiss', () => {
        const onRetry = vi.fn();
        const { getByTestId } = render(
            <ComposerPrChip
                item={{ key: KEY, repoId: 'ws1', number: 42, state: 'error', error: 'network down', url: GH_URL }}
                onDismiss={() => {}}
                onRetry={onRetry}
            />,
        );
        const chip = getByTestId('composer-pr-chip');
        expect(chip.getAttribute('data-state')).toBe('error');
        expect(chip.textContent).toContain('network down');

        fireEvent.click(getByTestId(`composer-pr-chip-retry-${KEY}`));
        expect(onRetry).toHaveBeenCalledWith(KEY);

        const view = getByTestId(`composer-pr-chip-view-${KEY}`) as HTMLAnchorElement;
        expect(view.getAttribute('href')).toBe(GH_URL);
        expect(view.getAttribute('target')).toBe('_blank');
        expect(getByTestId(`composer-pr-chip-dismiss-${KEY}`)).toBeTruthy();
    });

    it('error: omits Retry when no onRetry handler is provided', () => {
        const { queryByTestId } = render(
            <ComposerPrChip
                item={{ key: KEY, repoId: 'ws1', number: 42, state: 'error', error: 'boom' }}
                onDismiss={() => {}}
            />,
        );
        expect(queryByTestId(`composer-pr-chip-retry-${KEY}`)).toBeNull();
    });
});
