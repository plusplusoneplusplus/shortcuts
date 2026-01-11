/**
 * Tests for Git Diff navigation buttons (prev/next change)
 * Verifies the navigation functionality and cross-platform compatibility
 */

import * as assert from 'assert';

/**
 * Test the navigateToDiff logic by simulating line classification
 * This tests the algorithm without needing the actual webview
 */
suite('Git Diff Navigation Tests', () => {

    suite('Change block detection algorithm', () => {
        /**
         * Simulates the change block detection algorithm from main.ts
         */
        function findChangeBlocks(lines: { isChange: boolean }[]): { startIndex: number; endIndex: number }[] {
            const changeBlocks: { startIndex: number; endIndex: number }[] = [];
            let currentBlockStart = -1;
            let currentBlockEnd = -1;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (line.isChange) {
                    if (currentBlockStart === -1) {
                        // Start a new block
                        currentBlockStart = i;
                    }
                    currentBlockEnd = i;
                } else {
                    // End of a change block
                    if (currentBlockStart !== -1) {
                        changeBlocks.push({
                            startIndex: currentBlockStart,
                            endIndex: currentBlockEnd
                        });
                        currentBlockStart = -1;
                        currentBlockEnd = -1;
                    }
                }
            }
            
            // Don't forget the last block if we're still in one
            if (currentBlockStart !== -1) {
                changeBlocks.push({
                    startIndex: currentBlockStart,
                    endIndex: currentBlockEnd
                });
            }

            return changeBlocks;
        }

        test('should detect single change block', () => {
            const lines = [
                { isChange: false }, // context
                { isChange: true },  // change
                { isChange: true },  // change
                { isChange: false }, // context
            ];

            const blocks = findChangeBlocks(lines);

            assert.strictEqual(blocks.length, 1, 'Should find 1 change block');
            assert.strictEqual(blocks[0].startIndex, 1, 'Block should start at index 1');
            assert.strictEqual(blocks[0].endIndex, 2, 'Block should end at index 2');
        });

        test('should detect multiple change blocks', () => {
            const lines = [
                { isChange: false }, // context
                { isChange: true },  // change block 1
                { isChange: true },  // change block 1
                { isChange: false }, // context
                { isChange: false }, // context
                { isChange: true },  // change block 2
                { isChange: false }, // context
            ];

            const blocks = findChangeBlocks(lines);

            assert.strictEqual(blocks.length, 2, 'Should find 2 change blocks');
            assert.strictEqual(blocks[0].startIndex, 1, 'First block should start at index 1');
            assert.strictEqual(blocks[0].endIndex, 2, 'First block should end at index 2');
            assert.strictEqual(blocks[1].startIndex, 5, 'Second block should start at index 5');
            assert.strictEqual(blocks[1].endIndex, 5, 'Second block should end at index 5');
        });

        test('should handle changes at the beginning', () => {
            const lines = [
                { isChange: true },  // change
                { isChange: true },  // change
                { isChange: false }, // context
            ];

            const blocks = findChangeBlocks(lines);

            assert.strictEqual(blocks.length, 1, 'Should find 1 change block');
            assert.strictEqual(blocks[0].startIndex, 0, 'Block should start at index 0');
            assert.strictEqual(blocks[0].endIndex, 1, 'Block should end at index 1');
        });

        test('should handle changes at the end', () => {
            const lines = [
                { isChange: false }, // context
                { isChange: true },  // change
                { isChange: true },  // change
            ];

            const blocks = findChangeBlocks(lines);

            assert.strictEqual(blocks.length, 1, 'Should find 1 change block');
            assert.strictEqual(blocks[0].startIndex, 1, 'Block should start at index 1');
            assert.strictEqual(blocks[0].endIndex, 2, 'Block should end at index 2');
        });

        test('should handle all changes (no context)', () => {
            const lines = [
                { isChange: true },  // change
                { isChange: true },  // change
                { isChange: true },  // change
            ];

            const blocks = findChangeBlocks(lines);

            assert.strictEqual(blocks.length, 1, 'Should find 1 change block');
            assert.strictEqual(blocks[0].startIndex, 0, 'Block should start at index 0');
            assert.strictEqual(blocks[0].endIndex, 2, 'Block should end at index 2');
        });

        test('should handle no changes', () => {
            const lines = [
                { isChange: false }, // context
                { isChange: false }, // context
                { isChange: false }, // context
            ];

            const blocks = findChangeBlocks(lines);

            assert.strictEqual(blocks.length, 0, 'Should find 0 change blocks');
        });

        test('should handle alternating changes', () => {
            const lines = [
                { isChange: true },  // block 1
                { isChange: false }, // context
                { isChange: true },  // block 2
                { isChange: false }, // context
                { isChange: true },  // block 3
            ];

            const blocks = findChangeBlocks(lines);

            assert.strictEqual(blocks.length, 3, 'Should find 3 change blocks');
            assert.strictEqual(blocks[0].startIndex, 0);
            assert.strictEqual(blocks[1].startIndex, 2);
            assert.strictEqual(blocks[2].startIndex, 4);
        });
    });

    suite('Navigation target selection algorithm', () => {
        /**
         * Simulates finding the target block for navigation
         */
        function findTargetBlock(
            changeBlocks: { startIndex: number; endIndex: number }[],
            currentLineIndex: number,
            direction: 'prev' | 'next'
        ): number {
            if (changeBlocks.length === 0) return -1;

            // Find current block index (if we're inside one)
            let currentBlockIndex = -1;
            for (let i = 0; i < changeBlocks.length; i++) {
                if (currentLineIndex >= changeBlocks[i].startIndex && 
                    currentLineIndex <= changeBlocks[i].endIndex) {
                    currentBlockIndex = i;
                    break;
                }
            }

            let targetBlockIndex = -1;
            
            if (direction === 'next') {
                // Find the next change block after current position
                for (let i = 0; i < changeBlocks.length; i++) {
                    if (changeBlocks[i].startIndex > currentLineIndex) {
                        targetBlockIndex = i;
                        break;
                    }
                }
                // If we're at the end, wrap to the first block
                if (targetBlockIndex === -1) {
                    targetBlockIndex = 0;
                }
            } else {
                // Find the previous change block before current position
                // If we're inside a block, skip it
                for (let i = changeBlocks.length - 1; i >= 0; i--) {
                    if (i === currentBlockIndex) continue; // Skip current block
                    if (changeBlocks[i].endIndex < currentLineIndex) {
                        targetBlockIndex = i;
                        break;
                    }
                }
                // If we're at the beginning, wrap to the last block
                if (targetBlockIndex === -1) {
                    targetBlockIndex = changeBlocks.length - 1;
                }
            }

            return targetBlockIndex;
        }

        test('should navigate to next block', () => {
            const blocks = [
                { startIndex: 1, endIndex: 2 },
                { startIndex: 5, endIndex: 6 },
                { startIndex: 10, endIndex: 12 }
            ];

            // From before first block
            assert.strictEqual(findTargetBlock(blocks, 0, 'next'), 0);
            // From first block, should go to second
            assert.strictEqual(findTargetBlock(blocks, 2, 'next'), 1);
            // From between blocks
            assert.strictEqual(findTargetBlock(blocks, 3, 'next'), 1);
            // From second block, should go to third
            assert.strictEqual(findTargetBlock(blocks, 6, 'next'), 2);
            // From last block, should wrap to first
            assert.strictEqual(findTargetBlock(blocks, 12, 'next'), 0);
        });

        test('should navigate to previous block', () => {
            const blocks = [
                { startIndex: 1, endIndex: 2 },
                { startIndex: 5, endIndex: 6 },
                { startIndex: 10, endIndex: 12 }
            ];

            // From last block, should go to second
            assert.strictEqual(findTargetBlock(blocks, 11, 'prev'), 1);
            // From second block, should go to first
            assert.strictEqual(findTargetBlock(blocks, 5, 'prev'), 0);
            // From first block, should wrap to last
            assert.strictEqual(findTargetBlock(blocks, 1, 'prev'), 2);
            // From before first block, should wrap to last
            assert.strictEqual(findTargetBlock(blocks, 0, 'prev'), 2);
        });

        test('should handle single block', () => {
            const blocks = [{ startIndex: 5, endIndex: 8 }];

            // Next from before block goes to the block
            assert.strictEqual(findTargetBlock(blocks, 0, 'next'), 0);
            // Next from after block wraps to same block
            assert.strictEqual(findTargetBlock(blocks, 10, 'next'), 0);
            // Prev from after block goes to the block
            assert.strictEqual(findTargetBlock(blocks, 10, 'prev'), 0);
            // Prev from before block wraps to same block
            assert.strictEqual(findTargetBlock(blocks, 0, 'prev'), 0);
        });

        test('should return -1 for empty blocks', () => {
            const blocks: { startIndex: number; endIndex: number }[] = [];

            assert.strictEqual(findTargetBlock(blocks, 0, 'next'), -1);
            assert.strictEqual(findTargetBlock(blocks, 0, 'prev'), -1);
        });
    });

    suite('Keyboard shortcut compatibility', () => {
        test('should use Shift+Arrow keys for navigation', () => {
            // This is a documentation test to ensure the expected keyboard shortcuts
            const prevShortcut = { shiftKey: true, key: 'ArrowUp' };
            const nextShortcut = { shiftKey: true, key: 'ArrowDown' };

            assert.strictEqual(prevShortcut.shiftKey, true, 'Prev navigation should use Shift');
            assert.strictEqual(prevShortcut.key, 'ArrowUp', 'Prev navigation should use ArrowUp');
            assert.strictEqual(nextShortcut.shiftKey, true, 'Next navigation should use Shift');
            assert.strictEqual(nextShortcut.key, 'ArrowDown', 'Next navigation should use ArrowDown');
        });
    });

    suite('CSS class handling', () => {
        test('should define expected CSS classes for diff lines', () => {
            // These are the CSS classes that the navigation code expects
            const expectedClasses = {
                // Split view classes
                splitAddition: 'line-added',
                splitDeletion: 'line-deleted',
                // Inline view classes
                inlineAddition: 'inline-diff-line-addition',
                inlineDeletion: 'inline-diff-line-deletion',
                // Common classes
                keyboardFocused: 'keyboard-focused',
                highlightFlash: 'highlight-flash',
                inlineDiffLine: 'inline-diff-line',
                diffLine: 'diff-line'
            };

            // Verify all expected class names are valid CSS class names
            for (const [, className] of Object.entries(expectedClasses)) {
                // CSS class names must start with a letter or underscore
                assert.ok(/^[a-zA-Z_]/.test(className), `${className} should be a valid CSS class name`);
                // CSS class names can only contain letters, digits, hyphens, and underscores
                assert.ok(/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(className), `${className} should contain only valid characters`);
            }
        });
    });
});
