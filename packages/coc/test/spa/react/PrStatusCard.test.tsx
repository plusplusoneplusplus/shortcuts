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
 * Plus: two PRs stack newest-first, and the list starts behind the top-row
 * dropdown count even for a single PR.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import {
    PrStatusCard,
    describeAutoMerge,
    autoMergeLabel,
    prProviderFromUrl,
    type PrStatusCardItem,
    type PrAutoMergeInfo,
} from '../../../src/server/spa/client/react/features/chat/conversation/PrStatusCard';
import type { PrCheckRow, CheckStatus } from '../../../src/server/spa/client/react/features/pull-requests/pr-derived-data';

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

    it('loading state: shows a skeleton row with the PR number after expanding', () => {
        const item = readyItem({ state: 'loading', pr: undefined });
        const { getByTestId, queryByTestId } = render(<PrStatusCard items={[item]} />);
        expect(getByTestId('pr-status-card-toggle').getAttribute('aria-expanded')).toBe('false');
        expect(queryByTestId(`pr-status-card-row-${item.key}`)).toBeNull();

        fireEvent.click(getByTestId('pr-status-card-toggle'));
        const row = getByTestId(`pr-status-card-row-${item.key}`);
        expect(row.getAttribute('data-state')).toBe('loading');
        expect(getByTestId(`pr-status-card-loading-${item.key}`)).toBeTruthy();
        expect(row.textContent).toContain('#101');
        expect(row.textContent).toContain('Loading');
    });

    it('success state: shows number, title, state badge, branches, and deep-link', () => {
        const item = readyItem();
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));

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
        fireEvent.click(getByTestId('pr-status-card-toggle'));

        expect(getByTestId(`pr-status-card-error-${item.key}`).textContent).toContain('Network error');
        fireEvent.click(getByTestId(`pr-status-card-retry-${item.key}`));
        expect(onRetry).toHaveBeenCalledWith(item.key);
        expect(getByTestId(`pr-status-card-open-${item.key}`).getAttribute('href'))
            .toBe('#repos/ws-abc/pull-requests/101/overview');
    });

    it('error state: omits the retry button when no onRetry handler is provided', () => {
        const item = readyItem({ state: 'error', pr: undefined, error: 'boom' });
        const { getByTestId, queryByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
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
        fireEvent.click(getByTestId('pr-status-card-toggle'));
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
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        expect(within(getByTestId(`pr-status-card-row-${item.key}`)).getByTestId('pr-status-card-state-badge').textContent).toContain('Closed');
        expect(getByTestId(`pr-status-card-terminal-time-${item.key}`).textContent).toContain('closed');
    });

    it('two PRs stack newest-first by createdAt', () => {
        const older = readyItem({ key: 'o:1', number: 1, createdAt: '2026-01-01T00:00:00Z', pr: { number: 1, title: 'Older', status: 'open', sourceBranch: 'a', targetBranch: 'main' } });
        const newer = readyItem({ key: 'o:2', number: 2, createdAt: '2026-02-01T00:00:00Z', pr: { number: 2, title: 'Newer', status: 'open', sourceBranch: 'b', targetBranch: 'main' } });

        // Pass oldest-first to prove the card reorders.
        const { getAllByTestId, getByTestId } = render(<PrStatusCard items={[older, newer]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        const rows = getAllByTestId(/^pr-status-card-row-/);
        expect(rows[0].textContent).toContain('Newer');
        expect(rows[1].textContent).toContain('Older');
    });

    it('starts collapsed to a count and expands from the top row', () => {
        const items = [1, 2, 3].map(n => readyItem({
            key: `o:${n}`,
            number: n,
            pr: { number: n, title: `PR ${n}`, status: 'open', sourceBranch: `b${n}`, targetBranch: 'main' },
        }));
        const { getByTestId, queryByTestId } = render(<PrStatusCard items={items} />);

        const toggle = getByTestId('pr-status-card-toggle');
        expect(toggle.textContent).toContain('3 pull requests');
        // Collapsed by default → rows hidden.
        expect(queryByTestId('pr-status-card-row-o:1')).toBeNull();
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        // Expanding reveals the rows.
        fireEvent.click(toggle);
        expect(getByTestId('pr-status-card-row-o:1')).toBeTruthy();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('single PR also starts collapsed behind the dropdown top row', () => {
        const item = readyItem();
        const { getByTestId, queryByTestId } = render(<PrStatusCard items={[item]} />);
        const toggle = getByTestId('pr-status-card-toggle');
        expect(toggle.textContent).toContain('1 pull request');
        expect(toggle.textContent).toContain('▸');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(queryByTestId(`pr-status-card-row-${item.key}`)).toBeNull();

        fireEvent.click(toggle);
        expect(toggle.textContent).toContain('▾');
        expect(getByTestId(`pr-status-card-row-${item.key}`)).toBeTruthy();
    });
});

/** A ready item carrying an auto-merge payload + a provider-revealing URL. */
function autoMergeItem(autoMerge: PrAutoMergeInfo, url: string, key = 'origin-1:101'): PrStatusCardItem {
    return readyItem({
        key,
        pr: {
            number: 101,
            title: 'Add PR status card',
            status: 'open',
            sourceBranch: 'feature/card',
            targetBranch: 'main',
            url,
            autoMerge,
        },
    });
}

describe('PrStatusCard auto-merge indicator (AC-04 display)', () => {
    it('GitHub armed: shows "Auto-merge armed" with merge method and who armed it', () => {
        const item = autoMergeItem(
            { enabled: true, state: 'armed', mergeMethod: 'squash', enabledBy: { displayName: 'Carol' } },
            'https://github.com/o/r/pull/101',
        );
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        const badge = getByTestId(`pr-status-card-automerge-${item.key}`);
        expect(badge.getAttribute('data-automerge-state')).toBe('armed');
        expect(badge.textContent).toContain('Auto-merge armed');
        expect(badge.textContent).toContain('squash');
        expect(badge.textContent).toContain('by Carol');
    });

    it('GitHub blocked: shows "Auto-merge blocked" with the human reason', () => {
        const item = autoMergeItem(
            { enabled: true, state: 'blocked', blockedReason: 'pending-review', mergeMethod: 'rebase' },
            'https://github.com/o/r/pull/101',
        );
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        const badge = getByTestId(`pr-status-card-automerge-${item.key}`);
        expect(badge.getAttribute('data-automerge-state')).toBe('blocked');
        expect(badge.textContent).toContain('Auto-merge blocked');
        expect(badge.textContent).toContain('pending review');
    });

    it('ADO armed: provider-aware "Auto-complete" label from a dev.azure.com URL', () => {
        const item = autoMergeItem(
            { enabled: true, state: 'armed', mergeMethod: 'merge', enabledBy: { displayName: 'Dana' } },
            'https://dev.azure.com/org/proj/_git/repo/pullrequest/101',
        );
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        const badge = getByTestId(`pr-status-card-automerge-${item.key}`);
        expect(badge.textContent).toContain('Auto-complete armed');
        expect(badge.textContent).not.toContain('Auto-merge');
    });

    it('queued: shows the queued state', () => {
        const item = autoMergeItem(
            { enabled: true, state: 'queued' },
            'https://github.com/o/r/pull/101',
        );
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        expect(getByTestId(`pr-status-card-automerge-${item.key}`).textContent).toContain('Auto-merge queued');
    });

    it('not-enabled / disabled: renders no indicator', () => {
        const offItem = autoMergeItem({ enabled: false, state: 'not-enabled' }, 'https://github.com/o/r/pull/101', 'off:1');
        const { getByTestId, queryByTestId } = render(<PrStatusCard items={[offItem]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        expect(queryByTestId('pr-status-card-automerge-off:1')).toBeNull();
    });

    it('no auto-merge field at all: renders no indicator', () => {
        const item = readyItem({ key: 'plain:1' });
        const { getByTestId, queryByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        expect(queryByTestId('pr-status-card-automerge-plain:1')).toBeNull();
    });
});

describe('PrStatusCard freshness controls (AC-05 display)', () => {
    it('renders an "updated ago" label when lastUpdatedAt is provided', () => {
        const { getByTestId } = render(
            <PrStatusCard items={[readyItem()]} lastUpdatedAt={Date.now()} />,
        );
        expect(getByTestId('pr-status-card-updated').textContent).toContain('updated');
    });

    it('omits the freshness label until the first fetch lands', () => {
        const { queryByTestId } = render(<PrStatusCard items={[readyItem()]} />);
        expect(queryByTestId('pr-status-card-updated')).toBeNull();
    });

    it('shows a refresh control that invokes onRefresh', () => {
        const onRefresh = vi.fn();
        const { getByTestId } = render(<PrStatusCard items={[readyItem()]} onRefresh={onRefresh} />);
        const refresh = getByTestId('pr-status-card-refresh');
        expect(refresh.textContent).toContain('Refresh');
        fireEvent.click(refresh);
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('disables the refresh control while refreshing', () => {
        const onRefresh = vi.fn();
        const { getByTestId } = render(
            <PrStatusCard items={[readyItem()]} onRefresh={onRefresh} refreshing />,
        );
        const refresh = getByTestId('pr-status-card-refresh') as HTMLButtonElement;
        expect(refresh.disabled).toBe(true);
        expect(refresh.textContent).toContain('Refreshing');
        fireEvent.click(refresh);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('omits the refresh control when no onRefresh handler is provided', () => {
        const { queryByTestId } = render(<PrStatusCard items={[readyItem()]} />);
        expect(queryByTestId('pr-status-card-refresh')).toBeNull();
    });
});

function checkRow(status: CheckStatus, name: string, overrides: Partial<PrCheckRow> = {}): PrCheckRow {
    return { id: `${name}-${status}`, name, status, duration: '', interpretation: '', ...overrides };
}

describe('PrStatusCard CI checks (AC-03 display)', () => {
    it('checks panel is collapsed by default and not in the DOM until expanded', () => {
        const item = readyItem();
        const { queryByTestId, getByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        expect(getByTestId(`pr-status-card-checks-toggle-${item.key}`)).toBeTruthy();
        expect(queryByTestId(`pr-status-card-checks-${item.key}`)).toBeNull();
    });

    it('expanding a row calls onExpandChecks once and reveals the checks panel', () => {
        const onExpandChecks = vi.fn();
        const item = readyItem({
            checksState: 'ready',
            checks: [
                checkRow('success', 'build', { detailsUrl: 'https://ci/build' }),
                checkRow('failure', 'unit'),
                checkRow('pending', 'e2e'),
            ],
        });
        const { getByTestId } = render(<PrStatusCard items={[item]} onExpandChecks={onExpandChecks} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));

        fireEvent.click(getByTestId(`pr-status-card-checks-toggle-${item.key}`));
        expect(onExpandChecks).toHaveBeenCalledTimes(1);
        expect(onExpandChecks).toHaveBeenCalledWith(item.key);

        // Panel + the shared compact renderer (summary counts + a row per check).
        const panel = getByTestId(`pr-status-card-checks-${item.key}`);
        const summary = within(panel).getByTestId(`pr-checks-compact-${item.key}-summary`);
        expect(within(summary).getByTestId(`pr-checks-compact-${item.key}-count-passing`).getAttribute('data-count')).toBe('1');
        expect(within(summary).getByTestId(`pr-checks-compact-${item.key}-count-failing`).getAttribute('data-count')).toBe('1');
        expect(within(panel).getAllByTestId(`pr-checks-compact-${item.key}-row`)).toHaveLength(3);

        // Collapsing again removes the panel (and does not re-fire expand).
        fireEvent.click(getByTestId(`pr-status-card-checks-toggle-${item.key}`));
        expect(onExpandChecks).toHaveBeenCalledTimes(1);
    });

    it('expanded row shows a loading state before checks arrive', () => {
        const item = readyItem();
        const { getByTestId } = render(<PrStatusCard items={[item]} onExpandChecks={vi.fn()} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        fireEvent.click(getByTestId(`pr-status-card-checks-toggle-${item.key}`));
        // checksState undefined → compact renderer defaults to loading.
        expect(getByTestId(`pr-checks-compact-${item.key}-loading`)).toBeTruthy();
    });

    it('expanded row surfaces a checks error with a retry that re-requests', () => {
        const onExpandChecks = vi.fn();
        const item = readyItem({ checksState: 'error', checksError: 'checks down' });
        const { getByTestId } = render(<PrStatusCard items={[item]} onExpandChecks={onExpandChecks} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        fireEvent.click(getByTestId(`pr-status-card-checks-toggle-${item.key}`));
        expect(onExpandChecks).toHaveBeenCalledTimes(1); // the expand
        const err = getByTestId(`pr-checks-compact-${item.key}-error`);
        expect(err.textContent).toContain('checks down');
        fireEvent.click(getByTestId(`pr-checks-compact-${item.key}-retry`));
        expect(onExpandChecks).toHaveBeenCalledTimes(2); // expand + retry
    });
});

describe('describeAutoMerge / provider helpers (AC-04 pure logic)', () => {
    it('prProviderFromUrl maps hosts to providers', () => {
        expect(prProviderFromUrl('https://github.com/o/r/pull/1')).toBe('github');
        expect(prProviderFromUrl('https://dev.azure.com/org/proj/_git/r/pullrequest/1')).toBe('azure-devops');
        expect(prProviderFromUrl('https://myorg.visualstudio.com/proj/_git/r/pullrequest/1')).toBe('azure-devops');
        expect(prProviderFromUrl(undefined)).toBeUndefined();
        expect(prProviderFromUrl('https://example.com/x')).toBeUndefined();
    });

    it('autoMergeLabel is provider-aware', () => {
        expect(autoMergeLabel('github')).toBe('Auto-merge');
        expect(autoMergeLabel('azure-devops')).toBe('Auto-complete');
        expect(autoMergeLabel(undefined)).toBe('Auto-merge');
    });

    it('returns null when off / disabled / unknown state (off)', () => {
        expect(describeAutoMerge(undefined, 'github')).toBeNull();
        expect(describeAutoMerge({ enabled: false, state: 'not-enabled' }, 'github')).toBeNull();
        expect(describeAutoMerge({ enabled: true, state: 'not-enabled' }, 'github')).toBeNull();
        expect(describeAutoMerge({ enabled: true, state: 'whatever' }, 'github')).toBeNull();
    });

    it('describes an armed auto-merge (on)', () => {
        expect(
            describeAutoMerge(
                { enabled: true, state: 'armed', mergeMethod: 'squash', enabledBy: { displayName: 'Carol' } },
                'github',
            ),
        ).toEqual({ label: 'Auto-merge', state: 'armed', mergeMethod: 'squash', enabledBy: 'Carol', blockedReason: undefined });
    });

    it('describes a blocked auto-merge with a human reason (blocked)', () => {
        expect(
            describeAutoMerge({ enabled: true, state: 'blocked', blockedReason: 'failing-checks' }, 'azure-devops'),
        ).toEqual({ label: 'Auto-complete', state: 'blocked', mergeMethod: undefined, enabledBy: undefined, blockedReason: 'failing checks' });
    });

    it('passes through an unknown blocked reason verbatim', () => {
        const model = describeAutoMerge({ enabled: true, state: 'blocked', blockedReason: 'custom-reason' }, 'github');
        expect(model?.blockedReason).toBe('custom-reason');
    });
});

describe('PrStatusCard inline checks summary (always-visible chips on the Checks line)', () => {
    it('shows the summary chips without expanding the Checks toggle', () => {
        const item = readyItem({
            checksState: 'ready',
            checks: [checkRow('success', 'build'), checkRow('failure', 'unit'), checkRow('pending', 'e2e')],
        });
        const { getByTestId, queryByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));

        // The full per-check list (behind the toggle) stays collapsed…
        expect(queryByTestId(`pr-status-card-checks-${item.key}`)).toBeNull();
        // …but the inline summary chips render next to the Checks toggle.
        const inline = getByTestId(`pr-status-card-checks-inline-${item.key}-summary`);
        expect(within(inline).getByTestId(`pr-status-card-checks-inline-${item.key}-count-passing`).getAttribute('data-count')).toBe('1');
        expect(within(inline).getByTestId(`pr-status-card-checks-inline-${item.key}-count-failing`).getAttribute('data-count')).toBe('1');
        expect(within(inline).getByTestId(`pr-status-card-checks-inline-${item.key}-count-pending`).getAttribute('data-count')).toBe('1');
    });

    it('shows a brief loading state inline while checks are loading', () => {
        const item = readyItem({ checksState: 'loading' });
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        expect(getByTestId(`pr-status-card-checks-inline-${item.key}-loading`).textContent).toContain('Loading checks');
    });

    it('shows an inline error + retry that re-requests the checks', () => {
        const onExpandChecks = vi.fn();
        const item = readyItem({ checksState: 'error', checksError: 'down' });
        const { getByTestId } = render(<PrStatusCard items={[item]} onExpandChecks={onExpandChecks} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        const err = getByTestId(`pr-status-card-checks-inline-${item.key}-error`);
        expect(err.textContent).toContain('checks unavailable');
        fireEvent.click(getByTestId(`pr-status-card-checks-inline-${item.key}-retry`));
        expect(onExpandChecks).toHaveBeenCalledWith(item.key);
    });

    it('renders nothing extra inline when there are zero checks (stays quiet)', () => {
        const item = readyItem({ checksState: 'ready', checks: [] });
        const { getByTestId, queryByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));
        expect(queryByTestId(`pr-status-card-checks-inline-${item.key}-summary`)).toBeNull();
        // The bare Checks toggle is still present.
        expect(getByTestId(`pr-status-card-checks-toggle-${item.key}`)).toBeTruthy();
    });
});

describe('PrStatusCard aggregate header status indicators', () => {
    it('single PR: always shows the lifecycle status on the collapsed header (e.g. Open)', () => {
        const { getByTestId, queryByTestId } = render(<PrStatusCard items={[readyItem()]} />);
        // Rows collapsed, but the lifecycle status is visible.
        expect(queryByTestId('pr-status-card-row-origin-1:101')).toBeNull();
        const status = getByTestId('pr-status-card-pr-status');
        expect(status.getAttribute('data-pr-status-kind')).toBe('single');
        expect(status.getAttribute('data-pr-status')).toBe('open');
        expect(status.textContent).toContain('Open');
        // No auto-merge → the auto-merge indicator stays absent.
        expect(queryByTestId('pr-status-card-merge-status')).toBeNull();
    });

    it('single PR: a merged PR shows "Merged" on the header without expanding', () => {
        const item = readyItem({
            pr: { number: 55, title: 'Done', status: 'merged', sourceBranch: 'f', targetBranch: 'main', mergedAt: '2026-01-02T00:00:00Z' },
        });
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        const status = getByTestId('pr-status-card-pr-status');
        expect(status.getAttribute('data-pr-status')).toBe('merged');
        expect(status.textContent).toContain('Merged');
    });

    it('single PR: shows lifecycle AND the auto-merge indicator when auto-merge is active', () => {
        const item = autoMergeItem(
            { enabled: true, state: 'armed', mergeMethod: 'squash', enabledBy: { displayName: 'Carol' } },
            'https://github.com/o/r/pull/101',
        );
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        // The PR is still open → lifecycle shows Open…
        expect(getByTestId('pr-status-card-pr-status').textContent).toContain('Open');
        // …and the auto-merge indicator is shown next to it.
        const merge = getByTestId('pr-status-card-merge-status');
        expect(merge.getAttribute('data-merge-state')).toBe('armed');
        expect(merge.textContent).toContain('Auto-merge armed');
    });

    it('single PR: blocked auto-merge shows the reason and is provider-aware (ADO)', () => {
        const item = autoMergeItem(
            { enabled: true, state: 'blocked', blockedReason: 'pending-review' },
            'https://dev.azure.com/org/proj/_git/repo/pullrequest/101',
        );
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        const merge = getByTestId('pr-status-card-merge-status');
        expect(merge.textContent).toContain('Auto-complete blocked');
        expect(merge.textContent).toContain('pending review');
        expect(merge.textContent).not.toContain('Auto-merge');
    });

    it('multi PR: shows per-status lifecycle counts ordered open → draft → merged → closed', () => {
        const items = [
            readyItem({ key: 'm:1', pr: { number: 1, title: 'A', status: 'merged', sourceBranch: 'a', targetBranch: 'main', mergedAt: '2026-01-01T00:00:00Z' } }),
            readyItem({ key: 'm:2', pr: { number: 2, title: 'B', status: 'open', sourceBranch: 'b', targetBranch: 'main' } }),
            readyItem({ key: 'm:3', pr: { number: 3, title: 'C', status: 'open', sourceBranch: 'c', targetBranch: 'main' } }),
        ];
        const { getByTestId } = render(<PrStatusCard items={items} />);
        const status = getByTestId('pr-status-card-pr-status');
        expect(status.getAttribute('data-pr-status-kind')).toBe('multi');
        const segments = Array.from(status.querySelectorAll('[data-pr-status-segment]')).map(el => ({
            status: el.getAttribute('data-pr-status-segment'),
            count: el.getAttribute('data-count'),
        }));
        expect(segments).toEqual([
            { status: 'open', count: '2' },
            { status: 'merged', count: '1' },
        ]);
    });

    it('multi PR: shows auto-merge counts next to the lifecycle counts when active', () => {
        const items = [
            readyItem({ key: 'm:1', pr: { number: 1, title: 'A', status: 'open', sourceBranch: 'a', targetBranch: 'main' } }),
            autoMergeItem({ enabled: true, state: 'armed' }, 'https://github.com/o/r/pull/2', 'm:2'),
            autoMergeItem({ enabled: true, state: 'blocked', blockedReason: 'conflicts' }, 'https://github.com/o/r/pull/3', 'm:3'),
        ];
        const { getByTestId } = render(<PrStatusCard items={items} />);
        const merge = getByTestId('pr-status-card-merge-status');
        expect(merge.getAttribute('data-merge-kind')).toBe('multi');
        const segments = Array.from(merge.querySelectorAll('[data-merge-segment]')).map(el => ({
            state: el.getAttribute('data-merge-segment'),
            count: el.getAttribute('data-count'),
        }));
        expect(segments).toEqual([
            { state: 'blocked', count: '1' },
            { state: 'armed', count: '1' },
        ]);
    });

    it('omits both indicators until at least one row is ready', () => {
        const loading = readyItem({ state: 'loading', pr: undefined });
        const { queryByTestId } = render(<PrStatusCard items={[loading]} />);
        expect(queryByTestId('pr-status-card-pr-status')).toBeNull();
        expect(queryByTestId('pr-status-card-merge-status')).toBeNull();
    });
});
