/**
 * Unit tests for computeIntraLineDiff and buildIntraLinePartsMap.
 */

import { describe, it, expect } from 'vitest';
import {
    computeIntraLineDiff,
    computeSideBySideLines,
    computeDiffLines,
    buildIntraLinePartsMap,
} from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';

// ---------------------------------------------------------------------------
// computeIntraLineDiff
// ---------------------------------------------------------------------------

describe('computeIntraLineDiff', () => {
    it('returns empty arrays for two empty strings', () => {
        const [a, b] = computeIntraLineDiff('', '');
        expect(a).toEqual([]);
        expect(b).toEqual([]);
    });

    it('marks the whole left string changed when right is empty', () => {
        const [a, b] = computeIntraLineDiff('hello', '');
        expect(a).toEqual([{ text: 'hello', changed: true }]);
        expect(b).toEqual([]);
    });

    it('marks the whole right string changed when left is empty', () => {
        const [a, b] = computeIntraLineDiff('', 'world');
        expect(a).toEqual([]);
        expect(b).toEqual([{ text: 'world', changed: true }]);
    });

    it('marks nothing changed for identical strings', () => {
        const [a, b] = computeIntraLineDiff('hello world', 'hello world');
        expect(a.every(p => !p.changed)).toBe(true);
        expect(b.every(p => !p.changed)).toBe(true);
    });

    it('identifies a changed word in the middle', () => {
        const [a, b] = computeIntraLineDiff('foo bar baz', 'foo qux baz');
        // 'foo' and ' ' and 'baz' are unchanged; 'bar' vs 'qux' changed
        expect(a.find(p => p.text === 'bar')?.changed).toBe(true);
        expect(b.find(p => p.text === 'qux')?.changed).toBe(true);
        // unchanged tokens should not be marked
        const aUnchanged = a.filter(p => !p.changed).map(p => p.text).join('');
        expect(aUnchanged).toContain('foo');
        expect(aUnchanged).toContain('baz');
    });

    it('identifies a small property change in a large object literal', () => {
        const old = '{ foo: 1, bar: 2, baz: 3 }';
        const next = '{ foo: 1, bar: 99, baz: 3 }';
        const [a, b] = computeIntraLineDiff(old, next);
        // Only the changed number should be marked
        const changedA = a.filter(p => p.changed).map(p => p.text).join('');
        const changedB = b.filter(p => p.changed).map(p => p.text).join('');
        expect(changedA).toContain('2');
        expect(changedB).toContain('99');
        // Surrounding text should be unchanged
        const unchangedB = b.filter(p => !p.changed).map(p => p.text).join('');
        expect(unchangedB).toContain('foo');
        expect(unchangedB).toContain('baz');
    });

    it('reconstructs the full original string from parts', () => {
        const left  = 'const x = getValue(foo, bar);';
        const right = 'const x = computeValue(foo, baz);';
        const [a, b] = computeIntraLineDiff(left, right);
        expect(a.map(p => p.text).join('')).toBe(left);
        expect(b.map(p => p.text).join('')).toBe(right);
    });

    it('returns wholly-changed parts for very long lines (> 300 tokens)', () => {
        // Build a line with > 300 word tokens by repeating "a " many times
        const longLine = Array.from({ length: 301 }, (_, i) => `tok${i}`).join(' ');
        const [a, b] = computeIntraLineDiff(longLine, longLine + ' extra');
        // Should fall back to single changed part each
        expect(a).toHaveLength(1);
        expect(a[0].changed).toBe(true);
        expect(b).toHaveLength(1);
        expect(b[0].changed).toBe(true);
    });

    it('merges consecutive tokens of the same changed state', () => {
        // "abc def" → "xyz" — both words on left are changed, should merge
        const [a] = computeIntraLineDiff('abc def', 'xyz');
        // The left parts should not have more entries than necessary
        const changedParts = a.filter(p => p.changed);
        // Should be merged into as few parts as possible
        expect(changedParts.length).toBeLessThanOrEqual(2);
    });

    it('handles whitespace-only differences', () => {
        const [a, b] = computeIntraLineDiff('foo  bar', 'foo bar');
        expect(a.map(p => p.text).join('')).toBe('foo  bar');
        expect(b.map(p => p.text).join('')).toBe('foo bar');
    });

    it('handles added suffix', () => {
        const [a, b] = computeIntraLineDiff('hello', 'hello world');
        expect(a.map(p => p.text).join('')).toBe('hello');
        expect(b.map(p => p.text).join('')).toBe('hello world');
        // 'world' (and preceding space) should be marked as changed on right
        const changedB = b.filter(p => p.changed).map(p => p.text).join('');
        expect(changedB).toContain('world');
    });
});

