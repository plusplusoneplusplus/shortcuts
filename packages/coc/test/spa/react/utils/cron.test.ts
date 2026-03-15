import { describe, it, expect } from 'vitest';
import { parseCronToInterval, describeCron, intervalToCron, CRON_EXAMPLES, WEEKDAY_NAMES } from '../../../../src/server/spa/client/react/utils/cron';

describe('parseCronToInterval', () => {
    it('detects minutes interval', () => {
        expect(parseCronToInterval('*/5 * * * *')).toEqual({ mode: 'interval', value: '5', unit: 'minutes' });
    });
    it('detects hours interval', () => {
        expect(parseCronToInterval('0 */2 * * *')).toEqual({ mode: 'interval', value: '2', unit: 'hours' });
    });
    it('detects days interval', () => {
        expect(parseCronToInterval('0 0 */3 * *')).toEqual({ mode: 'interval', value: '3', unit: 'days' });
    });
    it('returns cron mode for complex expression', () => {
        expect(parseCronToInterval('0 9 * * 1-5')).toEqual({ mode: 'cron' });
    });
    it('returns cron mode for wrong field count', () => {
        expect(parseCronToInterval('* *')).toEqual({ mode: 'cron' });
    });
});

describe('describeCron', () => {
    it('describes every minute', () => {
        expect(describeCron('* * * * *')).toBe('Every minute');
    });
    it('describes every N minutes', () => {
        expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes');
    });
    it('describes every N hours', () => {
        expect(describeCron('0 */3 * * *')).toBe('Every 3 hours');
    });
    it('describes every hour', () => {
        expect(describeCron('0 * * * *')).toBe('Every hour');
    });
    it('describes daily at time', () => {
        expect(describeCron('0 9 * * *')).toBe('Every day at 09:00');
    });
    it('describes weekdays at time', () => {
        expect(describeCron('0 9 * * 1-5')).toBe('Weekdays at 09:00');
    });
    it('describes specific weekday', () => {
        expect(describeCron('0 9 * * 1')).toBe('Every Monday at 09:00');
    });
    it('describes monthly on specific day', () => {
        expect(describeCron('0 12 1 * *')).toBe('1st of every month at 12:00');
    });
    it('returns empty string for unrecognized', () => {
        expect(describeCron('0 12 1 3 *')).toBe('');
    });
    it('returns empty string for wrong field count', () => {
        expect(describeCron('* *')).toBe('');
    });
});

describe('intervalToCron', () => {
    it('converts minutes interval', () => {
        expect(intervalToCron('5', 'minutes')).toBe('*/5 * * * *');
    });
    it('converts hours interval', () => {
        expect(intervalToCron('2', 'hours')).toBe('0 */2 * * *');
    });
    it('converts days interval', () => {
        expect(intervalToCron('3', 'days')).toBe('0 0 */3 * *');
    });
    it('defaults to 1 for invalid value', () => {
        expect(intervalToCron('', 'hours')).toBe('0 */1 * * *');
    });
    it('defaults to hours for unknown unit', () => {
        expect(intervalToCron('1', 'weeks')).toBe('0 */1 * * *');
    });
});

describe('CRON_EXAMPLES', () => {
    it('has at least 5 examples', () => {
        expect(CRON_EXAMPLES.length).toBeGreaterThanOrEqual(5);
    });
    it('each example has label and expr', () => {
        for (const ex of CRON_EXAMPLES) {
            expect(typeof ex.label).toBe('string');
            expect(typeof ex.expr).toBe('string');
            expect(ex.expr.trim().split(/\s+/).length).toBe(5);
        }
    });
});

describe('WEEKDAY_NAMES', () => {
    it('maps 0 to Sunday', () => {
        expect(WEEKDAY_NAMES['0']).toBe('Sunday');
    });
    it('maps 1 to Monday', () => {
        expect(WEEKDAY_NAMES['1']).toBe('Monday');
    });
});