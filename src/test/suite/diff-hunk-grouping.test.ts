/**
 * Tests for Hunk Grouping Algorithm
 *
 * Tests cover:
 * - generateHunkHeader() formatting
 * - groupIntoHunks() partitioning with various context sizes
 * - Edge cases: empty input, all-context, all-changed, file boundaries
 * - Merge/split of adjacent hunks
 * - Hunk line-number bounds and precedingCollapsedCount accuracy
 */

import * as assert from 'assert';

suite('Diff Hunk Grouping Tests', () => {

    /**
     * Types mirroring the actual implementation in diff-renderer.ts
     */
    interface AlignedLine {
        oldLine: string | null;
        newLine: string | null;
        oldLineNum: number | null;
        newLineNum: number | null;
        type: 'context' | 'deletion' | 'addition' | 'modified';
    }

    interface Hunk {
        headerText: string;
        lines: AlignedLine[];
        startOldLine: number;
        startNewLine: number;
        endOldLine: number;
        endNewLine: number;
        precedingCollapsedCount: number;
    }

    // --- Pure functions copied from diff-renderer.ts ---

    function generateHunkHeader(
        startOld: number,
        countOld: number,
        startNew: number,
        countNew: number
    ): string {
        return `@@ -${startOld},${countOld} +${startNew},${countNew} @@`;
    }

    function groupIntoHunks(aligned: AlignedLine[], contextLines: number = 3): Hunk[] {
        if (aligned.length === 0) {
            return [];
        }

        const changedIndices: number[] = [];
        for (let i = 0; i < aligned.length; i++) {
            if (aligned[i].type !== 'context') {
                changedIndices.push(i);
            }
        }

        if (changedIndices.length === 0) {
            return [];
        }

        const ranges: [number, number][] = [];
        for (const idx of changedIndices) {
            const start = Math.max(0, idx - contextLines);
            const end = Math.min(aligned.length - 1, idx + contextLines);
            ranges.push([start, end]);
        }

        const merged: [number, number][] = [ranges[0]];
        for (let i = 1; i < ranges.length; i++) {
            const prev = merged[merged.length - 1];
            const cur = ranges[i];
            if (cur[0] <= prev[1] + 1) {
                prev[1] = Math.max(prev[1], cur[1]);
            } else {
                merged.push(cur);
            }
        }

        const hunks: Hunk[] = [];
        let prevEnd = -1;

        for (const [start, end] of merged) {
            const lines = aligned.slice(start, end + 1);

            let startOldLine = 1;
            let startNewLine = 1;
            let endOldLine = 1;
            let endNewLine = 1;

            for (const l of lines) {
                if (l.oldLineNum !== null) { startOldLine = l.oldLineNum; break; }
            }
            for (const l of lines) {
                if (l.newLineNum !== null) { startNewLine = l.newLineNum; break; }
            }
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].oldLineNum !== null) { endOldLine = lines[i].oldLineNum!; break; }
            }
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].newLineNum !== null) { endNewLine = lines[i].newLineNum!; break; }
            }

            const countOld = lines.filter(l => l.oldLineNum !== null).length;
            const countNew = lines.filter(l => l.newLineNum !== null).length;

            const headerText = generateHunkHeader(startOldLine, countOld, startNewLine, countNew);
            const precedingCollapsedCount = start - (prevEnd + 1);

            hunks.push({
                headerText,
                lines,
                startOldLine,
                startNewLine,
                endOldLine,
                endNewLine,
                precedingCollapsedCount
            });

            prevEnd = end;
        }

        return hunks;
    }

    // --- Test helpers ---

    function mkLine(type: AlignedLine['type'], oldNum: number | null, newNum: number | null): AlignedLine {
        return {
            oldLine: oldNum !== null ? `old line ${oldNum}` : null,
            newLine: newNum !== null ? `new line ${newNum}` : null,
            oldLineNum: oldNum,
            newLineNum: newNum,
            type
        };
    }

    function ctx(old: number, new_: number): AlignedLine { return mkLine('context', old, new_); }
    function add(new_: number): AlignedLine { return mkLine('addition', null, new_); }
    function del(old: number): AlignedLine { return mkLine('deletion', old, null); }

    // --- Tests ---

    // Test 1: Empty input → no hunks
    test('empty input returns no hunks', () => {
        const result = groupIntoHunks([], 3);
        assert.deepStrictEqual(result, []);
    });

    // Test 2: All context (no changes) → no hunks
    test('all context lines returns no hunks', () => {
        const lines: AlignedLine[] = [];
        for (let i = 1; i <= 10; i++) {
            lines.push(ctx(i, i));
        }
        const result = groupIntoHunks(lines, 3);
        assert.deepStrictEqual(result, []);
    });

    // Test 3: Single change in middle of file → one hunk with context
    test('single change in middle produces one hunk with context', () => {
        // 20 context lines, with a deletion at index 10 (old line 11, but we offset)
        const lines: AlignedLine[] = [];
        // Lines 1-10 context
        for (let i = 1; i <= 10; i++) {
            lines.push(ctx(i, i));
        }
        // Deletion at index 10 (old line 11)
        lines.push(del(11));
        // Lines 11-20 context (new side offset by -1 since deletion)
        for (let i = 12; i <= 21; i++) {
            lines.push(ctx(i, i - 1));
        }

        const result = groupIntoHunks(lines, 3);
        assert.strictEqual(result.length, 1);

        const hunk = result[0];
        // Hunk should span indices 7-13 (3 before change at 10, change, 3 after)
        assert.strictEqual(hunk.lines.length, 7);
        assert.strictEqual(hunk.precedingCollapsedCount, 7);
        // startOldLine should be 8 (first line in hunk)
        assert.strictEqual(hunk.startOldLine, 8);
        assert.strictEqual(hunk.startNewLine, 8);
    });

    // Test 4: Two changes close together → merged into one hunk
    test('two close changes merge into one hunk', () => {
        const lines: AlignedLine[] = [];
        for (let i = 1; i <= 20; i++) {
            lines.push(ctx(i, i));
        }
        // Replace indices 5 and 9 with changes
        lines[5] = del(6);
        lines[9] = add(10);

        const result = groupIntoHunks(lines, 3);
        assert.strictEqual(result.length, 1, 'should merge into one hunk');
        // Range: max(0,5-3)=2 to min(19,9+3)=12 → 11 lines
        assert.strictEqual(result[0].lines.length, 11);
    });

    // Test 5: Two changes far apart → two separate hunks
    test('two distant changes produce two separate hunks', () => {
        const lines: AlignedLine[] = [];
        for (let i = 1; i <= 30; i++) {
            lines.push(ctx(i, i));
        }
        // Changes at indices 5 and 25
        lines[5] = del(6);
        lines[25] = add(26);

        const result = groupIntoHunks(lines, 3);
        assert.strictEqual(result.length, 2, 'should produce two hunks');
        assert.ok(result[1].precedingCollapsedCount > 0, 'second hunk should have collapsed lines before it');
    });

    // Test 6: Change at start of file → no preceding context
    test('change at start of file has no preceding collapsed lines', () => {
        const lines: AlignedLine[] = [];
        lines.push(add(1));
        for (let i = 1; i <= 10; i++) {
            lines.push(ctx(i, i + 1));
        }

        const result = groupIntoHunks(lines, 3);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].precedingCollapsedCount, 0);
        // First line is the addition
        assert.strictEqual(result[0].lines[0].type, 'addition');
    });

    // Test 7: Change at end of file → no trailing context overflow
    test('change at end of file produces valid hunk', () => {
        const lines: AlignedLine[] = [];
        for (let i = 1; i <= 10; i++) {
            lines.push(ctx(i, i));
        }
        lines.push(add(11));

        const result = groupIntoHunks(lines, 3);
        assert.strictEqual(result.length, 1);
        // Last line in hunk is the addition
        const hunk = result[0];
        assert.strictEqual(hunk.lines[hunk.lines.length - 1].type, 'addition');
    });

    // Test 8: All lines changed → single hunk, no collapsed regions
    test('all lines changed produces single hunk with no collapsed lines', () => {
        const lines: AlignedLine[] = [
            del(1), del(2), del(3),
            add(1), add(2), add(3), add(4)
        ];

        const result = groupIntoHunks(lines, 3);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].lines.length, 7);
        assert.strictEqual(result[0].precedingCollapsedCount, 0);
    });

    // Test 9: contextLines = 0 → hunks contain only changed lines
    test('contextLines=0 produces hunks with only changed lines', () => {
        const lines: AlignedLine[] = [];
        for (let i = 1; i <= 10; i++) {
            lines.push(ctx(i, i));
        }
        // Change at index 5
        lines[5] = del(6);

        const result = groupIntoHunks(lines, 0);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].lines.length, 1);
        assert.strictEqual(result[0].lines[0].type, 'deletion');
    });

    // Test 10: contextLines = 1 → narrow context
    test('contextLines=1 produces narrow hunk', () => {
        const lines: AlignedLine[] = [];
        for (let i = 1; i <= 15; i++) {
            lines.push(ctx(i, i));
        }
        // Change at index 7
        lines[7] = del(8);

        const result = groupIntoHunks(lines, 1);
        assert.strictEqual(result.length, 1);
        // 1 before + change + 1 after = 3 lines
        assert.strictEqual(result[0].lines.length, 3);
    });

    // Test 11: contextLines = 5 → wider context
    test('contextLines=5 produces wider hunk', () => {
        const lines: AlignedLine[] = [];
        for (let i = 1; i <= 20; i++) {
            lines.push(ctx(i, i));
        }
        // Change at index 10
        lines[10] = del(11);

        const result = groupIntoHunks(lines, 5);
        assert.strictEqual(result.length, 1);
        // 5 before + change + 5 after = 11 lines
        assert.strictEqual(result[0].lines.length, 11);
    });

    // Test 12: generateHunkHeader formatting
    test('generateHunkHeader formats correctly', () => {
        assert.strictEqual(generateHunkHeader(1, 5, 1, 7), '@@ -1,5 +1,7 @@');
        assert.strictEqual(generateHunkHeader(10, 0, 12, 3), '@@ -10,0 +12,3 @@');
        assert.strictEqual(generateHunkHeader(100, 20, 105, 25), '@@ -100,20 +105,25 @@');
    });

    // Test 13: Adjacent additions and deletions (modified region)
    test('adjacent additions and deletions form one hunk with correct counts', () => {
        const lines: AlignedLine[] = [];
        // 5 context lines
        for (let i = 1; i <= 5; i++) {
            lines.push(ctx(i, i));
        }
        // 2 deletions + 2 additions
        lines.push(del(6));
        lines.push(del(7));
        lines.push(add(6));
        lines.push(add(7));
        // 5 more context lines
        for (let i = 8; i <= 12; i++) {
            lines.push(ctx(i, i));
        }

        const result = groupIntoHunks(lines, 3);
        assert.strictEqual(result.length, 1);

        const hunk = result[0];
        // countOld = lines with non-null oldLineNum (context + deletions)
        const countOld = hunk.lines.filter(l => l.oldLineNum !== null).length;
        // countNew = lines with non-null newLineNum (context + additions)
        const countNew = hunk.lines.filter(l => l.newLineNum !== null).length;

        // Hunk covers indices 2-11 (3 ctx before + 2 del + 2 add + 3 ctx after = 10 lines)
        // countOld = 3 ctx + 2 del + 3 ctx = 8 (additions have null oldLineNum)
        // countNew = 3 ctx + 2 add + 3 ctx = 8 (deletions have null newLineNum)
        assert.strictEqual(countOld, 8);
        assert.strictEqual(countNew, 8);
        // Verify deletions don't appear in new-side count
        const delLines = hunk.lines.filter(l => l.type === 'deletion');
        assert.strictEqual(delLines.length, 2);
        assert.ok(delLines.every(l => l.newLineNum === null));
        // Verify additions don't appear in old-side count
        const addLines = hunk.lines.filter(l => l.type === 'addition');
        assert.strictEqual(addLines.length, 2);
        assert.ok(addLines.every(l => l.oldLineNum === null));
    });

    // Test 14: Hunk line-number bounds
    test('hunk line-number bounds match first/last non-null line numbers', () => {
        const lines: AlignedLine[] = [];
        for (let i = 1; i <= 5; i++) {
            lines.push(ctx(i, i));
        }
        lines.push(del(6));
        lines.push(del(7));
        lines.push(add(6));
        lines.push(add(7));
        lines.push(add(8));
        for (let i = 8; i <= 12; i++) {
            lines.push(ctx(i, i + 1));
        }

        const result = groupIntoHunks(lines, 3);
        assert.strictEqual(result.length, 1);

        const hunk = result[0];

        // Verify bounds match actual first/last non-null line numbers
        let expectedStartOld = null as number | null;
        let expectedStartNew = null as number | null;
        let expectedEndOld = null as number | null;
        let expectedEndNew = null as number | null;

        for (const l of hunk.lines) {
            if (l.oldLineNum !== null && expectedStartOld === null) { expectedStartOld = l.oldLineNum; }
            if (l.newLineNum !== null && expectedStartNew === null) { expectedStartNew = l.newLineNum; }
            if (l.oldLineNum !== null) { expectedEndOld = l.oldLineNum; }
            if (l.newLineNum !== null) { expectedEndNew = l.newLineNum; }
        }

        assert.strictEqual(hunk.startOldLine, expectedStartOld);
        assert.strictEqual(hunk.startNewLine, expectedStartNew);
        assert.strictEqual(hunk.endOldLine, expectedEndOld);
        assert.strictEqual(hunk.endNewLine, expectedEndNew);
    });
});
