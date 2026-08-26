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

    it('does not make length a term in the score', () => {
        // Both are tier-2 matches over the identical basename, so the score is
        // the same; the depth difference is left to the ranking comparator.
        const short = fuzzyFileScore('idx', 'index.ts');
        const long = fuzzyFileScore('idx', 'very/deep/path/to/some/index.ts');
        expect(short).toBe(long);
        expect(fuzzyFileScore('index', 'index.ts')).toBe(
            fuzzyFileScore('index', 'index.ts.bak.and.then.some.more'),
        );
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

describe('fuzzyFileMatch alignment', () => {
    it('slides the match onto the literal run rather than the leftmost one', () => {
        // Greedy-forward alone consumes 'p' from "packages" and 'r' from
        // "forge", then scrapes up "ompt"; the backward pass finds the literal.
        const path = 'packages/forge/src/ai/prompt-builder.ts';
        const match = fuzzyFileMatch('prompt', path)!;
        expect(match.indices).toEqual([22, 23, 24, 25, 26, 27]);
        expect(path.slice(22, 28)).toBe('prompt');
    });

    it('handles the degenerate one-character window', () => {
        // sidx === eidx - 1: the backward pass has a single position to consider.
        expect(fuzzyFileMatch('x', 'index.ts')!.indices).toEqual([4]);
        expect(fuzzyFileMatch('s', 'index.ts')!.indices).toEqual([7]);
    });

    it('handles a query as long as the target', () => {
        expect(fuzzyFileMatch('abc', 'abc')!.indices).toEqual([0, 1, 2]);
    });

    it('scores a tightened alignment above a scattered one', () => {
        // Same tier, same 39-character path — only the alignment differs.
        const tight = fuzzyFileScore('prompt', 'ai/prompt-builder.ts');
        const scattered = fuzzyFileScore('prompt', 'packages/forge/src/ai/command-types.ts');
        expect(tight).toBeGreaterThan(scattered);
    });

    it('ranks starting the target above starting a segment within it', () => {
        expect(fuzzyFileScore('prompt', 'prompt-builder.ts')).toBeGreaterThan(
            fuzzyFileScore('prompt', 'follow-prompt.ts'),
        );
    });
});

describe('fuzzyFileMatch tiering', () => {
    it('puts a basename match in tier 2 and a path-only match in tier 1', () => {
        expect(fuzzyFileMatch('index', 'src/index.ts')!.tier).toBe(2);
        expect(fuzzyFileMatch('srcindex', 'src/index.ts')!.tier).toBe(1);
    });

    it('points tier-2 indices inside the basename, as one contiguous run', () => {
        const path = 'packages/forge/src/ai/prompt-builder.ts';
        const match = fuzzyFileMatch('prompt', path)!;
        expect(match.tier).toBe(2);
        const nameStart = path.lastIndexOf('/') + 1;
        expect(match.indices.every(i => i >= nameStart)).toBe(true);
        expect(match.indices).toEqual([22, 23, 24, 25, 26, 27]);
    });

    it('drops a query containing a separator to tier 1', () => {
        const match = fuzzyFileMatch('explorer/quick', 'src/explorer/quick-open.ts')!;
        expect(match.tier).toBe(1);
        expect(match.indices.map(i => 'src/explorer/quick-open.ts'[i]).join('')).toBe('explorer/quick');
    });

    it('reports the scored target length, not the path length', () => {
        expect(fuzzyFileMatch('index', 'src/index.ts')!.targetLen).toBe('index.ts'.length);
        expect(fuzzyFileMatch('srcindex', 'src/index.ts')!.targetLen).toBe('src/index.ts'.length);
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

    it('breaks ties on scored target length, then path length', () => {
        // Every one of these is a tier-2 match with the same quality, so the
        // whole ordering comes from the tie-breaks.
        const paths = [
            'packages/deep-wiki/src/seeds/prompts.ts',
            'packages/forge/src/ai/prompt-builder.ts',
            'packages/forge/src/ai/prompts.ts',
            'src/prompts.test.ts',
        ];
        const ranked = rankFuzzyMatches('prompt', paths, 10);
        expect(new Set(ranked.map(m => m.score)).size).toBe(1);
        expect(ranked.map(m => m.path)).toEqual([
            'packages/forge/src/ai/prompts.ts',
            'packages/deep-wiki/src/seeds/prompts.ts',
            'src/prompts.test.ts',
            'packages/forge/src/ai/prompt-builder.ts',
        ]);
    });

    it('ranks the reported prompt regression filenames first', () => {
        // `command-types.ts` used to tie `prompt-builder.ts` on path length,
        // and `wipe-data.ts` used to outrank an exact filename prefix match.
        const paths = [
            'packages/deep-wiki/src/seeds/prompts.ts',
            'packages/forge/src/ai/command-types.ts',
            'packages/forge/src/ai/prompt-builder.ts',
            'packages/coc/src/commands/wipe-data.ts',
            'packages/forge/src/utils/prompt-resolver.ts',
        ];
        const ranked = rankFuzzyMatches('prompt', paths, 10).map(m => m.path);
        expect(ranked.slice(0, 3)).toEqual([
            'packages/deep-wiki/src/seeds/prompts.ts',
            'packages/forge/src/ai/prompt-builder.ts',
            'packages/forge/src/utils/prompt-resolver.ts',
        ]);
        expect(ranked.slice(3).sort()).toEqual([
            'packages/coc/src/commands/wipe-data.ts',
            'packages/forge/src/ai/command-types.ts',
        ]);
    });

    it('ranks a shallower copy of the same file first', () => {
        // Was a score comparison: length is a tie-break now, not a term.
        const paths = ['very/deep/path/to/some/index.ts', 'index.ts'];
        expect(rankFuzzyMatches('idx', paths, 10).map(m => m.path)).toEqual([
            'index.ts',
            'very/deep/path/to/some/index.ts',
        ]);
    });

    it('ranks every basename match above every path-only match', () => {
        const paths = [
            'p/r/o/m/p/t/deeply-nested-elsewhere.ts',
            'src/prompts.ts',
            'packages/coc/src/commands/wipe-data.ts',
            'src/prompt-builder.ts',
        ];
        const ranked = rankFuzzyMatches('prompt', paths, 10).map(m => m.path);
        const nameMatches = ranked.filter(p => fuzzyFileMatch('prompt', p)!.tier === 2);
        const pathMatches = ranked.filter(p => fuzzyFileMatch('prompt', p)!.tier === 1);
        expect(nameMatches).toHaveLength(2);
        expect(pathMatches.length).toBeGreaterThan(0);
        // No query, however many consecutive path characters it hits, can invert this.
        expect(ranked.slice(0, nameMatches.length).sort()).toEqual(nameMatches.sort());
    });
});
