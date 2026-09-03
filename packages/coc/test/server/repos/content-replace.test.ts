/**
 * Tests for the pure replace engine behind POST /api/repos/:id/search/replace.
 *
 * Everything here runs without a filesystem: the engine's whole job is to turn
 * "the spans the client is looking at" into new file text, or into a reason not
 * to write the file at all.
 */

import { describe, it, expect } from 'vitest';
import {
    applyPreserveCase,
    applyReplacements,
    buildReplaceMatcher,
    expandReplacement,
    type ContentReplaceTarget,
} from '../../../src/server/repos/content-replace';

/** Build a target from a line's text by locating `needle` in it. */
function targetFor(line: number, text: string, needle: string, from = 0): ContentReplaceTarget {
    const startColumn = text.indexOf(needle, from);
    if (startColumn < 0) throw new Error(`"${needle}" not in "${text}"`);
    return { line, text, startColumn, endColumn: startColumn + needle.length };
}

describe('buildReplaceMatcher', () => {
    it('treats a literal query literally, so regex metacharacters match themselves', () => {
        const matcher = buildReplaceMatcher('a.c');
        expect('abc'.match(matcher)).toBeNull();
        expect('a.c'.match(matcher)).not.toBeNull();
    });

    it('honours regex, caseSensitive and wholeWord the way the search does', () => {
        expect('a1c'.match(buildReplaceMatcher('a\\dc', { regex: true }))).not.toBeNull();
        expect('NEEDLE'.match(buildReplaceMatcher('needle'))).not.toBeNull();
        expect('NEEDLE'.match(buildReplaceMatcher('needle', { caseSensitive: true }))).toBeNull();
        expect('needles'.match(buildReplaceMatcher('needle', { wholeWord: true }))).toBeNull();
        expect('a needle here'.match(buildReplaceMatcher('needle', { wholeWord: true }))).not.toBeNull();
    });

    it('is always global, because one line can hold several matches', () => {
        expect(buildReplaceMatcher('x').flags).toContain('g');
    });

    it('rejects an empty query, a multi-line query and a bad pattern as InvalidArg', () => {
        for (const bad of [
            () => buildReplaceMatcher(''),
            () => buildReplaceMatcher('a\nb'),
            () => buildReplaceMatcher('(unclosed', { regex: true }),
        ]) {
            let thrown: unknown;
            try {
                bad();
            } catch (err) {
                thrown = err;
            }
            expect((thrown as { code?: string }).code).toBe('InvalidArg');
        }
    });
});

describe('applyPreserveCase', () => {
    it('carries the matched text\'s casing over to the replacement', () => {
        expect(applyPreserveCase('FOO', 'bar')).toBe('BAR');
        expect(applyPreserveCase('foo', 'BAR')).toBe('bar');
        expect(applyPreserveCase('Foo', 'bar')).toBe('Bar');
    });

    it('leaves mixed casing alone rather than guessing at camelCase', () => {
        expect(applyPreserveCase('fooBar', 'baz qux')).toBe('baz qux');
    });

    it('leaves the replacement untouched when the match has no letters', () => {
        expect(applyPreserveCase('123', 'Bar')).toBe('Bar');
    });
});

describe('expandReplacement', () => {
    const match = /(\w+)@(\w+)/.exec('user@host') as RegExpExecArray;

    it('expands $1, $& and $$ in regex mode', () => {
        expect(expandReplacement('$2/$1', match, true)).toBe('host/user');
        expect(expandReplacement('[$&]', match, true)).toBe('[user@host]');
        expect(expandReplacement('$$1', match, true)).toBe('$1');
    });

    it('leaves an unmatched group number as written, like String.replace does', () => {
        expect(expandReplacement('$9', match, true)).toBe('$9');
    });

    it('leaves $ alone in literal mode, so a user typing $5.00 gets $5.00', () => {
        expect(expandReplacement('$5.00', match, false)).toBe('$5.00');
    });
});

