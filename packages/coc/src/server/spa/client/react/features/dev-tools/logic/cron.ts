/**
 * Five-field cron parsing: plain-English description plus the next run times.
 *
 * Standard `minute hour day-of-month month day-of-week` fields, with `*`,
 * ranges, lists, star-slash-step, and the usual three-letter month/day names. Seconds
 * and the Quartz-style sixth field are not supported — the card documents that.
 *
 * "Now" is always an injected `nowMs`, never a bare `Date.now()`, so the
 * next-run list is deterministic under test. All arithmetic runs in the host's
 * local time zone, which is what a cron table on this machine would do.
 *
 * React-free; every entry point returns `{ ok } | { ok: false, error }`.
 */

export type CronResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CronSchedule {
    minutes: number[];
    hours: number[];
    daysOfMonth: number[];
    months: number[];
    daysOfWeek: number[];
    /** True when the field was something other than `*` — drives cron's day OR rule. */
    dayOfMonthRestricted: boolean;
    dayOfWeekRestricted: boolean;
}

interface FieldSpec {
    name: string;
    min: number;
    max: number;
    names?: Record<string, number>;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTH_ALIASES: Record<string, number> = Object.fromEntries(
    MONTH_NAMES.map((name, index) => [name.slice(0, 3).toLowerCase(), index + 1]),
);
const DAY_ALIASES: Record<string, number> = Object.fromEntries(
    DAY_NAMES.map((name, index) => [name.slice(0, 3).toLowerCase(), index]),
);

const FIELDS: readonly FieldSpec[] = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'day of month', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12, names: MONTH_ALIASES },
    // 7 is accepted as an alias for Sunday and normalised to 0 below.
    { name: 'day of week', min: 0, max: 7, names: DAY_ALIASES },
];

function parseValue(token: string, spec: FieldSpec): number | null {
    const alias = spec.names?.[token.toLowerCase()];
    if (alias !== undefined) return alias;
    if (!/^\d+$/.test(token)) return null;
    const value = Number(token);
    return value >= spec.min && value <= spec.max ? value : null;
}

/** Expand one cron field (`*`, `a`, `a-b`, `a-b/n`, star-slash-n, or a comma list) into sorted values. */
function parseField(raw: string, spec: FieldSpec): CronResult<{ values: number[]; restricted: boolean }> {
    const field = raw.trim();
    if (!field) return { ok: false, error: `Empty ${spec.name} field` };

    const values = new Set<number>();
    let restricted = false;

    for (const part of field.split(',')) {
        const [rangeText, stepText, ...extra] = part.split('/');
        if (extra.length > 0 || stepText === '') {
            return { ok: false, error: `"${part}" is not a valid ${spec.name} step` };
        }
        let step = 1;
        if (stepText !== undefined) {
            if (!/^\d+$/.test(stepText) || Number(stepText) === 0) {
                return { ok: false, error: `"${part}" is not a valid ${spec.name} step` };
            }
            step = Number(stepText);
        }

        let start: number;
        let end: number;
        if (rangeText === '*') {
            start = spec.min;
            end = spec.max;
            if (step !== 1) restricted = true;
        } else {
            restricted = true;
            const bounds = rangeText!.split('-');
            if (bounds.length > 2) return { ok: false, error: `"${part}" is not a valid ${spec.name}` };
            const low = parseValue(bounds[0]!, spec);
            if (low === null) return { ok: false, error: `"${bounds[0]}" is not a valid ${spec.name}` };
            if (bounds.length === 1) {
                start = low;
                // `5/15` means "from 5, every 15" — an open-ended range.
                end = stepText === undefined ? low : spec.max;
            } else {
                const high = parseValue(bounds[1]!, spec);
                if (high === null) return { ok: false, error: `"${bounds[1]}" is not a valid ${spec.name}` };
                if (high < low) return { ok: false, error: `"${part}" is a descending ${spec.name} range` };
                start = low;
                end = high;
            }
        }

        for (let value = start; value <= end; value += step) values.add(value);
    }

    return { ok: true, value: { values: [...values].sort((a, b) => a - b), restricted } };
}

/** Parse a whole `m h dom mon dow` expression. */
export function parseCron(expression: string): CronResult<CronSchedule> {
    const fields = expression.trim().split(/\s+/).filter(Boolean);
    if (fields.length !== 5) {
        return {
            ok: false,
            error: `Expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`,
        };
    }

    const parsed: number[][] = [];
    const restrictedFlags: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
        const result = parseField(fields[i]!, FIELDS[i]!);
        if (!result.ok) return result;
        parsed.push(result.value.values);
        restrictedFlags.push(result.value.restricted);
    }

    // 7 and 0 are both Sunday.
    const daysOfWeek = [...new Set(parsed[4]!.map(day => (day === 7 ? 0 : day)))].sort((a, b) => a - b);

    return {
        ok: true,
        value: {
            minutes: parsed[0]!,
            hours: parsed[1]!,
            daysOfMonth: parsed[2]!,
            months: parsed[3]!,
            daysOfWeek,
            dayOfMonthRestricted: restrictedFlags[2]!,
            dayOfWeekRestricted: restrictedFlags[4]!,
        },
    };
}

const pad = (value: number) => String(value).padStart(2, '0');

