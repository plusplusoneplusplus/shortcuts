/** Browser-safe schedule rules shared by the scrubber server and editor. */
import { nextCronTime, parseCron } from './cron-utils';

export const SCRUB_MIN_INTERVAL_MS = 60 * 60_000;
export const SCRUB_DEFAULT_CRON = '0 9 * * *';
export const SCRUB_CRON_PRESETS = [
    { label: 'Every 6h', cron: '0 */6 * * *' },
    { label: 'Every 12h', cron: '0 */12 * * *' },
    { label: 'Every 24h', cron: SCRUB_DEFAULT_CRON },
] as const;

/**
 * Returns an error message when `cron` is not a valid 5-field expression or
 * can fire more often than once an hour; `undefined` when it is acceptable.
 */
export function validateScrubCron(cron: string, now: Date = new Date()): string | undefined {
    const expr = cron.trim();
    if (/\/0+(?:\s|,|$)/.test(expr)) return 'Invalid cron expression: step must be positive';
    // Bound range expansion before parsing untrusted editor/server input.
    const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
    const parts = expr.split(/\s+/);
    if (parts.length === 5 && parts.some((field, index) => field.split(',').some(part => {
        const range = part.match(/^(\d+)-(\d+)(?:\/\d+)?$/);
        return range && (Number(range[1]) < bounds[index][0] || Number(range[2]) > bounds[index][1]);
    }))) return 'Invalid cron expression: a field is out of range';
    try {
        const fields = parseCron(expr);
        const ranges: Array<[Set<number>, number, number]> = [
            [fields.minutes, 0, 59], [fields.hours, 0, 23], [fields.daysOfMonth, 1, 31],
            [fields.months, 1, 12], [fields.daysOfWeek, 0, 6],
        ];
        if (ranges.some(([values, min, max]) => values.size === 0
            || [...values].some(value => !Number.isInteger(value) || value < min || value > max))) {
            return 'Invalid cron expression: a field is out of range';
        }
        // Every matching hour includes all selected minutes, even beyond the scan horizon.
        if (fields.minutes.size > 1) return 'The schedule must run at most once an hour';
    } catch (error) {
        return error instanceof Error ? error.message : 'Invalid cron expression';
    }
    // Scan a week of firings: the tightest gap must be at least an hour.
    let previous = nextCronTime(expr, now);
    if (!previous) return 'This schedule never runs';
    const horizon = now.getTime() + 8 * 24 * 60 * 60_000;
    while (previous.getTime() < horizon) {
        const next = nextCronTime(expr, previous);
        if (!next) break;
        if (next.getTime() - previous.getTime() < SCRUB_MIN_INTERVAL_MS) return 'The schedule must run at most once an hour';
        previous = next;
    }
    return undefined;
}
