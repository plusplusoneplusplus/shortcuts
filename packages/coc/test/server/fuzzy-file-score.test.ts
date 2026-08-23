/**
 * Tests for the fuzzy file-path scorer shared by the /search endpoint and the
 * SPA file-finder dialogs.
 */

import { describe, it, expect } from 'vitest';
import { fuzzyFileMatch, fuzzyFileScore, rankFuzzyMatches } from '../../src/server/shared/fuzzy-file-score';

describe('fuzzyFileScore', () => {
    it('matches an exact substring', () => {
        expect(fuzzyFileScore('index', 'src/index.ts')).toBeGreaterThan(0);
    });

    it('matches characters in order but non-contiguously', () => {
        expect(fuzzyFileScore('idx', 'index.ts')).toBeGreaterThan(0);
    });

    it('does not match characters out of order', () => {
        expect(fuzzyFileScore('zxy', 'index.ts')).toBe(0);
    });

    it('does not match when a character is absent', () => {
        expect(fuzzyFileScore('zzz', 'index.ts')).toBe(0);
    });

    it('returns 0 for an empty query', () => {
        expect(fuzzyFileScore('', 'index.ts')).toBe(0);
    });

    it('returns 0 when the query is longer than the path', () => {
        expect(fuzzyFileScore('abcdefghijklmnopqrstuvwxyz0123456789', 'a.ts')).toBe(0);
    });

    it('is case insensitive', () => {
        expect(fuzzyFileScore('INDEX', 'src/index.ts')).toBeGreaterThan(0);
        expect(fuzzyFileScore('index', 'src/INDEX.ts')).toBeGreaterThan(0);
    });

    it('scores shorter targets higher for the same query', () => {
        const short = fuzzyFileScore('idx', 'index.ts');
        const long = fuzzyFileScore('idx', 'very/deep/path/to/some/index.ts');
        expect(short).toBeGreaterThan(long);
    });

    it('scores consecutive matches higher than scattered ones', () => {
        const consecutive = fuzzyFileScore('ind', 'index.ts');
        const scattered = fuzzyFileScore('ind', 'integration-dashboard.ts');
        expect(consecutive).toBeGreaterThan(scattered);
    });

    it('gives a bonus at a path separator', () => {
        expect(fuzzyFileScore('i', 'src/index.ts')).toBeGreaterThan(fuzzyFileScore('n', 'src/index.ts'));
    });

    it('treats backslash, dot, dash and underscore as boundaries', () => {
        // Each target has the matched character at index 4; only the boundary differs.
        const midWord = fuzzyFileScore('t', 'abcdt.x');
        for (const target of ['abc\\t.x', 'abc.t.x', 'abc-t.x', 'abc_t.x']) {
            expect(fuzzyFileScore('t', target)).toBeGreaterThan(midWord);
        }
    });

    it('matches a query spanning directory and file name', () => {
        expect(fuzzyFileScore('srcindex', 'src/index.ts')).toBeGreaterThan(0);
    });

    it('does not throw on regex-special characters', () => {
        expect(() => fuzzyFileScore('*.ts?', 'src/index.ts')).not.toThrow();
        expect(fuzzyFileScore('.ts', 'src/index.ts')).toBeGreaterThan(0);
    });

    it('handles an empty path', () => {
        expect(fuzzyFileScore('a', '')).toBe(0);
    });

    it('folds case for ASCII only', () => {
        // Documented deviation from toLowerCase(), required for parity with the
        // native scorer and to keep match indices aligned with the path.
        expect(fuzzyFileScore('café', 'src/café.ts')).toBeGreaterThan(0);
        expect(fuzzyFileScore('café', 'src/CAFÉ.ts')).toBe(0);
        expect(fuzzyFileScore('caf', 'src/CAFÉ.ts')).toBeGreaterThan(0);
    });
});

describe('fuzzyFileMatch', () => {
    it('reports the matched positions in ascending order', () => {
        const match = fuzzyFileMatch('idx', 'src/index.ts');
        expect(match).not.toBeNull();
        expect(match!.indices).toEqual([4, 6, 8]);
        expect(match!.indices.map(i => 'src/index.ts'[i]).join('')).toBe('idx');
    });

    it('indices are string indices even for non-ASCII paths', () => {
        const path = 'docs/café/x.ts';
        const match = fuzzyFileMatch('cafx', path);
        expect(match!.indices.map(i => path[i]).join('')).toBe('cafx');
    });

    it('returns null instead of a zero score when nothing matches', () => {
        expect(fuzzyFileMatch('zzz', 'src/index.ts')).toBeNull();
        expect(fuzzyFileMatch('', 'src/index.ts')).toBeNull();
        expect(fuzzyFileMatch('abcdefghijklmnopqrstuvwxyz0123456789', 'a.ts')).toBeNull();
    });

    it('agrees with fuzzyFileScore', () => {
        for (const path of ['src/index.ts', 'README.md', 'test/index.test.ts']) {
            expect(fuzzyFileMatch('index', path)?.score ?? 0).toBe(fuzzyFileScore('index', path));
        }
    });
});

describe('rankFuzzyMatches', () => {
    const PATHS = [
        'src/index.ts',
        'src/server/repos/tree-service.ts',
        'README.md',
        'test/index.test.ts',
    ];

    it('returns only matching paths', () => {
        const matches = rankFuzzyMatches('index', PATHS, 10);
        expect(matches.map(m => m.path).sort()).toEqual(['src/index.ts', 'test/index.test.ts']);
    });

    it('orders results by descending score', () => {
        const matches = rankFuzzyMatches('index', PATHS, 10);
        for (let i = 1; i < matches.length; i++) {
            expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
        }
    });

    it('applies the limit', () => {
        expect(rankFuzzyMatches('e', PATHS, 2)).toHaveLength(2);
    });

    it('returns everything when the limit exceeds the match count', () => {
        expect(rankFuzzyMatches('index', PATHS, 100)).toHaveLength(2);
    });

    it('returns an empty list for a limit of 0', () => {
        expect(rankFuzzyMatches('index', PATHS, 0)).toEqual([]);
    });

    it('returns an empty list for an empty query', () => {
        expect(rankFuzzyMatches('', PATHS, 10)).toEqual([]);
    });

    it('returns an empty list for an empty path list', () => {
        expect(rankFuzzyMatches('index', [], 10)).toEqual([]);
    });

    it('is stable for equal scores', () => {
        const equal = ['a/x.ts', 'b/x.ts', 'c/x.ts'];
        const first = rankFuzzyMatches('x', equal, 10).map(m => m.path);
        const second = rankFuzzyMatches('x', equal, 10).map(m => m.path);
        expect(first).toEqual(second);
    });

    it('scores every path the same way fuzzyFileScore does', () => {
        for (const match of rankFuzzyMatches('index', PATHS, 10)) {
            expect(match.score).toBe(fuzzyFileScore('index', match.path));
        }
    });

    it('carries match indices for every result', () => {
        for (const match of rankFuzzyMatches('index', PATHS, 10)) {
            expect(match.indices.map(i => match.path[i].toLowerCase()).join('')).toBe('index');
        }
    });
});
