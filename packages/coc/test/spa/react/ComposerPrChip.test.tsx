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

    it('all passing: the checks badge stays a non-interactive span and opens no popover', () => {
        const checks: PrCheckRow[] = [check('a', 'success'), check('b', 'success')];
        const { getByTestId, queryByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks })} onDismiss={() => {}} />,
        );
        const badge = getByTestId('composer-pr-chip-checks');
        expect(badge.tagName).toBe('SPAN');
        expect(badge.getAttribute('data-failing')).toBe('0');
        fireEvent.click(badge);
        expect(queryByTestId(POPOVER_TESTID)).toBeNull();
    });

    it('pending but none failing: the checks badge is not clickable', () => {
        const checks: PrCheckRow[] = [check('a', 'success'), check('b', 'pending')];
        const { getByTestId, queryByTestId } = render(
            <ComposerPrChip item={readyItem({ checksState: 'ready', checks })} onDismiss={() => {}} />,
        );
        const badge = getByTestId('composer-pr-chip-checks');
        expect(badge.tagName).toBe('SPAN');
        fireEvent.click(badge);
        expect(queryByTestId(POPOVER_TESTID)).toBeNull();
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