function joinList(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** True when `values` is exactly `min..max` with a fixed gap bigger than one. */
function asStep(values: number[], min: number, max: number): number | null {
    if (values.length < 2 || values[0] !== min) return null;
    const step = values[1]! - values[0]!;
    if (step < 2) return null;
    for (let i = 1; i < values.length; i += 1) {
        if (values[i]! - values[i - 1]! !== step) return null;
    }
    return values[values.length - 1]! + step > max ? step : null;
}

function isEvery(values: number[], min: number, max: number): boolean {
    return values.length === max - min + 1;
}

function describeNames(values: number[], names: readonly string[], offset: number): string {
    const contiguous = values.every((value, index) => index === 0 || value === values[index - 1]! + 1);
    if (contiguous && values.length > 2) {
        return `${names[values[0]! - offset]} through ${names[values[values.length - 1]! - offset]}`;
    }
    return joinList(values.map(value => names[value - offset]!));
}

/** Plain-English rendering of a parsed schedule. */
export function describeSchedule(schedule: CronSchedule): string {
    const { minutes, hours, daysOfMonth, months, daysOfWeek } = schedule;
    const everyMinute = isEvery(minutes, 0, 59);
    const everyHour = isEvery(hours, 0, 23);

    const parts: string[] = [];

    if (everyMinute && everyHour) {
        parts.push('Every minute');
    } else if (everyHour) {
        const step = asStep(minutes, 0, 59);
        if (step) {
            parts.push(`Every ${step} minutes`);
        } else if (minutes.length === 1) {
            parts.push(`At minute ${minutes[0]} of every hour`);
        } else {
            parts.push(`At minutes ${joinList(minutes.map(String))} of every hour`);
        }
    } else if (everyMinute) {
        parts.push(`Every minute past hour ${joinList(hours.map(String))}`);
    } else if (minutes.length === 1 && hours.length === 1) {
        parts.push(`At ${pad(hours[0]!)}:${pad(minutes[0]!)}`);
    } else {
        parts.push(`At minute ${joinList(minutes.map(String))} past hour ${joinList(hours.map(String))}`);
    }

    if (!isEvery(daysOfMonth, 1, 31)) {
        parts.push(`on day-of-month ${joinList(daysOfMonth.map(String))}`);
    }
    if (!isEvery(months, 1, 12)) {
        parts.push(`in ${describeNames(months, MONTH_NAMES, 1)}`);
    }
    if (!isEvery(daysOfWeek, 0, 6)) {
        parts.push(`on ${describeNames(daysOfWeek, DAY_NAMES, 0)}`);
    }

    return `${parts.join(', ')} (local time)`;
}

/** Parse and describe in one step. */
export function describeCron(expression: string): CronResult<string> {
    const parsed = parseCron(expression);
    if (!parsed.ok) return parsed;
    return { ok: true, value: describeSchedule(parsed.value) };
}

function dayMatches(schedule: CronSchedule, date: Date): boolean {
    const domHit = schedule.daysOfMonth.includes(date.getDate());
    const dowHit = schedule.daysOfWeek.includes(date.getDay());
    // Vixie cron: when both day fields are restricted, either one firing is enough.
    if (schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted) return domHit || dowHit;
    return domHit && dowHit;
}

/** Guard against a schedule that can never fire (e.g. `0 0 31 2 *`). */
const MAX_MINUTE_STEPS = 5 * 366 * 24 * 60;

/**
 * The next `count` run times at or after `nowMs`, in epoch milliseconds.
 *
 * Walks forward in local time, skipping a whole month/day/hour whenever the
 * coarser field cannot match, so an hourly schedule costs a few hundred steps
 * rather than a year of minutes.
 */
export function nextRuns(schedule: CronSchedule, nowMs: number, count: number): number[] {
    const runs: number[] = [];
    const cursor = new Date(nowMs);
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);

    let steps = 0;
    while (runs.length < count && steps < MAX_MINUTE_STEPS) {
        steps += 1;
        if (!schedule.months.includes(cursor.getMonth() + 1)) {
            cursor.setMonth(cursor.getMonth() + 1, 1);
            cursor.setHours(0, 0, 0, 0);
            continue;
        }
        if (!dayMatches(schedule, cursor)) {
            cursor.setDate(cursor.getDate() + 1);
            cursor.setHours(0, 0, 0, 0);
            continue;
        }
        if (!schedule.hours.includes(cursor.getHours())) {
            cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
            continue;
        }
        if (!schedule.minutes.includes(cursor.getMinutes())) {
            cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
            continue;
        }
        runs.push(cursor.getTime());
        cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
    }

    return runs;
}

export interface CronExplanation {
    schedule: CronSchedule;
    description: string;
    /** Local-string renderings of the next runs, newest last. */
    runs: { epochMs: number; local: string; iso: string }[];
}

/** Parse, describe and compute the next runs — what the card renders. */
export function explainCron(expression: string, nowMs: number, count = 5): CronResult<CronExplanation> {
    const parsed = parseCron(expression);
    if (!parsed.ok) return parsed;
    const runs = nextRuns(parsed.value, nowMs, count);
    return {
        ok: true,
        value: {
            schedule: parsed.value,
            description: describeSchedule(parsed.value),
            runs: runs.map(epochMs => {
                const date = new Date(epochMs);
                return { epochMs, local: date.toLocaleString(), iso: date.toISOString() };
            }),
        },
    };
}
