/**
 * Epoch ↔ ISO 8601 ↔ local-string conversion.
 *
 * Every entry point that needs "now" takes it as an explicit `nowMs` argument —
 * there is no bare `Date.now()` in here, so tests are deterministic.
 */

export type TimestampResult =
    | { ok: true; value: TimestampView }
    | { ok: false; error: string };

export type EpochUnit = 'seconds' | 'milliseconds';

export interface TimestampView {
    /** The instant, in epoch milliseconds. */
    epochMs: number;
    /** Epoch seconds, truncated toward zero. */
    epochSeconds: number;
    /** Which unit a bare number was read as (`'milliseconds'` for ISO input). */
    detectedUnit: EpochUnit;
    /** `2024-01-01T00:00:00.000Z`. */
    iso: string;
    /** Host-locale rendering, e.g. `1/1/2024, 12:00:00 AM`. */
    local: string;
    /** `in 3 hours` / `2 days ago`, relative to the injected clock. */
    relative: string;
}

/**
 * A bare epoch number is seconds or milliseconds depending on magnitude.
 * 1e11 seconds is the year 5138 and 1e11 ms is 1973, so the boundary separates
 * every timestamp anyone will paste in practice.
 */
const MS_THRESHOLD = 1e11;

export function detectEpochUnit(value: number): EpochUnit {
    return Math.abs(value) >= MS_THRESHOLD ? 'milliseconds' : 'seconds';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Human-readable offset between two instants, e.g. `3 minutes ago`. */
export function formatRelative(epochMs: number, nowMs: number): string {
    const delta = epochMs - nowMs;
    const abs = Math.abs(delta);
    const say = (n: number, unit: string) => {
        const rounded = Math.round(n);
        const label = `${rounded} ${unit}${rounded === 1 ? '' : 's'}`;
        return delta >= 0 ? `in ${label}` : `${label} ago`;
    };
    if (abs < 1000) return 'now';
    if (abs < MINUTE) return say(abs / 1000, 'second');
    if (abs < HOUR) return say(abs / MINUTE, 'minute');
    if (abs < DAY) return say(abs / HOUR, 'hour');
    return say(abs / DAY, 'day');
}

function viewFor(epochMs: number, detectedUnit: EpochUnit, nowMs: number): TimestampResult {
    const date = new Date(epochMs);
    if (Number.isNaN(date.getTime())) {
        return { ok: false, error: 'Timestamp is out of range' };
    }
    return {
        ok: true,
        value: {
            epochMs,
            epochSeconds: Math.trunc(epochMs / 1000),
            detectedUnit,
            iso: date.toISOString(),
            local: date.toLocaleString(),
            relative: formatRelative(epochMs, nowMs),
        },
    };
}

/** Build a view from an explicit epoch value in a known unit. */
export function fromEpoch(value: number, unit: EpochUnit, nowMs: number): TimestampResult {
    if (!Number.isFinite(value)) return { ok: false, error: 'Enter a number' };
    return viewFor(unit === 'seconds' ? value * 1000 : value, unit, nowMs);
}

/**
 * Parse whatever the user pasted: a bare epoch number (unit auto-detected) or
 * anything `Date` understands, ISO 8601 included.
 */
export function parseTimestamp(text: string, nowMs: number): TimestampResult {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: 'Enter a timestamp' };

    if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
        const numeric = Number(trimmed);
        const unit = detectEpochUnit(numeric);
        return fromEpoch(numeric, unit, nowMs);
    }

    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
        return { ok: false, error: 'Not an epoch number or a recognisable date string' };
    }
    return viewFor(parsed, 'milliseconds', nowMs);
}
