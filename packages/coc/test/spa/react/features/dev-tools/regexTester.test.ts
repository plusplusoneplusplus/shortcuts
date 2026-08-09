/**
 * Regex tester — pure logic, no rendering.
 */
import { describe, expect, it } from 'vitest';
import {
    compileRegex,
    runRegex,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/regexTester';

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    return result.value;
}

describe('compileRegex', () => {
    it('compiles a valid pattern with flags', () => {
        const regex = unwrap(compileRegex('a+', 'gi'));
        expect(regex.source).toBe('a+');
        expect(regex.flags).toBe('gi');
    });

    it('errors on an unbalanced group and on an empty pattern', () => {
        expect(compileRegex('(', 'g').ok).toBe(false);
        const empty = compileRegex('', 'g');
        expect(empty.ok === false && empty.error).toContain('Enter a pattern');
    });

    it('errors on an invalid flag', () => {
        expect(compileRegex('a', 'q').ok).toBe(false);
    });
});

describe('runRegex', () => {
    it('finds every match and its capture groups', () => {
        const run = unwrap(runRegex('(\\w+)@(\\w+)\\.com', 'g', 'mail ada@example.com or grace@test.com'));
        expect(run.matches.length).toBe(2);
        expect(run.matches[0]!.text).toBe('ada@example.com');
        expect(run.matches[0]!.start).toBe(5);
        expect(run.matches[0]!.captures.map(c => c.text)).toEqual(['ada', 'example']);
        expect(run.matches[1]!.captures.map(c => c.text)).toEqual(['grace', 'test']);
    });

    it('finds all matches even when the user leaves off the g flag', () => {
        expect(unwrap(runRegex('a', '', 'banana')).matches.length).toBe(3);
    });

    it('honours the ignore-case flag', () => {
        expect(unwrap(runRegex('abc', '', 'ABC abc')).matches.length).toBe(1);
        expect(unwrap(runRegex('abc', 'i', 'ABC abc')).matches.length).toBe(2);
    });

    it('splits the subject into highlightable segments', () => {
        const run = unwrap(runRegex('an', 'g', 'banana'));
        expect(run.segments).toEqual([
            { text: 'b', match: false },
            { text: 'an', match: true },
            { text: 'an', match: true },
            { text: 'a', match: false },
        ]);
        expect(run.segments.map(s => s.text).join('')).toBe('banana');
    });

    it('terminates on a zero-length match instead of looping forever', () => {
        const run = unwrap(runRegex('a*', 'g', 'aab'));
        expect(run.matches.length).toBeGreaterThan(0);
        expect(run.matches[0]!.text).toBe('aa');
        // Zero-length matches contribute nothing to the highlight.
        expect(run.segments.map(s => s.text).join('')).toBe('aab');
    });

    it('reports an unmatched subject as zero matches with one plain segment', () => {
        const run = unwrap(runRegex('zzz', 'g', 'banana'));
        expect(run.matches.length).toBe(0);
        expect(run.segments).toEqual([{ text: 'banana', match: false }]);
    });

    it('exposes named groups separately from numbered ones', () => {
        const run = unwrap(runRegex('(?<year>\\d{4})-(?<month>\\d{2})', 'g', '2026-08'));
        expect(run.matches[0]!.named).toEqual({ year: '2026', month: '08' });
        expect(run.matches[0]!.captures.map(c => c.text)).toEqual(['2026', '08']);
    });

    it('leaves a non-participating group undefined', () => {
        const run = unwrap(runRegex('(a)|(b)', 'g', 'b'));
        expect(run.matches[0]!.captures.map(c => c.text)).toEqual([undefined, 'b']);
    });

    it('surfaces an invalid pattern as an error', () => {
        const bad = runRegex('(unclosed', 'g', 'text');
        expect(bad.ok).toBe(false);
    });
});
