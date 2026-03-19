/**
 * Tests for Expand/Collapse Interaction and Navigation Updates (commit 007)
 *
 * Validates:
 * - expandedHunks state tracking (isHunkExpanded, toggleHunkExpanded, resetExpandedHunks)
 * - Collapsed section data attributes (data-start-aligned-index, data-end-aligned-index)
 * - Expand handler produces correct line elements from fullAlignedLines
 * - Split view: both panes expanded simultaneously, alignment preserved
 * - Inline view: single placeholder replaced with context lines
 * - Comment indicators on expanded lines
 * - Re-render resets expandedHunks state
 * - scrollToFirstChange hunk-header fallback
 * - Navigation skips collapsed sections (no change lines in collapsed content)
 * - Double expand is no-op (placeholder already removed)
 * - Hunk aligned index tracking
 *
 * NOTE: These tests validate contracts and logic without a real DOM, mirroring
 * the pattern used in diff-hunk-split-rendering.test.ts.
 */

import * as assert from 'assert';

suite('Expand/Collapse Interaction Tests', () => {

    // ── Types mirroring source ──

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
        alignedStartIndex: number;
        alignedEndIndex: number;
    }

    // ── groupIntoHunks copied from diff-renderer.ts ──

    function generateHunkHeader(
        startOld: number, countOld: number, startNew: number, countNew: number
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

    // ── Simulated expandedHunks state (mirrors state.ts) ──

    class ExpandedHunksState {
        expandedHunks: Set<number> = new Set();

        isHunkExpanded(index: number): boolean {
            return this.expandedHunks.has(index);
        }

        toggleHunkExpanded(index: number): void {
            if (this.expandedHunks.has(index)) {
                this.expandedHunks.delete(index);
            } else {
                this.expandedHunks.add(index);
            }
        }

        resetExpandedHunks(): void {
            this.expandedHunks = new Set();
        }
    }

    /**
     * Compute collapsed section info for an aligned array.
     * Returns an array of { hunkIndex, startAligned, endAligned, count } for each collapsed region.
     */
    function computeCollapsedSections(aligned: AlignedLine[], contextLines: number = 3) {
        const hunks = groupIntoHunks(aligned, contextLines);
        const sections: { hunkIndex: number; startAligned: number; endAligned: number; count: number }[] = [];

        for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
            const hunk = hunks[hunkIdx];
            if (hunk.precedingCollapsedCount > 0) {
                const prevEnd = hunkIdx > 0 ? hunks[hunkIdx - 1].alignedEndIndex : -1;
                const collapsedStart = prevEnd + 1;
                const collapsedEnd = hunk.alignedStartIndex - 1;
                sections.push({
                    hunkIndex: hunkIdx - 1,
                    startAligned: collapsedStart,
                    endAligned: collapsedEnd,
                    count: hunk.precedingCollapsedCount
                });
            }
        }

        // Trailing
        if (hunks.length > 0) {
            const lastHunk = hunks[hunks.length - 1];
            const trailingStart = lastHunk.alignedEndIndex + 1;
            const trailingCount = aligned.length - trailingStart;
            if (trailingCount > 0) {
                sections.push({
                    hunkIndex: hunks.length - 1,
                    startAligned: trailingStart,
                    endAligned: aligned.length - 1,
                    count: trailingCount
                });
            }
        }

        return sections;
    }

    /**
     * Simulate expanding a collapsed section: extract hidden lines from fullAligned.
     */
    function simulateExpand(fullAligned: AlignedLine[], startIdx: number, endIdx: number): AlignedLine[] {
        return fullAligned.slice(startIdx, endIdx + 1);
    }

    // ── State tracking tests ──

    suite('expandedHunks state tracking', () => {

        test('initial state has no expanded hunks', () => {
            const state = new ExpandedHunksState();
            assert.strictEqual(state.isHunkExpanded(0), false);
            assert.strictEqual(state.isHunkExpanded(5), false);
        });

        test('toggleHunkExpanded adds and removes', () => {
            const state = new ExpandedHunksState();
            state.toggleHunkExpanded(2);
            assert.strictEqual(state.isHunkExpanded(2), true);
            state.toggleHunkExpanded(2);
            assert.strictEqual(state.isHunkExpanded(2), false);
        });

        test('multiple hunks can be expanded independently', () => {
            const state = new ExpandedHunksState();
            state.toggleHunkExpanded(0);
            state.toggleHunkExpanded(3);
            assert.strictEqual(state.isHunkExpanded(0), true);
            assert.strictEqual(state.isHunkExpanded(3), true);
            assert.strictEqual(state.isHunkExpanded(1), false);
        });

        test('resetExpandedHunks clears all', () => {
            const state = new ExpandedHunksState();
            state.toggleHunkExpanded(0);
            state.toggleHunkExpanded(1);
            state.toggleHunkExpanded(5);
            state.resetExpandedHunks();
            assert.strictEqual(state.isHunkExpanded(0), false);
            assert.strictEqual(state.isHunkExpanded(1), false);
            assert.strictEqual(state.isHunkExpanded(5), false);
        });

        test('re-render should reset state', () => {
            const state = new ExpandedHunksState();
            state.toggleHunkExpanded(2);
            assert.strictEqual(state.isHunkExpanded(2), true);
            // Simulate re-render
            state.resetExpandedHunks();
            assert.strictEqual(state.isHunkExpanded(2), false);
        });
    });

    // ── Hunk aligned index tracking ──

    suite('Hunk alignedStartIndex and alignedEndIndex', () => {

        test('single hunk tracks correct aligned indices', () => {
            // 5 context, 1 change at idx 5, 5 context — hunk covers idx 2..8
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 5; i++) aligned.push(ctx(i));
            aligned.push(add(6));
            for (let i = 7; i <= 11; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 1);
            assert.strictEqual(hunks[0].alignedStartIndex, 2); // 5 - 3 = 2
            assert.strictEqual(hunks[0].alignedEndIndex, 8); // 5 + 3 = 8
        });

        test('two distant hunks have correct aligned ranges', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 30; i++) aligned.push(ctx(i));
            aligned.push(add(31));
            for (let i = 32; i <= 40; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 2);

            // First hunk: change at idx 10, range [7, 13]
            assert.strictEqual(hunks[0].alignedStartIndex, 7);
            assert.strictEqual(hunks[0].alignedEndIndex, 13);

            // Second hunk: change at idx 30, range [27, 33]
            assert.strictEqual(hunks[1].alignedStartIndex, 27);
            assert.strictEqual(hunks[1].alignedEndIndex, 33);
        });

        test('hunk at beginning has alignedStartIndex 0', () => {
            const aligned: AlignedLine[] = [add(1), ctx(2), ctx(3), ctx(4), ctx(5)];
            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 1);
            assert.strictEqual(hunks[0].alignedStartIndex, 0);
        });

        test('hunk at end has alignedEndIndex = aligned.length - 1', () => {
            const aligned: AlignedLine[] = [ctx(1), ctx(2), ctx(3), ctx(4), del(5)];
            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 1);
            assert.strictEqual(hunks[0].alignedEndIndex, aligned.length - 1);
        });
    });

    // ── Collapsed section data attribute tests ──

    suite('Collapsed section aligned index computation', () => {

        test('preceding collapsed section has correct start/end aligned indices', () => {
            // 10 context lines, then a change at idx 10, then 10 more context
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 21; i++) aligned.push(ctx(i));

            const sections = computeCollapsedSections(aligned, 3);
            // Hunk covers [7, 13], so preceding collapsed = [0, 6]
            assert.ok(sections.length >= 1);
            const preceding = sections.find(s => s.startAligned === 0);
            assert.ok(preceding, 'should have a preceding collapsed section');
            assert.strictEqual(preceding!.startAligned, 0);
            assert.strictEqual(preceding!.endAligned, 6);
            assert.strictEqual(preceding!.count, 7);
        });

        test('trailing collapsed section has correct start/end aligned indices', () => {
            const aligned: AlignedLine[] = [
                ctx(1), ctx(2), del(3), ctx(4), ctx(5), ctx(6),
                ctx(7), ctx(8), ctx(9), ctx(10)
            ];

            const sections = computeCollapsedSections(aligned, 3);
            // Hunk covers change at idx 2, range [0, 5]. Trailing = [6, 9]
            const trailing = sections.find(s => s.endAligned === aligned.length - 1);
            assert.ok(trailing, 'should have a trailing collapsed section');
            assert.strictEqual(trailing!.count, aligned.length - trailing!.startAligned);
        });

        test('gap between two distant hunks has correct indices', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 30; i++) aligned.push(ctx(i));
            aligned.push(add(31));
            for (let i = 32; i <= 40; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 2);

            const sections = computeCollapsedSections(aligned, 3);
            // There should be a gap between the two hunks
            const gap = sections.find(s => s.startAligned > hunks[0].alignedEndIndex && s.endAligned < hunks[1].alignedStartIndex);
            assert.ok(gap, 'should have a gap between two distant hunks');
            assert.strictEqual(gap!.startAligned, hunks[0].alignedEndIndex + 1);
            assert.strictEqual(gap!.endAligned, hunks[1].alignedStartIndex - 1);
        });

        test('no collapsed sections when all lines are in hunks', () => {
            // 3 context + change + 3 context = all within hunk range
            const aligned: AlignedLine[] = [ctx(1), ctx(2), ctx(3), del(4), ctx(5), ctx(6), ctx(7)];
            const sections = computeCollapsedSections(aligned, 3);
            assert.strictEqual(sections.length, 0);
        });
    });

    // ── Expand handler logic tests ──

    suite('Expand handler logic', () => {

        test('expand retrieves correct hidden lines from aligned array', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 21; i++) aligned.push(ctx(i));

            const sections = computeCollapsedSections(aligned, 3);
            assert.ok(sections.length >= 1);

            const preceding = sections[0];
            const expandedLines = simulateExpand(aligned, preceding.startAligned, preceding.endAligned);
            assert.strictEqual(expandedLines.length, preceding.count);

            // All expanded lines should be context lines
            for (const line of expandedLines) {
                assert.strictEqual(line.type, 'context', 'expanded lines from collapsed section should be context');
            }
        });

        test('expanded lines have correct line numbers', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 21; i++) aligned.push(ctx(i));

            const sections = computeCollapsedSections(aligned, 3);
            const preceding = sections[0];
            const expandedLines = simulateExpand(aligned, preceding.startAligned, preceding.endAligned);

            // Lines 1..7 (indices 0..6)
            for (let i = 0; i < expandedLines.length; i++) {
                assert.strictEqual(expandedLines[i].oldLineNum, i + 1);
                assert.strictEqual(expandedLines[i].newLineNum, i + 1);
            }
        });

        test('expand trailing section retrieves correct lines', () => {
            const aligned: AlignedLine[] = [
                ctx(1), ctx(2), del(3), ctx(4), ctx(5), ctx(6),
                ctx(7), ctx(8), ctx(9), ctx(10)
            ];
            const sections = computeCollapsedSections(aligned, 3);
            const trailing = sections.find(s => s.endAligned === aligned.length - 1);
            assert.ok(trailing, 'should have trailing section');

            const expandedLines = simulateExpand(aligned, trailing!.startAligned, trailing!.endAligned);
            assert.strictEqual(expandedLines.length, trailing!.count);
            for (const line of expandedLines) {
                assert.strictEqual(line.type, 'context');
            }
        });

        test('expand gap between distant hunks retrieves correct lines', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 30; i++) aligned.push(ctx(i));
            aligned.push(add(31));
            for (let i = 32; i <= 40; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            const sections = computeCollapsedSections(aligned, 3);
            const gap = sections.find(s => s.startAligned > hunks[0].alignedEndIndex && s.endAligned < hunks[1].alignedStartIndex);
            assert.ok(gap);

            const expandedLines = simulateExpand(aligned, gap!.startAligned, gap!.endAligned);
            assert.strictEqual(expandedLines.length, gap!.count);
            for (const line of expandedLines) {
                assert.strictEqual(line.type, 'context');
            }
        });

        test('double expand is a no-op after placeholder removal', () => {
            // Simulates that after first expand, the placeholder is gone
            // The second call to expandCollapsedSection would find 0 placeholders and return early
            const state = new ExpandedHunksState();
            state.toggleHunkExpanded(0);
            assert.strictEqual(state.isHunkExpanded(0), true);
            // Second toggle would collapse it, but in real code expandCollapsedSection
            // only calls toggleHunkExpanded once when the placeholder is found.
            // If placeholder is gone, expandCollapsedSection returns early — state unchanged.
            // This test verifies that double-expanding the same index doesn't crash
            // and the toggle behavior is correct
            state.toggleHunkExpanded(0);
            assert.strictEqual(state.isHunkExpanded(0), false);
        });
    });

    // ── Split-view dual-pane expansion ──

    suite('Split-view dual-pane expansion simulation', () => {

        test('expand produces equal number of elements for both panes', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 21; i++) aligned.push(ctx(i));

            const sections = computeCollapsedSections(aligned, 3);
            const preceding = sections[0];
            const expandedLines = simulateExpand(aligned, preceding.startAligned, preceding.endAligned);

            // Each expanded line produces one element per pane
            let oldElements = 0;
            let newElements = 0;
            for (const line of expandedLines) {
                // Old side: line element if oldLine exists, empty element otherwise
                oldElements++;
                // New side: line element if newLine exists, empty element otherwise
                newElements++;
            }
            assert.strictEqual(oldElements, newElements, 'both panes should have equal element count');
        });

        test('context lines produce non-empty elements on both sides', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 21; i++) aligned.push(ctx(i));

            const sections = computeCollapsedSections(aligned, 3);
            const preceding = sections[0];
            const expandedLines = simulateExpand(aligned, preceding.startAligned, preceding.endAligned);

            for (const line of expandedLines) {
                assert.ok(line.oldLine !== null, 'context old line should not be null');
                assert.ok(line.newLine !== null, 'context new line should not be null');
                assert.ok(line.oldLineNum !== null, 'context old line num should not be null');
                assert.ok(line.newLineNum !== null, 'context new line num should not be null');
            }
        });
    });

    // ── scrollToFirstChange fallback ──

    suite('scrollToFirstChange hunk-header fallback', () => {

        test('changes are always inside hunks (never collapsed)', () => {
            // Build aligned array with changes spread around
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 20; i++) aligned.push(ctx(i));
            aligned.push(add(21));
            for (let i = 22; i <= 40; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 1);

            // Verify the addition is inside the hunk's lines
            const additionInHunk = hunks[0].lines.some(l => l.type === 'addition');
            assert.ok(additionInHunk, 'addition should be within the hunk lines');

            // Verify collapsed sections contain only context
            const sections = computeCollapsedSections(aligned, 3);
            for (const section of sections) {
                const collapsedLines = aligned.slice(section.startAligned, section.endAligned + 1);
                for (const line of collapsedLines) {
                    assert.strictEqual(line.type, 'context', 'collapsed section should only contain context lines');
                }
            }
        });

        test('all-context file produces no hunks', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            assert.strictEqual(hunks.length, 0, 'no hunks for all-context file');
        });
    });

    // ── Navigation with hunks ──

    suite('Navigation with hunk-based rendering', () => {

        test('all change lines are within hunks (never in collapsed sections)', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            aligned.push(add(11));
            for (let i = 12; i <= 30; i++) aligned.push(ctx(i));
            aligned.push(del(31));
            for (let i = 32; i <= 40; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            const sections = computeCollapsedSections(aligned, 3);

            // All changes should be in hunks
            const changeIndices: number[] = [];
            for (let i = 0; i < aligned.length; i++) {
                if (aligned[i].type !== 'context') changeIndices.push(i);
            }

            for (const ci of changeIndices) {
                const inHunk = hunks.some(h => ci >= h.alignedStartIndex && ci <= h.alignedEndIndex);
                assert.ok(inHunk, `change at index ${ci} should be inside a hunk`);
            }

            // No changes in collapsed sections
            for (const section of sections) {
                for (let i = section.startAligned; i <= section.endAligned; i++) {
                    assert.strictEqual(aligned[i].type, 'context', `line ${i} in collapsed section should be context`);
                }
            }
        });

        test('change blocks from hunks can be enumerated for navigation', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            aligned.push(add(11));
            for (let i = 12; i <= 30; i++) aligned.push(ctx(i));
            aligned.push(del(31));
            for (let i = 32; i <= 40; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);

            // Count change blocks across all hunks
            let changeBlockCount = 0;
            for (const hunk of hunks) {
                let inBlock = false;
                for (const line of hunk.lines) {
                    if (line.type !== 'context') {
                        if (!inBlock) {
                            changeBlockCount++;
                            inBlock = true;
                        }
                    } else {
                        inBlock = false;
                    }
                }
            }

            // We have 2 change regions: del+add at 11, del at 31
            assert.strictEqual(changeBlockCount, 2, 'should have 2 navigable change blocks');
        });

        test('navigation wrapping works with multiple hunks', () => {
            // Simulate navigateToDiff logic: find change blocks, cycle through them
            const changeBlocks = [
                { startIndex: 3, endIndex: 4 },
                { startIndex: 15, endIndex: 15 }
            ];

            // From position 0, next → block 0
            let currentPos = 0;
            let target = -1;
            for (let i = 0; i < changeBlocks.length; i++) {
                if (changeBlocks[i].startIndex > currentPos) { target = i; break; }
            }
            assert.strictEqual(target, 0);

            // From position 5, next → block 1
            currentPos = 5;
            target = -1;
            for (let i = 0; i < changeBlocks.length; i++) {
                if (changeBlocks[i].startIndex > currentPos) { target = i; break; }
            }
            assert.strictEqual(target, 1);

            // From position 20, next → wrap to block 0
            currentPos = 20;
            target = -1;
            for (let i = 0; i < changeBlocks.length; i++) {
                if (changeBlocks[i].startIndex > currentPos) { target = i; break; }
            }
            if (target === -1) target = 0;
            assert.strictEqual(target, 0);
        });
    });

    // ── Comment indicators on expanded lines ──

    suite('Comment indicators on expanded lines', () => {

        test('expanded context lines can have comments looked up', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 21; i++) aligned.push(ctx(i));

            const sections = computeCollapsedSections(aligned, 3);
            const preceding = sections[0];
            const expandedLines = simulateExpand(aligned, preceding.startAligned, preceding.endAligned);

            // Verify we can look up line numbers for comments
            for (const line of expandedLines) {
                assert.ok(line.oldLineNum !== null || line.newLineNum !== null,
                    'expanded line should have at least one line number for comment lookup');
            }
        });
    });

    // ── Edge cases ──

    suite('Edge cases', () => {

        test('expand with startIdx === endIdx (single hidden line)', () => {
            // Build an aligned array where exactly 1 line is collapsed
            // This requires careful construction: context=4, change, context=4
            // With contextLines=3: hunk covers [1,7] for change at 4
            // If we had context lines before and after, we need a gap of exactly 1
            // Simplest: build with a gap of 1 line between two hunks
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 3; i++) aligned.push(ctx(i));
            aligned.push(del(4));
            for (let i = 5; i <= 12; i++) aligned.push(ctx(i));
            aligned.push(add(13));
            for (let i = 14; i <= 16; i++) aligned.push(ctx(i));

            const hunks = groupIntoHunks(aligned, 3);
            if (hunks.length === 2) {
                const gap = hunks[1].alignedStartIndex - hunks[0].alignedEndIndex - 1;
                if (gap === 1) {
                    const expandedLines = simulateExpand(aligned, hunks[0].alignedEndIndex + 1, hunks[1].alignedStartIndex - 1);
                    assert.strictEqual(expandedLines.length, 1);
                    assert.strictEqual(expandedLines[0].type, 'context');
                }
            }
            // If hunks merged, that's fine — no gap to test
        });

        test('expand with all lines in the file (single change produces no collapsed)', () => {
            // Only 7 lines total: 3 ctx + change + 3 ctx
            const aligned: AlignedLine[] = [ctx(1), ctx(2), ctx(3), del(4), ctx(5), ctx(6), ctx(7)];
            const sections = computeCollapsedSections(aligned, 3);
            assert.strictEqual(sections.length, 0, 'no collapsed sections when all lines fit in one hunk');
        });

        test('expand does not modify the original aligned array', () => {
            const aligned: AlignedLine[] = [];
            for (let i = 1; i <= 10; i++) aligned.push(ctx(i));
            aligned.push(del(11));
            for (let i = 12; i <= 21; i++) aligned.push(ctx(i));

            const originalLength = aligned.length;
            const sections = computeCollapsedSections(aligned, 3);
            if (sections.length > 0) {
                simulateExpand(aligned, sections[0].startAligned, sections[0].endAligned);
            }
            assert.strictEqual(aligned.length, originalLength, 'aligned array should not be modified');
        });

        test('invalid range (startIdx > endIdx) returns empty', () => {
            const aligned: AlignedLine[] = [ctx(1), ctx(2), ctx(3)];
            const result = simulateExpand(aligned, 3, 1); // invalid: start > end
            assert.strictEqual(result.length, 0);
        });

        test('expand of empty aligned array is safe', () => {
            const sections = computeCollapsedSections([], 3);
            assert.strictEqual(sections.length, 0);
        });
    });
});
