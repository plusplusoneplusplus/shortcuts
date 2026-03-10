/**
 * Tests for shared parseStringArray utility.
 *
 * Covers happy path, edge cases, and non-array inputs.
 */

import { describe, it, expect } from 'vitest';
import { parseStringArray } from '../../src/utils/parse-string-array';

describe('parseStringArray', () => {
    it('returns empty array for non-array inputs', () => {
        expect(parseStringArray(null)).toEqual([]);
        expect(parseStringArray(undefined)).toEqual([]);
        expect(parseStringArray(42)).toEqual([]);
        expect(parseStringArray('hello')).toEqual([]);
        expect(parseStringArray({})).toEqual([]);
        expect(parseStringArray(true)).toEqual([]);
    });

    it('returns strings from a string array', () => {
        expect(parseStringArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('filters out non-string items', () => {
        expect(parseStringArray(['a', 42, 'b', null, 'c', undefined, true])).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array for an empty array', () => {
        expect(parseStringArray([])).toEqual([]);
    });

    it('returns empty array for an array with no strings', () => {
        expect(parseStringArray([1, 2, null, false, {}])).toEqual([]);
    });

    it('preserves empty strings', () => {
        expect(parseStringArray(['', 'a', ''])).toEqual(['', 'a', '']);
    });
});
