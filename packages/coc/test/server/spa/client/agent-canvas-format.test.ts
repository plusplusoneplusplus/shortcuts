import { describe, it, expect } from 'vitest';
import { formatRunDuration } from '../../../../src/server/spa/client/react/features/chat/agent-canvas/format';

describe('formatRunDuration', () => {
    it('formats sub-hour durations as m:ss', () => {
        expect(formatRunDuration(0)).toBe('0:00');
        expect(formatRunDuration(9_000)).toBe('0:09');
        expect(formatRunDuration(309_000)).toBe('5:09');
        expect(formatRunDuration(59 * 60_000 + 59_000)).toBe('59:59');
    });

    it('formats an hour or more as Hh Mm', () => {
        expect(formatRunDuration(60 * 60_000)).toBe('1h 0m');
        expect(formatRunDuration(65 * 60_000)).toBe('1h 5m');
        expect(formatRunDuration(23 * 3_600_000 + 59 * 60_000)).toBe('23h 59m');
    });

    it('formats a day or more as Dd Hh (no unbounded minute count)', () => {
        expect(formatRunDuration(24 * 3_600_000)).toBe('1d 0h');
        // 7353:17 (122h33m17s) — the stuck-agent case — collapses to a tidy label.
        expect(formatRunDuration((7353 * 60 + 17) * 1000)).toBe('5d 2h');
    });

    it('clamps negative input to zero', () => {
        expect(formatRunDuration(-5000)).toBe('0:00');
    });
});
