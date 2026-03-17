import { describe, it, expect } from 'vitest';
import {
    hashText,
    levenshteinDistance,
    calculateSimilarity,
    normalizeText,
    splitIntoLines,
    findAllOccurrences,
} from '../../src/utils/text-matching';

describe('hashText', () => {
    it('returns a non-empty string', () => {
        expect(hashText('hello')).toBeTruthy();
    });

    it('returns the same hash for identical input', () => {
        expect(hashText('test content')).toBe(hashText('test content'));
    });

    it('returns different hashes for different inputs', () => {
        expect(hashText('abc')).not.toBe(hashText('xyz'));
    });

    it('handles empty string', () => {
        const result = hashText('');
        expect(typeof result).toBe('string');
    });
});

describe('levenshteinDistance', () => {
    it('returns 0 for identical strings', () => {
        expect(levenshteinDistance('abc', 'abc')).toBe(0);
    });

    it('returns correct edit distance for simple substitution', () => {
        expect(levenshteinDistance('cat', 'cut')).toBe(1);
    });

    it('returns string length when comparing to empty string', () => {
        expect(levenshteinDistance('', 'abc')).toBe(3);
        expect(levenshteinDistance('abc', '')).toBe(3);
    });

    it('returns 0 for two empty strings', () => {
        expect(levenshteinDistance('', '')).toBe(0);
    });

    it('computes distance for insertion', () => {
        expect(levenshteinDistance('ab', 'abc')).toBe(1);
    });

    it('computes distance for deletion', () => {
        expect(levenshteinDistance('abc', 'ab')).toBe(1);
    });

    it('handles longer strings', () => {
        // "kitten" → "sitting" = 3 edits
        expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    });
});

describe('calculateSimilarity', () => {
    it('returns 1.0 for identical strings', () => {
        expect(calculateSimilarity('test', 'test')).toBe(1);
    });

    it('returns 0.0 when one string is empty', () => {
        expect(calculateSimilarity('', 'abc')).toBe(0);
        expect(calculateSimilarity('abc', '')).toBe(0);
    });

    it('returns a value between 0 and 1 for partially matching strings', () => {
        const score = calculateSimilarity('typescript', 'javascript');
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(1);
    });

    it('returns a high score for very similar strings', () => {
        const score = calculateSimilarity('hello world', 'hello world!');
        expect(score).toBeGreaterThan(0.8);
    });

    it('returns a lower score for completely different strings', () => {
        const score = calculateSimilarity('aaa', 'zzz');
        expect(score).toBeLessThan(0.5);
    });
});

describe('normalizeText', () => {
    it('trims leading and trailing whitespace', () => {
        expect(normalizeText('  hello  ')).toBe('hello');
    });

    it('normalizes CRLF to LF', () => {
        expect(normalizeText('line1\r\nline2')).toBe('line1\nline2');
    });

    it('normalizes standalone CR to LF', () => {
        expect(normalizeText('line1\rline2')).toBe('line1\nline2');
    });

    it('handles empty string', () => {
        expect(normalizeText('')).toBe('');
    });

    it('leaves already-normalized text unchanged', () => {
        expect(normalizeText('hello\nworld')).toBe('hello\nworld');
    });
});

describe('splitIntoLines', () => {
    it('splits LF-delimited content', () => {
        expect(splitIntoLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
    });

    it('splits CRLF-delimited content', () => {
        expect(splitIntoLines('a\r\nb\r\nc')).toEqual(['a', 'b', 'c']);
    });

    it('returns single-element array for text with no newlines', () => {
        expect(splitIntoLines('hello')).toEqual(['hello']);
    });

    it('handles empty string', () => {
        expect(splitIntoLines('')).toEqual(['']);
    });
});

describe('findAllOccurrences', () => {
    it('finds all occurrences of a substring', () => {
        expect(findAllOccurrences('abcabc', 'abc')).toEqual([0, 3]);
    });

    it('returns empty array when substring not found', () => {
        expect(findAllOccurrences('hello', 'xyz')).toEqual([]);
    });

    it('returns empty array for empty search text', () => {
        expect(findAllOccurrences('hello', '')).toEqual([]);
    });

    it('finds overlapping occurrences correctly (sliding by 1)', () => {
        // "aa" occurs at 0 and 1 in "aaa" with sliding window
        const result = findAllOccurrences('aaa', 'aa');
        expect(result).toContain(0);
        expect(result).toContain(1);
    });
});
