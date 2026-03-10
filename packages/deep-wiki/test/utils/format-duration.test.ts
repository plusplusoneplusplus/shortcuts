import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../src/utils/format-duration';

describe('formatDuration', () => {
    it('returns milliseconds for values under 1000', () => {
        expect(formatDuration(0)).toBe('0ms');
        expect(formatDuration(1)).toBe('1ms');
        expect(formatDuration(500)).toBe('500ms');
        expect(formatDuration(999)).toBe('999ms');
    });

    it('returns seconds for values under 60s', () => {
        expect(formatDuration(1000)).toBe('1s');
        expect(formatDuration(1499)).toBe('1s');
        expect(formatDuration(1500)).toBe('2s');
        expect(formatDuration(59000)).toBe('59s');
        expect(formatDuration(59499)).toBe('59s');
    });

    it('returns minutes and seconds for values >= 60s', () => {
        expect(formatDuration(60000)).toBe('1m 0s');
        expect(formatDuration(90000)).toBe('1m 30s');
        expect(formatDuration(125000)).toBe('2m 5s');
        expect(formatDuration(3600000)).toBe('60m 0s');
    });

    it('handles the boundary at 59.5s (rounds to 60s → shows as 1m 0s)', () => {
        expect(formatDuration(59500)).toBe('1m 0s');
    });
});
