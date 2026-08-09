/**
 * Arbitrary-base integer conversion, base 2 through 36.
 *
 * React-free and throws nothing outward: every entry point returns
 * `{ ok: true, value } | { ok: false, error }` so the card can render an inline
 * error and keep the last good output on screen. Values are `bigint`, so
 * arbitrarily long inputs convert exactly.
 */

export type BaseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MIN_BASE = 2;
export const MAX_BASE = 36;

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** True when `base` is an integer in the supported 2–36 range. */
export function isValidBase(base: number): boolean {
    return Number.isInteger(base) && base >= MIN_BASE && base <= MAX_BASE;
}

/** Digit value of `ch` in `base`, or -1 when it is not a digit of that base. */
function digitValue(ch: string, base: number): number {
    const index = DIGITS.indexOf(ch.toLowerCase());
    return index >= 0 && index < base ? index : -1;
}

/** Parse `text` as an integer written in `base`. A leading `-` is allowed. */
export function parseInBase(text: string, base: number): BaseResult<bigint> {
    if (!isValidBase(base)) {
        return { ok: false, error: `Base must be an integer between ${MIN_BASE} and ${MAX_BASE}` };
    }
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: 'Enter a value' };

    const negative = trimmed.startsWith('-');
    const body = negative || trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
    if (!body) return { ok: false, error: 'Enter a value' };

    const bigBase = BigInt(base);
    let value = 0n;
    for (const ch of body) {
        if (ch === '_') continue; // digit grouping, as in 1_000
        const digit = digitValue(ch, base);
        if (digit < 0) {
            return { ok: false, error: `"${ch}" is not a valid digit in base ${base}` };
        }
        value = value * bigBase + BigInt(digit);
    }
    return { ok: true, value: negative ? -value : value };
}

/** Render `value` in `base` using lowercase digits. */
export function formatInBase(value: bigint, base: number): BaseResult<string> {
    if (!isValidBase(base)) {
        return { ok: false, error: `Base must be an integer between ${MIN_BASE} and ${MAX_BASE}` };
    }
    return { ok: true, value: value.toString(base) };
}

/** Convert `text` from `fromBase` to `toBase` in one step. */
export function convertBase(text: string, fromBase: number, toBase: number): BaseResult<string> {
    const parsed = parseInBase(text, fromBase);
    if (!parsed.ok) return parsed;
    return formatInBase(parsed.value, toBase);
}

/** The bases the card offers as one-click presets. */
export const COMMON_BASES: readonly number[] = [2, 8, 10, 16, 36];
