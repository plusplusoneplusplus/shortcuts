import { describe, it, expect } from 'vitest';
import { computeDiffLines, computeSideBySideLines } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

describe('computeSideBySideLines', () => {
    it('returns [] for empty input', () => {
        expect(computeSideBySideLines([])).toEqual([]);
    });

    it('skips meta lines', () => {
        const lines = computeDiffLines([
            'diff --git a/foo.ts b/foo.ts',
            '--- a/foo.ts',
            '+++ b/foo.ts',
        ]);
        expect(computeSideBySideLines(lines)).toEqual([]);
    });

    it('produces a hunk header row with both sides empty', () => {
        const lines = computeDiffLines(['@@ -1,2 +1,2 @@']);
        const result = computeSideBySideLines(lines);
        expect(result).toHaveLength(1);
        expect(result[0].hunkHeader).toBe('@@ -1,2 +1,2 @@');
        expect(result[0].left).toEqual({ type: 'empty', content: '', lineNumber: null, originalIndex: null });
        expect(result[0].right).toEqual({ type: 'empty', content: '', lineNumber: null, originalIndex: null });
    });

    it('produces a context row with correct line numbers and originalIndex', () => {
        const rawLines = ['@@ -5,1 +7,1 @@', ' context line'];
        const diffLines = computeDiffLines(rawLines);
        const result = computeSideBySideLines(diffLines);
        // First row is the hunk header, second is the context line
        const ctxRow = result[1];
        expect(ctxRow.left).toEqual({ type: 'context', content: ' context line', lineNumber: 5, originalIndex: diffLines[1].index });
        expect(ctxRow.right).toEqual({ type: 'context', content: ' context line', lineNumber: 7, originalIndex: diffLines[1].index });
        expect(ctxRow.hunkHeader).toBeUndefined();
    });

    it('produces removed row with empty right for pure remove', () => {
        const rawLines = ['@@ -1,1 +1,0 @@', '-old line'];
        const diffLines = computeDiffLines(rawLines);
        const result = computeSideBySideLines(diffLines);
        const row = result[1];
        expect(row.left.type).toBe('removed');
        expect(row.left.content).toBe('-old line');
        expect(row.left.lineNumber).toBe(1);
        expect(row.left.originalIndex).toBe(diffLines[1].index);
        expect(row.right).toEqual({ type: 'empty', content: '', lineNumber: null, originalIndex: null });
    });

    it('produces added row with empty left for pure add', () => {
        const rawLines = ['@@ -1,0 +1,1 @@', '+new line'];
        const diffLines = computeDiffLines(rawLines);
        const result = computeSideBySideLines(diffLines);
        const row = result[1];
        expect(row.left).toEqual({ type: 'empty', content: '', lineNumber: null, originalIndex: null });
        expect(row.right.type).toBe('added');
        expect(row.right.content).toBe('+new line');
        expect(row.right.lineNumber).toBe(1);
        expect(row.right.originalIndex).toBe(diffLines[1].index);
    });

    it('pairs equal-length remove+add run', () => {
        const rawLines = ['@@ -1,2 +1,2 @@', '-a', '-b', '+x', '+y'];
        const diffLines = computeDiffLines(rawLines);
        const result = computeSideBySideLines(diffLines);
        expect(result).toHaveLength(3); // 1 hunk header + 2 paired rows
        expect(result[1].left.type).toBe('removed');
        expect(result[1].right.type).toBe('added');
        expect(result[2].left.type).toBe('removed');
        expect(result[2].right.type).toBe('added');
    });

    it('pads right with empty for remove > add', () => {
        const rawLines = ['@@ -1,3 +1,1 @@', '-a', '-b', '-c', '+x'];
        const diffLines = computeDiffLines(rawLines);
        const result = computeSideBySideLines(diffLines);
        expect(result).toHaveLength(4); // hunk + 3 rows
        expect(result[1].left.type).toBe('removed');
        expect(result[1].right.type).toBe('added');
        expect(result[2].left.type).toBe('removed');
        expect(result[2].right.type).toBe('empty');
        expect(result[3].left.type).toBe('removed');
        expect(result[3].right.type).toBe('empty');
    });

    it('pads left with empty for add > remove', () => {
        const rawLines = ['@@ -1,1 +1,3 @@', '-a', '+x', '+y', '+z'];
        const diffLines = computeDiffLines(rawLines);
        const result = computeSideBySideLines(diffLines);
        expect(result).toHaveLength(4); // hunk + 3 rows
        expect(result[1].left.type).toBe('removed');
        expect(result[1].right.type).toBe('added');
        expect(result[2].left.type).toBe('empty');
        expect(result[2].right.type).toBe('added');
        expect(result[3].left.type).toBe('empty');
        expect(result[3].right.type).toBe('added');
    });

    it('groups interleaved -a +b -c +d into two paired rows', () => {
        const rawLines = ['@@ -1,2 +1,2 @@', '-a', '+b', '-c', '+d'];
        const diffLines = computeDiffLines(rawLines);
        const result = computeSideBySideLines(diffLines);
        expect(result).toHaveLength(3); // hunk + 2 rows
        expect(result[1].left.content).toBe('-a');
        expect(result[1].right.content).toBe('+b');
        expect(result[2].left.content).toBe('-c');
        expect(result[2].right.content).toBe('+d');
    });

    it('originalIndex matches DiffLine.index for context lines', () => {
        const rawLines = ['@@ -4,1 +4,1 @@', ' ctx'];
        const diffLines = computeDiffLines(rawLines);
        const result = computeSideBySideLines(diffLines);
        const ctxRow = result[1];
        expect(ctxRow.left.originalIndex).toBe(diffLines[1].index);
        expect(ctxRow.right.originalIndex).toBe(diffLines[1].index);
    });

    it('originalIndex is null for empty padding cells', () => {
        const rawLines = ['@@ -1,2 +1,1 @@', '-a', '-b', '+x'];
        const diffLines = computeDiffLines(rawLines);
        const result = computeSideBySideLines(diffLines);
        // result[2] should have empty right
        expect(result[2].right.originalIndex).toBeNull();
    });

    it('hunkHeader field absent on non-hunk rows', () => {
        const rawLines = ['@@ -1,1 +1,1 @@', ' ctx'];
        const diffLines = computeDiffLines(rawLines);
        const result = computeSideBySideLines(diffLines);
        expect(result[1].hunkHeader).toBeUndefined();
    });

    it('multi-hunk diff round-trip: correct row count and separator positions', () => {
        const diff = [
            'diff --git a/foo.ts b/foo.ts',
            '--- a/foo.ts',
            '+++ b/foo.ts',
            '@@ -1,3 +1,3 @@',
            ' ctx1',
            '-old1',
            '+new1',
            ' ctx2',
            '@@ -10,3 +10,3 @@',
            ' ctx3',
            '-old2',
            '+new2',
            ' ctx4',
            '@@ -20,1 +20,1 @@',
            '-old3',
            '+new3',
        ];
        const diffLines = computeDiffLines(diff);
        const result = computeSideBySideLines(diffLines);

        // 3 hunk headers + (ctx1 + pair1 + ctx2) + (ctx3 + pair2 + ctx4) + pair3
        // = 3 + 3 + 3 + 1 = 10 rows
        expect(result).toHaveLength(10);

        // Hunk header rows
        expect(result[0].hunkHeader).toBeDefined();
        expect(result[4].hunkHeader).toBeDefined();
        expect(result[8].hunkHeader).toBeDefined();
    });

    it('preserves content prefix characters', () => {
        const rawLines = ['@@ -1,1 +1,1 @@', '-old line'];
        const diffLines = computeDiffLines(rawLines);
        const result = computeSideBySideLines(diffLines);
        expect(result[1].left.content).toBe('-old line');
    });
});
