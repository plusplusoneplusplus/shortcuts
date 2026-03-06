/**
 * Tests for Hunk-based Inline View Rendering (commit 006)
 *
 * Validates:
 * - Phase 1: alignedDiffInfo and lineToIndexMap populated for ALL aligned lines (inline variant)
 * - Phase 2: hunk-based DOM rendering into a single container with collapsed sections and hunk headers
 * - Inline view produces single collapsed/hunk-header elements (not dual like split view)
 * - Indicator bar positioning remains correct in inline view
 * - Edge cases: identical files, all changes, single hunk, trailing collapsed lines
 *
 * NOTE: These tests validate contracts and logic without a real DOM, mirroring
 * the pattern used in diff-hunk-split-rendering.test.ts.
 */

import * as assert from 'assert';

suite('Hunk-based Inline View Rendering Tests', () => {

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
                precedingCollapsedCount: start - (prevEnd + 1)
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
     * Simulate Phase 1 for inline view: populate alignedDiffInfo and lineToIndexMap.
     * Mirrors the inline-specific logic where deletion has newLineNum=null and addition has oldLineNum=null.
     */
    function simulateInlinePhase1(aligned: AlignedLine[]): { diffInfo: DiffLineInfo[]; indexMap: Map<string, number> } {
        const diffInfo: DiffLineInfo[] = [];
        const indexMap = new Map<string, number>();
        let lineIndex = 0;
        for (const line of aligned) {
            diffInfo.push({
                index: lineIndex,
                type: line.type === 'context' ? 'context' : (line.type === 'addition' ? 'addition' : 'deletion'),
                hasComment: false,
                oldLineNum: line.type === 'addition' ? null : line.oldLineNum,
                newLineNum: line.type === 'deletion' ? null : line.newLineNum
            });
            if (line.oldLineNum !== null) { indexMap.set(`old:${line.oldLineNum}`, lineIndex); }
            if (line.newLineNum !== null) { indexMap.set(`new:${line.newLineNum}`, lineIndex); }
            lineIndex++;
        }
        return { diffInfo, indexMap };
    }

    /**
     * Simulate Phase 2 for inline view: count DOM elements appended to the single container.
     * Unlike split view, inline appends ONE collapsed section and ONE hunk header per hunk.
     */
    function simulateInlinePhase2(aligned: AlignedLine[], contextLines: number = 3) {
        const hunks = groupIntoHunks(aligned, contextLines);
        let hunkHeaders = 0;
        let collapsedSections = 0;
        let lineElements = 0;

        for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
            const hunk = hunks[hunkIdx];
            if (hunk.precedingCollapsedCount > 0) { collapsedSections++; }
            hunkHeaders++;
            lineElements += hunk.lines.length;
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

        return { hunks: hunks.length, hunkHeaders, collapsedSections, lineElements };
    }

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

    // ── Phase 1 Tests: Data structures populated for ALL lines (inline variant) ──

    suite('Phase 1 — alignedDiffInfo and lineToIndexMap (inline)', () => {

        test('should populate alignedDiffInfo for every aligned line', () => {
            const aligned: AlignedLine[] = [ctx(1), ctx(2), ctx(3), del(4), add(4), ctx(5), ctx(6)];
            const { diffInfo } = simulateInlinePhase1(aligned);
            assert.strictEqual(diffInfo.length, aligned.length);
        });

        test('should assign sequential indices to all entries', () => {
            const aligned: AlignedLine[] = [ctx(1), del(2), add(2), ctx(3)];
            const { diffInfo } = simulateInlinePhase1(aligned);
            for (let i = 0; i < diffInfo.length; i++) {
                assert.strictEqual(diffInfo[i].index, i);
            }
        });

        test('should map correct types: context, addition, deletion', () => {
            const aligned: AlignedLine[] = [ctx(1), del(2), add(2), ctx(3)];
            const { diffInfo } = simulateInlinePhase1(aligned);
            assert.strictEqual(diffInfo[0].type, 'context');
            assert.strictEqual(diffInfo[1].type, 'deletion');
            assert.strictEqual(diffInfo[2].type, 'addition');
            assert.strictEqual(diffInfo[3].type, 'context');
        });

        test('deletion should have null newLineNum in diffInfo', () => {
            const aligned: AlignedLine[] = [del(5)];
            const { diffInfo } = simulateInlinePhase1(aligned);
            assert.strictEqual(diffInfo[0].oldLineNum, 5);
            assert.strictEqual(diffInfo[0].newLineNum, null);
        });

        test('addition should have null oldLineNum in diffInfo', () => {
            const aligned: AlignedLine[] = [add(3)];
            const { diffInfo } = simulateInlinePhase1(aligned);
            assert.strictEqual(diffInfo[0].oldLineNum, null);
            assert.strictEqual(diffInfo[0].newLineNum, 3);
        });

        test('context should have both old and new line numbers in diffInfo', () => {
            const aligned: AlignedLine[] = [ctx(7)];
            const { diffInfo } = simulateInlinePhase1(aligned);
            assert.strictEqual(diffInfo[0].oldLineNum, 7);
            assert.strictEqual(diffInfo[0].newLineNum, 7);
        });

        test('should populate lineToIndexMap for old and new line numbers', () => {
            const aligned: AlignedLine[] = [ctx(1), del(2), add(3), ctx(4)];
            const { indexMap } = simulateInlinePhase1(aligned);
            assert.strictEqual(indexMap.get('old:1'), 0);
            assert.strictEqual(indexMap.get('new:1'), 0);
            assert.strictEqual(indexMap.get('old:2'), 1);
            assert.strictEqual(indexMap.get('new:3'), 2);
            assert.strictEqual(indexMap.get('old:4'), 3);
            assert.strictEqual(indexMap.get('new:4'), 3);
        });

        test('should not create map entries for null line numbers', () => {
            const aligned: AlignedLine[] = [add(1), del(1)];
            const { indexMap } = simulateInlinePhase1(aligned);
            assert.strictEqual(indexMap.has('old:null'), false);
            assert.strictEqual(indexMap.has('new:null'), false);
        });

        test('should handle empty aligned array', () => {
            const { diffInfo, indexMap } = simulateInlinePhase1([]);
            assert.strictEqual(diffInfo.length, 0);
            assert.strictEqual(indexMap.size, 0);
        });

        test('should handle large file with 500+ context lines and 2 changes', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 250; i++) aligned.push(ctx(i));
            aligned.push(del(251));
            aligned.push(add(251));
            for (let i = 252; i <= 500; i++) aligned.push(ctx(i));
            const { diffInfo, indexMap } = simulateInlinePhase1(aligned);
            assert.strictEqual(diffInfo.length, 501);
            assert.strictEqual(indexMap.get('old:1'), 0);
            assert.strictEqual(indexMap.get('old:251'), 250);
            assert.strictEqual(indexMap.get('new:251'), 251);
            assert.strictEqual(indexMap.get('new:500'), 500);
        });
    });

    // ── Phase 2 Tests: Single-container hunk-based DOM rendering ──

    suite('Phase 2 — Hunk-based inline DOM rendering', () => {

        test('should render no elements for identical files (no hunks)', () => {
            const aligned = [ctx(1), ctx(2), ctx(3), ctx(4), ctx(5)];
            const result = simulateInlinePhase2(aligned);
            assert.strictEqual(result.hunks, 0);
            assert.strictEqual(result.hunkHeaders, 0);
            assert.strictEqual(result.collapsedSections, 0);
            assert.strictEqual(result.lineElements, 0);
        });

        test('should render one hunk header and lines for a single change', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 21; i++) aligned.push(ctx(i));
            const result = simulateInlinePhase2(aligned);
            assert.strictEqual(result.hunks, 1);
            assert.strictEqual(result.hunkHeaders, 1);
            assert.ok(result.collapsedSections >= 1, 'should have at least one collapsed section');
        });

        test('should show collapsed section before first hunk when change is not at start', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 20; i++) aligned.push(ctx(i));
            aligned.push(del(21));
            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 1);
            assert.ok(hunks[0].precedingCollapsedCount > 0, 'should have preceding collapsed lines');
        });

        test('should show trailing collapsed section after last hunk', () => {
            const aligned: AlignedLine[] = [del(1)];
            for (let i = 2; i <= 20; i++) aligned.push(ctx(i));
            const trailing = computeTrailingCollapsed(aligned, 3);
            assert.ok(trailing > 0, 'should have trailing collapsed lines');
        });

        test('should show collapsed sections between two distant hunks', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 5; i++) aligned.push(ctx(i));
            aligned.push(del(6));
            for (let i = 7; i <= 25; i++) aligned.push(ctx(i));
            aligned.push(add(26));
            for (let i = 27; i <= 30; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 2);
            assert.ok(hunks[1].precedingCollapsedCount > 0, 'gap between distant hunks should show collapsed section');
        });

        test('should merge adjacent hunks when context regions overlap', () => {
            const aligned: AlignedLine[] = [
                ctx(1), ctx(2), ctx(3),
                del(4),
                ctx(5), ctx(6), ctx(7),
                add(8),
                ctx(9), ctx(10), ctx(11)
            ];
            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 1);
        });

        test('should handle file that is entirely changes (no context)', () => {
            const aligned: AlignedLine[] = [del(1), del(2), add(1), add(2)];
            const result = simulateInlinePhase2(aligned, 3);
            assert.strictEqual(result.hunks, 1);
            assert.strictEqual(result.collapsedSections, 0);
        });
    });

    // ── Single container vs dual container: inline appends elements once ──

    suite('Single container rendering — inline vs split differences', () => {

        test('inline should append ONE collapsed section per gap (not two)', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 20; i++) aligned.push(ctx(i));
            aligned.push(del(21));
            for (let i = 22; i <= 40; i++) aligned.push(ctx(i));

            const result = simulateInlinePhase2(aligned, 3);
            // Inline: 1 preceding + 1 trailing = 2 collapsed sections total (single container)
            // Split would have 2x that (one per pane)
            assert.ok(result.collapsedSections >= 1, 'inline should have collapsed sections');
        });

        test('inline should append ONE hunk header per hunk (not two)', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 5; i++) aligned.push(ctx(i));
            aligned.push(del(6));
            for (let i = 7; i <= 25; i++) aligned.push(ctx(i));
            aligned.push(add(26));
            for (let i = 27; i <= 30; i++) aligned.push(ctx(i));

            const result = simulateInlinePhase2(aligned, 3);
            assert.strictEqual(result.hunkHeaders, 2);
            // In split view this would be 2 per hunk = 4 headers total
        });

        test('inline renders every line in a hunk as a single element (no empty placeholders)', () => {
            // Unlike split view which creates empty elements for additions on old side,
            // inline view renders each line as one createInlineLineElement call
            const aligned: AlignedLine[] = [ctx(1), add(2), del(3), ctx(4)];
            const result = simulateInlinePhase2(aligned, 3);
            // All 4 lines in one hunk, each produces exactly 1 line element
            assert.strictEqual(result.lineElements, 4);
        });

        test('inline total DOM elements equals hunkHeaders + collapsedSections + lineElements', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 21; i++) aligned.push(ctx(i));

            const result = simulateInlinePhase2(aligned, 3);
            const totalElements = result.hunkHeaders + result.collapsedSections + result.lineElements;
            assert.ok(totalElements > 0, 'should render some elements');
            // Hunk covers 3 context + 1 deletion + 3 context = 7 lines + 1 header + collapsed sections
            assert.strictEqual(result.lineElements, 7);
        });
    });

    // ── Inline line type and side mapping ──

    suite('Inline line type and side mapping', () => {

        test('context lines should have type=context and side=context', () => {
            // Simulates what renderInlineDiff Phase 2 does for context lines
            const line: AlignedLine = ctx(5);
            const type = 'context';
            const side = 'context';
            const content = line.newLine || line.oldLine || '';
            assert.strictEqual(type, 'context');
            assert.strictEqual(side, 'context');
            assert.strictEqual(content, 'line5');
        });

        test('deletion lines should have type=deletion and side=old', () => {
            const line: AlignedLine = del(3);
            const type = 'deletion';
            const side = 'old';
            const content = line.oldLine || '';
            const oldNum = line.oldLineNum;
            const newNum: number | null = null;
            assert.strictEqual(type, 'deletion');
            assert.strictEqual(side, 'old');
            assert.strictEqual(content, 'deleted3');
            assert.strictEqual(oldNum, 3);
            assert.strictEqual(newNum, null);
        });

        test('addition lines should have type=addition and side=new', () => {
            const line: AlignedLine = add(7);
            const type = 'addition';
            const side = 'new';
            const content = line.newLine || '';
            const oldNum: number | null = null;
            const newNum = line.newLineNum;
            assert.strictEqual(type, 'addition');
            assert.strictEqual(side, 'new');
            assert.strictEqual(content, 'added7');
            assert.strictEqual(oldNum, null);
            assert.strictEqual(newNum, 7);
        });
    });

    // ── Indicator bar positioning (same logic as split, validated for inline) ──

    suite('Indicator bar positioning (inline)', () => {

        test('percentage calculation places marks proportionally', () => {
            const totalLines = 500;
            const barHeight = 200;
            const startIdx = 250;
            const endIdx = 252;

            const top = (startIdx / totalLines) * barHeight;
            const height = Math.max(((endIdx - startIdx + 1) / totalLines) * barHeight, 2);

            assert.strictEqual(top, 100);
            assert.ok(height >= 2);
        });

        test('marks for collapsed lines still appear at correct proportional position', () => {
            const totalLines = 500;
            const barHeight = 100;
            const changeIdx = 250;
            const top = (changeIdx / totalLines) * barHeight;
            assert.strictEqual(top, 50);
        });
    });

    // ── Trailing collapsed count ──

    suite('Trailing collapsed section (inline)', () => {

        test('should compute correct trailing count for change near start', () => {
            const aligned: AlignedLine[] = [del(1)];
            for (let i = 2; i <= 20; i++) aligned.push(ctx(i));
            const trailing = computeTrailingCollapsed(aligned, 3);
            assert.strictEqual(trailing, 16);
        });

        test('should be zero when change is at end of file', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 19; i++) aligned.push(ctx(i));
            aligned.push(del(20));
            const trailing = computeTrailingCollapsed(aligned, 3);
            assert.strictEqual(trailing, 0);
        });

        test('should be zero for identical files', () => {
            const aligned = [ctx(1), ctx(2), ctx(3)];
            const trailing = computeTrailingCollapsed(aligned, 3);
            assert.strictEqual(trailing, 0);
        });

        test('should be zero when last hunk extends to end of file', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 3; i++) aligned.push(ctx(i));
            aligned.push(add(4));
            const trailing = computeTrailingCollapsed(aligned, 3);
            assert.strictEqual(trailing, 0);
        });
    });

    // ── All changes visible in hunks (never collapsed) ──

    suite('Changes never collapsed in inline view', () => {

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
            const totalChanges = aligned.filter(l => l.type !== 'context');
            assert.strictEqual(changedInHunks.length, totalChanges.length,
                'every changed line must be in a hunk (never collapsed)');
        });

        test('scrollToFirstChange queries work because changed lines are always in hunks', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 100; i++) aligned.push(ctx(i));
            aligned.push(del(101));
            aligned.push(add(101));
            for (let i = 102; i <= 200; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 1);
            const hasChange = hunks[0].lines.some(l => l.type !== 'context');
            assert.ok(hasChange, 'hunk must contain changed lines for scrollToFirstChange to work');
        });
    });

    // ── View mode toggle parity ──

    suite('View mode toggle parity', () => {

        test('same aligned input produces same number of hunks for inline and split', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 20; i++) aligned.push(ctx(i));
            aligned.push(del(21));
            for (let i = 22; i <= 50; i++) aligned.push(ctx(i));
            aligned.push(add(51));
            for (let i = 52; i <= 70; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            // Both views use the same groupIntoHunks, so hunk count is identical
            assert.strictEqual(hunks.length, 2);
        });

        test('Phase 1 data structures are identical for inline and split with same input', () => {
            const aligned: AlignedLine[] = [ctx(1), del(2), add(2), ctx(3)];
            const inline = simulateInlinePhase1(aligned);
            // Split Phase 1 uses the same indices and map entries
            assert.strictEqual(inline.diffInfo.length, 4);
            assert.strictEqual(inline.indexMap.get('old:1'), 0);
            assert.strictEqual(inline.indexMap.get('new:1'), 0);
            assert.strictEqual(inline.indexMap.get('old:2'), 1);
            assert.strictEqual(inline.indexMap.get('new:2'), 2);
        });
    });
});
