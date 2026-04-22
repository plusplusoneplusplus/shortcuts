/**
 * Tests for pr-utils helpers.
 */

import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatTimestamp, prStatusBadge, prStatusColor } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';

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
