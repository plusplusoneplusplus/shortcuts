/**
 * Tests for pr-utils helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime, prStatusBadge, prStatusColor } from '../../../../../src/server/spa/client/react/repos/pull-requests/pr-utils';

describe('formatRelativeTime', () => {
    const NOW = new Date('2024-06-15T12:00:00Z').getTime();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns "just now" for timestamps within the last 60 seconds', () => {
        const iso = new Date(NOW - 30_000).toISOString(); // 30s ago
        expect(formatRelativeTime(iso)).toBe('just now');
    });

    it('returns "just now" for timestamp exactly at now', () => {
        expect(formatRelativeTime(new Date(NOW).toISOString())).toBe('just now');
    });

    it('returns minutes ago for timestamps 1–59 minutes old', () => {
        const iso = new Date(NOW - 5 * 60_000).toISOString(); // 5m ago
        expect(formatRelativeTime(iso)).toBe('5m ago');
    });

    it('returns hours ago for timestamps 1–23 hours old', () => {
        const iso = new Date(NOW - 3 * 3600_000).toISOString(); // 3h ago
        expect(formatRelativeTime(iso)).toBe('3h ago');
    });

    it('returns "yesterday" for timestamps exactly 1 day old', () => {
        const iso = new Date(NOW - 25 * 3600_000).toISOString(); // ~25h ago
        expect(formatRelativeTime(iso)).toBe('yesterday');
    });

    it('returns days ago for timestamps 2–29 days old', () => {
        const iso = new Date(NOW - 2 * 86_400_000).toISOString(); // 2d ago
        expect(formatRelativeTime(iso)).toBe('2d ago');
    });

    it('returns months ago for timestamps 30+ days old', () => {
        const iso = new Date(NOW - 60 * 86_400_000).toISOString(); // ~2 months ago
        expect(formatRelativeTime(iso)).toBe('2mo ago');
    });

    it('returns years ago for timestamps 12+ months old', () => {
        const iso = new Date(NOW - 400 * 86_400_000).toISOString(); // ~13 months
        expect(formatRelativeTime(iso)).toBe('1y ago');
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
