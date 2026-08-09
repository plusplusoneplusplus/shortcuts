/**
 * Programmer-calculator pure logic: the expression evaluator, width/sign
 * handling, formatting and the bit-grid helpers.
 */
import { describe, expect, it } from 'vitest';

import {
    bitsOf,
    evaluate,
    formatBinaryGrouped,
    formatValue,
    maskFor,
    toHexLiteral,
    toSigned,
    toggleBit,
    truncate,
    type CalcWidth,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/calculator';

const u32 = { width: 32 as CalcWidth, signed: false };
const s32 = { width: 32 as CalcWidth, signed: true };

function value(expr: string, opts = u32): bigint {
    const result = evaluate(expr, opts);
    if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
    return result.value;
}

function error(expr: string, opts = u32): string {
    const result = evaluate(expr, opts);
    if (result.ok) throw new Error(`expected failure, got: ${result.value}`);
    return result.error;
}

describe('evaluate — literals', () => {
    it('reads decimal, hex, binary and octal literals', () => {
        expect(value('255')).toBe(255n);
        expect(value('0xFF')).toBe(255n);
        expect(value('0xff')).toBe(255n);
        expect(value('0b1010')).toBe(10n);
        expect(value('0o777')).toBe(511n);
    });

    it('rejects a literal that does not fit the selected width', () => {
        expect(error('0x1FF', { width: 8, signed: false })).toContain('does not fit in 8 bits');
        expect(value('0xFF', { width: 8, signed: false })).toBe(255n);
    });

    it('rejects a malformed literal', () => {
        expect(error('0x')).toContain('Malformed literal');
        expect(error('0b2')).toContain('Malformed literal');
    });
});

describe('evaluate — operators', () => {
    it('handles each arithmetic operator', () => {
        expect(value('2 + 3')).toBe(5n);
        expect(value('10 - 4')).toBe(6n);
        expect(value('6 * 7')).toBe(42n);
        expect(value('20 / 6')).toBe(3n);
        expect(value('20 % 6')).toBe(2n);
    });

    it('handles each bitwise operator', () => {
        expect(value('0b1100 & 0b1010')).toBe(0b1000n);
        expect(value('0b1100 | 0b1010')).toBe(0b1110n);
        expect(value('0b1100 ^ 0b1010')).toBe(0b0110n);
        expect(value('~0')).toBe(0xffffffffn);
        expect(value('0xFF << 4')).toBe(0xff0n);
        expect(value('0xFF0 >> 4')).toBe(0xffn);
    });

    it('applies C precedence and parentheses', () => {
        expect(value('2 + 3 * 4')).toBe(14n);
        expect(value('(2 + 3) * 4')).toBe(20n);
        // `|` binds weaker than `^`, which binds weaker than `&`, which binds
        // weaker than the shifts.
        expect(value('1 | 2 ^ 3 & 1')).toBe(3n);
        expect(value('1 << 2 + 1')).toBe(8n);
        expect(value('(1 << 2) + 1')).toBe(5n);
    });

    it('handles unary minus, plus and complement', () => {
        expect(value('-1')).toBe(0xffffffffn);
        expect(value('+5')).toBe(5n);
        expect(value('~0xFF')).toBe(0xffffff00n);
        expect(value('- (2 + 3)')).toBe(0xfffffffbn);
        expect(value('3 * -2')).toBe(0xfffffffan);
    });
});

describe('evaluate — width and signedness', () => {
    it('wraps results at every supported width', () => {
        expect(value('0xFF << 4', { width: 8, signed: false })).toBe(0xf0n);
        expect(value('0xFF << 4', { width: 16, signed: false })).toBe(0xff0n);
        expect(value('0xFF << 4', { width: 32, signed: false })).toBe(0xff0n);
        expect(value('0xFF << 4', { width: 64, signed: false })).toBe(0xff0n);
    });

    it('wraps around on overflow', () => {
        expect(value('255 + 1', { width: 8, signed: false })).toBe(0n);
        expect(value('0 - 1', { width: 8, signed: false })).toBe(0xffn);
        expect(value('0xFFFF * 2', { width: 16, signed: false })).toBe(0xfffen);
    });

    it('shifts right logically when unsigned and arithmetically when signed', () => {
        expect(value('-8 >> 1', u32)).toBe(0x7ffffffcn);
        expect(value('-8 >> 1', s32)).toBe(0xfffffffcn);
        expect(toSigned(value('-8 >> 1', s32), 32)).toBe(-4n);
    });

    it('divides and takes the remainder with the operand signedness', () => {
        expect(value('-9 / 2', u32)).toBe(0x7ffffffbn);
        expect(toSigned(value('-9 / 2', s32), 32)).toBe(-4n);
        expect(toSigned(value('-9 % 2', s32), 32)).toBe(-1n);
    });

    it('keeps 64-bit values above Number.MAX_SAFE_INTEGER exact', () => {
        const w64 = { width: 64 as CalcWidth, signed: false };
        expect(value('1 << 63', w64)).toBe(9223372036854775808n);
        expect(value('~0', w64)).toBe(18446744073709551615n);
        expect(value('0xFFFFFFFFFFFFFFFF - 1', w64)).toBe(18446744073709551614n);
        expect(BigInt(Number.MAX_SAFE_INTEGER) < value('~0', w64)).toBe(true);
        expect(toSigned(value('~0', w64), 64)).toBe(-1n);
    });
});

describe('evaluate — errors', () => {
    it('reports division and modulo by zero', () => {
        expect(error('1 / 0')).toBe('Divide by zero');
        expect(error('1 % 0')).toBe('Modulo by zero');
        expect(error('1 / (2 - 2)')).toBe('Divide by zero');
    });

    it('reports malformed expressions', () => {
        expect(error('')).toBe('Empty expression');
        expect(error('   ')).toBe('Empty expression');
        expect(error('1 +')).toBe('Unexpected end of expression');
        expect(error('(1 + 2')).toBe('Missing ")"');
        expect(error('1 2')).toContain('Unexpected token');
        expect(error('1 $ 2')).toContain('Unexpected character');
        expect(error('1 < 2')).toContain('Unexpected character');
        expect(error(') 1')).toContain('Unexpected token');
    });

    it('rejects a negative shift count instead of throwing', () => {
        expect(error('1 << -1')).toBe('Negative shift count');
    });
});

describe('width helpers', () => {
    it('masks and truncates', () => {
        expect(maskFor(8)).toBe(0xffn);
        expect(maskFor(64)).toBe(0xffffffffffffffffn);
        expect(truncate(0x1ffn, 8)).toBe(0xffn);
        expect(truncate(-1n, 16)).toBe(0xffffn);
    });

    it('reinterprets the bit pattern as signed', () => {
        expect(toSigned(0xffn, 8)).toBe(-1n);
        expect(toSigned(0x80n, 8)).toBe(-128n);
        expect(toSigned(0x7fn, 8)).toBe(127n);
    });
});

describe('bit grid helpers', () => {
    it('lists bits LSB first', () => {
        const bits = bitsOf(0b1010n, 8);
        expect(bits.length).toBe(8);
        expect(bits.slice(0, 4)).toEqual([false, true, false, true]);
        expect(bits.slice(4)).toEqual([false, false, false, false]);
    });

    it('toggles a single bit in both directions', () => {
        expect(toggleBit(0xf0n, 8, 0)).toBe(0xf1n);
        expect(toggleBit(0xf1n, 8, 0)).toBe(0xf0n);
        expect(toggleBit(0n, 8, 7)).toBe(0x80n);
    });

    it('wraps the toggled value to the width and ignores out-of-range indexes', () => {
        expect(toggleBit(0x1ffn, 8, 1)).toBe(0xfdn);
        expect(toggleBit(0xf0n, 8, 8)).toBe(0xf0n);
        expect(toggleBit(0xf0n, 8, -1)).toBe(0xf0n);
    });

    it('toggling the top bit of a 64-bit value stays exact', () => {
        expect(toggleBit(0n, 64, 63)).toBe(9223372036854775808n);
    });
});

describe('formatting', () => {
    it('renders each readout base', () => {
        expect(formatValue(255n, 32, false, 'dec')).toBe('255');
        expect(formatValue(255n, 32, false, 'hex')).toBe('FF');
        expect(formatValue(255n, 32, false, 'oct')).toBe('377');
        expect(formatValue(255n, 8, false, 'bin')).toBe('11111111');
    });

    it('shows the two’s-complement decimal in signed mode', () => {
        expect(formatValue(0xffn, 8, true, 'dec')).toBe('-1');
        expect(formatValue(0xffn, 8, false, 'dec')).toBe('255');
        expect(formatValue(0xffn, 8, true, 'hex')).toBe('FF');
    });

    it('groups the binary readout in nibbles and builds a hex literal', () => {
        expect(formatBinaryGrouped(0xf1n, 8)).toBe('1111 0001');
        expect(toHexLiteral(0xf1n, 8)).toBe('0xF1');
        expect(toHexLiteral(0x1f1n, 8)).toBe('0xF1');
    });
});
