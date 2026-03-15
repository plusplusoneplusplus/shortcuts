/** Pure cron utility functions and constants. */

/** Try to reverse-parse a cron expression into a simple interval. */
export function parseCronToInterval(cron: string): { mode: 'interval'; value: string; unit: string } | { mode: 'cron' } {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return { mode: 'cron' };
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    const minMatch = minute.match(/^\*\/(\d+)$/);
    if (minMatch && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return { mode: 'interval', value: minMatch[1], unit: 'minutes' };
    }

    const hrMatch = hour.match(/^\*\/(\d+)$/);
    if (minute === '0' && hrMatch && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return { mode: 'interval', value: hrMatch[1], unit: 'hours' };
    }

    const dayMatch = dayOfMonth.match(/^\*\/(\d+)$/);
    if (minute === '0' && hour === '0' && dayMatch && month === '*' && dayOfWeek === '*') {
        return { mode: 'interval', value: dayMatch[1], unit: 'days' };
    }

    return { mode: 'cron' };
}

export const WEEKDAY_NAMES: Record<string, string> = {
    '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday',
    '4': 'Thursday', '5': 'Friday', '6': 'Saturday', '7': 'Sunday',
};

/** Human-readable description for common cron patterns. Returns '' for unrecognized. */
export function describeCron(expr: string): string {
    const p = expr.trim().split(/\s+/);
    if (p.length !== 5) return '';
    const [min, hr, dom, mon, dow] = p;

    if (min === '*' && hr === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every minute';

    const minStep = min.match(/^\*\/(\d+)$/);
    if (minStep && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
        return `Every ${minStep[1]} minute${minStep[1] === '1' ? '' : 's'}`;
    }

    const hrStep = hr.match(/^\*\/(\d+)$/);
    if (min === '0' && hrStep && dom === '*' && mon === '*' && dow === '*') {
        return `Every ${hrStep[1]} hour${hrStep[1] === '1' ? '' : 's'}`;
    }

    if (min === '0' && hr === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour';

    if (/^\d+$/.test(min) && /^\d+$/.test(hr) && dom === '*' && mon === '*') {
        const hh = hr.padStart(2, '0');
        const mm = min.padStart(2, '0');
        const time = `${hh}:${mm}`;
        if (dow === '*') return `Every day at ${time}`;
        if (dow === '1-5') return `Weekdays at ${time}`;
        if (WEEKDAY_NAMES[dow]) return `Every ${WEEKDAY_NAMES[dow]} at ${time}`;
    }

    if (/^\d+$/.test(min) && /^\d+$/.test(hr) && /^\d+$/.test(dom) && mon === '*' && dow === '*') {
        const hh = hr.padStart(2, '0');
        const mm = min.padStart(2, '0');
        const d = parseInt(dom, 10);
        const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
        return `${d}${suffix} of every month at ${hh}:${mm}`;
    }

    return '';
}

/** Convert an interval (value + unit) to a cron expression. */
export function intervalToCron(value: string, unit: string): string {
    const val = parseInt(value, 10) || 1;
    switch (unit) {
        case 'minutes': return `*/${val} * * * *`;
        case 'hours': return `0 */${val} * * *`;
        case 'days': return `0 0 */${val} * *`;
        default: return `0 */${val} * * *`;
    }
}

export const CRON_EXAMPLES: { label: string; expr: string }[] = [
    { label: 'Every minute', expr: '* * * * *' },
    { label: 'Every 5 minutes', expr: '*/5 * * * *' },
    { label: 'Every hour', expr: '0 * * * *' },
    { label: 'Every 6 hours', expr: '0 */6 * * *' },
    { label: 'Daily at 9 AM', expr: '0 9 * * *' },
    { label: 'Weekdays at 9 AM', expr: '0 9 * * 1-5' },
    { label: 'Every Sunday at midnight', expr: '0 0 * * 0' },
    { label: '1st of month at noon', expr: '0 12 1 * *' },
];
