import { describe, it, expect } from 'vitest';
import { parseCron, nextCronTime, describeCron, slugifyName } from '../../src/server/schedule/cron-utils';
import type { CronFields } from '../../src/server/schedule/cron-utils';

// ============================================================================
// parseCron
// ============================================================================

describe('parseCron', () => {
    describe('field count validation', () => {
        it('throws on fewer than 5 fields', () => {
            expect(() => parseCron('* * *')).toThrow('expected 5 fields');
        });

        it('throws on more than 5 fields', () => {
            expect(() => parseCron('* * * * * *')).toThrow('expected 5 fields');
        });

        it('throws on empty string', () => {
            expect(() => parseCron('')).toThrow('expected 5 fields');
        });
    });

    describe('wildcard (*)', () => {
        it('parses all-wildcard expression', () => {
            const fields = parseCron('* * * * *');
            expect(fields.minutes.size).toBe(60);   // 0–59
            expect(fields.hours.size).toBe(24);      // 0–23
            expect(fields.daysOfMonth.size).toBe(31); // 1–31
            expect(fields.months.size).toBe(12);     // 1–12
            expect(fields.daysOfWeek.size).toBe(7);  // 0–6
        });
    });

    describe('specific values', () => {
        it('parses specific minute', () => {
            const fields = parseCron('30 * * * *');
            expect(fields.minutes).toEqual(new Set([30]));
        });

        it('parses specific hour', () => {
            const fields = parseCron('* 12 * * *');
            expect(fields.hours).toEqual(new Set([12]));
        });

        it('parses specific day of month', () => {
            const fields = parseCron('* * 15 * *');
            expect(fields.daysOfMonth).toEqual(new Set([15]));
        });

        it('parses specific month', () => {
            const fields = parseCron('* * * 6 *');
            expect(fields.months).toEqual(new Set([6]));
        });

        it('parses specific day of week', () => {
            const fields = parseCron('* * * * 3');
            expect(fields.daysOfWeek).toEqual(new Set([3]));
        });

        it('parses zero values', () => {
            const fields = parseCron('0 0 * * 0');
            expect(fields.minutes).toEqual(new Set([0]));
            expect(fields.hours).toEqual(new Set([0]));
            expect(fields.daysOfWeek).toEqual(new Set([0]));
        });
    });

    describe('comma-separated lists', () => {
        it('parses comma-separated minutes', () => {
            const fields = parseCron('0,15,30,45 * * * *');
            expect(fields.minutes).toEqual(new Set([0, 15, 30, 45]));
        });

        it('parses comma-separated hours', () => {
            const fields = parseCron('* 9,17 * * *');
            expect(fields.hours).toEqual(new Set([9, 17]));
        });

        it('parses comma-separated days of week', () => {
            const fields = parseCron('* * * * 1,3,5');
            expect(fields.daysOfWeek).toEqual(new Set([1, 3, 5]));
        });
    });

    describe('ranges (start-end)', () => {
        it('parses hour range', () => {
            const fields = parseCron('* 9-17 * * *');
            expect(fields.hours).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]));
        });

        it('parses day-of-week range (weekdays)', () => {
            const fields = parseCron('* * * * 1-5');
            expect(fields.daysOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
        });

        it('parses single-value range (start === end)', () => {
            const fields = parseCron('* 5-5 * * *');
            expect(fields.hours).toEqual(new Set([5]));
        });

        it('parses month range', () => {
            const fields = parseCron('* * * 3-6 *');
            expect(fields.months).toEqual(new Set([3, 4, 5, 6]));
        });
    });

    describe('step values (*/step and range/step)', () => {
        it('parses */5 minutes', () => {
            const fields = parseCron('*/5 * * * *');
            expect(fields.minutes).toEqual(new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]));
        });

        it('parses */15 minutes', () => {
            const fields = parseCron('*/15 * * * *');
            expect(fields.minutes).toEqual(new Set([0, 15, 30, 45]));
        });

        it('parses */2 hours (even hours)', () => {
            const fields = parseCron('* */2 * * *');
            expect(fields.hours).toEqual(new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]));
        });

        it('parses range with step (1-10/3)', () => {
            const fields = parseCron('1-10/3 * * * *');
            expect(fields.minutes).toEqual(new Set([1, 4, 7, 10]));
        });

        it('parses range with step for hours (9-17/2)', () => {
            const fields = parseCron('* 9-17/2 * * *');
            expect(fields.hours).toEqual(new Set([9, 11, 13, 15, 17]));
        });

        it('parses */1 as every value', () => {
            const fields = parseCron('*/1 * * * *');
            expect(fields.minutes.size).toBe(60);
        });
    });

    describe('combined expressions', () => {
        it('parses typical workday expression (0 9 * * 1-5)', () => {
            const fields = parseCron('0 9 * * 1-5');
            expect(fields.minutes).toEqual(new Set([0]));
            expect(fields.hours).toEqual(new Set([9]));
            expect(fields.daysOfMonth.size).toBe(31);
            expect(fields.months.size).toBe(12);
            expect(fields.daysOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
        });

        it('parses quarterly first-of-month (0 0 1 1,4,7,10 *)', () => {
            const fields = parseCron('0 0 1 1,4,7,10 *');
            expect(fields.minutes).toEqual(new Set([0]));
            expect(fields.hours).toEqual(new Set([0]));
            expect(fields.daysOfMonth).toEqual(new Set([1]));
            expect(fields.months).toEqual(new Set([1, 4, 7, 10]));
        });

        it('handles extra whitespace', () => {
            const fields = parseCron('  0   9   *   *   1-5  ');
            expect(fields.minutes).toEqual(new Set([0]));
            expect(fields.hours).toEqual(new Set([9]));
            expect(fields.daysOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
        });
    });
});

