/**
 * Tests for autoPullStatusView — the read-only presentation of the server's
 * auto-pull schedule (AC-05). No timer here: the client renders `nextRunAt`
 * and the last outcome, it never computes when the next pull happens.
 */

import { describe, it, expect } from 'vitest';
import {
    formatTimeUntil,
    describeLastRun,
    describeLastRunDetail,
} from '../../../../../src/server/spa/client/react/features/git/autoPullStatusView';

const NOW = Date.parse('2026-01-01T12:00:00.000Z');

function at(offsetMs: number): string {
    return new Date(NOW + offsetMs).toISOString();
}

describe('formatTimeUntil', () => {
    it('returns undefined when nothing is scheduled', () => {
        expect(formatTimeUntil(undefined, NOW)).toBeUndefined();
    });

    it('returns undefined for an unparseable instant', () => {
        expect(formatTimeUntil('not-a-date', NOW)).toBeUndefined();
    });

    it('rounds up to whole minutes under an hour', () => {
        expect(formatTimeUntil(at(90_000), NOW)).toBe('in 2m');
        expect(formatTimeUntil(at(59 * 60_000), NOW)).toBe('in 59m');
    });

    it('switches to hours at an hour and to days at a day', () => {
        expect(formatTimeUntil(at(90 * 60_000), NOW)).toBe('in 2h');
        expect(formatTimeUntil(at(30 * 60 * 60_000), NOW)).toBe('in 2d');
    });

    it('reads as "due" once the instant has passed, never a negative count', () => {
        expect(formatTimeUntil(at(0), NOW)).toBe('due');
        expect(formatTimeUntil(at(-5 * 60_000), NOW)).toBe('due');
    });
});

describe('describeLastRun', () => {
    it('is undefined when the repo has never run', () => {
        expect(describeLastRun(undefined)).toBeUndefined();
        expect(describeLastRun({ enabled: true })).toBeUndefined();
    });

    it('spells out each terminal outcome', () => {
        expect(describeLastRun({ enabled: true, outcome: 'success' })).toBe('pulled');
        expect(describeLastRun({ enabled: true, outcome: 'failed' })).toBe('failed');
        expect(describeLastRun({ enabled: true, outcome: 'skipped-dirty' }))
            .toBe('skipped — uncommitted changes');
        expect(describeLastRun({ enabled: true, outcome: 'skipped-precheck-error' }))
            .toBe('skipped — could not check the working tree');
        expect(describeLastRun({ enabled: true, outcome: 'skipped-in-flight' }))
            .toBe('skipped — a pull was already running');
    });

    it('falls back to the raw value for an outcome it does not know', () => {
        expect(describeLastRun({ enabled: true, outcome: 'future-outcome' as any })).toBe('future-outcome');
    });
});

describe('describeLastRunDetail', () => {
    it('is undefined without an outcome', () => {
        expect(describeLastRunDetail({ enabled: true, lastRunAt: at(-60_000) })).toBeUndefined();
    });

    it('joins the time, the outcome, and the server message', () => {
        const detail = describeLastRunDetail({
            enabled: true,
            lastRunAt: at(-60_000),
            outcome: 'skipped-dirty',
            message: 'uncommitted changes in the working tree',
        });
        expect(detail).toContain('skipped — uncommitted changes');
        expect(detail).toContain('uncommitted changes in the working tree');
        expect(detail).toContain(new Date(NOW - 60_000).toLocaleString());
    });

    it('omits the message on a plain success', () => {
        expect(describeLastRunDetail({ enabled: true, lastRunAt: at(-60_000), outcome: 'success' }))
            .toMatch(/pulled$/);
    });
});
