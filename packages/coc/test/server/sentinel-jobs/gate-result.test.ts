import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    canonicalizeJobGateResult as canonicalize,
    MAX_JOB_GATE_RESULT_BYTES,
} from '../../../src/server/sentinel-jobs/job-gate-result';

describe('canonicalizeJobGateResult', () => {
    it.each([null, true, false, 0, -12.5, 'hello', [], {}])('accepts JSON value %j', value => {
        const result = canonicalize(value);
        expect(JSON.parse(result.canonicalJson)).toEqual(value);
        expect(result.hash).toBe(createHash('sha256').update(result.canonicalJson).digest('hex'));
    });

    it('ignores object key order at every level, including objects inside arrays', () => {
        const first = { state: 'open', ci: [{ z: 1, a: { y: false, b: null } }] };
        const second = { ci: [{ a: { b: null, y: false }, z: 1 }], state: 'open' };
        expect(canonicalize(first)).toEqual(canonicalize(second));
        expect(canonicalize(first).canonicalJson).toBe('{"ci":[{"a":{"b":null,"y":false},"z":1}],"state":"open"}');
    });

    it('sorts integer-like and special object keys lexically without losing data', () => {
        const value = JSON.parse('{"2":"two","10":"ten","__proto__":{"z":0,"a":1}}');
        const result = canonicalize(value);
        expect(result.canonicalJson).toBe('{"10":"ten","2":"two","__proto__":{"a":1,"z":0}}');
        expect(JSON.parse(result.canonicalJson)).toEqual(value);
    });

    it('changes the hash for any nested value, added/removed key, type or array order change', () => {
        const baseline = canonicalize({ ci: ['pass', 'fail'], state: null }).hash;
        for (const value of [
            { ci: ['fail', 'pass'], state: null },
            { ci: ['pass', 'fail'], state: 'null' },
            { ci: ['pass', 'fail'] },
            { ci: ['pass', 'fail'], state: null, extra: 0 },
            { ci: ['pass', 'pending'], state: null },
        ]) expect(canonicalize(value).hash).not.toBe(baseline);
    });

    it('accepts exactly 16 KiB and rejects larger canonical JSON', () => {
        const value = 'x'.repeat(MAX_JOB_GATE_RESULT_BYTES - 2);
        expect(Buffer.byteLength(canonicalize(value).canonicalJson)).toBe(MAX_JOB_GATE_RESULT_BYTES);
        expect(() => canonicalize(value + 'x')).toThrow('exceeds');
    });

    it('counts UTF-8 and JSON escaping in the stored size', () => {
        const multibyte = 'é'.repeat((MAX_JOB_GATE_RESULT_BYTES - 2) / 2);
        expect(Buffer.byteLength(canonicalize(multibyte).canonicalJson)).toBe(MAX_JOB_GATE_RESULT_BYTES);
        expect(() => canonicalize(multibyte + 'é')).toThrow('exceeds');
        expect(() => canonicalize('\n'.repeat(MAX_JOB_GATE_RESULT_BYTES / 2))).toThrow('exceeds');
    });

    it.each([undefined, NaN, Infinity, -Infinity, 1n, Symbol('x'), () => 1,
        { missing: undefined }, [undefined], new Array(1), new Date(), new Map(),
    ])('rejects non-JSON value %#', value => {
        expect(() => canonicalize(value)).toThrow();
    });

    it('rejects cycles but accepts shared non-cyclic objects without mutating them', () => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        expect(() => canonicalize(cycle)).toThrow('cycles');
        const shared = Object.freeze({ z: 1, a: 2 });
        expect(canonicalize([shared, shared]).canonicalJson).toBe('[{"a":2,"z":1},{"a":2,"z":1}]');
        expect(Object.keys(shared)).toEqual(['z', 'a']);
    });

    it('accepts objects with a null prototype', () => {
        expect(canonicalize(Object.assign(Object.create(null), { z: 1, a: 2 })).canonicalJson).toBe('{"a":2,"z":1}');
    });

    it('rejects accessors and toJSON methods without invoking them', () => {
        let invoked = false;
        const accessor = { get result() { invoked = true; return 1; } };
        const customJson = { toJSON() { invoked = true; return 'hidden'; } };
        expect(() => canonicalize(accessor)).toThrow('accessors');
        expect(() => canonicalize(customJson)).toThrow('JSON values');
        expect(invoked).toBe(false);
    });

    it('rejects symbol keys rather than silently discarding them', () => {
        expect(() => canonicalize({ [Symbol('hidden')]: true })).toThrow('symbol keys');
    });
});
