/**
 * Byte-size conversion between raw bytes and both unit families: decimal
 * (KB = 1000 bytes) and binary (KiB = 1024 bytes). Both are always produced so
 * the card can show them side by side.
 *
 * React-free; parsing returns a result rather than throwing.
 */

export type ByteSizeResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ByteSizeRow {
    unit: string;
    /** Bytes per one of this unit. */
    factor: number;
    /** The input expressed in this unit, already rounded for display. */
    text: string;
}

export interface ByteSizeView {
    bytes: number;
    decimal: ByteSizeRow[];
    binary: ByteSizeRow[];
    /** The single most readable decimal rendering, e.g. `1.5 MB`. */
    humanDecimal: string;
    /** The same, in binary units, e.g. `1.43 MiB`. */
    humanBinary: string;
}

const DECIMAL_UNITS: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
const BINARY_UNITS: readonly string[] = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/** Every unit name the parser accepts, mapped to its size in bytes. */
export const UNIT_FACTORS: Readonly<Record<string, number>> = (() => {
    const table: Record<string, number> = {};
    DECIMAL_UNITS.forEach((unit, i) => {
        table[unit.toLowerCase()] = 1000 ** i;
    });
    BINARY_UNITS.forEach((unit, i) => {
        table[unit.toLowerCase()] = 1024 ** i;
    });
    // `1k` / `1m` read as the decimal units they abbreviate.
    table.k = 1000;
    table.m = 1000 ** 2;
    table.g = 1000 ** 3;
    table.t = 1000 ** 4;
    table.p = 1000 ** 5;
    table.byte = 1;
    table.bytes = 1;
    return table;
})();

/** Trim trailing zeros so 1.50 shows as 1.5 and 2.00 as 2. */
function trimNumber(value: number, digits = 3): string {
    if (!Number.isFinite(value)) return String(value);
    const fixed = value.toFixed(digits);
    return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

function rowsFor(bytes: number, units: readonly string[], base: number): ByteSizeRow[] {
    return units.map((unit, i) => {
        const factor = base ** i;
        return { unit, factor, text: trimNumber(bytes / factor) };
    });
}

function humanize(bytes: number, units: readonly string[], base: number): string {
    const abs = Math.abs(bytes);
    let exponent = 0;
    while (abs >= base ** (exponent + 1) && exponent < units.length - 1) exponent += 1;
    return `${trimNumber(bytes / base ** exponent, exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

/** Expand a byte count into both unit families. */
export function describeBytes(bytes: number): ByteSizeResult<ByteSizeView> {
    if (!Number.isFinite(bytes)) return { ok: false, error: 'Enter a number of bytes' };
    return {
        ok: true,
        value: {
            bytes,
            decimal: rowsFor(bytes, DECIMAL_UNITS, 1000),
            binary: rowsFor(bytes, BINARY_UNITS, 1024),
            humanDecimal: humanize(bytes, DECIMAL_UNITS, 1000),
            humanBinary: humanize(bytes, BINARY_UNITS, 1024),
        },
    };
}

/**
 * Parse `"1.5 MiB"`, `"2GB"` or a bare number (read as bytes) into a byte
 * count.
 */
export function parseByteSize(text: string): ByteSizeResult<number> {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: 'Enter a size' };

    const match = /^([+-]?\d+(?:[._]\d+)?)\s*([a-zA-Z]*)$/.exec(trimmed.replace(/,/g, ''));
    if (!match) return { ok: false, error: 'Expected a number optionally followed by a unit' };

    const amount = Number(match[1]!.replace('_', '.'));
    if (!Number.isFinite(amount)) return { ok: false, error: 'Expected a number optionally followed by a unit' };

    const unit = match[2] ?? '';
    if (!unit) return { ok: true, value: amount };

    const factor = UNIT_FACTORS[unit.toLowerCase()];
    if (factor === undefined) return { ok: false, error: `Unknown unit "${unit}"` };
    return { ok: true, value: amount * factor };
}

/** Parse then describe, for the card's single-input flow. */
export function convertByteSize(text: string): ByteSizeResult<ByteSizeView> {
    const parsed = parseByteSize(text);
    if (!parsed.ok) return parsed;
    return describeBytes(parsed.value);
}
