/**
 * Tests for diff content extraction and whitespace preservation
 * Covers: extractLineContent function and preserving original whitespace during save
 */

import * as assert from 'assert';

/**
 * Simulates the extractLineContent function from the webview
 * This mirrors the logic in main.ts for testing purposes
 */
function extractLineContent(lineEl: MockLineElement): string {
    // If the line was edited, extract from DOM (user's changes)
    if (lineEl.dataset.edited === 'true') {
        return lineEl.textContent || '';
    }

    // For unedited lines, use the original content to preserve whitespace
    if (lineEl.dataset.originalContent !== undefined) {
        return lineEl.dataset.originalContent;
    }

    // Fallback to DOM extraction
    return lineEl.textContent || '';
}

/**
 * Mock line element for testing
 */
interface MockLineElement {
    dataset: {
        edited?: string;
        originalContent?: string;
        side?: string;
        lineNumber?: string;
    };
    textContent: string | null;
    classList: {
        contains: (className: string) => boolean;
    };
}

/**
 * Create a mock line element
 */
function createMockLineElement(options: {
    originalContent?: string;
    textContent?: string;
    edited?: boolean;
    side?: 'old' | 'new' | 'context';
    isEmpty?: boolean;
}): MockLineElement {
    return {
        dataset: {
            originalContent: options.originalContent,
            edited: options.edited ? 'true' : undefined,
            side: options.side,
        },
        textContent: options.textContent ?? options.originalContent ?? null,
        classList: {
            contains: (className: string) => {
                if (className === 'diff-line-empty') {
                    return options.isEmpty ?? false;
                }
                return false;
            }
        }
    };
}

/**
 * Simulates saving content by extracting from line elements
 * This mirrors the saveEditedContent logic in main.ts
 */
function extractContentFromLines(lineElements: MockLineElement[], viewMode: 'split' | 'inline'): string {
    const lines: string[] = [];

    lineElements.forEach((el) => {
        if (viewMode === 'inline') {
            const side = el.dataset.side;
            // Include context lines and new lines, skip deletions
            if (side === 'new' || side === 'context') {
                lines.push(extractLineContent(el));
            }
        } else {
            // For split view, skip empty alignment lines
            if (!el.classList.contains('diff-line-empty')) {
                lines.push(extractLineContent(el));
            }
        }
    });

    return lines.join('\n');
}

