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
import type { Reviewer } from '../../../src/server/spa/client/react/features/pull-requests/pr-utils';

const KEY = 'gh_owner_repo:42';
const GH_URL = 'https://github.com/owner/repo/pull/42';
const POPOVER_TESTID = `composer-pr-chip-checks-popover-${KEY}`;

function check(id: string, status: CheckStatus): PrCheckRow {
    return { id, name: id, status, duration: '', interpretation: '' };
}

function checkWithUrl(id: string, status: CheckStatus, detailsUrl?: string): PrCheckRow {
    return { id, name: id, status, duration: '', interpretation: '', detailsUrl };
}

function reviewer(displayName: string, vote?: string, isRequired = false): Reviewer {
    return { identity: { displayName }, vote, isRequired };
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

    it('ready: shows a compact reviewer count between lifecycle status and checks', () => {
        const checks: PrCheckRow[] = [check('build', 'success')];
        const item = readyItem({
            reviewersState: 'ready',
            reviewers: [
                reviewer('Approved Reviewer', 'approved'),
                reviewer('Waiting Reviewer', 'noVote', true),
            ],
            checksState: 'ready',
            checks,
        });
        const { getByTestId, queryByText } = render(<ComposerPrChip item={item} onDismiss={() => {}} />);

        const status = getByTestId('composer-pr-chip-status');
        const reviewers = getByTestId('composer-pr-chip-reviewers');
        const checksBadge = getByTestId('composer-pr-chip-checks');
        expect(reviewers.textContent).toContain('1/2 reviewers');
        expect(reviewers.getAttribute('data-approved')).toBe('1');
        expect(reviewers.getAttribute('data-total')).toBe('2');
        expect(queryByText('Approved Reviewer')).toBeNull();
        expect(queryByText('Waiting Reviewer')).toBeNull();
        expect(status.compareDocumentPosition(reviewers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(reviewers.compareDocumentPosition(checksBadge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('ready: omits the reviewer count until reviewers are ready, and when there are none', () => {
        const { queryByTestId, rerender } = render(<ComposerPrChip item={readyItem()} onDismiss={() => {}} />);
        expect(queryByTestId('composer-pr-chip-reviewers')).toBeNull();

        rerender(<ComposerPrChip item={readyItem({ reviewersState: 'ready', reviewers: [] })} onDismiss={() => {}} />);
        expect(queryByTestId('composer-pr-chip-reviewers')).toBeNull();
    });

    it('ready: still shows reviewer data for merged PRs', () => {
        const { getByTestId } = render(
            <ComposerPrChip
                item={readyItem({
                    pr: { ...readyItem().pr!, status: 'merged' },
                    reviewersState: 'ready',
                    reviewers: [reviewer('Approved Reviewer', 'approved'), reviewer('Waiting Reviewer', 'noVote')],
                })}
                onDismiss={() => {}}
            />,
        );

        expect(getByTestId('composer-pr-chip-status').textContent).toContain('Merged');
        expect(getByTestId('composer-pr-chip-reviewers').textContent).toContain('1/2 reviewers');
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
        // Passes its own key so the hook refreshes (and spins) only this row.
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledWith(KEY);
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

describe('ComposerPrChip — failed-checks popover', () => {
    const failingChecks: PrCheckRow[] = [
        checkWithUrl('build', 'failure', 'https://github.com/owner/repo/actions/runs/1'),
        checkWithUrl('lint', 'failure', 'https://github.com/owner/repo/actions/runs/2'),
        check('unit', 'success'),
        check('e2e', 'pending'),
    ];

    it('failing: the checks badge is a button that toggles the failed-checks popover', () => {
        const { getByTestId, queryByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks: failingChecks })} onDismiss={() => {}} />,
        );
        const badge = getByTestId('composer-pr-chip-checks');
        expect(badge.tagName).toBe('BUTTON');
        expect(badge.getAttribute('aria-haspopup')).toBe('dialog');
        expect(badge.getAttribute('aria-expanded')).toBe('false');
        expect(badge.getAttribute('data-failing')).toBe('2');
        // Closed until clicked.
        expect(queryByTestId(POPOVER_TESTID)).toBeNull();

        fireEvent.click(badge);
        expect(badge.getAttribute('aria-expanded')).toBe('true');
        const popover = getByTestId(POPOVER_TESTID);
        expect(popover.getAttribute('role')).toBe('dialog');

        // Clicking again closes it.
        fireEvent.click(badge);
        expect(badge.getAttribute('aria-expanded')).toBe('false');
        expect(queryByTestId(POPOVER_TESTID)).toBeNull();
    });

    it('failing: the popover lists ONLY the failed checks in the drill-down, and shows count summary', () => {
        const { getByTestId, getAllByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks: failingChecks })} onDismiss={() => {}} />,
        );
        fireEvent.click(getByTestId('composer-pr-chip-checks'));

        const rows = getAllByTestId('composer-pr-chip-checks-failed-row');
        expect(rows).toHaveLength(2);
        expect(rows.every(row => row.getAttribute('data-status') === 'failure')).toBe(true);

        const popover = getByTestId(POPOVER_TESTID);
        // Redesigned header shows "CI monitoring" instead of the old "N failed checks" heading.
        expect(popover.textContent).toContain('CI monitoring');
        // Count summary rows for this set: 2 failing, 1 passing (unit), 1 in-progress (e2e).
        expect(getByTestId(`composer-pr-chip-counts-failed-${KEY}`).textContent).toBe('2');
        expect(getByTestId(`composer-pr-chip-counts-passed-${KEY}`).textContent).toBe('1');
        expect(getByTestId(`composer-pr-chip-counts-pending-${KEY}`).textContent).toBe('1');
        // The failing check names appear in the drill-down list.
        expect(popover.textContent).toContain('build');
        expect(popover.textContent).toContain('lint');
        // The passing/pending check names do NOT appear (only failing checks are listed).
        expect(popover.textContent).not.toContain('unit');
        expect(popover.textContent).not.toContain('e2e');
    });

    it('failing: each failed check links to its provider details page in a new tab', () => {
        const { getByTestId, getAllByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks: failingChecks })} onDismiss={() => {}} />,
        );
        fireEvent.click(getByTestId('composer-pr-chip-checks'));

        const links = getAllByTestId('composer-pr-chip-checks-failed-link') as HTMLAnchorElement[];
        expect(links.map(a => a.getAttribute('href'))).toEqual([
            'https://github.com/owner/repo/actions/runs/1',
            'https://github.com/owner/repo/actions/runs/2',
        ]);
        for (const a of links) {
            expect(a.getAttribute('target')).toBe('_blank');
            expect(a.getAttribute('rel')).toBe('noopener noreferrer');
        }
    });

    it('failing: following a check link closes the popover', () => {
        const { getByTestId, getAllByTestId, queryByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks: failingChecks })} onDismiss={() => {}} />,
        );
        fireEvent.click(getByTestId('composer-pr-chip-checks'));
        const link = getAllByTestId('composer-pr-chip-checks-failed-link')[0];
        fireEvent.click(link);
        expect(queryByTestId(POPOVER_TESTID)).toBeNull();
    });

    it('failing: a failed check without a details URL renders as plain text (no link)', () => {
        const checks: PrCheckRow[] = [checkWithUrl('build', 'failure')];
        const { getByTestId, getAllByTestId, queryByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks })} onDismiss={() => {}} />,
        );
        fireEvent.click(getByTestId('composer-pr-chip-checks'));

        const rows = getAllByTestId('composer-pr-chip-checks-failed-row');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('build');
        expect(queryByTestId('composer-pr-chip-checks-failed-link')).toBeNull();
        expect(getByTestId(POPOVER_TESTID).textContent).toContain('CI monitoring');
    });

    it('failing: Escape closes the popover', () => {
        const { getByTestId, queryByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks: failingChecks })} onDismiss={() => {}} />,
        );
        fireEvent.click(getByTestId('composer-pr-chip-checks'));
        expect(queryByTestId(POPOVER_TESTID)).not.toBeNull();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(queryByTestId(POPOVER_TESTID)).toBeNull();
    });

    it('failing: an outside click closes the popover', () => {
        const { getByTestId, queryByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks: failingChecks })} onDismiss={() => {}} />,
        );
        fireEvent.click(getByTestId('composer-pr-chip-checks'));
        expect(queryByTestId(POPOVER_TESTID)).not.toBeNull();
        fireEvent.mouseDown(document.body);
        expect(queryByTestId(POPOVER_TESTID)).toBeNull();
    });

    it('redesign: popover header shows "CI monitoring" and an external link when the PR has a provider URL', () => {
        const { getByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks: failingChecks })} onDismiss={() => {}} />,
        );
        fireEvent.click(getByTestId('composer-pr-chip-checks'));
        const popover = getByTestId(POPOVER_TESTID);
        expect(popover.textContent).toContain('CI monitoring');
        const extLink = getByTestId(`composer-pr-chip-popover-open-${KEY}`) as HTMLAnchorElement;
        expect(extLink.getAttribute('href')).toBe(GH_URL);
        expect(extLink.getAttribute('target')).toBe('_blank');
    });

    it('redesign: count summary shows In progress / Passed / Failed tallies', () => {
        const checks: PrCheckRow[] = [
            check('a', 'success'),
            check('b', 'success'),
            check('c', 'pending'),
            check('d', 'failure'),
        ];
        const { getByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks })} onDismiss={() => {}} />,
        );
        fireEvent.click(getByTestId('composer-pr-chip-checks'));
        expect(getByTestId(`composer-pr-chip-counts-passed-${KEY}`).textContent).toBe('2');
        expect(getByTestId(`composer-pr-chip-counts-pending-${KEY}`).textContent).toBe('1');
        expect(getByTestId(`composer-pr-chip-counts-failed-${KEY}`).textContent).toBe('1');
    });

    it('redesign: auto-archive settings link points to preferences settings', () => {
        const { getByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks: failingChecks })} onDismiss={() => {}} />,
        );
        fireEvent.click(getByTestId('composer-pr-chip-checks'));
        const link = getByTestId(`composer-pr-chip-archive-settings-${KEY}`) as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('#repos/ws1/settings/preferences');
        expect(link.textContent).toContain('Auto-archive settings');
    });

    it('redesign: external open link is absent when the PR has no provider URL', () => {
        const item = readyItem({
            checksState: 'ready',
            checks: failingChecks,
            pr: { ...readyItem().pr!, url: undefined },
            url: undefined,
        });
        const { queryByTestId, getByTestId } = render(<ComposerPrChip item={item} onDismiss={() => {}} />);
        fireEvent.click(getByTestId('composer-pr-chip-checks'));
        expect(queryByTestId(`composer-pr-chip-popover-open-${KEY}`)).toBeNull();
    });

    it('all passing: the checks badge still opens the popover so the passing checks are reachable', () => {
        const checks: PrCheckRow[] = [check('a', 'success'), check('b', 'success')];
        const { getByTestId, queryByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks })} onDismiss={() => {}} />,
        );
        const badge = getByTestId('composer-pr-chip-checks');
        expect(badge.tagName).toBe('BUTTON');
        expect(badge.getAttribute('data-failing')).toBe('0');
        fireEvent.click(badge);
        expect(queryByTestId(POPOVER_TESTID)).not.toBeNull();
        // Opens on Failed, which is empty here — the auto-fix empty copy shows.
        expect(getByTestId(`composer-pr-chip-checks-none-${KEY}`).textContent).toContain(
            'No failing checks right now',
        );
    });

    it('pending but none failing: the checks badge is clickable', () => {
        const checks: PrCheckRow[] = [check('a', 'success'), check('b', 'pending')];
        const { getByTestId, queryByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks })} onDismiss={() => {}} />,
        );
        const badge = getByTestId('composer-pr-chip-checks');
        expect(badge.tagName).toBe('BUTTON');
        fireEvent.click(badge);
        expect(queryByTestId(POPOVER_TESTID)).not.toBeNull();
    });

    it('no checks at all: the badge renders nothing', () => {
        const { queryByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks: [] })} onDismiss={() => {}} />,
        );
        expect(queryByTestId('composer-pr-chip-checks')).toBeNull();
    });
});

