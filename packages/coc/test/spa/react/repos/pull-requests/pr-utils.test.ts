/**
 * Tests for pr-utils helpers.
 */

import { describe, it, expect } from 'vitest';
import { AttentionGroup } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-attention-groups';
import {
    deriveQueueRisk,
    formatRelativeTime,
    formatTimestamp,
    getGroupBadgeStyle,
    prStatusBadge,
    prStatusColor,
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