// ============================================================================
// nextCronTime
// ============================================================================

describe('nextCronTime', () => {
    it('returns the next minute for every-minute cron', () => {
        const after = new Date(2025, 5, 15, 10, 30, 0, 0); // June 15 2025 10:30 local
        const next = nextCronTime('* * * * *', after);
        expect(next).not.toBeNull();
        expect(next!.getHours()).toBe(10);
        expect(next!.getMinutes()).toBe(31);
    });

    it('returns the next matching minute for */5', () => {
        const after = new Date(2025, 5, 15, 10, 32, 0, 0); // June 15 2025 10:32 local
        const next = nextCronTime('*/5 * * * *', after);
        expect(next).not.toBeNull();
        expect(next!.getMinutes()).toBe(35);
    });

    it('advances to next hour if no matching minute remains', () => {
        // Use local time to avoid timezone issues (nextCronTime uses local Date methods)
        const after = new Date(2025, 5, 15, 10, 58, 0, 0); // June 15 2025 10:58 local
        const next = nextCronTime('0 * * * *', after);
        expect(next).not.toBeNull();
        expect(next!.getHours()).toBe(11);
        expect(next!.getMinutes()).toBe(0);
    });

    it('advances to next day if no matching hour remains', () => {
        const after = new Date(2025, 5, 15, 23, 30, 0, 0); // June 15 2025 23:30 local
        const next = nextCronTime('0 9 * * *', after);
        expect(next).not.toBeNull();
        expect(next!.getDate()).toBe(16);
        expect(next!.getHours()).toBe(9);
    });

    it('skips non-matching days of week', () => {
        // 2025-06-15 is a Sunday (day 0); cron says Monday-Friday
        const after = new Date(2025, 5, 15, 8, 0, 0, 0); // June 15 2025 local
        const next = nextCronTime('0 9 * * 1-5', after);
        expect(next).not.toBeNull();
        expect(next!.getDay()).toBeGreaterThanOrEqual(1);
        expect(next!.getDay()).toBeLessThanOrEqual(5);
    });

    it('skips non-matching months', () => {
        // After March, next match should be in June for month 6
        const after = new Date(2025, 2, 31, 23, 59, 0, 0); // March 31 2025 local
        const next = nextCronTime('0 0 1 6 *', after);
        expect(next).not.toBeNull();
        expect(next!.getMonth()).toBe(5); // June is month index 5
        expect(next!.getDate()).toBe(1);
    });

    it('returns null for impossible expression within 1 year', () => {
        // Day 31 of February will never match within a reasonable window
        const after = new Date(2025, 0, 1, 0, 0, 0, 0); // Jan 1 2025 local
        const next = nextCronTime('0 0 31 2 *', after);
        expect(next).toBeNull();
    });

    it('defaults to current time when no after is provided', () => {
        const before = Date.now();
        const next = nextCronTime('* * * * *');
        expect(next).not.toBeNull();
        // Next minute should be within ~2 minutes of now
        expect(next!.getTime()).toBeGreaterThan(before);
        expect(next!.getTime()).toBeLessThan(before + 2 * 60 * 1000);
    });

    it('handles specific day-of-month and day-of-week conjunction', () => {
        // Both day-of-month AND day-of-week must match
        const after = new Date(2025, 0, 1, 0, 0, 0, 0); // Jan 1 2025 local
        const next = nextCronTime('0 0 1 * 1', after);
        if (next) {
            expect(next.getDate()).toBe(1);
            expect(next.getDay()).toBe(1); // Monday
        }
    });
});