suite('Diff Content Extraction Tests', () => {

    suite('extractLineContent Function', () => {
        test('should return original content for unedited lines', () => {
            const lineEl = createMockLineElement({
                originalContent: '\t\tconst x = 1;',
                textContent: 'const x = 1;', // Browser might strip leading whitespace
                edited: false
            });

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, '\t\tconst x = 1;');
        });

        test('should return DOM content for edited lines', () => {
            const lineEl = createMockLineElement({
                originalContent: '\t\tconst x = 1;',
                textContent: '\t\tconst x = 2;', // User changed the value
                edited: true
            });

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, '\t\tconst x = 2;');
        });

        test('should preserve tabs in original content', () => {
            const lineEl = createMockLineElement({
                originalContent: '\t\t\tfunction test() {',
                textContent: 'function test() {',
                edited: false
            });

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, '\t\t\tfunction test() {');
            assert.ok(result.startsWith('\t\t\t'), 'Should preserve leading tabs');
        });

        test('should preserve multiple spaces in original content', () => {
            const lineEl = createMockLineElement({
                originalContent: '    const y = 2;', // 4 spaces
                textContent: 'const y = 2;',
                edited: false
            });

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, '    const y = 2;');
            assert.ok(result.startsWith('    '), 'Should preserve leading spaces');
        });

        test('should preserve trailing whitespace in original content', () => {
            const lineEl = createMockLineElement({
                originalContent: 'return value;   ', // trailing spaces
                textContent: 'return value;',
                edited: false
            });

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, 'return value;   ');
            assert.ok(result.endsWith('   '), 'Should preserve trailing spaces');
        });

        test('should preserve empty lines', () => {
            const lineEl = createMockLineElement({
                originalContent: '',
                textContent: '',
                edited: false
            });

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, '');
        });

        test('should preserve whitespace-only lines', () => {
            const lineEl = createMockLineElement({
                originalContent: '\t\t',
                textContent: '',
                edited: false
            });

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, '\t\t');
        });

        test('should fallback to textContent when no original content stored', () => {
            const lineEl = createMockLineElement({
                textContent: 'fallback content'
                // No originalContent set
            });

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, 'fallback content');
        });
    });

    suite('Content Extraction with Mixed Edited/Unedited Lines', () => {
        test('should preserve whitespace in unedited lines while extracting edited lines', () => {
            const lineElements = [
                createMockLineElement({
                    originalContent: '\tline 1',
                    textContent: 'line 1',
                    edited: false,
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: '\t\tline 2',
                    textContent: '\t\tline 2 modified',
                    edited: true,
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: '\tline 3',
                    textContent: 'line 3',
                    edited: false,
                    side: 'new'
                })
            ];

            const result = extractContentFromLines(lineElements, 'inline');
            const lines = result.split('\n');

            assert.strictEqual(lines[0], '\tline 1', 'First line should preserve tab');
            assert.strictEqual(lines[1], '\t\tline 2 modified', 'Second line should have edited content');
            assert.strictEqual(lines[2], '\tline 3', 'Third line should preserve tab');
        });

        test('should skip deletion lines in inline mode', () => {
            const lineElements = [
                createMockLineElement({
                    originalContent: 'keep this',
                    textContent: 'keep this',
                    edited: false,
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: 'deleted line',
                    textContent: 'deleted line',
                    edited: false,
                    side: 'old' // This is a deletion
                }),
                createMockLineElement({
                    originalContent: 'also keep',
                    textContent: 'also keep',
                    edited: false,
                    side: 'context'
                })
            ];

            const result = extractContentFromLines(lineElements, 'inline');
            const lines = result.split('\n');

            assert.strictEqual(lines.length, 2);
            assert.strictEqual(lines[0], 'keep this');
            assert.strictEqual(lines[1], 'also keep');
        });

        test('should skip empty alignment lines in split mode', () => {
            const lineElements = [
                createMockLineElement({
                    originalContent: 'line 1',
                    textContent: 'line 1',
                    edited: false,
                    isEmpty: false
                }),
                createMockLineElement({
                    originalContent: '',
                    textContent: '',
                    edited: false,
                    isEmpty: true // Empty alignment line
                }),
                createMockLineElement({
                    originalContent: 'line 2',
                    textContent: 'line 2',
                    edited: false,
                    isEmpty: false
                })
            ];

            const result = extractContentFromLines(lineElements, 'split');
            const lines = result.split('\n');

            assert.strictEqual(lines.length, 2);
            assert.strictEqual(lines[0], 'line 1');
            assert.strictEqual(lines[1], 'line 2');
        });
    });

    suite('Real-world Whitespace Scenarios', () => {
        test('should preserve C++ style indentation', () => {
            const lineElements = [
                createMockLineElement({
                    originalContent: '#include <iostream>',
                    textContent: '#include <iostream>',
                    edited: false,
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: '',
                    textContent: '',
                    edited: false,
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: 'int main() {',
                    textContent: 'int main() {',
                    edited: false,
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: '\treturn 0;',
                    textContent: 'return 0;',
                    edited: false,
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: '}',
                    textContent: '}',
                    edited: false,
                    side: 'new'
                })
            ];

            const result = extractContentFromLines(lineElements, 'inline');
            const lines = result.split('\n');

            assert.strictEqual(lines[0], '#include <iostream>');
            assert.strictEqual(lines[1], '');
            assert.strictEqual(lines[2], 'int main() {');
            assert.strictEqual(lines[3], '\treturn 0;', 'Should preserve tab indentation');
            assert.strictEqual(lines[4], '}');
        });

        test('should preserve Python style indentation (4 spaces)', () => {
            const lineElements = [
                createMockLineElement({
                    originalContent: 'def hello():',
                    textContent: 'def hello():',
                    edited: false,
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: '    print("Hello")',
                    textContent: 'print("Hello")',
                    edited: false,
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: '    if True:',
                    textContent: 'if True:',
                    edited: false,
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: '        print("Nested")',
                    textContent: 'print("Nested")',
                    edited: false,
                    side: 'new'
                })
            ];

            const result = extractContentFromLines(lineElements, 'inline');
            const lines = result.split('\n');

            assert.strictEqual(lines[0], 'def hello():');
            assert.strictEqual(lines[1], '    print("Hello")', 'Should preserve 4-space indent');
            assert.strictEqual(lines[2], '    if True:', 'Should preserve 4-space indent');
            assert.strictEqual(lines[3], '        print("Nested")', 'Should preserve 8-space indent');
        });

        test('should preserve mixed tabs and spaces', () => {
            const lineElements = [
                createMockLineElement({
                    originalContent: '\t    mixed indent', // tab + 4 spaces
                    textContent: 'mixed indent',
                    edited: false,
                    side: 'new'
                })
            ];

            const result = extractContentFromLines(lineElements, 'inline');
            assert.strictEqual(result, '\t    mixed indent');
        });

        test('should handle user adding a single new line without affecting other whitespace', () => {
            // Simulates the user's scenario: adding only a new line
            const lineElements = [
                createMockLineElement({
                    originalContent: '\tint x = 1;',
                    textContent: 'int x = 1;',
                    edited: false,
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: '',
                    textContent: '',
                    edited: true, // User added this new line
                    side: 'new'
                }),
                createMockLineElement({
                    originalContent: '\tint y = 2;',
                    textContent: 'int y = 2;',
                    edited: false,
                    side: 'new'
                })
            ];

            const result = extractContentFromLines(lineElements, 'inline');
            const lines = result.split('\n');

            assert.strictEqual(lines[0], '\tint x = 1;', 'First line should preserve tab');
            assert.strictEqual(lines[1], '', 'New line should be empty');
            assert.strictEqual(lines[2], '\tint y = 2;', 'Third line should preserve tab');
        });
    });

    suite('Edge Cases', () => {
        test('should handle null textContent', () => {
            const lineEl: MockLineElement = {
                dataset: {
                    originalContent: 'original'
                },
                textContent: null,
                classList: {
                    contains: () => false
                }
            };

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, 'original');
        });

        test('should handle undefined originalContent with null textContent', () => {
            const lineEl: MockLineElement = {
                dataset: {},
                textContent: null,
                classList: {
                    contains: () => false
                }
            };

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, '');
        });

        test('should handle special characters in content', () => {
            const lineEl = createMockLineElement({
                originalContent: '\t// TODO: Fix this <bug> & "issue"',
                textContent: '// TODO: Fix this <bug> & "issue"',
                edited: false
            });

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, '\t// TODO: Fix this <bug> & "issue"');
        });

        test('should handle very long lines', () => {
            const longContent = '\t' + 'x'.repeat(10000);
            const lineEl = createMockLineElement({
                originalContent: longContent,
                textContent: 'x'.repeat(10000),
                edited: false
            });

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, longContent);
            assert.ok(result.startsWith('\t'), 'Should preserve leading tab');
        });

        test('should handle unicode whitespace characters', () => {
            // Note: This tests that we preserve what's in originalContent exactly
            const lineEl = createMockLineElement({
                originalContent: '\u00A0\u00A0content', // non-breaking spaces
                textContent: 'content',
                edited: false
            });

            const result = extractLineContent(lineEl);
            assert.strictEqual(result, '\u00A0\u00A0content');
        });
    });
});

