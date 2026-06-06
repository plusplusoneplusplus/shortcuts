/**
 * Tests for pr-utils helpers.
 */

import { describe, it, expect } from 'vitest';
import { AttentionGroup } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-attention-groups';
import {
    authorMatchesCoworkerRosterEntry,
    buildCoworkerRosterCandidates,
    deriveQueueRisk,
    filterPullRequestsByCoworkerRoster,
    formatRelativeTime,
    formatTimestamp,
    getGroupBadgeStyle,
    pullRequestMatchesCoworkerRoster,
    prStatusBadge,
    prStatusColor,
    type PrCoworkerRosterEntry,
    type PullRequest,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';

describe('formatTimestamp', () => {
    it('returns a non-empty string for a valid ISO date', () => {
        const result = formatTimestamp('2024-01-02T14:00:00Z');
        expect(result).toBeTruthy();
        expect(result).not.toBe('');
    });

    it('includes the year in the output', () => {
        const result = formatTimestamp('2024-01-02T14:00:00Z');
        expect(result).toContain('2024');
    });

    it('returns empty string for null input', () => {
        expect(formatTimestamp(null)).toBe('');
    });

    it('returns empty string for undefined input', () => {
        expect(formatTimestamp(undefined)).toBe('');
    });

    it('returns empty string for invalid date string', () => {
        expect(formatTimestamp('not-a-date')).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(formatTimestamp('')).toBe('');
    });
});

describe('formatRelativeTime (backward-compat alias)', () => {
    it('delegates to formatTimestamp and returns a non-empty string for valid ISO', () => {
        const result = formatRelativeTime('2024-06-15T12:00:00Z');
        expect(result).toBeTruthy();
        expect(result).toContain('2024');
    });

    it('returns empty string for null input', () => {
        expect(formatRelativeTime(null)).toBe('');
    });

    it('returns empty string for undefined input', () => {
        expect(formatRelativeTime(undefined)).toBe('');
    });
});

describe('prStatusBadge', () => {
    it('open → green badge with 🟢 emoji', () => {
        const badge = prStatusBadge('open');
        expect(badge.emoji).toBe('🟢');
        expect(badge.label).toBe('Open');
        expect(badge.className).toContain('green');
    });

    it('draft → yellow badge with 🟡 emoji', () => {
        const badge = prStatusBadge('draft');
        expect(badge.emoji).toBe('🟡');
        expect(badge.label).toBe('Draft');
        expect(badge.className).toContain('yellow');
    });

    it('merged → purple badge with 🟣 emoji', () => {
        const badge = prStatusBadge('merged');
        expect(badge.emoji).toBe('🟣');
        expect(badge.label).toBe('Merged');
        expect(badge.className).toContain('purple');
    });

    it('closed → red badge with 🔴 emoji', () => {
        const badge = prStatusBadge('closed');
        expect(badge.emoji).toBe('🔴');
        expect(badge.label).toBe('Closed');
        expect(badge.className).toContain('red');
    });

    it('unknown status → gray badge with ⚪ emoji', () => {
        const badge = prStatusBadge('unknown');
        expect(badge.emoji).toBe('⚪');
        expect(badge.label).toBe('unknown');
        expect(badge.className).toContain('gray');
    });
});

describe('prStatusColor', () => {
    it('returns the className string for a given status', () => {
        expect(prStatusColor('open')).toBe('bg-green-100 text-green-800');
        expect(prStatusColor('merged')).toBe('bg-purple-100 text-purple-800');
    });
});

describe('getGroupBadgeStyle', () => {
    it('returns distinct, non-empty badge styles for every attention group', () => {
        const styles = [
            getGroupBadgeStyle(AttentionGroup.RerunNeeded),
            getGroupBadgeStyle(AttentionGroup.ManualUpdateNeeded),
            getGroupBadgeStyle(AttentionGroup.ReviewerNudge),
            getGroupBadgeStyle(AttentionGroup.MergeValidation),
        ];

        for (const style of styles) {
            expect(style.label).toBeTruthy();
            expect(style.color).toBeTruthy();
            expect(style.emoji).toBeTruthy();
        }

        expect(new Set(styles.map(style => style.label)).size).toBe(styles.length);
        expect(new Set(styles.map(style => style.color)).size).toBe(styles.length);
        expect(new Set(styles.map(style => style.emoji)).size).toBe(styles.length);
    });

    it('uses the configured label, colour, and emoji for each group', () => {
        expect(getGroupBadgeStyle(AttentionGroup.RerunNeeded)).toEqual({
            label: 'Rerun needed',
            color: 'bg-orange-100 text-orange-800',
            emoji: '🔁',
        });
        expect(getGroupBadgeStyle(AttentionGroup.ManualUpdateNeeded)).toEqual({
            label: 'Update needed',
            color: 'bg-yellow-100 text-yellow-800',
            emoji: '✏️',
        });
        expect(getGroupBadgeStyle(AttentionGroup.ReviewerNudge)).toEqual({
            label: 'Nudge reviewer',
            color: 'bg-blue-100 text-blue-800',
            emoji: '💬',
        });
        expect(getGroupBadgeStyle(AttentionGroup.MergeValidation)).toEqual({
            label: 'Validate merge',
            color: 'bg-purple-100 text-purple-800',
            emoji: '✅',
        });
    });
});

describe('deriveQueueRisk', () => {
    it('returns unknown when real diff stats are unavailable', () => {
        expect(deriveQueueRisk(undefined)).toBe('unknown');
        expect(deriveQueueRisk(null)).toBe('unknown');
    });

    it('uses the documented changed-line thresholds', () => {
        expect(deriveQueueRisk({ additions: 100, deletions: 99, changedFiles: 3 })).toBe('low');
        expect(deriveQueueRisk({ additions: 100, deletions: 100, changedFiles: 3 })).toBe('med');
        expect(deriveQueueRisk({ additions: 500, deletions: 300, changedFiles: 6 })).toBe('med');
        expect(deriveQueueRisk({ additions: 500, deletions: 301, changedFiles: 6 })).toBe('high');
    });

    it('bumps risk by exactly one tier for failing checks or blocking threads', () => {
        expect(deriveQueueRisk(
            { additions: 50, deletions: 25, changedFiles: 1 },
            { hasFailingCheck: true },
        )).toBe('med');
        expect(deriveQueueRisk(
            { additions: 200, deletions: 100, changedFiles: 2 },
            { hasUnresolvedBlockingThread: true },
        )).toBe('high');
        expect(deriveQueueRisk(
            { additions: 900, deletions: 50, changedFiles: 10 },
            { hasFailingCheck: true, hasUnresolvedBlockingThread: true },
        )).toBe('high');
    });
});

describe('coworker roster author matching', () => {
    const rosterEntry = (overrides: Partial<PrCoworkerRosterEntry> = {}): PrCoworkerRosterEntry => ({
        id: '12345',
        displayName: 'Coworker One',
        addedAt: '2024-01-01T00:00:00.000Z',
        ...overrides,
    });

    const pr = (overrides: Partial<PullRequest> = {}): PullRequest => ({
        id: overrides.number ?? 1,
        number: 1,
        title: 'Test PR',
        sourceBranch: 'feature',
        targetBranch: 'main',
        status: 'open',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        author: { id: '999', displayName: 'Someone Else' },
        ...overrides,
    });

    it('matches GitHub numeric author IDs before display names', () => {
        expect(authorMatchesCoworkerRosterEntry(
            { id: 12345, displayName: 'Renamed GitHub User' },
            rosterEntry({ id: '12345', displayName: 'Original GitHub User' }),
        )).toBe(true);
    });

    it('matches ADO GUID author IDs independent of casing', () => {
        expect(authorMatchesCoworkerRosterEntry(
            { id: 'A19F35A1-42DB-4C6A-A87D-4A7D7218E7E5', displayName: 'Ado User' },
            rosterEntry({ id: 'a19f35a1-42db-4c6a-a87d-4a7d7218e7e5', displayName: 'Other Name' }),
        )).toBe(true);
    });

    it('does not fall back to displayName when both provider IDs are present and different', () => {
        expect(authorMatchesCoworkerRosterEntry(
            { id: 'github-user-1', displayName: 'Shared Name' },
            rosterEntry({ id: 'github-user-2', displayName: 'Shared Name' }),
        )).toBe(false);
    });

    it('falls back to case-insensitive displayName matching when an ID is unavailable', () => {
        expect(authorMatchesCoworkerRosterEntry(
            { displayName: '  COWORKER ONE  ' },
            rosterEntry({ id: '', displayName: 'coworker one' }),
        )).toBe(true);
    });

    it('matches the union of roster authors across loaded pull requests', () => {
        const pullRequests = [
            pr({ number: 1, author: { id: '12345', displayName: 'Coworker One' } }),
            pr({ number: 2, author: { id: '99999', displayName: 'Outside Author' } }),
            pr({ number: 3, author: { displayName: 'Coworker Two' } }),
        ];
        const roster = [
            rosterEntry({ id: '12345', displayName: 'Coworker One' }),
            rosterEntry({ id: '', displayName: 'coworker two' }),
        ];

        expect(pullRequestMatchesCoworkerRoster(pullRequests[0], roster)).toBe(true);
        expect(pullRequestMatchesCoworkerRoster(pullRequests[1], roster)).toBe(false);
        expect(filterPullRequestsByCoworkerRoster(pullRequests, roster).map(item => item.number)).toEqual([1, 3]);
    });

    it('dedupes add-picker author candidates by provider id first and displayName fallback', () => {
        const candidates = buildCoworkerRosterCandidates([
            pr({
                number: 1,
                author: { id: 12345, displayName: 'Bob Dev', email: 'bob@example.invalid' },
            }),
            pr({
                number: 2,
                author: { id: '12345', displayName: 'Robert Dev', avatarUrl: 'https://avatars.example.invalid/bob' },
            }),
            pr({ number: 3, author: { displayName: '  Casey Dev  ' } }),
            pr({ number: 4, author: { displayName: 'casey dev' } }),
            pr({ number: 5, author: { id: '', displayName: '   ' } }),
            pr({ number: 6, author: undefined }),
        ]);

        expect(candidates).toEqual([
            {
                id: '12345',
                displayName: 'Bob Dev',
                email: 'bob@example.invalid',
                avatarUrl: 'https://avatars.example.invalid/bob',
                prCount: 2,
            },
            {
                id: '',
                displayName: 'Casey Dev',
                prCount: 2,
            },
        ]);
    });
});
