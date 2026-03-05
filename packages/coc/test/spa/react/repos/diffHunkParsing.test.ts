/**
 * Unit tests for diff hunk-header parsing and line-number assignment.
 *
 * Tests `parseHunkHeader` and `computeDiffLines` from UnifiedDiffViewer,
 * covering correct oldLine/newLine assignment for context, added, and
 * removed lines after various hunk headers.
 */

import { describe, it, expect } from 'vitest';
import {
    parseHunkHeader,
    computeDiffLines,
} from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

// ============================================================================
// parseHunkHeader
// ============================================================================

describe('parseHunkHeader — coordinate extraction', () => {
    it('extracts oldStart=10 newStart=12 from @@ -10,6 +12,8 @@', () => {
        const result = parseHunkHeader('@@ -10,6 +12,8 @@');
        expect(result).not.toBeNull();
        expect(result!.oldStart).toBe(10);
        expect(result!.newStart).toBe(12);
    });

    it('handles hunk header without count (@@ -1 +1 @@)', () => {
        const result = parseHunkHeader('@@ -1 +1 @@');
        expect(result).not.toBeNull();
        expect(result!.oldStart).toBe(1);
        expect(result!.newStart).toBe(1);
    });

    it('returns null for non-hunk lines', () => {
        expect(parseHunkHeader('+added line')).toBeNull();
        expect(parseHunkHeader('-removed line')).toBeNull();
        expect(parseHunkHeader(' context line')).toBeNull();
        expect(parseHunkHeader('')).toBeNull();
        expect(parseHunkHeader('diff --git a/foo b/foo')).toBeNull();
    });

    it('parses large line numbers correctly', () => {
        const result = parseHunkHeader('@@ -1000,10 +2000,15 @@');
        expect(result).not.toBeNull();
        expect(result!.oldStart).toBe(1000);
        expect(result!.newStart).toBe(2000);
    });
});

// ============================================================================
// computeDiffLines — hunk-header line numbering
// ============================================================================

describe('computeDiffLines — hunk-header line numbering', () => {
    it('assigns correct oldLine/newLine to lines after @@ -10,6 +12,8 @@', () => {
        const raw = '@@ -10,6 +12,8 @@\n context\n+added\n-removed\n context2';
        const lines = raw.split('\n');
        const result = computeDiffLines(lines);

        // hunk header itself has undefined oldLine/newLine
        expect(result[0].type).toBe('hunk-header');
        expect(result[0].oldLine).toBeUndefined();
        expect(result[0].newLine).toBeUndefined();

        // first context line: old=10, new=12
        expect(result[1].type).toBe('context');
        expect(result[1].oldLine).toBe(10);
        expect(result[1].newLine).toBe(12);

        // added line: no oldLine, new=13
        expect(result[2].type).toBe('added');
        expect(result[2].oldLine).toBeUndefined();
        expect(result[2].newLine).toBe(13);

        // removed line: old=11, no newLine
        expect(result[3].type).toBe('removed');
        expect(result[3].oldLine).toBe(11);
        expect(result[3].newLine).toBeUndefined();

        // second context line: old=12, new=14
        expect(result[4].type).toBe('context');
        expect(result[4].oldLine).toBe(12);
        expect(result[4].newLine).toBe(14);
    });

    it('increments counters across multiple hunks', () => {
        const raw = [
            '@@ -1,2 +1,2 @@',
            ' ctx',
            '-rem',
            '@@ -5,1 +5,1 @@',
            ' ctx2',
        ];
        const result = computeDiffLines(raw);

        const secondHunk = result.find((l, i) => i > 0 && l.type === 'hunk-header');
        expect(secondHunk).toBeDefined();

        const secondHunkIdx = result.indexOf(secondHunk!);
        const afterSecondHunk = result[secondHunkIdx + 1];
        expect(afterSecondHunk.oldLine).toBe(5);
        expect(afterSecondHunk.newLine).toBe(5);
    });

    it('context line before any @@ header has undefined line numbers', () => {
        const raw = ['diff --git a/foo b/foo', '--- a/foo', '+++ b/foo'];
        const result = computeDiffLines(raw);
        result.forEach(dl => {
            expect(dl.oldLine).toBeUndefined();
            expect(dl.newLine).toBeUndefined();
        });
    });

    it('three consecutive added lines increment newLine only', () => {
        const raw = ['@@ -5,1 +5,3 @@', '+line1', '+line2', '+line3'];
        const result = computeDiffLines(raw);
        expect(result[1].newLine).toBe(5);
        expect(result[2].newLine).toBe(6);
        expect(result[3].newLine).toBe(7);
        // oldLine never advances for added lines
        expect(result[1].oldLine).toBeUndefined();
        expect(result[2].oldLine).toBeUndefined();
        expect(result[3].oldLine).toBeUndefined();
    });

    it('three consecutive removed lines increment oldLine only', () => {
        const raw = ['@@ -5,3 +5,1 @@', '-line1', '-line2', '-line3'];
        const result = computeDiffLines(raw);
        expect(result[1].oldLine).toBe(5);
        expect(result[2].oldLine).toBe(6);
        expect(result[3].oldLine).toBe(7);
        expect(result[1].newLine).toBeUndefined();
        expect(result[2].newLine).toBeUndefined();
        expect(result[3].newLine).toBeUndefined();
    });
});
