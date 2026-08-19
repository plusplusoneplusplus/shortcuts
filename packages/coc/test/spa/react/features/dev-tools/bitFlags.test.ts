/**
 * Unit tests for the bit-flag definition parser.
 *
 * One case per convention the card promises to handle, plus the non-fatal
 * paths: comments, duplicate names and a line the parser cannot make sense of.
 * Everything here is pure — no React, no storage.
 */
import { describe, expect, it } from 'vitest';

import {
    parseFlagDefinitions,
    type FlagEntry,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/bitFlags';

/** The parsed entry for `name`, or a readable failure. */
function entry(source: string, name: string): FlagEntry {
    const found = parseFlagDefinitions(source).entries.find(e => e.name === name);
    if (!found) throw new Error(`no entry named ${name}`);
    return found;
}

/** `{ NAME: value }` for compact whole-paste assertions. */
function valuesOf(source: string): Record<string, bigint> {
    const out: Record<string, bigint> = {};
    for (const e of parseFlagDefinitions(source).entries) out[e.name] = e.value;
    return out;
}

describe('parseFlagDefinitions — shift form', () => {
    const SOURCE = 'enum { A = 1 << 0, B = 1u << 3, C = 1ULL << 40 };';

    it('parses shifts with and without integer suffixes', () => {
        expect(valuesOf(SOURCE)).toEqual({ A: 1n, B: 8n, C: 1n << 40n });
    });

    it('tags every single-bit value as a flag and records its bit index', () => {
        expect(entry(SOURCE, 'A')).toMatchObject({ kind: 'flag', bit: 0 });
        expect(entry(SOURCE, 'B')).toMatchObject({ kind: 'flag', bit: 3 });
        expect(entry(SOURCE, 'C')).toMatchObject({ kind: 'flag', bit: 40 });
    });
});

describe('parseFlagDefinitions — literal form', () => {
    it('parses hex, decimal, octal, binary, separators and suffixes', () => {
        const source = [
            'enum Literals {',
            '    A = 0x0001,',
            '    B = 64,',
            '    C = 0400,',
            '    D = 0b1000000000,',
            "    E = 1'048'576,",
            '    F = 0x8000UL',
            '};',
        ].join('\n');
        expect(valuesOf(source)).toEqual({
            A: 1n,
            B: 64n,
            C: 256n,
            D: 512n,
            E: 1_048_576n,
            F: 0x8000n,
        });
    });

    it('uses the enum name as the default set name', () => {
        expect(parseFlagDefinitions('enum class Perms : uint32_t { R = 1 };').name).toBe('Perms');
        expect(parseFlagDefinitions('enum Plain { R = 1 };').name).toBe('Plain');
        expect(parseFlagDefinitions('enum { R = 1 };').name).toBeNull();
    });
});

describe('parseFlagDefinitions — #define form', () => {
    it('parses bare #define lines with no enum wrapper', () => {
        const source = ['#define FOO_A 0x01', '#define FOO_B 0x02', '#define FOO_ALL (FOO_A | FOO_B)'].join('\n');
        expect(valuesOf(source)).toEqual({ FOO_A: 1n, FOO_B: 2n, FOO_ALL: 3n });
        expect(entry(source, 'FOO_ALL').kind).toBe('alias');
    });
});

describe('parseFlagDefinitions — composites and aliases', () => {
    it('tags any non-single-bit value as an alias, never as a bit', () => {
        const source = 'enum { A = 1, B = 2, C = 4, ALL = A | B | C, NONE = 0 };';
        const parsed = parseFlagDefinitions(source);
        expect(parsed.entries.map(e => [e.name, e.kind])).toEqual([
            ['A', 'flag'],
            ['B', 'flag'],
            ['C', 'flag'],
            ['ALL', 'alias'],
            ['NONE', 'zero'],
        ]);
        expect(entry(source, 'ALL')).toMatchObject({ value: 7n, bit: null });
    });
});

describe('parseFlagDefinitions — multi-bit fields', () => {
    const SOURCE = [
        'enum Fields {',
        '    FLAG_X = 1 << 0,',
        '    SPEED_SHIFT = 4,',
        '    SPEED_MASK = 0x30,',
        '    COLOR_MASK = 0x0700',
        '};',
    ].join('\n');

    it('pairs a _MASK with its _SHIFT', () => {
        expect(entry(SOURCE, 'SPEED_MASK')).toMatchObject({ kind: 'mask', value: 0x30n, shift: 4 });
    });

    it('falls back to the mask trailing-zero count when there is no _SHIFT', () => {
        expect(entry(SOURCE, 'COLOR_MASK')).toMatchObject({ kind: 'mask', shift: 8 });
    });

    it('does not report a _SHIFT partner as a flag', () => {
        expect(entry(SOURCE, 'SPEED_SHIFT')).toMatchObject({ kind: 'shift', bit: null });
        expect(entry(SOURCE, 'FLAG_X').kind).toBe('flag');
    });
});

describe('parseFlagDefinitions — symbolic references', () => {
    it('resolves names defined earlier in the same paste', () => {
        const source = 'enum { A = 1 << 0, B = A | 0x2, C = PREVIOUS, PREVIOUS = 0x40 };';
        // `C` refers to a name defined *after* it, which C++ would reject too.
        const parsed = parseFlagDefinitions(source);
        expect(valuesOf(source)).toEqual({ A: 1n, B: 3n, PREVIOUS: 0x40n });
        expect(parsed.skipped).toHaveLength(1);
        expect(parsed.skipped[0]!.reason).toContain('unknown name "PREVIOUS"');
    });

    it('copies an earlier name outright', () => {
        expect(valuesOf('enum { A = 0x10, B = A };')).toEqual({ A: 0x10n, B: 0x10n });
    });
});

describe('parseFlagDefinitions — comments and noise', () => {
    it('skips line and block comments without losing line numbers', () => {
        const source = [
            '// leading note',
            'enum Flags {',
            '    A = 1 << 0, /* first */',
            '    /* B is reserved',
            '       and spans lines */',
            '    C = 1 << 2 // last',
            '};',
        ].join('\n');
        const parsed = parseFlagDefinitions(source);
        expect(valuesOf(source)).toEqual({ A: 1n, C: 4n });
        expect(parsed.skipped).toEqual([]);
        expect(parsed.parsedLines).toBe(2);
    });

    it('ignores preprocessor noise it does not understand', () => {
        const source = ['#ifndef FOO_H', '#define FOO_H', '#define FOO_A 0x01', '#endif'].join('\n');
        expect(valuesOf(source)).toEqual({ FOO_A: 1n });
        expect(parseFlagDefinitions(source).skipped).toEqual([]);
    });
});

describe('parseFlagDefinitions — duplicate names', () => {
    it('keeps the last definition and warns', () => {
        const source = 'enum { A = 1, B = 2, A = 0x40 };';
        const parsed = parseFlagDefinitions(source);
        expect(valuesOf(source)).toEqual({ B: 2n, A: 0x40n });
        expect(parsed.entries.map(e => e.name)).toEqual(['B', 'A']);
        expect(parsed.warnings).toContain('"A" is defined more than once — keeping the last definition');
    });
});

describe('parseFlagDefinitions — unparsable lines', () => {
    it('reports them per line instead of failing the whole paste', () => {
        const source = ['#define FOO_A 0x01', '??? not code ???', '#define FOO_B 0x02'].join('\n');
        const parsed = parseFlagDefinitions(source);
        expect(valuesOf(source)).toEqual({ FOO_A: 1n, FOO_B: 2n });
        expect(parsed.parsedLines).toBe(2);
        expect(parsed.totalLines).toBe(3);
        expect(parsed.skipped).toEqual([{ line: 2, text: '??? not code ???', reason: 'not a flag definition' }]);
    });

    it('never throws on empty or junk input', () => {
        expect(parseFlagDefinitions('').entries).toEqual([]);
        expect(parseFlagDefinitions('   \n\n').entries).toEqual([]);
        expect(parseFlagDefinitions('enum { A = 1 / 0 };').skipped[0]!.reason).toBe('Divide by zero');
    });
});

describe('parseFlagDefinitions — sequential enums', () => {
    it('warns when the enumerators auto-increment', () => {
        const parsed = parseFlagDefinitions('enum Colour { RED, GREEN, BLUE };');
        expect(valuesOf('enum Colour { RED, GREEN, BLUE };')).toEqual({ RED: 0n, GREEN: 1n, BLUE: 2n });
        expect(parsed.sequential).toBe(true);
        expect(parsed.warnings).toContain('this looks like a sequential enum, not a bit flag enum');
    });

    it('warns when explicit values form a run', () => {
        expect(parseFlagDefinitions('enum { A = 1, B = 2, C = 3 };').sequential).toBe(true);
    });

    it('stays quiet for a real flag enum', () => {
        const parsed = parseFlagDefinitions('enum { A = 1, B = 2, C = 4, D = 8 };');
        expect(parsed.sequential).toBe(false);
        expect(parsed.warnings).toEqual([]);
    });
});
