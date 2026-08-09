/**
 * Unit tests for the cron explainer's pure logic.
 *
 * Every next-run assertion feeds an explicit clock, so the expectations hold
 * regardless of when the suite runs. Dates are constructed with the local-time
 * `new Date(y, m, d, ...)` form because cron schedules are local by definition.
 */
import { describe, expect, it } from 'vitest';

import {
    describeCron,
    explainCron,
    nextRuns,
    parseCron,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/cron';

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    return result.value;
}

function errorOf(result: { ok: true } | { ok: false; error: string }): string {
    if (result.ok) throw new Error('expected an error');
    return result.error;
}

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

describe('parseCron', () => {
    it('expands every field of a weekday-morning schedule', () => {
        const schedule = unwrap(parseCron('0 9 * * 1-5'));
        expect(schedule.minutes).toEqual([0]);
        expect(schedule.hours).toEqual([9]);
        expect(schedule.daysOfMonth.length).toBe(31);
        expect(schedule.months.length).toBe(12);
        expect(schedule.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
        expect(schedule.dayOfMonthRestricted).toBe(false);
        expect(schedule.dayOfWeekRestricted).toBe(true);
    });

    it('expands a step field', () => {
        expect(unwrap(parseCron('*/15 * * * *')).minutes).toEqual([0, 15, 30, 45]);
    });

    it('expands lists, ranges and range-steps together', () => {
        expect(unwrap(parseCron('0,30 1-5/2 * * *')).minutes).toEqual([0, 30]);
        expect(unwrap(parseCron('0,30 1-5/2 * * *')).hours).toEqual([1, 3, 5]);
    });

    it('accepts month and day names, and folds 7 onto Sunday', () => {
        const schedule = unwrap(parseCron('0 0 1 JAN,dec MON'));
        expect(schedule.months).toEqual([1, 12]);
        expect(schedule.daysOfWeek).toEqual([1]);
        expect(unwrap(parseCron('0 0 * * 7')).daysOfWeek).toEqual([0]);
    });

    it('rejects the wrong field count', () => {
        expect(errorOf(parseCron('0 9 * *'))).toContain('Expected 5 fields');
        expect(errorOf(parseCron(''))).toContain('got 0');
    });

    it('rejects out-of-range values, bad names, zero steps and descending ranges', () => {
        expect(errorOf(parseCron('60 * * * *'))).toContain('minute');
        expect(errorOf(parseCron('0 25 * * *'))).toContain('hour');
        expect(errorOf(parseCron('0 0 * FOO *'))).toContain('month');
        expect(errorOf(parseCron('*/0 * * * *'))).toContain('step');
        expect(errorOf(parseCron('0 5-1 * * *'))).toContain('descending');
    });
});

describe('describeCron', () => {
    it('reads common expressions in English', () => {
        expect(unwrap(describeCron('0 9 * * 1-5'))).toBe('At 09:00, on Monday through Friday (local time)');
        expect(unwrap(describeCron('*/15 * * * *'))).toBe('Every 15 minutes (local time)');
        expect(unwrap(describeCron('* * * * *'))).toBe('Every minute (local time)');
        expect(unwrap(describeCron('30 3 1 * *'))).toBe('At 03:30, on day-of-month 1 (local time)');
        expect(unwrap(describeCron('0 0 1 1 *'))).toBe('At 00:00, on day-of-month 1, in January (local time)');
        expect(unwrap(describeCron('5 * * * *'))).toBe('At minute 5 of every hour (local time)');
        expect(unwrap(describeCron('* 9 * * *'))).toBe('Every minute past hour 9 (local time)');
        expect(unwrap(describeCron('0 9,17 * * MON,FRI'))).toBe(
            'At minute 0 past hour 9 and 17, on Monday and Friday (local time)',
        );
    });

    it('passes the parse error through', () => {
        expect(errorOf(describeCron('nope'))).toContain('Expected 5 fields');
    });
});

describe('nextRuns', () => {
    it('lists weekday mornings, skipping the weekend', () => {
        // 2024-01-05 is a Friday at 10:00 — the 09:00 run has already passed.
        const runs = nextRuns(unwrap(parseCron('0 9 * * 1-5')), local(2024, 1, 5, 10, 0), 3);
        expect(runs).toEqual([local(2024, 1, 8, 9), local(2024, 1, 9, 9), local(2024, 1, 10, 9)]);
    });

    it('starts from the next minute, never the current one', () => {
        const runs = nextRuns(unwrap(parseCron('*/15 * * * *')), local(2024, 1, 1, 0, 0), 3);
        expect(runs).toEqual([local(2024, 1, 1, 0, 15), local(2024, 1, 1, 0, 30), local(2024, 1, 1, 0, 45)]);
    });

    it('rolls over the hour, the day and the month', () => {
        const runs = nextRuns(unwrap(parseCron('30 3 1 * *')), local(2024, 1, 1, 4, 0), 2);
        expect(runs).toEqual([local(2024, 2, 1, 3, 30), local(2024, 3, 1, 3, 30)]);
    });

    it('treats a restricted day-of-month and day-of-week as an OR', () => {
        // The 1st, plus every Monday.
        const runs = nextRuns(unwrap(parseCron('0 0 1 * MON')), local(2024, 1, 1, 12, 0), 3);
        expect(runs).toEqual([local(2024, 1, 8), local(2024, 1, 15), local(2024, 1, 22)]);
    });

    it('returns nothing for a schedule that can never fire', () => {
        expect(nextRuns(unwrap(parseCron('0 0 31 2 *')), local(2024, 1, 1), 5)).toEqual([]);
    });
});

describe('explainCron', () => {
    it('bundles the description and five formatted runs', () => {
        const explained = unwrap(explainCron('0 9 * * 1-5', local(2024, 1, 5, 10, 0)));
        expect(explained.description).toContain('At 09:00');
        expect(explained.runs.length).toBe(5);
        expect(explained.runs[0]!.epochMs).toBe(local(2024, 1, 8, 9));
        expect(explained.runs[0]!.iso).toBe(new Date(local(2024, 1, 8, 9)).toISOString());
        expect(explained.runs[0]!.local).toBe(new Date(local(2024, 1, 8, 9)).toLocaleString());
    });

    it('reports an invalid expression instead of throwing', () => {
        expect(errorOf(explainCron('0 9 * * 9', local(2024, 1, 1)))).toContain('day of week');
    });
});