describe('ComposerPrChip — clickable check categories', () => {
    const mixedChecks: PrCheckRow[] = [
        checkWithUrl('build', 'failure', 'https://github.com/owner/repo/actions/runs/1'),
        check('unit', 'success'),
        check('types', 'success'),
        check('e2e', 'pending'),
        check('deploy', 'running'),
        check('flaky', 'skipped'),
    ];

    function openPopover(checks: PrCheckRow[] = mixedChecks) {
        const utils = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks })} onDismiss={() => {}} />,
        );
        fireEvent.click(utils.getByTestId('composer-pr-chip-checks'));
        return utils;
    }

    const categoryId = (id: string) => `composer-pr-chip-category-${id}-${KEY}`;
    const listId = `composer-pr-chip-checks-list-${KEY}`;

    function listedNames(container: HTMLElement): string[] {
        return Array.from(container.querySelectorAll('[data-testid="composer-pr-chip-checks-failed-row"]'))
            .map(el => el.getAttribute('data-name') ?? '');
    }

    it('the three category rows are focusable buttons with aria-pressed reflecting the active one', () => {
        const { getByTestId } = openPopover();
        for (const id of ['pending', 'passed', 'failed']) {
            const btn = getByTestId(categoryId(id));
            expect(btn.tagName).toBe('BUTTON');
            expect(btn.getAttribute('type')).toBe('button');
            expect(btn.hasAttribute('disabled')).toBe(false);
        }
        // Failed is the default.
        expect(getByTestId(categoryId('failed')).getAttribute('aria-pressed')).toBe('true');
        expect(getByTestId(categoryId('passed')).getAttribute('aria-pressed')).toBe('false');
        expect(getByTestId(categoryId('pending')).getAttribute('aria-pressed')).toBe('false');
    });

    it('opens on Failed and clicking Passed swaps the list to the passing checks', () => {
        const { getByTestId } = openPopover();
        expect(listedNames(getByTestId(listId))).toEqual(['build']);
        expect(getByTestId(listId).getAttribute('data-category')).toBe('failing');

        fireEvent.click(getByTestId(categoryId('passed')));
        expect(listedNames(getByTestId(listId))).toEqual(['unit', 'types']);
        expect(getByTestId(listId).getAttribute('data-category')).toBe('passing');
        expect(getByTestId(categoryId('passed')).getAttribute('aria-pressed')).toBe('true');
        expect(getByTestId(categoryId('failed')).getAttribute('aria-pressed')).toBe('false');
    });

    it('"In progress" lists pending AND running checks, matching its count', () => {
        const { getByTestId } = openPopover();
        fireEvent.click(getByTestId(categoryId('pending')));
        const names = listedNames(getByTestId(listId));
        expect(names).toEqual(['e2e', 'deploy']);
        expect(getByTestId(`composer-pr-chip-counts-pending-${KEY}`).textContent).toBe(String(names.length));
    });

    it('clicking Failed lists the failing checks, and the skipped check stays unreachable', () => {
        const { getByTestId } = openPopover();
        fireEvent.click(getByTestId(categoryId('passed')));
        fireEvent.click(getByTestId(categoryId('failed')));
        expect(listedNames(getByTestId(listId))).toEqual(['build']);
        // 'flaky' (skipped) is in no category, so it is never listed.
        for (const id of ['pending', 'passed', 'failed']) {
            fireEvent.click(getByTestId(categoryId(id)));
            expect(listedNames(getByTestId(listId))).not.toContain('flaky');
        }
    });

    it('clicking the active category clears the filter back to Failed', () => {
        const { getByTestId } = openPopover();
        fireEvent.click(getByTestId(categoryId('passed')));
        expect(getByTestId(listId).getAttribute('data-category')).toBe('passing');

        fireEvent.click(getByTestId(categoryId('passed')));
        expect(getByTestId(listId).getAttribute('data-category')).toBe('failing');
        expect(getByTestId(categoryId('failed')).getAttribute('aria-pressed')).toBe('true');

        // Clicking the already-active Failed keeps it on Failed.
        fireEvent.click(getByTestId(categoryId('failed')));
        expect(getByTestId(listId).getAttribute('data-category')).toBe('failing');
    });

    it('each category lists exactly as many rows as its count shows', () => {
        const { getByTestId, queryByTestId } = openPopover();
        const counts: Array<[string, string]> = [
            ['pending', `composer-pr-chip-counts-pending-${KEY}`],
            ['passed', `composer-pr-chip-counts-passed-${KEY}`],
            ['failed', `composer-pr-chip-counts-failed-${KEY}`],
        ];
        for (const [id, countTestId] of counts) {
            fireEvent.click(getByTestId(categoryId(id)));
            const list = queryByTestId(listId);
            const rendered = list ? listedNames(list).length : 0;
            expect(String(rendered)).toBe(getByTestId(countTestId).textContent);
        }
    });

    it('rows keep the failed-row shape: emoji, link in a new tab, status label and duration', () => {
        const checks: PrCheckRow[] = [
            { id: 'unit', name: 'unit', status: 'success', duration: '1m 4s', interpretation: 'all good', detailsUrl: 'https://ci.example/unit' },
        ];
        const { getByTestId } = openPopover(checks);
        fireEvent.click(getByTestId(categoryId('passed')));
        const row = getByTestId(listId).querySelector('[data-testid="composer-pr-chip-checks-failed-row"]')!;
        expect(row.getAttribute('data-status')).toBe('success');
        expect(row.textContent).toContain('unit');
        expect(row.textContent).toContain('Passed');
        expect(row.textContent).toContain('1m 4s');
        // The interpretation/description line is not rendered.
        expect(row.textContent).not.toContain('all good');
        const link = row.querySelector('a')!;
        expect(link.getAttribute('href')).toBe('https://ci.example/unit');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('an empty category shows a neutral line, and the Failed empty state keeps the auto-fix copy', () => {
        const checks: PrCheckRow[] = [check('unit', 'success')];
        const { getByTestId, queryByTestId } = openPopover(checks);
        // Default Failed with zero failures → the auto-fix empty copy.
        expect(getByTestId(`composer-pr-chip-checks-none-${KEY}`).textContent).toContain(
            'No failing checks right now — arm auto-fix to catch the next failure.',
        );

        // A zero-count category is still clickable, and gets a neutral line instead.
        fireEvent.click(getByTestId(categoryId('pending')));
        const empty = getByTestId(`composer-pr-chip-checks-empty-${KEY}`);
        expect(empty.textContent).toBe('No checks in progress.');
        expect(empty.textContent).not.toContain('auto-fix');
        expect(queryByTestId(listId)).toBeNull();
    });

    it('the list region scrolls internally with a max height so the toggles stay visible', () => {
        const many: PrCheckRow[] = Array.from({ length: 24 }, (_, i) => check(`pass-${i}`, 'success'));
        const { getByTestId } = openPopover(many);
        fireEvent.click(getByTestId(categoryId('passed')));
        const list = getByTestId(listId);
        expect(listedNames(list)).toHaveLength(24);
        expect(list.className).toContain('overflow-y-auto');
        expect(list.className).toContain('max-h-[240px]');
        // No truncation / "+N more" affordance.
        expect(getByTestId(POPOVER_TESTID).textContent).not.toContain('more');
        // The archive link stays rendered below the list.
        expect(getByTestId(`composer-pr-chip-archive-settings-${KEY}`)).toBeTruthy();
    });

    it('the selected category survives a re-render from the status poll', () => {
        const item = readyItem({ checksState: 'ready', checks: mixedChecks });
        const { getByTestId, rerender } = render(<ComposerPrChip item={item} onDismiss={() => {}} />);
        fireEvent.click(getByTestId('composer-pr-chip-checks'));
        fireEvent.click(getByTestId(categoryId('passed')));
        expect(getByTestId(listId).getAttribute('data-category')).toBe('passing');

        // A poll refresh delivers a new (equal) rows array.
        rerender(
            <ComposerPrChip
                item={readyItem({ checksState: 'ready', checks: [...mixedChecks] })}
                onDismiss={() => {}}
            />,
        );
        expect(getByTestId(listId).getAttribute('data-category')).toBe('passing');
    });

    it('resets to Failed when the popover is closed and reopened', () => {
        const { getByTestId } = openPopover();
        fireEvent.click(getByTestId(categoryId('passed')));
        expect(getByTestId(listId).getAttribute('data-category')).toBe('passing');

        const badge = getByTestId('composer-pr-chip-checks');
        fireEvent.click(badge);
        fireEvent.click(badge);
        expect(getByTestId(listId).getAttribute('data-category')).toBe('failing');
    });
});

