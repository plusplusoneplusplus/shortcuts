/**
 * Unit tests for the bit-flag definition parser.
 *
 * One case per convention the card promises to handle, plus the non-fatal
 * paths: comments, duplicate names and a line the parser cannot make sense of.
 * Everything here is pure — no React, no storage.
 */
import { describe, expect, it } from 'vitest';

import {
    decodeValue,
    encodeSelection,
    parseFlagDefinitions,
    selectionFor,
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

// ---------------------------------------------------------------------------
// Decode / encode
// ---------------------------------------------------------------------------

/** A mixed set: single bits, an alias, a `NONE = 0`, and a `_MASK`/`_SHIFT` pair. */
const MIXED = parseFlagDefinitions(`
enum Caps {
    NONE  = 0,
    READ  = 1 << 0,
    WRITE = 1 << 1,
    EXEC  = 1 << 2,
    ALL   = READ | WRITE | EXEC,
    SPEED_MASK  = 0x30,
    SPEED_SHIFT = 4,
};
`).entries;

describe('decodeValue', () => {
    it('names the single bits that are set', () => {
        const decoded = decodeValue(MIXED, 0x5n, 32);
        expect(decoded.flags.map(f => [f.name, f.bit])).toEqual([
            ['READ', 0],
            ['EXEC', 2],
        ]);
        expect(decoded.unknown).toBe(0n);
    });

    it('reports leftover bits nothing accounts for', () => {
        const decoded = decodeValue(MIXED, 0x85n, 32);
        expect(decoded.flags.map(f => f.name)).toEqual(['READ', 'EXEC']);
        expect(decoded.unknown).toBe(0x80n);
        expect(decoded.unknownBits).toEqual([7]);
        expect(decoded.summary).toBe('READ | EXEC | unknown 0x80');
    });

    it('lists an alias only when every one of its bits is present', () => {
        expect(decodeValue(MIXED, 0x7n, 32).aliases.map(a => a.name)).toEqual(['ALL']);
        expect(decodeValue(MIXED, 0x3n, 32).aliases).toEqual([]);
    });

    it('keeps a fully matched alias out of the summary when its bits are already named', () => {
        expect(decodeValue(MIXED, 0x7n, 32).summary).toBe('READ | WRITE | EXEC');
    });

    it('reads a multi-bit field as a shifted-down number', () => {
        const decoded = decodeValue(MIXED, 0x30n, 32);
        expect(decoded.fields).toEqual([{ name: 'SPEED_MASK', mask: 0x30n, value: 3n, shift: 4 }]);
        expect(decoded.unknown).toBe(0n);
        expect(decoded.summary).toBe('SPEED_MASK=3');
    });

    it('falls back to the mask trailing-zero count when there is no _SHIFT', () => {
        const entries = parseFlagDefinitions('enum { SPEED_MASK = 0x30 };').entries;
        expect(decodeValue(entries, 0x20n, 32).fields[0]?.value).toBe(2n);
    });

    it('treats zero as an empty state, not an error', () => {
        const decoded = decodeValue(MIXED, 0n, 32);
        expect(decoded.empty).toBe(true);
        expect(decoded.flags).toEqual([]);
        expect(decoded.aliases).toEqual([]);
        expect(decoded.fields).toEqual([]);
        expect(decoded.summary).toBe('0x0');
    });

    it('never matches a NONE = 0 entry', () => {
        expect(decodeValue(MIXED, 0xffn, 32).flags.map(f => f.name)).not.toContain('NONE');
    });

    it('never reports a _SHIFT partner as a bit', () => {
        // SPEED_SHIFT = 4 shares its value with EXEC; only EXEC may be listed.
        expect(decodeValue(MIXED, 0x4n, 32).flags.map(f => f.name)).toEqual(['EXEC']);
    });

    it('truncates the input to the selected width', () => {
        const decoded = decodeValue(MIXED, 0x1ffn, 8);
        expect(decoded.value).toBe(0xffn);
        // Bits 3, 6 and 7 have no name in this set; bits 4-5 are the mask.
        expect(decoded.unknown).toBe(0xc8n);
    });
});

describe('encodeSelection', () => {
    it('ORs the ticked flags together', () => {
        expect(encodeSelection(MIXED, { selected: ['READ', 'EXEC'] }, 32)).toBe(0x5n);
    });

    it('sets every constituent bit when an alias is ticked', () => {
        expect(encodeSelection(MIXED, { selected: ['ALL'] }, 32)).toBe(0x7n);
    });

    it('shifts a sub-field up into its mask and clamps it there', () => {
        expect(encodeSelection(MIXED, { selected: [], fields: { SPEED_MASK: 3n } }, 32)).toBe(0x30n);
        expect(encodeSelection(MIXED, { selected: [], fields: { SPEED_MASK: 0xffn } }, 32)).toBe(0x30n);
    });

    it('ignores names the current set does not have', () => {
        expect(encodeSelection(MIXED, { selected: ['READ', 'GONE'] }, 32)).toBe(0x1n);
    });

    it('truncates to the selected width', () => {
        const entries = parseFlagDefinitions('enum { HIGH = 1 << 9 };').entries;
        expect(encodeSelection(entries, { selected: ['HIGH'] }, 8)).toBe(0n);
    });

    it('round-trips a mixed selection through decode', () => {
        const selection = { selected: ['READ', 'EXEC', 'ALL'], fields: { SPEED_MASK: 2n } };
        const value = encodeSelection(MIXED, selection, 32);
        const back = selectionFor(MIXED, value, 32);
        expect(new Set(back.selected)).toEqual(new Set(['READ', 'WRITE', 'EXEC', 'ALL']));
        expect(back.fields?.SPEED_MASK).toBe(2n);
        expect(encodeSelection(MIXED, back, 32)).toBe(value);
    });
});

describe('selectionFor', () => {
    it('ticks every flag a typed number covers', () => {
        const selection = selectionFor(MIXED, 0xffn, 32);
        expect(new Set(selection.selected)).toEqual(new Set(['READ', 'WRITE', 'EXEC', 'ALL']));
    });

    it('reports a zeroed sub-field as 0 rather than dropping it', () => {
        expect(selectionFor(MIXED, 0x1n, 32).fields?.SPEED_MASK).toBe(0n);
    });
});