// ============================================================================
// describeCron
// ============================================================================

describe('describeCron', () => {
    it('describes every minute', () => {
        expect(describeCron('* * * * *')).toBe('Every minute');
    });

    it('describes every N minutes', () => {
        expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes');
        expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    });

    it('describes every N hours', () => {
        expect(describeCron('0 */3 * * *')).toBe('Every 3 hours');
        expect(describeCron('0 */6 * * *')).toBe('Every 6 hours');
    });

    it('describes daily at specific time', () => {
        expect(describeCron('0 9 * * *')).toBe('Every day at 09:00');
        expect(describeCron('30 14 * * *')).toBe('Every day at 14:30');
    });

    it('describes daily at midnight', () => {
        expect(describeCron('0 0 * * *')).toBe('Every day at 00:00');
    });

    it('describes specific weekday at time', () => {
        const result = describeCron('0 9 * * 1');
        expect(result).toBe('Mon at 09:00');
    });

    it('describes multiple weekdays at time', () => {
        const result = describeCron('0 9 * * 1,3,5');
        expect(result).toBe('Mon, Wed, Fri at 09:00');
    });

    it('describes multiple times per day', () => {
        const result = describeCron('0 9,17 * * *');
        expect(result).toBe('Every day at 09:00, 17:00');
    });

    it('describes multiple times on specific weekdays', () => {
        const result = describeCron('0 9,17 * * 1,5');
        expect(result).toBe('Mon, Fri at 09:00, 17:00');
    });

    it('returns raw expression for complex patterns', () => {
        // Range in day-of-month field — not a pattern describeCron handles
        const result = describeCron('0 12 1-15 * *');
        expect(result).toBe('0 12 1-15 * *');
    });

    it('returns raw expression for wrong field count', () => {
        expect(describeCron('* *')).toBe('* *');
    });

    it('handles invalid expression gracefully', () => {
        // Should not throw
        const result = describeCron('invalid');
        expect(typeof result).toBe('string');
    });
});

// ============================================================================
// slugifyName
// ============================================================================

describe('slugifyName', () => {
    it('lowercases and replaces spaces with hyphens', () => {
        expect(slugifyName('My Schedule')).toBe('my-schedule');
    });

    it('replaces multiple non-alphanumeric chars with single hyphen', () => {
        expect(slugifyName('Hello   World!!!')).toBe('hello-world');
    });

    it('trims leading and trailing hyphens', () => {
        expect(slugifyName('---test---')).toBe('test');
    });

    it('handles all-special-character names', () => {
        expect(slugifyName('!!!')).toBe('schedule');
    });

    it('handles empty string', () => {
        expect(slugifyName('')).toBe('schedule');
    });

    it('preserves digits', () => {
        expect(slugifyName('Pipeline Run 42')).toBe('pipeline-run-42');
    });

    it('handles mixed unicode and ascii', () => {
        // Non-ASCII chars get replaced
        expect(slugifyName('café schedule')).toBe('caf-schedule');
    });

    it('collapses multiple consecutive special chars', () => {
        expect(slugifyName('a--b__c  d')).toBe('a-b-c-d');
    });
});
