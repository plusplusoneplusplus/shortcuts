/**
 * Byte-size conversion — pure logic, no rendering.
 */
import { describe, expect, it } from 'vitest';
import {
    convertByteSize,
    describeBytes,
    parseByteSize,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/byteSize';

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    return result.value;
}

function row(rows: { unit: string; text: string }[], unit: string): string {
    const found = rows.find(r => r.unit === unit);
    if (!found) throw new Error(`no row for ${unit}`);
    return found.text;
}

describe('parseByteSize', () => {
    it('reads a bare number as bytes', () => {
        expect(unwrap(parseByteSize('1536'))).toBe(1536);
        expect(unwrap(parseByteSize('  2048  '))).toBe(2048);
    });

    it('applies decimal and binary unit suffixes', () => {
        expect(unwrap(parseByteSize('1KB'))).toBe(1000);
        expect(unwrap(parseByteSize('1 KiB'))).toBe(1024);
        expect(unwrap(parseByteSize('1.5MB'))).toBe(1_500_000);
        expect(unwrap(parseByteSize('1.5 MiB'))).toBe(1_572_864);
        expect(unwrap(parseByteSize('2gb'))).toBe(2_000_000_000);
        expect(unwrap(parseByteSize('2GiB'))).toBe(2_147_483_648);
    });

    it('errors on an unknown unit and on non-numeric input', () => {
        const unknown = parseByteSize('5 furlongs');
        expect(unknown.ok).toBe(false);
        expect(unknown.ok === false && unknown.error).toContain('Unknown unit');
        expect(parseByteSize('abc').ok).toBe(false);
        expect(parseByteSize('').ok).toBe(false);
    });
});

describe('describeBytes', () => {
    it('separates decimal from binary for the same byte count', () => {
        const view = unwrap(describeBytes(1_000_000));
        expect(row(view.decimal, 'MB')).toBe('1');
        expect(row(view.binary, 'MiB')).toBe('0.954');
        expect(row(view.decimal, 'B')).toBe('1000000');
    });

    it('renders 1536 bytes as 1.54 KB and 1.5 KiB', () => {
        const view = unwrap(describeBytes(1536));
        expect(view.humanDecimal).toBe('1.54 KB');
        expect(view.humanBinary).toBe('1.5 KiB');
    });

    it('leaves a sub-kilobyte count in plain bytes', () => {
        const view = unwrap(describeBytes(512));
        expect(view.humanDecimal).toBe('512 B');
        expect(view.humanBinary).toBe('512 B');
    });

    it('errors on a non-finite byte count', () => {
        expect(describeBytes(Number.NaN).ok).toBe(false);
    });
});

describe('convertByteSize', () => {
    it('parses then describes in one step', () => {
        const view = unwrap(convertByteSize('1 GiB'));
        expect(view.bytes).toBe(1_073_741_824);
        expect(view.humanBinary).toBe('1 GiB');
        expect(view.humanDecimal).toBe('1.07 GB');
    });

    it('propagates the parse error', () => {
        expect(convertByteSize('nope').ok).toBe(false);
    });
});
