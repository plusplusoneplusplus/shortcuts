/**
 * Arbitrary-base conversion — pure logic, no rendering.
 */
import { describe, expect, it } from 'vitest';
import {
    convertBase,
    formatInBase,
    isValidBase,
    parseInBase,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/baseConverter';

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    return result.value;
}

describe('isValidBase', () => {
    it('accepts 2 through 36 and rejects everything else', () => {
        expect(isValidBase(2)).toBe(true);
        expect(isValidBase(36)).toBe(true);
        expect(isValidBase(1)).toBe(false);
        expect(isValidBase(37)).toBe(false);
        expect(isValidBase(10.5)).toBe(false);
        expect(isValidBase(Number.NaN)).toBe(false);
    });
});

describe('parseInBase', () => {
    it('reads digits in the given base', () => {
        expect(unwrap(parseInBase('ff', 16))).toBe(255n);
        expect(unwrap(parseInBase('FF', 16))).toBe(255n);
        expect(unwrap(parseInBase('1010', 2))).toBe(10n);
        expect(unwrap(parseInBase('777', 8))).toBe(511n);
        expect(unwrap(parseInBase('zz', 36))).toBe(1295n);
    });

    it('handles signs and digit grouping', () => {
        expect(unwrap(parseInBase('-255', 10))).toBe(-255n);
        expect(unwrap(parseInBase('+255', 10))).toBe(255n);
        expect(unwrap(parseInBase('1_000', 10))).toBe(1000n);
    });

    it('is exact well beyond Number.MAX_SAFE_INTEGER', () => {
        expect(unwrap(parseInBase('ffffffffffffffff', 16))).toBe(18446744073709551615n);
    });

    it('rejects a digit that does not exist in the base', () => {
        const result = parseInBase('12', 2);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.error).toContain('not a valid digit in base 2');
    });

    it('rejects an out-of-range base and an empty value', () => {
        expect(parseInBase('10', 40).ok).toBe(false);
        expect(parseInBase('   ', 10).ok).toBe(false);
        expect(parseInBase('-', 10).ok).toBe(false);
    });
});

describe('formatInBase / convertBase', () => {
    it('renders in the target base with lowercase digits', () => {
        expect(unwrap(formatInBase(255n, 16))).toBe('ff');
        expect(unwrap(formatInBase(10n, 2))).toBe('1010');
        expect(unwrap(formatInBase(-255n, 16))).toBe('-ff');
    });

    it('round-trips through an arbitrary base pair', () => {
        for (const base of [2, 7, 16, 30, 36]) {
            const encoded = unwrap(convertBase('123456789', 10, base));
            expect(unwrap(convertBase(encoded, base, 10))).toBe('123456789');
        }
    });

    it('propagates the parse error rather than throwing', () => {
        const result = convertBase('xyz', 10, 16);
        expect(result.ok).toBe(false);
    });
});
