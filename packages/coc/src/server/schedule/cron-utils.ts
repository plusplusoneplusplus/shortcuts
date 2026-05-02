/**
 * Cron Utilities
 *
 * Pure-function cron parser, next-time calculator, and human-readable describer.
 * Supports standard 5-field cron expressions: min hour dom month dow.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Types
// ============================================================================

export interface CronFields {
    minutes: Set<number>;
    hours: Set<number>;
    daysOfMonth: Set<number>;
    months: Set<number>;
    daysOfWeek: Set<number>;
}

// ============================================================================
// Cron Parser (5-field standard: min hour dom month dow)
// ============================================================================

function parseField(field: string, min: number, max: number): Set<number> {
    const result = new Set<number>();
    for (const part of field.split(',')) {
        const stepMatch = part.match(/^(.+)\/(\d+)$/);
        let range: string;
        let step = 1;
        if (stepMatch) {
            range = stepMatch[1];
            step = parseInt(stepMatch[2], 10);
        } else {
            range = part;
        }

        if (range === '*') {
            for (let i = min; i <= max; i += step) result.add(i);
        } else {
            const dashMatch = range.match(/^(\d+)-(\d+)$/);
            if (dashMatch) {
                const start = parseInt(dashMatch[1], 10);
                const end = parseInt(dashMatch[2], 10);
                for (let i = start; i <= end; i += step) result.add(i);
            } else {
                result.add(parseInt(range, 10));
            }
        }
    }
    return result;
}

export function parseCron(expr: string): CronFields {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
    }
    return {
        minutes: parseField(parts[0], 0, 59),
        hours: parseField(parts[1], 0, 23),
        daysOfMonth: parseField(parts[2], 1, 31),
        months: parseField(parts[3], 1, 12),
        daysOfWeek: parseField(parts[4], 0, 6),
    };
}

/**
 * Compute the next occurrence of a cron expression after `after`.
 * Returns null if no valid time is found within 1 year.
 */
export function nextCronTime(expr: string, after: Date = new Date()): Date | null {
    const fields = parseCron(expr);
    const limit = new Date(after.getTime() + 366 * 24 * 60 * 60 * 1000);
    const candidate = new Date(after);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    while (candidate < limit) {
        if (!fields.months.has(candidate.getMonth() + 1)) {
            candidate.setMonth(candidate.getMonth() + 1, 1);
            candidate.setHours(0, 0, 0, 0);
            continue;
        }
        if (!fields.daysOfMonth.has(candidate.getDate()) || !fields.daysOfWeek.has(candidate.getDay())) {
            candidate.setDate(candidate.getDate() + 1);
            candidate.setHours(0, 0, 0, 0);
            continue;
        }
        if (!fields.hours.has(candidate.getHours())) {
            candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
            continue;
        }
        if (!fields.minutes.has(candidate.getMinutes())) {
            candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
            continue;
        }
        return candidate;
    }
    return null;
}

/**
 * Convert a cron expression to a human-readable description.
 */
export function describeCron(expr: string): string {
    try {
        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5) return expr;

        const [min, hour, dom, month, dow] = parts;

        if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
            return 'Every minute';
        }

        const stepMatch = min.match(/^\*\/(\d+)$/);
        if (stepMatch && hour === '*' && dom === '*' && month === '*' && dow === '*') {
            return `Every ${stepMatch[1]} minutes`;
        }

        const hourStepMatch = hour.match(/^\*\/(\d+)$/);
        if (min === '0' && hourStepMatch && dom === '*' && month === '*' && dow === '*') {
            return `Every ${hourStepMatch[1]} hours`;
        }

        if (/^\d+$/.test(hour) && /^\d+$/.test(min) && dom === '*' && month === '*') {
            const pad = (n: string) => n.padStart(2, '0');
            const timeStr = `${pad(hour)}:${pad(min)}`;
            if (dow === '*') return `Every day at ${timeStr}`;
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dowNames = dow.split(',').map(d => days[parseInt(d, 10)] || d).join(', ');
            return `${dowNames} at ${timeStr}`;
        }

        const isCommaList = (s: string) => s.split(',').every(p => /^\d+$/.test(p));
        if (isCommaList(hour) && hour.includes(',') && /^\d+$/.test(min) && dom === '*' && month === '*') {
            const pad = (n: string) => n.padStart(2, '0');
            const times = hour
                .split(',')
                .map(Number)
                .sort((a, b) => a - b)
                .map(h => `${pad(String(h))}:${pad(min)}`)
                .join(', ');
            if (dow === '*') return `Every day at ${times}`;
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dowNames = dow.split(',').map(d => days[parseInt(d, 10)] || d).join(', ');
            return `${dowNames} at ${times}`;
        }

        return expr;
    } catch {
        return expr;
    }
}

/**
 * Convert a schedule name to a filesystem-safe slug.
 * Lowercase, non-alphanumeric chars become hyphens, trimmed and collapsed.
 */
export function slugifyName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'schedule';
}