describe('ComposerPrChip — reviewers popover', () => {
    const reviewers: Reviewer[] = [
        reviewer('Approved Reviewer', 'approved'),
        reviewer('Suggestions Reviewer', 'approvedWithSuggestions'),
        reviewer('Waiting Reviewer', 'noVote', true),
        reviewer('Blocked Reviewer', 'rejected'),
        reviewer('Author Wait Reviewer', 'waitingForAuthor'),
    ];
    const reviewersPopoverTestId = `composer-pr-chip-reviewers-popover-${KEY}`;

    it('clicking the reviewer badge toggles approval details', () => {
        const { getByTestId, queryByTestId } = render(
            <ComposerPrChip item={readyItem({ reviewersState: 'ready', reviewers })} onDismiss={() => {}} />,
        );
        const badge = getByTestId('composer-pr-chip-reviewers');
        expect(badge.tagName).toBe('BUTTON');
        expect(badge.getAttribute('aria-haspopup')).toBe('dialog');
        expect(badge.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(badge);

        expect(badge.getAttribute('aria-expanded')).toBe('true');
        const popover = getByTestId(reviewersPopoverTestId);
        expect(popover.getAttribute('role')).toBe('dialog');
        expect(popover.textContent).toContain('2/5 reviewers approved');
        expect(popover.textContent).toContain('Approved reviewers');
        expect(popover.textContent).toContain('Waiting reviewers');
        expect(popover.textContent).toContain('Change requested / blocked');

        fireEvent.click(badge);
        expect(badge.getAttribute('aria-expanded')).toBe('false');
        expect(queryByTestId(reviewersPopoverTestId)).toBeNull();
    });

    it('separates approved, waiting, and blocked reviewers in the popover', () => {
        const { getByTestId, getAllByTestId } = render(
            <ComposerPrChip item={readyItem({ reviewersState: 'ready', reviewers })} onDismiss={() => {}} />,
        );
        fireEvent.click(getByTestId('composer-pr-chip-reviewers'));

        const approved = getAllByTestId('composer-pr-chip-reviewer-approved-row');
        const waiting = getAllByTestId('composer-pr-chip-reviewer-waiting-row');
        const blocked = getAllByTestId('composer-pr-chip-reviewer-blocked-row');
        expect(approved).toHaveLength(2);
        expect(waiting).toHaveLength(1);
        expect(blocked).toHaveLength(2);
        expect(approved.map(row => row.textContent)).toEqual([
            expect.stringContaining('Approved Reviewer'),
            expect.stringContaining('Suggestions Reviewer'),
        ]);
        expect(waiting[0].textContent).toContain('Waiting Reviewer');
        expect(waiting[0].textContent).toContain('required');
        expect(blocked.map(row => row.textContent)).toEqual([
            expect.stringContaining('Blocked Reviewer'),
            expect.stringContaining('Author Wait Reviewer'),
        ]);
    });

    it('Escape and outside clicks close the reviewer popover without dismissing the chip', () => {
        const onDismiss = vi.fn();
        const { getByTestId, queryByTestId } = render(
            <ComposerPrChip item={readyItem({ reviewersState: 'ready', reviewers })} onDismiss={onDismiss} />,
        );
        fireEvent.click(getByTestId('composer-pr-chip-reviewers'));
        expect(queryByTestId(reviewersPopoverTestId)).not.toBeNull();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(queryByTestId(reviewersPopoverTestId)).toBeNull();
        expect(onDismiss).not.toHaveBeenCalled();

        fireEvent.click(getByTestId('composer-pr-chip-reviewers'));
        expect(queryByTestId(reviewersPopoverTestId)).not.toBeNull();
        fireEvent.mouseDown(document.body);
        expect(queryByTestId(reviewersPopoverTestId)).toBeNull();
        expect(onDismiss).not.toHaveBeenCalled();
    });
});
