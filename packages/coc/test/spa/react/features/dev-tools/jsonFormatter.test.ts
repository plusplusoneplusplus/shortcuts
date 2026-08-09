/**
 * JSON formatter / validator — pure logic, no rendering.
 */
import { describe, expect, it } from 'vitest';
import {
    describeJson,
    formatJson,
    minifyJson,
    parseJson,
    positionToLineColumn,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/jsonFormatter';

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    return result.value;
}

describe('positionToLineColumn', () => {
    it('counts from 1 on both axes', () => {
        expect(positionToLineColumn('abc', 0)).toEqual({ line: 1, column: 1 });
        expect(positionToLineColumn('abc', 2)).toEqual({ line: 1, column: 3 });
    });

    it('resets the column on each newline', () => {
        expect(positionToLineColumn('ab\ncd', 3)).toEqual({ line: 2, column: 1 });
        expect(positionToLineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
    });

    it('clamps an offset past the end', () => {
        expect(positionToLineColumn('ab', 99)).toEqual({ line: 1, column: 3 });
    });
});

describe('parseJson', () => {
    it('parses valid JSON', () => {
        expect(unwrap(parseJson('{"a":1}'))).toEqual({ a: 1 });
        expect(unwrap(parseJson('[1,2,3]'))).toEqual([1, 2, 3]);
    });

    it('errors on empty input', () => {
        const empty = parseJson('   ');
        expect(empty.ok === false && empty.error).toContain('Enter some JSON');
    });

    it('locates a syntax error by line and column', () => {
        const bad = parseJson('{\n  "a": 1,\n  "b" 2\n}');
        expect(bad.ok).toBe(false);
        expect(bad.ok === false && bad.error).toMatch(/line \d+/);
    });
});

describe('formatJson', () => {
    it('pretty-prints with the requested indent', () => {
        expect(unwrap(formatJson('{"a":1}', 2))).toBe('{\n  "a": 1\n}');
        expect(unwrap(formatJson('{"a":1}', 4))).toBe('{\n    "a": 1\n}');
    });

    it('collapses to one line at indent 0', () => {
        expect(unwrap(formatJson('{"a":1}', 0))).toBe('{"a":1}');
    });

    it('rejects an out-of-range indent', () => {
        const bad = formatJson('{"a":1}', 99);
        expect(bad.ok === false && bad.error).toContain('Indent must be');
        expect(formatJson('{"a":1}', -1).ok).toBe(false);
    });

    it('propagates the parse error', () => {
        expect(formatJson('{oops}', 2).ok).toBe(false);
    });
});

describe('minifyJson', () => {
    it('strips insignificant whitespace', () => {
        expect(unwrap(minifyJson('{\n  "a": [1, 2]\n}'))).toBe('{"a":[1,2]}');
    });

    it('round-trips through format and back', () => {
        const original = '{"a":[1,2],"b":{"c":"d"}}';
        expect(unwrap(minifyJson(unwrap(formatJson(original, 4))))).toBe(original);
    });

    it('propagates the parse error', () => {
        expect(minifyJson('nope').ok).toBe(false);
    });
});

describe('describeJson', () => {
    it('counts bytes, keys and nesting depth', () => {
        const text = '{"a":{"b":[1,2]}}';
        const stats = describeJson(unwrap(parseJson(text)), text);
        expect(stats.bytes).toBe(text.length);
        expect(stats.keys).toBe(2);
        expect(stats.depth).toBe(3);
    });

    it('measures a scalar as depth zero', () => {
        expect(describeJson(1, '1')).toEqual({ bytes: 1, keys: 0, depth: 0 });
    });

    it('counts UTF-8 bytes rather than characters', () => {
        const text = '{"a":"é"}';
        expect(describeJson(unwrap(parseJson(text)), text).bytes).toBe(text.length + 1);
    });
});