// ---------------------------------------------------------------------------
// buildIntraLinePartsMap
// ---------------------------------------------------------------------------

describe('buildIntraLinePartsMap', () => {
    const DIFF = [
        'diff --git a/foo.ts b/foo.ts',
        'index 000..111 100644',
        '--- a/foo.ts',
        '+++ b/foo.ts',
        '@@ -1,3 +1,3 @@',
        ' context line',
        '-old value',
        '+new value',
        ' another context',
    ].join('\n');

    it('maps paired removed/added lines to intra-line parts', () => {
        const lines = DIFF.split('\n');
        const diffLines = computeDiffLines(lines);
        const sxsLines = computeSideBySideLines(diffLines);
        const map = buildIntraLinePartsMap(sxsLines);

        // The map should have entries for the paired removed+added lines
        expect(map.size).toBeGreaterThan(0);

        // All values should be arrays of IntraLinePart
        for (const parts of map.values()) {
            expect(Array.isArray(parts)).toBe(true);
            for (const part of parts) {
                expect(typeof part.text).toBe('string');
                expect(typeof part.changed).toBe('boolean');
            }
        }
    });

    it('does not map context or unpaired lines', () => {
        const contextOnlyDiff = [
            'diff --git a/x.ts b/x.ts',
            '@@ -1,2 +1,2 @@',
            ' line one',
            ' line two',
        ].join('\n');
        const lines = contextOnlyDiff.split('\n');
        const diffLines = computeDiffLines(lines);
        const sxsLines = computeSideBySideLines(diffLines);
        const map = buildIntraLinePartsMap(sxsLines);
        expect(map.size).toBe(0);
    });

    it('returns empty map for empty sxsLines', () => {
        const map = buildIntraLinePartsMap([]);
        expect(map.size).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// computeSideBySideLines — intra-line parts integration
// ---------------------------------------------------------------------------

describe('computeSideBySideLines — intra-line parts', () => {
    it('populates leftParts and rightParts for 1:1 paired removed+added rows', () => {
        const lines = [
            '@@ -1,2 +1,2 @@',
            '-const x = 1;',
            '+const x = 2;',
        ];
        const diffLines = computeDiffLines(lines);
        const sxsLines = computeSideBySideLines(diffLines);

        const pairedRow = sxsLines.find(r => r.left.type === 'removed' && r.right.type === 'added');
        expect(pairedRow).toBeDefined();
        expect(pairedRow!.leftParts).toBeDefined();
        expect(pairedRow!.rightParts).toBeDefined();

        // The changed part should highlight only the differing number
        const changedLeft  = pairedRow!.leftParts!.filter(p => p.changed).map(p => p.text).join('');
        const changedRight = pairedRow!.rightParts!.filter(p => p.changed).map(p => p.text).join('');
        expect(changedLeft).toContain('1');
        expect(changedRight).toContain('2');
    });

    it('does not set leftParts/rightParts when left has no matching right (unpaired removed)', () => {
        const lines = [
            '@@ -1,2 +1,1 @@',
            '-removed line one',
            '-removed line two',
            '+added only one',
        ];
        const diffLines = computeDiffLines(lines);
        const sxsLines = computeSideBySideLines(diffLines);

        // The second removed row should have no rightParts (paired with empty)
        const unpairedRow = sxsLines.find(r => r.left.type === 'removed' && r.right.type === 'empty');
        expect(unpairedRow).toBeDefined();
        expect(unpairedRow!.leftParts).toBeUndefined();
        expect(unpairedRow!.rightParts).toBeUndefined();
    });

    it('does not set parts when lines are identical (no actual change)', () => {
        const lines = [
            '@@ -1 +1 @@',
            '-same line',
            '+same line',
        ];
        const diffLines = computeDiffLines(lines);
        const sxsLines = computeSideBySideLines(diffLines);

        const row = sxsLines.find(r => r.left.type === 'removed' && r.right.type === 'added');
        expect(row).toBeDefined();
        // No changed parts → parts should not be set
        expect(row!.leftParts).toBeUndefined();
        expect(row!.rightParts).toBeUndefined();
    });
});
