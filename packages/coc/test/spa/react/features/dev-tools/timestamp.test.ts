/**
 * Timestamp conversion — pure logic with an injected clock, no rendering.
 */
import { describe, expect, it } from 'vitest';
import {
    detectEpochUnit,
    formatRelative,
    fromEpoch,
    parseTimestamp,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/timestamp';

/** 2024-01-01T00:00:00.000Z, used as the injected "now" everywhere below. */
const NOW_MS = 1704067200000;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    return result.value;
}

describe('detectEpochUnit', () => {
    it('reads a 10-digit value as seconds and a 13-digit one as milliseconds', () => {
        expect(detectEpochUnit(1704067200)).toBe('seconds');
        expect(detectEpochUnit(1704067200000)).toBe('milliseconds');
        expect(detectEpochUnit(0)).toBe('seconds');
        expect(detectEpochUnit(-1704067200)).toBe('seconds');
    });
});

describe('parseTimestamp', () => {
    it('auto-detects seconds and produces the same instant as the ms form', () => {
        const seconds = unwrap(parseTimestamp('1704067200', NOW_MS));
        const millis = unwrap(parseTimestamp('1704067200000', NOW_MS));
        expect(seconds.detectedUnit).toBe('seconds');
        expect(millis.detectedUnit).toBe('milliseconds');
        expect(seconds.epochMs).toBe(millis.epochMs);
        expect(seconds.iso).toBe('2024-01-01T00:00:00.000Z');
    });

    it('round-trips an ISO 8601 string back to the same ISO string', () => {
        const iso = '2024-06-15T12:34:56.000Z';
        const view = unwrap(parseTimestamp(iso, NOW_MS));
        expect(view.iso).toBe(iso);
        expect(unwrap(parseTimestamp(String(view.epochSeconds), NOW_MS)).iso).toBe(iso);
    });

    it('exposes both epoch units for the same instant', () => {
        const view = unwrap(parseTimestamp('1704067200', NOW_MS));
        expect(view.epochSeconds).toBe(1704067200);
        expect(view.epochMs).toBe(1704067200000);
    });

    it('errors on empty and on unparseable input', () => {
        expect(parseTimestamp('', NOW_MS).ok).toBe(false);
        const bad = parseTimestamp('not a date', NOW_MS);
        expect(bad.ok).toBe(false);
        expect(bad.ok === false && bad.error).toContain('recognisable date');
    });
});

describe('fromEpoch', () => {
    it('honours the explicit unit rather than guessing', () => {
        expect(unwrap(fromEpoch(1, 'seconds', NOW_MS)).epochMs).toBe(1000);
        expect(unwrap(fromEpoch(1, 'milliseconds', NOW_MS)).epochMs).toBe(1);
    });

    it('errors on a non-finite value and on an out-of-range instant', () => {
        expect(fromEpoch(Number.NaN, 'seconds', NOW_MS).ok).toBe(false);
        expect(fromEpoch(1e18, 'milliseconds', NOW_MS).ok).toBe(false);
    });
});

describe('formatRelative', () => {
    it('describes the offset from the injected clock in both directions', () => {
        expect(formatRelative(NOW_MS, NOW_MS)).toBe('now');
        expect(formatRelative(NOW_MS - 30_000, NOW_MS)).toBe('30 seconds ago');
        expect(formatRelative(NOW_MS + 60_000, NOW_MS)).toBe('in 1 minute');
        expect(formatRelative(NOW_MS - 3 * 3_600_000, NOW_MS)).toBe('3 hours ago');
        expect(formatRelative(NOW_MS + 2 * 86_400_000, NOW_MS)).toBe('in 2 days');
    });

    it('does not read the wall clock — the same inputs always give the same text', () => {
        expect(formatRelative(0, 86_400_000)).toBe('1 day ago');
    });
});
