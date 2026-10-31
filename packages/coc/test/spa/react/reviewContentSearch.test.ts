import { describe, expect, it } from 'vitest';
import { compileReviewContentQuery } from '../../../src/server/spa/client/react/features/git/diff/reviewContentSearch';
import { DEFAULT_CONTENT_SEARCH_MODES } from '../../../src/server/spa/client/react/features/repo-detail/explorer/types';
import type { ContentSearchModes } from '../../../src/server/spa/client/react/features/repo-detail/explorer/types';

function compile(query: string, modes: Partial<ContentSearchModes> = {}) {
    const result = compileReviewContentQuery(query, { ...DEFAULT_CONTENT_SEARCH_MODES, ...modes });
    if (result.search === null) throw new Error(result.error);
    return result.search;
}

describe('review full-content query', () => {
    it('finds unchanged lines on both sides in source order, with navigation columns', () => {
        const search = compile('target');
        expect(search({ old: 'heading\ntarget TARGET', new: 'target\nother' })).toEqual([
            { side: 'old', line: 2, startColumn: 1, endColumn: 7, text: 'target TARGET' },
            { side: 'old', line: 2, startColumn: 8, endColumn: 14, text: 'target TARGET' },
            { side: 'new', line: 1, startColumn: 1, endColumn: 7, text: 'target' },
        ]);
    });

    it('escapes every regex metacharacter in literal mode', () => {
        const query = '.*+?^${}()|[]\\';
        expect(compile(query)({ old: null, new: `prefix ${query} suffix` })).toEqual([
            { side: 'new', line: 1, startColumn: 8, endColumn: 8 + query.length, text: `prefix ${query} suffix` },
        ]);
    });

    it('supports exact case and non-overlapping occurrences', () => {
        expect(compile('aa', { caseSensitive: true })({ old: null, new: 'AA aaaaa' })
            .map(match => [match.startColumn, match.endColumn])).toEqual([[4, 6], [6, 8]]);
    });

    it('preserves whitespace queries and treats an empty query as idle', () => {
        expect(compile(' ')({ old: ' a ', new: null })).toHaveLength(2);
        expect(compile('')({ old: 'a', new: 'b' })).toEqual([]);
    });

    it.each(['old', 'new'] as const)('filters to the %s side', side => {
        const matches = compile('a')({ old: 'a', new: 'a' }, side);
        expect(matches).toHaveLength(1);
        expect(matches[0].side).toBe(side);
    });

    it('distinguishes an absent side from an empty blob', () => {
        expect(compile('^$', { regex: true })({ old: null, new: '' })).toEqual([
            { side: 'new', line: 1, startColumn: 1, endColumn: 1, text: '' },
        ]);
    });

    it('uses Unicode whole-word boundaries, including combining marks', () => {
        const text = 'cat concatenate cat_ cat2 écat caté cat\u0301 (cat)';
        expect(compile('cat', { wholeWord: true })({ old: text, new: null })
            .map(match => match.startColumn)).toEqual([1, 43]);
        expect(compile('猫', { wholeWord: true })({ old: '猫 猫咪', new: null })).toHaveLength(1);
    });

    it('applies whole-word boundaries to an entire regex alternation', () => {
        const matches = compile('cat|dog', { regex: true, wholeWord: true })({ old: 'cats dogma cat dog', new: null });
        expect(matches.map(match => match.startColumn)).toEqual([12, 16]);
    });

    it('matches regexes on one line at a time and normalizes CRLF', () => {
        const contents = { old: 'foo\r\nbar\r\n', new: 'foo\nbar\n' };
        expect(compile('foo\\s+bar', { regex: true })(contents)).toEqual([]);
        expect(compile('^bar$', { regex: true })(contents).map(match => [match.side, match.line, match.text]))
            .toEqual([['old', 2, 'bar'], ['new', 2, 'bar']]);
        expect(compile('^$', { regex: true })(contents)).toEqual([]);
    });

    it('returns regex errors for display without searching', () => {
        const result = compileReviewContentQuery('[', { ...DEFAULT_CONTENT_SEARCH_MODES, regex: true });
        expect(result.search).toBeNull();
        expect(result.error).toEqual(expect.any(String));
        expect(result.error?.length).toBeGreaterThan(0);
        expect(compile('[')({ old: '[', new: null })).toHaveLength(1);
    });

    it('advances zero-width matches safely over astral characters in UTF-16 coordinates', () => {
        expect(compile('(?=.)|$', { regex: true })({ old: '😀x', new: null })
            .map(match => [match.startColumn, match.endColumn])).toEqual([[1, 1], [3, 3], [4, 4]]);
        expect(compile('x')({ old: null, new: '😀x' })[0].startColumn).toBe(3);
    });

    it('reuses a compiled query across lines, sides and files without regex state leaking', () => {
        const search = compile('a', { regex: true });
        const contents = { old: 'a\na', new: 'a' };
        expect(search(contents)).toHaveLength(3);
        expect(search(contents)).toEqual(search(contents));
    });

    it('keeps every result and the complete source line without size or match caps', () => {
        const longLine = `${'x'.repeat(1024 * 1024)}needle`;
        const contents = { old: 'needle\n'.repeat(1200), new: longLine };
        const matches = compile('needle')(contents);
        expect(matches).toHaveLength(1201);
        expect(matches.at(-1)).toEqual({
            side: 'new', line: 1, startColumn: 1024 * 1024 + 1,
            endColumn: longLine.length + 1, text: longLine,
        });
    });
});
