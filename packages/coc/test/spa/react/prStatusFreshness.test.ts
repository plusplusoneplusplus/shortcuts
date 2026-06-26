/**
 * Unit tests for the pure AC-05 freshness / smart-poll logic.
 *
 * Covers the polling predicate (the DoD's "false when all terminal" case plus
 * the active signals — checks pending/running and auto-merge armed/queued) and
 * the "updated Xs ago" label formatter.
 */
import { describe, it, expect } from 'vitest';
import {
    PR_STATUS_POLL_INTERVAL_MS,
    isPrItemActive,
    shouldPollPrStatusItems,
    formatUpdatedAgo,
} from '../../../src/server/spa/client/react/features/chat/conversation/prStatusFreshness';
import type { PrStatusCardItem, PrAutoMergeInfo } from '../../../src/server/spa/client/react/features/chat/conversation/PrStatusCard';
import type { PrCheckRow, CheckStatus } from '../../../src/server/spa/client/react/features/pull-requests/pr-derived-data';
import type { Reviewer } from '../../../src/server/spa/client/react/features/pull-requests/pr-utils';

function checkRow(status: CheckStatus, name = status): PrCheckRow {
    return { id: `${name}-${status}`, name, status, duration: '', interpretation: '' };
}

function readyItem(overrides: Partial<PrStatusCardItem> = {}): PrStatusCardItem {
    return {
        key: 'o:1',
        repoId: 'ws',
        number: 1,
        state: 'ready',
        pr: { number: 1, title: 'PR', status: 'open', sourceBranch: 'a', targetBranch: 'main' },
        ...overrides,
    };
}

function reviewer(vote?: string): Reviewer {
    return { identity: { displayName: vote ?? 'missing' }, vote };
}

function withAutoMerge(autoMerge: PrAutoMergeInfo, status = 'open'): PrStatusCardItem {
    return readyItem({ pr: { number: 1, title: 'PR', status, sourceBranch: 'a', targetBranch: 'main', autoMerge } });
}

describe('isPrItemActive', () => {
    it('is false for non-ready rows (loading / error)', () => {
        expect(isPrItemActive(readyItem({ state: 'loading', pr: undefined }))).toBe(false);
        expect(isPrItemActive(readyItem({ state: 'error', pr: undefined, error: 'x' }))).toBe(false);
    });

    it('is false for an idle open PR with no pending checks and no armed auto-merge', () => {
        expect(isPrItemActive(readyItem())).toBe(false);
    });

    it('is false for terminal (merged/closed) PRs even with armed auto-merge', () => {
        expect(isPrItemActive(withAutoMerge({ enabled: true, state: 'armed' }, 'merged'))).toBe(false);
        expect(isPrItemActive(withAutoMerge({ enabled: true, state: 'queued' }, 'closed'))).toBe(false);
    });

    it('is true for a non-terminal PR with auto-merge armed or queued', () => {
        expect(isPrItemActive(withAutoMerge({ enabled: true, state: 'armed' }))).toBe(true);
        expect(isPrItemActive(withAutoMerge({ enabled: true, state: 'queued' }))).toBe(true);
    });

    it('is false when auto-merge is enabled but blocked or not-enabled', () => {
        expect(isPrItemActive(withAutoMerge({ enabled: true, state: 'blocked', blockedReason: 'conflicts' }))).toBe(false);
        expect(isPrItemActive(withAutoMerge({ enabled: false, state: 'not-enabled' }))).toBe(false);
    });

    it('is true when loaded checks are pending or running', () => {
        expect(isPrItemActive(readyItem({ checksState: 'ready', checks: [checkRow('success'), checkRow('pending')] }))).toBe(true);
        expect(isPrItemActive(readyItem({ checksState: 'ready', checks: [checkRow('running')] }))).toBe(true);
    });

    it('is false when loaded checks are all settled', () => {
        expect(isPrItemActive(readyItem({ checksState: 'ready', checks: [checkRow('success'), checkRow('failure'), checkRow('skipped')] }))).toBe(false);
    });

    it('ignores checks that have not been loaded yet (only auto-merge keeps it active)', () => {
        // checksState undefined → unknown; do not poll on a guess.
        expect(isPrItemActive(readyItem({ checks: [checkRow('pending')] }))).toBe(false);
    });

    it('is true for a non-terminal PR with unresolved reviewer approval', () => {
        expect(isPrItemActive(readyItem({
            reviewersState: 'ready',
            reviewers: [reviewer('approved'), reviewer('noVote')],
        }))).toBe(true);
        expect(isPrItemActive(readyItem({
            reviewersState: 'ready',
            reviewers: [reviewer('waitingForAuthor')],
        }))).toBe(true);
    });

    it('is false when reviewer approval is resolved or absent', () => {
        expect(isPrItemActive(readyItem({
            reviewersState: 'ready',
            reviewers: [reviewer('approved'), reviewer('approvedWithSuggestions')],
        }))).toBe(false);
        expect(isPrItemActive(readyItem({ reviewersState: 'ready', reviewers: [] }))).toBe(false);
    });

    it('does not poll terminal PRs solely because historical reviewers are unresolved', () => {
        expect(isPrItemActive(readyItem({
            pr: { number: 1, title: 'PR', status: 'merged', sourceBranch: 'a', targetBranch: 'main' },
            reviewersState: 'ready',
            reviewers: [reviewer('noVote')],
        }))).toBe(false);
    });
});

describe('shouldPollPrStatusItems', () => {
    it('is false when the list is empty', () => {
        expect(shouldPollPrStatusItems([])).toBe(false);
    });

    it('is false when every PR is terminal (the DoD case)', () => {
        const merged = withAutoMerge({ enabled: true, state: 'armed' }, 'merged');
        const closed = readyItem({ key: 'o:2', pr: { number: 2, title: 'B', status: 'closed', sourceBranch: 'b', targetBranch: 'main' } });
        expect(shouldPollPrStatusItems([merged, closed])).toBe(false);
    });

    it('is true when at least one PR is still active', () => {
        const merged = withAutoMerge({ enabled: true, state: 'armed' }, 'merged');
        const armedOpen = withAutoMerge({ enabled: true, state: 'armed' });
        expect(shouldPollPrStatusItems([merged, armedOpen])).toBe(true);
    });

    it('exposes a ~45s poll cadence', () => {
        expect(PR_STATUS_POLL_INTERVAL_MS).toBe(45_000);
    });
});

describe('formatUpdatedAgo', () => {
    const base = 1_000_000_000_000;
    it('returns empty when there is no recorded update', () => {
        expect(formatUpdatedAgo(undefined, base)).toBe('');
    });
    it('formats sub-5s as "just now"', () => {
        expect(formatUpdatedAgo(base, base + 2_000)).toBe('updated just now');
    });
    it('formats seconds, minutes, hours, and days', () => {
        expect(formatUpdatedAgo(base, base + 30_000)).toBe('updated 30s ago');
        expect(formatUpdatedAgo(base, base + 5 * 60_000)).toBe('updated 5m ago');
        expect(formatUpdatedAgo(base, base + 3 * 3_600_000)).toBe('updated 3h ago');
        expect(formatUpdatedAgo(base, base + 2 * 86_400_000)).toBe('updated 2d ago');
    });
    it('never goes negative when the clock is skewed', () => {
        expect(formatUpdatedAgo(base, base - 10_000)).toBe('updated just now');
    });
});