describe('applyReplacements', () => {
    it('rewrites only the listed span and leaves the rest of the file byte-identical', () => {
        const content = 'const needle = 1;\nconst other = needle;\n';
        const outcome = applyReplacements(
            content,
            [targetFor(1, 'const needle = 1;', 'needle')],
            buildReplaceMatcher('needle'),
            'pin',
        );

        expect(outcome).toMatchObject({ ok: true, replaced: 1 });
        expect((outcome as { content: string }).content).toBe('const pin = 1;\nconst other = needle;\n');
    });

    it('applies several targets on one line right-to-left so later columns stay valid', () => {
        const text = 'needle and needle';
        const outcome = applyReplacements(
            text + '\n',
            [targetFor(1, text, 'needle'), targetFor(1, text, 'needle', 5)],
            buildReplaceMatcher('needle'),
            'pinpoint',
        );

        expect(outcome).toMatchObject({ ok: true, replaced: 2 });
        expect((outcome as { content: string }).content).toBe('pinpoint and pinpoint\n');
    });

    it('preserves CRLF terminators and a missing trailing newline', () => {
        const crlf = applyReplacements(
            'a needle\r\nsecond\r\n',
            [targetFor(1, 'a needle', 'needle')],
            buildReplaceMatcher('needle'),
            'pin',
        );
        expect((crlf as { content: string }).content).toBe('a pin\r\nsecond\r\n');

        const noEol = applyReplacements(
            'a needle',
            [targetFor(1, 'a needle', 'needle')],
            buildReplaceMatcher('needle'),
            'pin',
        );
        expect((noEol as { content: string }).content).toBe('a pin');
    });

    it('expands backreferences under regex and preserves case when asked', () => {
        const text = 'call FOO(1)';
        const outcome = applyReplacements(
            text + '\n',
            [targetFor(1, text, 'FOO(1)')],
            buildReplaceMatcher('foo\\((\\d)\\)', { regex: true }),
            'bar[$1]',
            { regex: true, preserveCase: true },
        );

        expect((outcome as { content: string }).content).toBe('call BAR[1]\n');
    });

    it('skips the whole file when a listed line changed on disk', () => {
        const outcome = applyReplacements(
            'const needle = 2;\n',
            [targetFor(1, 'const needle = 1;', 'needle')],
            buildReplaceMatcher('needle'),
            'pin',
        );
        expect(outcome).toMatchObject({ ok: false, reason: 'stale' });
    });

    it('skips the whole file when a listed line no longer exists', () => {
        const outcome = applyReplacements(
            'only one line\n',
            [{ line: 9, text: 'gone', startColumn: 0, endColumn: 4 }],
            buildReplaceMatcher('gone'),
            'pin',
        );
        expect(outcome).toMatchObject({ ok: false, reason: 'stale' });
    });

    it('skips when the span no longer matches the query at that exact column', () => {
        const text = 'needle needle';
        const outcome = applyReplacements(
            text + '\n',
            [{ line: 1, text, startColumn: 3, endColumn: 9 }],
            buildReplaceMatcher('needle'),
            'pin',
        );
        expect(outcome).toMatchObject({ ok: false, reason: 'stale' });
    });

    it('writes nothing at all when one of several targets is stale', () => {
        const good = 'first needle';
        const outcome = applyReplacements(
            `${good}\nsecond CHANGED\n`,
            [targetFor(1, good, 'needle'), targetFor(2, 'second needle', 'needle')],
            buildReplaceMatcher('needle'),
            'pin',
        );
        // All-or-nothing: a half-applied replace is a corruption the user
        // never asked for and cannot see.
        expect(outcome.ok).toBe(false);
    });

    it('does not spin on a zero-width pattern before the target column', () => {
        const text = 'ab';
        const outcome = applyReplacements(
            text + '\n',
            [{ line: 1, text, startColumn: 1, endColumn: 1 }],
            buildReplaceMatcher('x*', { regex: true }),
            '-',
        );
        expect(outcome).toMatchObject({ ok: true, replaced: 1 });
        expect((outcome as { content: string }).content).toBe('a-b\n');
    });
});
