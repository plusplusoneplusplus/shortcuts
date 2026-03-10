/**
 * Tests for shared consolidation constants and helpers.
 */

import { describe, it, expect } from 'vitest';
import { deduplicateStrings, resolveMaxComplexity } from '../../src/consolidation/constants';

describe('deduplicateStrings', () => {
    it('removes duplicate strings', () => {
        expect(deduplicateStrings(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
    });

    it('preserves insertion order', () => {
        expect(deduplicateStrings(['z', 'a', 'z', 'm'])).toEqual(['z', 'a', 'm']);
    });

    it('returns empty array for empty input', () => {
        expect(deduplicateStrings([])).toEqual([]);
    });

    it('returns same array when no duplicates', () => {
        expect(deduplicateStrings(['x', 'y', 'z'])).toEqual(['x', 'y', 'z']);
    });

    it('handles single-element array', () => {
        expect(deduplicateStrings(['only'])).toEqual(['only']);
    });

    it('handles all identical elements', () => {
        expect(deduplicateStrings(['dup', 'dup', 'dup'])).toEqual(['dup']);
    });
});

describe('resolveMaxComplexity', () => {
    it('returns high when any component is high', () => {
        expect(resolveMaxComplexity([{ complexity: 'low' }, { complexity: 'high' }])).toBe('high');
    });

    it('returns low for all-low components', () => {
        expect(resolveMaxComplexity([{ complexity: 'low' }, { complexity: 'low' }])).toBe('low');
    });

    it('returns medium when highest is medium', () => {
        expect(resolveMaxComplexity([{ complexity: 'low' }, { complexity: 'medium' }])).toBe('medium');
    });
});
