import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatRelativeTime } from '../../../../src/server/spa/client/react/utils/format';

afterEach(() => {
    vi.restoreAllMocks();
});

function mockNow(ms: number) {
    vi.spyOn(Date, 'now').mockReturnValue(ms);
}

const BASE = new Date('2024-01-01T12:00:00.000Z').getTime();

describe('formatRelativeTime — past dates', () => {
    it('returns "just now" for 0 ms ago', () => {
        mockNow(BASE);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('just now');
    });

    it('returns "just now" for 59 seconds ago', () => {
        mockNow(BASE + 59_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('just now');
    });

    it('returns "Xm ago" for minutes', () => {
        mockNow(BASE + 5 * 60_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('5m ago');
    });

    it('returns "Xh ago" for hours', () => {
        mockNow(BASE + 3 * 3600_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('3h ago');
    });

    it('returns "yesterday" for exactly 1 day ago', () => {
        mockNow(BASE + 24 * 3600_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('yesterday');
    });

    it('returns "Xd ago" for 2-6 days ago', () => {
        mockNow(BASE + 3 * 24 * 3600_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('3d ago');
    });
});

describe('formatRelativeTime — future dates', () => {
    it('returns "just now" for ~0 seconds in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 30_000).toISOString(); // 30s ahead
        expect(formatRelativeTime(future)).toBe('just now');
    });

    it('returns "in Xm" for 5 minutes in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 5 * 60_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 5m');
    });

    it('returns "in Xm" for 55 minutes in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 55 * 60_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 55m');
    });

    it('returns "in Xh" for 2 hours in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 2 * 3600_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 2h');
    });

    it('returns "in Xd" for 3 days in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 3 * 24 * 3600_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 3d');
    });
});

describe('formatRelativeTime — edge cases', () => {
    it('returns empty string for null', () => {
        expect(formatRelativeTime(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(formatRelativeTime(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(formatRelativeTime('')).toBe('');
    });
});
