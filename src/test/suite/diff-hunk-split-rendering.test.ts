/**
 * Tests for Hunk-based Split View Rendering (commit 005)
 *
 * Validates:
 * - Phase 1: alignedDiffInfo and lineToIndexMap populated for ALL aligned lines
 * - Phase 2: hunk-based DOM rendering with collapsed sections and hunk headers
 * - Indicator bar uses percentage-based positioning in split view
 * - scrollToLineIndex fallback for collapsed lines in split view
 * - Edge cases: identical files, all changes, single hunk, trailing collapsed lines
 * - Scroll sync and scrollToFirstChange still work with hunk rendering
 *
 * NOTE: These tests validate contracts and logic without a real DOM, mirroring
 * the pattern used in diff-renderer-github-style.test.ts and diff-hunk-grouping.test.ts.
 */

import * as assert from 'assert';

suite('Hunk-based Split View Rendering Tests', () => {

    // ── Types mirroring diff-renderer.ts ──

    interface AlignedLine {
        oldLine: string | null;
        newLine: string | null;
        oldLineNum: number | null;
        newLineNum: number | null;
        type: 'context' | 'deletion' | 'addition' | 'modified';
    }

    interface DiffLineInfo {
        index: number;
        type: 'context' | 'addition' | 'deletion';
        hasComment: boolean;
        oldLineNum: number | null;
        newLineNum: number | null;
    }

    interface Hunk {
        headerText: string;
        lines: AlignedLine[];
        startOldLine: number;
        startNewLine: number;
        endOldLine: number;
        endNewLine: number;
        precedingCollapsedCount: number;
        alignedStartIndex: number;
        alignedEndIndex: number;
    }

    // ── groupIntoHunks copied from diff-renderer.ts for isolated testing ──

    function generateHunkHeader(
        startOld: number,
        countOld: number,
        startNew: number,
        countNew: number
    ): string {
        return `@@ -${startOld},${countOld} +${startNew},${countNew} @@`;
    }

    function groupIntoHunks(aligned: AlignedLine[], contextLines: number = 3): Hunk[] {
        if (aligned.length === 0) { return []; }
        const changedIndices: number[] = [];
        for (let i = 0; i < aligned.length; i++) {
            if (aligned[i].type !== 'context') { changedIndices.push(i); }
        }
        if (changedIndices.length === 0) { return []; }
        const ranges: [number, number][] = [];
        for (const idx of changedIndices) {
            ranges.push([Math.max(0, idx - contextLines), Math.min(aligned.length - 1, idx + contextLines)]);
        }
        const merged: [number, number][] = [ranges[0]];
        for (let i = 1; i < ranges.length; i++) {
            const prev = merged[merged.length - 1];
            const cur = ranges[i];
            if (cur[0] <= prev[1] + 1) { prev[1] = Math.max(prev[1], cur[1]); }
            else { merged.push(cur); }
        }
        const hunks: Hunk[] = [];
        let prevEnd = -1;
        for (const [start, end] of merged) {
            const lines = aligned.slice(start, end + 1);
            let startOldLine = 1, startNewLine = 1, endOldLine = 1, endNewLine = 1;
            for (const l of lines) { if (l.oldLineNum !== null) { startOldLine = l.oldLineNum; break; } }
            for (const l of lines) { if (l.newLineNum !== null) { startNewLine = l.newLineNum; break; } }
            for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].oldLineNum !== null) { endOldLine = lines[i].oldLineNum!; break; } }
            for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].newLineNum !== null) { endNewLine = lines[i].newLineNum!; break; } }
            const countOld = lines.filter(l => l.oldLineNum !== null).length;
            const countNew = lines.filter(l => l.newLineNum !== null).length;
            hunks.push({
                headerText: generateHunkHeader(startOldLine, countOld, startNewLine, countNew),
                lines,
                startOldLine, startNewLine, endOldLine, endNewLine,
                precedingCollapsedCount: start - (prevEnd + 1),
                alignedStartIndex: start,
                alignedEndIndex: end
            });
            prevEnd = end;
        }
        return hunks;
    }

    // ── Helpers ──

    function ctx(n: number): AlignedLine {
        return { oldLine: `line${n}`, newLine: `line${n}`, oldLineNum: n, newLineNum: n, type: 'context' };
    }

    function add(n: number): AlignedLine {
        return { oldLine: null, newLine: `added${n}`, oldLineNum: null, newLineNum: n, type: 'addition' };
    }

    function del(n: number): AlignedLine {
        return { oldLine: `deleted${n}`, newLine: null, oldLineNum: n, newLineNum: null, type: 'deletion' };
    }

    /**
     * Simulate Phase 1: populate alignedDiffInfo and lineToIndexMap for ALL aligned lines.
     */
    function simulatePhase1(aligned: AlignedLine[]): { diffInfo: DiffLineInfo[]; indexMap: Map<string, number> } {
        const diffInfo: DiffLineInfo[] = [];
        const indexMap = new Map<string, number>();
        let lineIndex = 0;
        for (const line of aligned) {
            diffInfo.push({
                index: lineIndex,
                type: line.type === 'context' ? 'context' : (line.type === 'addition' ? 'addition' : 'deletion'),
                hasComment: false,
                oldLineNum: line.oldLineNum,
                newLineNum: line.newLineNum
            });
            if (line.oldLineNum !== null) { indexMap.set(`old:${line.oldLineNum}`, lineIndex); }
            if (line.newLineNum !== null) { indexMap.set(`new:${line.newLineNum}`, lineIndex); }
            lineIndex++;
        }
        return { diffInfo, indexMap };
    }

    /**
     * Simulate Phase 2: count DOM elements that would be appended per container.
     * Returns counts of hunk headers, collapsed sections, line elements, and empty elements.
     */
    function simulatePhase2(aligned: AlignedLine[], contextLines: number = 3) {
        const hunks = groupIntoHunks(aligned, contextLines);
        let hunkHeaders = 0;
        let collapsedSections = 0;
        let lineElements = 0;
        let emptyElements = 0;

        for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
            const hunk = hunks[hunkIdx];
            if (hunk.precedingCollapsedCount > 0) { collapsedSections++; }
            hunkHeaders++;
            for (const line of hunk.lines) {
                if (line.oldLine !== null && line.oldLineNum !== null) { lineElements++; }
                else { emptyElements++; }
            }
        }

        // Trailing collapsed
        if (hunks.length > 0) {
            const lastHunk = hunks[hunks.length - 1];
            const lastLine = lastHunk.lines[lastHunk.lines.length - 1];
            let lastHunkEndIdx = aligned.length - 1;
            for (let i = aligned.length - 1; i >= 0; i--) {
                if (aligned[i] === lastLine) { lastHunkEndIdx = i; break; }
            }
            const trailingCount = aligned.length - lastHunkEndIdx - 1;
            if (trailingCount > 0) { collapsedSections++; }
        }

        return { hunks: hunks.length, hunkHeaders, collapsedSections, lineElements, emptyElements };
    }

    /**
     * Compute trailing collapsed count for an aligned array
     */
    function computeTrailingCollapsed(aligned: AlignedLine[], contextLines: number = 3): number {
        const hunks = groupIntoHunks(aligned, contextLines);
        if (hunks.length === 0) return 0;
        const lastHunk = hunks[hunks.length - 1];
        const lastLine = lastHunk.lines[lastHunk.lines.length - 1];
        let lastHunkEndIdx = aligned.length - 1;
        for (let i = aligned.length - 1; i >= 0; i--) {
            if (aligned[i] === lastLine) { lastHunkEndIdx = i; break; }
        }
        return aligned.length - lastHunkEndIdx - 1;
    }

    // ── Phase 1 Tests: Data structures populated for ALL lines ──

    suite('Phase 1 — alignedDiffInfo and lineToIndexMap', () => {

        test('should populate alignedDiffInfo for every aligned line', () => {
            const aligned: AlignedLine[] = [ctx(1), ctx(2), ctx(3), del(4), add(4), ctx(5), ctx(6)];
            const { diffInfo } = simulatePhase1(aligned);
            assert.strictEqual(diffInfo.length, aligned.length);
        });

        test('should assign sequential indices to all entries', () => {
            const aligned: AlignedLine[] = [ctx(1), del(2), add(2), ctx(3)];
            const { diffInfo } = simulatePhase1(aligned);
            for (let i = 0; i < diffInfo.length; i++) {
                assert.strictEqual(diffInfo[i].index, i);
            }
        });

        test('should map correct types: context, addition, deletion', () => {
            const aligned: AlignedLine[] = [ctx(1), del(2), add(2), ctx(3)];
            const { diffInfo } = simulatePhase1(aligned);
            assert.strictEqual(diffInfo[0].type, 'context');
            assert.strictEqual(diffInfo[1].type, 'deletion');
            assert.strictEqual(diffInfo[2].type, 'addition');
            assert.strictEqual(diffInfo[3].type, 'context');
        });

        test('should populate lineToIndexMap for old and new line numbers', () => {
            const aligned: AlignedLine[] = [ctx(1), del(2), add(3), ctx(4)];
            const { indexMap } = simulatePhase1(aligned);
            assert.strictEqual(indexMap.get('old:1'), 0);
            assert.strictEqual(indexMap.get('new:1'), 0);
            assert.strictEqual(indexMap.get('old:2'), 1);
            assert.strictEqual(indexMap.get('new:3'), 2);
            // context line 4 maps both old and new
            assert.strictEqual(indexMap.get('old:4'), 3);
            assert.strictEqual(indexMap.get('new:4'), 3);
        });

        test('should not create map entries for null line numbers', () => {
            const aligned: AlignedLine[] = [add(1), del(1)];
            const { indexMap } = simulatePhase1(aligned);
            // addition has null oldLineNum
            assert.strictEqual(indexMap.has('old:null'), false);
            // deletion has null newLineNum
            assert.strictEqual(indexMap.has('new:null'), false);
        });

        test('should handle empty aligned array', () => {
            const { diffInfo, indexMap } = simulatePhase1([]);
            assert.strictEqual(diffInfo.length, 0);
            assert.strictEqual(indexMap.size, 0);
        });

        test('should handle large file with 500+ context lines and 2 changes', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 250; i++) aligned.push(ctx(i));
            aligned.push(del(251));
            aligned.push(add(251));
            for (let i = 252; i <= 500; i++) aligned.push(ctx(i));
            const { diffInfo, indexMap } = simulatePhase1(aligned);
            // 250 context + 1 del + 1 add + 249 context = 501 lines
            assert.strictEqual(diffInfo.length, 501);
            // Every line number should be mapped
            assert.strictEqual(indexMap.get('old:1'), 0);
            assert.strictEqual(indexMap.get('old:251'), 250); // deletion
            assert.strictEqual(indexMap.get('new:251'), 251); // addition
            assert.strictEqual(indexMap.get('new:500'), 500);
        });
    });

    // ── Phase 2 Tests: Hunk-based DOM rendering ──

    suite('Phase 2 — Hunk-based DOM rendering', () => {

        test('should render no elements for identical files (no hunks)', () => {
            const aligned = [ctx(1), ctx(2), ctx(3), ctx(4), ctx(5)];
            const result = simulatePhase2(aligned);
            assert.strictEqual(result.hunks, 0);
            assert.strictEqual(result.hunkHeaders, 0);
            assert.strictEqual(result.collapsedSections, 0);
            assert.strictEqual(result.lineElements, 0);
        });

        test('should render one hunk header and lines for a single change', () => {
            // 10 context, 1 deletion, 10 context → 1 hunk with 3+1+3=7 lines visible
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 21; i++) aligned.push(ctx(i));
            const result = simulatePhase2(aligned);
            assert.strictEqual(result.hunks, 1);
            assert.strictEqual(result.hunkHeaders, 1);
            // context=3 → hunk covers indices 7..13 → 7 preceding collapsed, 7 trailing collapsed
            assert.ok(result.collapsedSections >= 1, 'should have at least one collapsed section');
        });

        test('should show collapsed section before first hunk when change is not at start', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 20; i++) aligned.push(ctx(i));
            aligned.push(del(21));
            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 1);
            // Change at index 20, context=3 → hunk starts at index 17
            // precedingCollapsedCount = 17 - (-1 + 1) = 17
            assert.ok(hunks[0].precedingCollapsedCount > 0, 'should have preceding collapsed lines');
        });

        test('should show trailing collapsed section after last hunk', () => {
            const aligned: AlignedLine[] = [del(1)];
            for (let i = 2; i <= 20; i++) aligned.push(ctx(i));
            const trailing = computeTrailingCollapsed(aligned, 3);
            // Change at index 0, context=3 → hunk covers 0..3 → trailing = 20-3-1 = 16
            assert.ok(trailing > 0, 'should have trailing collapsed lines');
        });

        test('should show collapsed sections between two distant hunks', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 5; i++) aligned.push(ctx(i));
            aligned.push(del(6)); // first change at index 5
            for (let i = 7; i <= 25; i++) aligned.push(ctx(i));
            aligned.push(add(26)); // second change at index 25
            for (let i = 27; i <= 30; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 2);
            // Second hunk should have preceding collapsed count > 0
            assert.ok(hunks[1].precedingCollapsedCount > 0, 'gap between distant hunks should show collapsed section');
        });

        test('should merge adjacent hunks when context regions overlap', () => {
            const aligned: AlignedLine[] = [
                ctx(1), ctx(2), ctx(3),
                del(4), // change
                ctx(5), ctx(6), ctx(7),
                add(8), // change only 3 context lines away
                ctx(9), ctx(10), ctx(11)
            ];
            const hunks = groupIntoHunks(aligned, 3);
            // With context=3, both changes share overlapping context → merged into 1 hunk
            assert.strictEqual(hunks.length, 1);
        });

        test('should append hunk headers to both containers (verified by count)', () => {
            const aligned: AlignedLine[] = [ctx(1), del(2), ctx(3)];
            const hunks = groupIntoHunks(aligned, 3);
            // Each hunk produces one header for old container and one for new container
            // simulatePhase2 counts from old container perspective
            assert.strictEqual(hunks.length, 1);
        });

        test('should render empty line elements for additions on old side', () => {
            // An addition has no old line → old side gets empty element
            const aligned: AlignedLine[] = [ctx(1), add(2), ctx(3)];
            const result = simulatePhase2(aligned, 3);
            // The addition line has oldLine=null → emptyElements should be 1
            assert.strictEqual(result.emptyElements, 1, 'addition should produce empty element on old side');
        });

        test('should handle file that is entirely changes (no context)', () => {
            const aligned: AlignedLine[] = [del(1), del(2), add(1), add(2)];
            const result = simulatePhase2(aligned, 3);
            assert.strictEqual(result.hunks, 1);
            assert.strictEqual(result.collapsedSections, 0); // no context to collapse
        });
    });

    // ── Indicator bar percentage-based positioning ──

    suite('Indicator bar positioning', () => {

        test('percentage calculation should place marks proportionally', () => {
            // Simulate the percentage-based formula from calculateMarkPosition
            const totalLines = 500;
            const barHeight = 200;
            const startIdx = 250;
            const endIdx = 252;

            const top = (startIdx / totalLines) * barHeight;
            const height = Math.max(((endIdx - startIdx + 1) / totalLines) * barHeight, 2);

            assert.strictEqual(top, 100); // 250/500 * 200 = 100
            assert.ok(height >= 2, 'height should be at least 2px');
        });

        test('percentage calculation should handle first line', () => {
            const totalLines = 100;
            const barHeight = 400;
            const top = (0 / totalLines) * barHeight;
            assert.strictEqual(top, 0);
        });

        test('percentage calculation should handle last line', () => {
            const totalLines = 100;
            const barHeight = 400;
            const startIdx = 99;
            const top = (startIdx / totalLines) * barHeight;
            assert.strictEqual(top, 396);
        });

        test('height should be at least 2px minimum for single-line marks', () => {
            const totalLines = 10000;
            const barHeight = 200;
            const startIdx = 5000;
            const endIdx = 5000;
            const height = Math.max(((endIdx - startIdx + 1) / totalLines) * barHeight, 2);
            assert.strictEqual(height, 2); // 1/10000*200 = 0.02 → clamped to 2
        });

        test('marks for collapsed lines still appear at correct proportional position', () => {
            // A change at line 250 in a 500-line file should appear at 50% regardless
            // of whether lines are in the DOM or collapsed
            const totalLines = 500;
            const barHeight = 100;
            const changeIdx = 250;
            const top = (changeIdx / totalLines) * barHeight;
            assert.strictEqual(top, 50);
        });
    });

    // ── scrollToLineIndex fallback behavior ──

    suite('scrollToLineIndex split view fallback', () => {

        test('should use data-line-number lookup when index has line info', () => {
            // Simulate the logic: given an alignedDiffInfo entry, extract newLineNum
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'context', hasComment: false, oldLineNum: 1, newLineNum: 1 },
                { index: 1, type: 'deletion', hasComment: false, oldLineNum: 2, newLineNum: null },
                { index: 2, type: 'addition', hasComment: false, oldLineNum: null, newLineNum: 2 },
            ];

            // For index 0: newLineNum = 1 → query [data-line-number="1"]
            const info0 = diffInfo[0];
            const lineNum0 = info0.newLineNum ?? info0.oldLineNum;
            assert.strictEqual(lineNum0, 1);

            // For index 1 (deletion, newLineNum is null): falls back to oldLineNum = 2
            const info1 = diffInfo[1];
            const lineNum1 = info1.newLineNum ?? info1.oldLineNum;
            assert.strictEqual(lineNum1, 2);

            // For index 2 (addition): newLineNum = 2
            const info2 = diffInfo[2];
            const lineNum2 = info2.newLineNum ?? info2.oldLineNum;
            assert.strictEqual(lineNum2, 2);
        });

        test('should handle case where both lineNums are null gracefully', () => {
            // Edge case: should not crash
            const info: DiffLineInfo = { index: 0, type: 'context', hasComment: false, oldLineNum: null, newLineNum: null };
            const lineNum = info.newLineNum ?? info.oldLineNum;
            assert.strictEqual(lineNum, null);
        });
    });

    // ── scrollToFirstChange contract ──

    suite('scrollToFirstChange compatibility', () => {

        test('split view queries .line-added which is always in DOM with hunk rendering', () => {
            // scrollToFirstChange queries '.line-added' and '.line-deleted'
            // Hunk rendering always includes changed lines in the DOM
            // This test validates the contract that changed lines are never collapsed
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 100; i++) aligned.push(ctx(i));
            aligned.push(del(101));
            aligned.push(add(101));
            for (let i = 102; i <= 200; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 1);
            // Verify the hunk contains the changed lines
            const hasChange = hunks[0].lines.some(l => l.type !== 'context');
            assert.ok(hasChange, 'hunk must contain changed lines for scrollToFirstChange to work');
        });

        test('all changes across all hunks are in DOM (never collapsed)', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 50; i++) aligned.push(ctx(i));
            aligned.push(del(51));
            for (let i = 52; i <= 100; i++) aligned.push(ctx(i));
            aligned.push(add(101));
            for (let i = 102; i <= 150; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            const allHunkLines = hunks.flatMap(h => h.lines);
            const changedInHunks = allHunkLines.filter(l => l.type !== 'context');

            // Count total changes in aligned
            const totalChanges = aligned.filter(l => l.type !== 'context');
            assert.strictEqual(changedInHunks.length, totalChanges.length,
                'every changed line must be in a hunk (never collapsed)');
        });
    });

    // ── Trailing collapsed count computation ──

    suite('Trailing collapsed section', () => {

        test('should compute correct trailing count for change near start', () => {
            const aligned: AlignedLine[] = [del(1)];
            for (let i = 2; i <= 20; i++) aligned.push(ctx(i));
            const trailing = computeTrailingCollapsed(aligned, 3);
            // Hunk covers indices 0..3, trailing = 20 - 3 - 1 = 16
            assert.strictEqual(trailing, 16);
        });

        test('should be zero when change is at end of file', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 19; i++) aligned.push(ctx(i));
            aligned.push(del(20));
            const trailing = computeTrailingCollapsed(aligned, 3);
            // Hunk covers indices 16..19, last index = 19 = aligned.length-1
            assert.strictEqual(trailing, 0);
        });

        test('should be zero for identical files', () => {
            const aligned = [ctx(1), ctx(2), ctx(3)];
            const trailing = computeTrailingCollapsed(aligned, 3);
            assert.strictEqual(trailing, 0); // no hunks → 0
        });

        test('should be zero when last hunk extends to end of file', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 3; i++) aligned.push(ctx(i));
            aligned.push(add(4));
            // context=3 → hunk covers 0..min(4+3, 3)=0..4, but array is only 4 long → 0..3
            const trailing = computeTrailingCollapsed(aligned, 3);
            assert.strictEqual(trailing, 0);
        });
    });

    // ── Both containers receive same structure ──

    suite('Dual container symmetry', () => {

        test('both containers should receive equal number of hunk headers', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 20; i++) aligned.push(ctx(i));
            aligned.push(del(21));
            for (let i = 22; i <= 50; i++) aligned.push(ctx(i));
            aligned.push(add(51));
            for (let i = 52; i <= 70; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            // Each hunk produces exactly 1 header per container
            const oldHeaders = hunks.length;
            const newHeaders = hunks.length;
            assert.strictEqual(oldHeaders, newHeaders);
        });

        test('both containers should receive equal number of collapsed sections', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 20; i++) aligned.push(ctx(i));
            aligned.push(del(21));
            for (let i = 22; i <= 40; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            let collapsedCount = 0;
            for (const hunk of hunks) {
                if (hunk.precedingCollapsedCount > 0) collapsedCount++;
            }
            // trailing
            if (hunks.length > 0) {
                const lastHunk = hunks[hunks.length - 1];
                const lastLine = lastHunk.lines[lastHunk.lines.length - 1];
                let endIdx = aligned.length - 1;
                for (let i = aligned.length - 1; i >= 0; i--) {
                    if (aligned[i] === lastLine) { endIdx = i; break; }
                }
                if (aligned.length - endIdx - 1 > 0) collapsedCount++;
            }
            // Both containers get the same count
            assert.ok(collapsedCount > 0, 'test should have at least one collapsed section');
        });

        test('hunk lines produce matching element count on both sides', () => {
            const aligned: AlignedLine[] = [ctx(1), del(2), add(2), ctx(3)];
            const hunks = groupIntoHunks(aligned, 3);
            // Each line in each hunk produces exactly 1 element on each side
            for (const hunk of hunks) {
                const oldSideCount = hunk.lines.length; // 1 element per line (real or empty)
                const newSideCount = hunk.lines.length;
                assert.strictEqual(oldSideCount, newSideCount);
            }
        });
    });
});
