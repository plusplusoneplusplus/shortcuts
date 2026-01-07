/**
 * Tests for Diff Indicator Bar (Minimap) calculations
 *
 * These tests cover the calculation logic for:
 * - Mark positioning based on line indices
 * - Viewport indicator positioning based on scroll state
 * - Grouping consecutive changes
 * - Comment indicators on marks
 */

import * as assert from 'assert';

suite('Diff Indicator Bar Tests', () => {

    /**
     * Types mirroring the actual implementation
     */
    interface DiffLineInfo {
        index: number;
        type: 'context' | 'addition' | 'deletion';
        hasComment: boolean;
    }

    interface MarkInfo {
        startIndex: number;
        endIndex: number;
        type: 'addition' | 'deletion' | 'context' | 'modified';
        hasComment: boolean;
        topPosition: number;
        height: number;
    }

    interface ViewportInfo {
        top: number;
        height: number;
        visible: boolean;
    }

    /**
     * Pure function: Calculate mark position using percentage (for non-scrolling content)
     */
    function calculateMarkPositionPercentage(
        lineIndex: number,
        totalLines: number,
        barHeight: number
    ): number {
        if (totalLines === 0) return 0;
        return (lineIndex / totalLines) * barHeight;
    }

    /**
     * Pure function: Calculate mark height using percentage
     */
    function calculateMarkHeightPercentage(
        linesInGroup: number,
        totalLines: number,
        barHeight: number,
        minHeight: number = 2
    ): number {
        if (totalLines === 0) return minHeight;
        return Math.max((linesInGroup / totalLines) * barHeight, minHeight);
    }

    /**
     * Pure function: Calculate mark position using scroll ratio (for scrollable content)
     */
    function calculateMarkPositionScrollRatio(
        lineOffsetTop: number,
        scrollHeight: number,
        barHeight: number
    ): number {
        if (scrollHeight === 0) return 0;
        return (lineOffsetTop / scrollHeight) * barHeight;
    }

    /**
     * Pure function: Calculate mark height using scroll ratio
     */
    function calculateMarkHeightScrollRatio(
        lineHeight: number,
        linesInGroup: number,
        scrollHeight: number,
        barHeight: number,
        minHeight: number = 2
    ): number {
        if (scrollHeight === 0) return minHeight;
        return Math.max((lineHeight * linesInGroup / scrollHeight) * barHeight, minHeight);
    }

    /**
     * Pure function: Calculate viewport indicator position and size
     */
    function calculateViewportIndicator(
        scrollTop: number,
        scrollHeight: number,
        clientHeight: number,
        barHeight: number,
        minViewportHeight: number = 20
    ): ViewportInfo {
        if (scrollHeight <= clientHeight) {
            return { top: 0, height: 0, visible: false };
        }

        const viewportTop = (scrollTop / scrollHeight) * barHeight;
        const viewportHeight = Math.max((clientHeight / scrollHeight) * barHeight, minViewportHeight);

        return {
            top: viewportTop,
            height: viewportHeight,
            visible: true
        };
    }

    /**
     * Pure function: Group consecutive diff lines for indicator marks
     * Returns 'modified' type when a group contains both additions and deletions
     */
    function groupConsecutiveChanges(diffInfo: DiffLineInfo[]): MarkInfo[] {
        const marks: MarkInfo[] = [];
        let i = 0;

        while (i < diffInfo.length) {
            const lineInfo = diffInfo[i];

            // Skip context lines unless they have comments
            if (lineInfo.type === 'context' && !lineInfo.hasComment) {
                i++;
                continue;
            }

            // Find consecutive lines of the same type or consecutive changes
            // Track what types are present in this group
            let endIndex = i;
            let hasAddition = lineInfo.type === 'addition';
            let hasDeletion = lineInfo.type === 'deletion';
            
            while (endIndex < diffInfo.length - 1) {
                const nextInfo = diffInfo[endIndex + 1];
                const currentIsChange = lineInfo.type === 'addition' || lineInfo.type === 'deletion';
                const nextIsChange = nextInfo.type === 'addition' || nextInfo.type === 'deletion';

                if (currentIsChange && nextIsChange) {
                    endIndex++;
                    // Track what types are present in this group
                    if (nextInfo.type === 'addition') hasAddition = true;
                    if (nextInfo.type === 'deletion') hasDeletion = true;
                } else if (lineInfo.type === nextInfo.type) {
                    endIndex++;
                } else {
                    break;
                }
            }

            // Check if any line in this range has comments
            let hasCommentInRange = false;
            for (let j = i; j <= endIndex; j++) {
                if (diffInfo[j].hasComment) {
                    hasCommentInRange = true;
                    break;
                }
            }

            // Determine the mark type:
            // - If the group has both additions and deletions, it's a modification (blue)
            // - If only additions, show green
            // - If only deletions, show red
            // - If context with comments, show as context
            let markType: 'addition' | 'deletion' | 'context' | 'modified';
            if (hasAddition && hasDeletion) {
                markType = 'modified';
            } else if (hasAddition) {
                markType = 'addition';
            } else if (hasDeletion) {
                markType = 'deletion';
            } else {
                markType = lineInfo.type;
            }

            marks.push({
                startIndex: i,
                endIndex: endIndex,
                type: markType,
                hasComment: hasCommentInRange,
                topPosition: 0, // Will be calculated separately
                height: 0 // Will be calculated separately
            });

            i = endIndex + 1;
        }

        return marks;
    }

    /**
     * Pure function: Calculate marks with positions
     */
    function calculateMarksWithPositions(
        diffInfo: DiffLineInfo[],
        barHeight: number,
        lineOffsets?: number[], // Optional: actual line offsets for scroll-based calculation
        scrollHeight?: number
    ): MarkInfo[] {
        const marks = groupConsecutiveChanges(diffInfo);
        const totalLines = diffInfo.length;
        const useScrollRatio = lineOffsets !== undefined && scrollHeight !== undefined && scrollHeight > 0;

        for (const mark of marks) {
            if (useScrollRatio && lineOffsets![mark.startIndex] !== undefined) {
                // Use scroll ratio calculation
                const lineTop = lineOffsets![mark.startIndex];
                const linesInGroup = mark.endIndex - mark.startIndex + 1;
                const avgLineHeight = scrollHeight! / totalLines;

                mark.topPosition = calculateMarkPositionScrollRatio(lineTop, scrollHeight!, barHeight);
                mark.height = calculateMarkHeightScrollRatio(avgLineHeight, linesInGroup, scrollHeight!, barHeight);
            } else {
                // Use percentage calculation
                mark.topPosition = calculateMarkPositionPercentage(mark.startIndex, totalLines, barHeight);
                mark.height = calculateMarkHeightPercentage(mark.endIndex - mark.startIndex + 1, totalLines, barHeight);
            }
        }

        return marks;
    }

    suite('Mark Position Calculations (Percentage)', () => {

        test('should calculate position at start of file', () => {
            const position = calculateMarkPositionPercentage(0, 100, 500);
            assert.strictEqual(position, 0);
        });

        test('should calculate position at middle of file', () => {
            const position = calculateMarkPositionPercentage(50, 100, 500);
            assert.strictEqual(position, 250);
        });

        test('should calculate position at end of file', () => {
            const position = calculateMarkPositionPercentage(99, 100, 500);
            assert.strictEqual(position, 495);
        });

        test('should handle single line file', () => {
            const position = calculateMarkPositionPercentage(0, 1, 500);
            assert.strictEqual(position, 0);
        });

        test('should handle empty file', () => {
            const position = calculateMarkPositionPercentage(0, 0, 500);
            assert.strictEqual(position, 0);
        });

        test('should scale with bar height', () => {
            const position1 = calculateMarkPositionPercentage(25, 100, 400);
            const position2 = calculateMarkPositionPercentage(25, 100, 800);
            assert.strictEqual(position1, 100);
            assert.strictEqual(position2, 200);
        });
    });

    suite('Mark Height Calculations (Percentage)', () => {

        test('should calculate height for single line', () => {
            const height = calculateMarkHeightPercentage(1, 100, 500);
            assert.strictEqual(height, 5);
        });

        test('should calculate height for multiple lines', () => {
            const height = calculateMarkHeightPercentage(10, 100, 500);
            assert.strictEqual(height, 50);
        });

        test('should enforce minimum height', () => {
            const height = calculateMarkHeightPercentage(1, 10000, 500, 2);
            assert.strictEqual(height, 2);
        });

        test('should handle custom minimum height', () => {
            const height = calculateMarkHeightPercentage(1, 10000, 500, 5);
            assert.strictEqual(height, 5);
        });

        test('should handle empty file', () => {
            const height = calculateMarkHeightPercentage(1, 0, 500);
            assert.strictEqual(height, 2);
        });
    });

    suite('Mark Position Calculations (Scroll Ratio)', () => {

        test('should calculate position based on line offset', () => {
            // Line at offset 100px in a 1000px scroll height, bar is 500px
            const position = calculateMarkPositionScrollRatio(100, 1000, 500);
            assert.strictEqual(position, 50);
        });

        test('should calculate position at start', () => {
            const position = calculateMarkPositionScrollRatio(0, 1000, 500);
            assert.strictEqual(position, 0);
        });

        test('should calculate position at end', () => {
            const position = calculateMarkPositionScrollRatio(900, 1000, 500);
            assert.strictEqual(position, 450);
        });

        test('should handle zero scroll height', () => {
            const position = calculateMarkPositionScrollRatio(100, 0, 500);
            assert.strictEqual(position, 0);
        });
    });

    suite('Mark Height Calculations (Scroll Ratio)', () => {

        test('should calculate height based on line height and group size', () => {
            // Line height 20px, 5 lines, scroll height 1000px, bar 500px
            const height = calculateMarkHeightScrollRatio(20, 5, 1000, 500);
            assert.strictEqual(height, 50);
        });

        test('should enforce minimum height', () => {
            // Very small mark
            const height = calculateMarkHeightScrollRatio(10, 1, 10000, 500, 2);
            assert.strictEqual(height, 2);
        });

        test('should handle zero scroll height', () => {
            const height = calculateMarkHeightScrollRatio(20, 5, 0, 500);
            assert.strictEqual(height, 2);
        });
    });

    suite('Viewport Indicator Calculations', () => {

        test('should calculate viewport position at top', () => {
            const viewport = calculateViewportIndicator(0, 2000, 500, 400);
            assert.strictEqual(viewport.visible, true);
            assert.strictEqual(viewport.top, 0);
            assert.strictEqual(viewport.height, 100); // 500/2000 * 400 = 100
        });

        test('should calculate viewport position at middle', () => {
            const viewport = calculateViewportIndicator(750, 2000, 500, 400);
            assert.strictEqual(viewport.visible, true);
            assert.strictEqual(viewport.top, 150); // 750/2000 * 400 = 150
            assert.strictEqual(viewport.height, 100);
        });

        test('should calculate viewport position at bottom', () => {
            const viewport = calculateViewportIndicator(1500, 2000, 500, 400);
            assert.strictEqual(viewport.visible, true);
            assert.strictEqual(viewport.top, 300); // 1500/2000 * 400 = 300
            assert.strictEqual(viewport.height, 100);
        });

        test('should hide viewport when content fits without scrolling', () => {
            const viewport = calculateViewportIndicator(0, 400, 500, 400);
            assert.strictEqual(viewport.visible, false);
        });

        test('should enforce minimum viewport height', () => {
            // Very large content, small viewport
            const viewport = calculateViewportIndicator(0, 100000, 500, 400, 20);
            assert.strictEqual(viewport.visible, true);
            assert.strictEqual(viewport.height, 20);
        });

        test('should handle equal scroll and client height', () => {
            const viewport = calculateViewportIndicator(0, 500, 500, 400);
            assert.strictEqual(viewport.visible, false);
        });
    });

    suite('Grouping Consecutive Changes', () => {

        test('should group consecutive additions', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'context', hasComment: false },
                { index: 1, type: 'addition', hasComment: false },
                { index: 2, type: 'addition', hasComment: false },
                { index: 3, type: 'addition', hasComment: false },
                { index: 4, type: 'context', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].startIndex, 1);
            assert.strictEqual(marks[0].endIndex, 3);
            assert.strictEqual(marks[0].type, 'addition');
        });

        test('should group consecutive deletions', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'deletion', hasComment: false },
                { index: 1, type: 'deletion', hasComment: false },
                { index: 2, type: 'context', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].startIndex, 0);
            assert.strictEqual(marks[0].endIndex, 1);
            assert.strictEqual(marks[0].type, 'deletion');
        });

        test('should group mixed additions and deletions together as modified', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'context', hasComment: false },
                { index: 1, type: 'deletion', hasComment: false },
                { index: 2, type: 'deletion', hasComment: false },
                { index: 3, type: 'addition', hasComment: false },
                { index: 4, type: 'addition', hasComment: false },
                { index: 5, type: 'context', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            // Should be grouped as one mark (consecutive changes) with type 'modified'
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].startIndex, 1);
            assert.strictEqual(marks[0].endIndex, 4);
            assert.strictEqual(marks[0].type, 'modified', 'Mixed additions and deletions should be marked as modified');
        });

        test('should create separate marks for non-consecutive changes', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'addition', hasComment: false },
                { index: 1, type: 'context', hasComment: false },
                { index: 2, type: 'context', hasComment: false },
                { index: 3, type: 'deletion', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 2);
            assert.strictEqual(marks[0].startIndex, 0);
            assert.strictEqual(marks[0].endIndex, 0);
            assert.strictEqual(marks[1].startIndex, 3);
            assert.strictEqual(marks[1].endIndex, 3);
        });

        test('should skip context lines without comments', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'context', hasComment: false },
                { index: 1, type: 'context', hasComment: false },
                { index: 2, type: 'context', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 0);
        });

        test('should include context lines with comments', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'context', hasComment: false },
                { index: 1, type: 'context', hasComment: true },
                { index: 2, type: 'context', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].startIndex, 1);
            assert.strictEqual(marks[0].hasComment, true);
        });

        test('should track comments in change groups', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'addition', hasComment: false },
                { index: 1, type: 'addition', hasComment: true },
                { index: 2, type: 'addition', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].hasComment, true);
        });

        test('should handle empty diff', () => {
            const marks = groupConsecutiveChanges([]);
            assert.strictEqual(marks.length, 0);
        });

        test('should handle all additions', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'addition', hasComment: false },
                { index: 1, type: 'addition', hasComment: false },
                { index: 2, type: 'addition', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].startIndex, 0);
            assert.strictEqual(marks[0].endIndex, 2);
        });

        test('should handle alternating changes and context', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'addition', hasComment: false },
                { index: 1, type: 'context', hasComment: false },
                { index: 2, type: 'deletion', hasComment: false },
                { index: 3, type: 'context', hasComment: false },
                { index: 4, type: 'addition', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 3);
        });

        test('should mark addition-only group as addition', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'addition', hasComment: false },
                { index: 1, type: 'addition', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].type, 'addition');
        });

        test('should mark deletion-only group as deletion', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'deletion', hasComment: false },
                { index: 1, type: 'deletion', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].type, 'deletion');
        });

        test('should mark deletion followed by addition as modified', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'deletion', hasComment: false },
                { index: 1, type: 'addition', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].type, 'modified');
        });

        test('should mark addition followed by deletion as modified', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'addition', hasComment: false },
                { index: 1, type: 'deletion', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].type, 'modified');
        });

        test('should mark interleaved additions and deletions as modified', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'deletion', hasComment: false },
                { index: 1, type: 'addition', hasComment: false },
                { index: 2, type: 'deletion', hasComment: false },
                { index: 3, type: 'addition', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].type, 'modified');
        });

        test('should handle multiple separate change groups with different types', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'addition', hasComment: false },
                { index: 1, type: 'addition', hasComment: false },
                { index: 2, type: 'context', hasComment: false },
                { index: 3, type: 'deletion', hasComment: false },
                { index: 4, type: 'addition', hasComment: false },
                { index: 5, type: 'context', hasComment: false },
                { index: 6, type: 'deletion', hasComment: false },
                { index: 7, type: 'deletion', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 3);
            assert.strictEqual(marks[0].type, 'addition', 'First group should be addition');
            assert.strictEqual(marks[1].type, 'modified', 'Second group should be modified (deletion + addition)');
            assert.strictEqual(marks[2].type, 'deletion', 'Third group should be deletion');
        });

        test('should handle single addition as addition type', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'context', hasComment: false },
                { index: 1, type: 'addition', hasComment: false },
                { index: 2, type: 'context', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].type, 'addition');
        });

        test('should handle single deletion as deletion type', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'context', hasComment: false },
                { index: 1, type: 'deletion', hasComment: false },
                { index: 2, type: 'context', hasComment: false },
            ];

            const marks = groupConsecutiveChanges(diffInfo);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].type, 'deletion');
        });
    });

    suite('Full Mark Calculation with Positions', () => {

        test('should calculate marks with percentage positions', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'context', hasComment: false },
                { index: 1, type: 'addition', hasComment: false },
                { index: 2, type: 'addition', hasComment: false },
                { index: 3, type: 'context', hasComment: false },
                { index: 4, type: 'deletion', hasComment: true },
                { index: 5, type: 'context', hasComment: false },
            ];

            const marks = calculateMarksWithPositions(diffInfo, 300);

            assert.strictEqual(marks.length, 2);

            // First mark: additions at index 1-2
            assert.strictEqual(marks[0].startIndex, 1);
            assert.strictEqual(marks[0].endIndex, 2);
            assert.strictEqual(marks[0].type, 'addition');
            assert.strictEqual(marks[0].topPosition, 50); // 1/6 * 300 = 50
            assert.strictEqual(marks[0].height, 100); // 2/6 * 300 = 100

            // Second mark: deletion at index 4
            assert.strictEqual(marks[1].startIndex, 4);
            assert.strictEqual(marks[1].endIndex, 4);
            assert.strictEqual(marks[1].type, 'deletion');
            assert.strictEqual(marks[1].hasComment, true);
            assert.strictEqual(marks[1].topPosition, 200); // 4/6 * 300 = 200
            assert.strictEqual(marks[1].height, 50); // 1/6 * 300 = 50
        });

        test('should calculate marks with scroll ratio positions', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'context', hasComment: false },
                { index: 1, type: 'addition', hasComment: false },
                { index: 2, type: 'context', hasComment: false },
            ];

            // Line offsets: each line is 20px tall
            const lineOffsets = [0, 20, 40];
            const scrollHeight = 60;
            const barHeight = 300;

            const marks = calculateMarksWithPositions(diffInfo, barHeight, lineOffsets, scrollHeight);

            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].startIndex, 1);
            // Position: 20/60 * 300 = 100
            assert.strictEqual(marks[0].topPosition, 100);
        });

        test('should handle real-world scenario with many changes', () => {
            // Simulate a file with 100 lines, changes scattered throughout
            const diffInfo: DiffLineInfo[] = [];
            for (let i = 0; i < 100; i++) {
                if (i >= 10 && i < 15) {
                    diffInfo.push({ index: i, type: 'deletion', hasComment: i === 12 });
                } else if (i >= 50 && i < 60) {
                    diffInfo.push({ index: i, type: 'addition', hasComment: false });
                } else if (i >= 80 && i < 85) {
                    diffInfo.push({ index: i, type: 'deletion', hasComment: false });
                } else if (i >= 85 && i < 90) {
                    diffInfo.push({ index: i, type: 'addition', hasComment: true });
                } else {
                    diffInfo.push({ index: i, type: 'context', hasComment: false });
                }
            }

            const marks = calculateMarksWithPositions(diffInfo, 500);

            // Should have 3 marks: deletions at 10-14, additions at 50-59, changes at 80-89
            assert.strictEqual(marks.length, 3);

            // First mark: deletions
            assert.strictEqual(marks[0].startIndex, 10);
            assert.strictEqual(marks[0].endIndex, 14);
            assert.strictEqual(marks[0].hasComment, true);
            assert.strictEqual(marks[0].type, 'deletion');

            // Second mark: additions
            assert.strictEqual(marks[1].startIndex, 50);
            assert.strictEqual(marks[1].endIndex, 59);
            assert.strictEqual(marks[1].type, 'addition');

            // Third mark: mixed changes (grouped together as modified)
            assert.strictEqual(marks[2].startIndex, 80);
            assert.strictEqual(marks[2].endIndex, 89);
            assert.strictEqual(marks[2].hasComment, true);
            assert.strictEqual(marks[2].type, 'modified', 'Mixed deletions and additions should be marked as modified');
        });
    });

    suite('Edge Cases', () => {

        test('should handle single line file with change', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'addition', hasComment: false },
            ];

            const marks = calculateMarksWithPositions(diffInfo, 500);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].topPosition, 0);
            assert.strictEqual(marks[0].height, 500);
        });

        test('should handle very large file', () => {
            const diffInfo: DiffLineInfo[] = [];
            for (let i = 0; i < 10000; i++) {
                diffInfo.push({
                    index: i,
                    type: i === 5000 ? 'addition' : 'context',
                    hasComment: false
                });
            }

            const marks = calculateMarksWithPositions(diffInfo, 500);
            assert.strictEqual(marks.length, 1);
            // Position should be at 50% of bar height
            assert.strictEqual(marks[0].topPosition, 250);
            // Height should be minimum (2px) since 1/10000 * 500 < 2
            assert.strictEqual(marks[0].height, 2);
        });

        test('should handle file with only context lines', () => {
            const diffInfo: DiffLineInfo[] = [];
            for (let i = 0; i < 50; i++) {
                diffInfo.push({ index: i, type: 'context', hasComment: false });
            }

            const marks = calculateMarksWithPositions(diffInfo, 500);
            assert.strictEqual(marks.length, 0);
        });

        test('should handle file with all lines having comments', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'context', hasComment: true },
                { index: 1, type: 'context', hasComment: true },
                { index: 2, type: 'context', hasComment: true },
            ];

            const marks = calculateMarksWithPositions(diffInfo, 300);
            // All context lines have comments, so they should be grouped
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].startIndex, 0);
            assert.strictEqual(marks[0].endIndex, 2);
            assert.strictEqual(marks[0].hasComment, true);
        });

        test('should handle zero bar height', () => {
            const diffInfo: DiffLineInfo[] = [
                { index: 0, type: 'addition', hasComment: false },
            ];

            const marks = calculateMarksWithPositions(diffInfo, 0);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(marks[0].topPosition, 0);
            assert.strictEqual(marks[0].height, 2); // Minimum height
        });
    });

    suite('Alignment Verification', () => {

        test('marks should align with viewport when scrolled to same position', () => {
            // Scenario: User scrolls to a change, the viewport indicator should
            // be at the same position as the mark

            const diffInfo: DiffLineInfo[] = [];
            for (let i = 0; i < 100; i++) {
                diffInfo.push({
                    index: i,
                    type: i >= 40 && i < 50 ? 'addition' : 'context',
                    hasComment: false
                });
            }

            const barHeight = 500;
            const marks = calculateMarksWithPositions(diffInfo, barHeight);

            // Mark should be at 40/100 * 500 = 200
            assert.strictEqual(marks[0].topPosition, 200);

            // If user scrolls so that line 40 is at top of viewport:
            // Assuming each line is 20px, line 40 offset = 800px
            // scroll height = 2000px (100 lines * 20px)
            // client height = 500px
            const scrollTop = 800;
            const scrollHeight = 2000;
            const clientHeight = 500;

            const viewport = calculateViewportIndicator(scrollTop, scrollHeight, clientHeight, barHeight);

            // Viewport top: 800/2000 * 500 = 200
            assert.strictEqual(viewport.top, 200);

            // Both mark and viewport should be at position 200
            assert.strictEqual(marks[0].topPosition, viewport.top);
        });

        test('viewport should cover mark when mark is visible', () => {
            const barHeight = 500;
            const scrollHeight = 2000;
            const clientHeight = 500;

            // Mark at position 100, height 50
            const markTop = 100;
            const markHeight = 50;

            // Scroll so viewport covers the mark
            // Viewport top at 100 means scrollTop = 100/500 * 2000 = 400
            const scrollTop = 400;

            const viewport = calculateViewportIndicator(scrollTop, scrollHeight, clientHeight, barHeight);

            // Viewport should be at position 100, height 125 (500/2000 * 500)
            assert.strictEqual(viewport.top, 100);
            assert.strictEqual(viewport.height, 125);

            // Mark should be within viewport
            const markBottom = markTop + markHeight;
            const viewportBottom = viewport.top + viewport.height;

            assert.ok(markTop >= viewport.top, 'Mark top should be >= viewport top');
            assert.ok(markBottom <= viewportBottom, 'Mark bottom should be <= viewport bottom');
        });
    });
});

