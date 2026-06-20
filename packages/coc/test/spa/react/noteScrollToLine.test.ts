/**
 * Tests for computeBestEffortScrollTop — the proportional "scroll to source
 * line" math backing AC-04. Pure function, so the cases below pin every branch
 * (no line / first line / single-line doc / nothing scrollable / mid / clamp).
 */
import { describe, it, expect } from 'vitest';
import { computeBestEffortScrollTop } from '../../../src/server/spa/client/react/features/notes/editor/noteScrollToLine';

describe('computeBestEffortScrollTop', () => {
    const tall = { totalLines: 100, scrollHeight: 2000, clientHeight: 1000 };

    it('opens at the top when no line is given', () => {
        expect(computeBestEffortScrollTop({ line: undefined, ...tall })).toBe(0);
        expect(computeBestEffortScrollTop({ line: null, ...tall })).toBe(0);
    });

    it('opens at the top for the first line', () => {
        expect(computeBestEffortScrollTop({ line: 1, ...tall })).toBe(0);
        expect(computeBestEffortScrollTop({ line: 0, ...tall })).toBe(0);
    });

    it('opens at the top for a single-line document', () => {
        expect(computeBestEffortScrollTop({ line: 5, totalLines: 1, scrollHeight: 2000, clientHeight: 1000 })).toBe(0);
    });

    it('opens at the top when nothing is scrollable (jsdom / short note)', () => {
        // scrollHeight <= clientHeight → maxScroll <= 0
        expect(computeBestEffortScrollTop({ line: 50, totalLines: 100, scrollHeight: 0, clientHeight: 0 })).toBe(0);
        expect(computeBestEffortScrollTop({ line: 50, totalLines: 100, scrollHeight: 800, clientHeight: 1000 })).toBe(0);
    });

    it('scrolls proportionally for a mid-document line', () => {
        // ratio = (50 - 1) / 100 = 0.49 ; maxScroll = 1000 → 490
        expect(computeBestEffortScrollTop({ line: 50, ...tall })).toBe(490);
    });

    it('clamps to the bottom when the line is past the end of the document', () => {
        // ratio clamps to 1 → full maxScroll (1000)
        expect(computeBestEffortScrollTop({ line: 500, ...tall })).toBe(1000);
    });

    it('returns 0 for non-finite inputs instead of NaN', () => {
        expect(computeBestEffortScrollTop({ line: Number.NaN, ...tall })).toBe(0);
        expect(computeBestEffortScrollTop({ line: 50, totalLines: Number.NaN, scrollHeight: 2000, clientHeight: 1000 })).toBe(0);
        expect(computeBestEffortScrollTop({ line: 50, totalLines: 100, scrollHeight: Number.NaN, clientHeight: 1000 })).toBe(0);
    });
});
