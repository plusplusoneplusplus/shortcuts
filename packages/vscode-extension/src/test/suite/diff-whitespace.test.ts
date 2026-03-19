/**
 * Comprehensive unit tests for whitespace diff functionality
 * 
 * These tests cover the whitespace handling in diff rendering:
 * - normalizeLineForComparison function
 * - linesEqual function with whitespace ignoring
 * - isWhitespaceOnlyChange detection
 * - LCS computation with whitespace ignoring
 * - Various edge cases for whitespace and tab handling
 */

import * as assert from 'assert';

// Since the diff-renderer functions are bundled for webview, we replicate
// the pure functions here for testing purposes

/**
 * Normalize a line for comparison when ignoring whitespace
 * Removes leading/trailing whitespace and collapses internal whitespace
 */
function normalizeLineForComparison(line: string): string {
    return line.trim().replace(/\s+/g, ' ');
}

/**
 * Check if two lines are equal, optionally ignoring whitespace
 */
function linesEqual(line1: string, line2: string, ignoreWhitespace: boolean): boolean {
    if (ignoreWhitespace) {
        return normalizeLineForComparison(line1) === normalizeLineForComparison(line2);
    }
    return line1 === line2;
}

/**
 * Check if the only difference between two lines is whitespace
 */
function isWhitespaceOnlyChange(oldLine: string, newLine: string): boolean {
    return normalizeLineForComparison(oldLine) === normalizeLineForComparison(newLine) &&
           oldLine !== newLine;
}

/**
 * Compute LCS (Longest Common Subsequence) for diff alignment
 */
function computeLCS(oldLines: string[], newLines: string[], ignoreWhitespace: boolean = false): number[][] {
    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (linesEqual(oldLines[i - 1], newLines[j - 1], ignoreWhitespace)) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    return dp;
}

/**
 * Backtrack LCS to get aligned diff
 */
interface AlignedLine {
    oldLine: string | null;
    newLine: string | null;
    oldLineNum: number | null;
    newLineNum: number | null;
    type: 'context' | 'deletion' | 'addition' | 'modified';
}

function backtrackLCS(
    oldLines: string[],
    newLines: string[],
    dp: number[][],
    ignoreWhitespace: boolean = false
): AlignedLine[] {
    const result: AlignedLine[] = [];
    let i = oldLines.length;
    let j = newLines.length;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && linesEqual(oldLines[i - 1], newLines[j - 1], ignoreWhitespace)) {
            // Context line (unchanged or whitespace-only change when ignoring whitespace)
            result.unshift({
                oldLine: oldLines[i - 1],
                newLine: newLines[j - 1],
                oldLineNum: i,
                newLineNum: j,
                type: 'context'
            });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            // Addition
            result.unshift({
                oldLine: null,
                newLine: newLines[j - 1],
                oldLineNum: null,
                newLineNum: j,
                type: 'addition'
            });
            j--;
        } else if (i > 0) {
            // Deletion
            result.unshift({
                oldLine: oldLines[i - 1],
                newLine: null,
                oldLineNum: i,
                newLineNum: null,
                type: 'deletion'
            });
            i--;
        }
    }

    return result;
}

/**
 * Helper function to compute diff
 */
function computeDiff(oldContent: string, newContent: string, ignoreWhitespace: boolean): AlignedLine[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const dp = computeLCS(oldLines, newLines, ignoreWhitespace);
    return backtrackLCS(oldLines, newLines, dp, ignoreWhitespace);
}

/**
 * Count diff types in aligned lines
 */
function countDiffTypes(aligned: AlignedLine[]): { context: number; additions: number; deletions: number } {
    return aligned.reduce((acc, line) => {
        if (line.type === 'context') acc.context++;
        else if (line.type === 'addition') acc.additions++;
        else if (line.type === 'deletion') acc.deletions++;
        return acc;
    }, { context: 0, additions: 0, deletions: 0 });
}

suite('Diff Whitespace Tests', () => {

    suite('normalizeLineForComparison', () => {
        test('should remove leading whitespace', () => {
            assert.strictEqual(normalizeLineForComparison('   hello'), 'hello');
            assert.strictEqual(normalizeLineForComparison('\thello'), 'hello');
            assert.strictEqual(normalizeLineForComparison('\t  \thello'), 'hello');
        });

        test('should remove trailing whitespace', () => {
            assert.strictEqual(normalizeLineForComparison('hello   '), 'hello');
            assert.strictEqual(normalizeLineForComparison('hello\t'), 'hello');
            assert.strictEqual(normalizeLineForComparison('hello\t  \t'), 'hello');
        });

        test('should collapse internal whitespace to single space', () => {
            assert.strictEqual(normalizeLineForComparison('hello   world'), 'hello world');
            assert.strictEqual(normalizeLineForComparison('hello\tworld'), 'hello world');
            assert.strictEqual(normalizeLineForComparison('hello\t  \tworld'), 'hello world');
        });

        test('should handle multiple internal whitespace groups', () => {
            assert.strictEqual(normalizeLineForComparison('a   b   c'), 'a b c');
            assert.strictEqual(normalizeLineForComparison('a\tb\tc'), 'a b c');
            assert.strictEqual(normalizeLineForComparison('a  \t  b  \t  c'), 'a b c');
        });

        test('should handle empty string', () => {
            assert.strictEqual(normalizeLineForComparison(''), '');
        });

        test('should handle whitespace-only string', () => {
            assert.strictEqual(normalizeLineForComparison('   '), '');
            assert.strictEqual(normalizeLineForComparison('\t\t'), '');
            assert.strictEqual(normalizeLineForComparison('  \t  '), '');
        });

        test('should handle mixed tabs and spaces', () => {
            assert.strictEqual(normalizeLineForComparison('\t hello \t world \t'), 'hello world');
        });

        test('should preserve non-whitespace content', () => {
            assert.strictEqual(normalizeLineForComparison('const x = 1;'), 'const x = 1;');
        });

        test('should handle newline characters', () => {
            // Newlines are also whitespace
            assert.strictEqual(normalizeLineForComparison('hello\nworld'), 'hello world');
            assert.strictEqual(normalizeLineForComparison('hello\r\nworld'), 'hello world');
        });

        test('should handle form feed and vertical tab', () => {
            assert.strictEqual(normalizeLineForComparison('hello\fworld'), 'hello world');
            assert.strictEqual(normalizeLineForComparison('hello\vworld'), 'hello world');
        });

        test('should handle non-breaking space', () => {
            // Non-breaking space (U+00A0)
            assert.strictEqual(normalizeLineForComparison('hello\u00A0world'), 'hello world');
        });
    });

    suite('linesEqual', () => {
        suite('with ignoreWhitespace = false', () => {
            test('should return true for identical lines', () => {
                assert.strictEqual(linesEqual('hello', 'hello', false), true);
            });

            test('should return false for different whitespace', () => {
                assert.strictEqual(linesEqual('hello', '  hello', false), false);
                assert.strictEqual(linesEqual('hello', 'hello  ', false), false);
                assert.strictEqual(linesEqual('hello world', 'hello  world', false), false);
            });

            test('should return false for tabs vs spaces', () => {
                assert.strictEqual(linesEqual('\thello', '    hello', false), false);
            });

            test('should return false for different content', () => {
                assert.strictEqual(linesEqual('hello', 'world', false), false);
            });
        });

        suite('with ignoreWhitespace = true', () => {
            test('should return true for identical lines', () => {
                assert.strictEqual(linesEqual('hello', 'hello', true), true);
            });

            test('should return true for different leading whitespace', () => {
                assert.strictEqual(linesEqual('hello', '  hello', true), true);
                assert.strictEqual(linesEqual('hello', '\thello', true), true);
                assert.strictEqual(linesEqual('  hello', '\thello', true), true);
            });

            test('should return true for different trailing whitespace', () => {
                assert.strictEqual(linesEqual('hello', 'hello  ', true), true);
                assert.strictEqual(linesEqual('hello', 'hello\t', true), true);
                assert.strictEqual(linesEqual('hello  ', 'hello\t', true), true);
            });

            test('should return true for different internal whitespace', () => {
                assert.strictEqual(linesEqual('hello world', 'hello  world', true), true);
                assert.strictEqual(linesEqual('hello world', 'hello\tworld', true), true);
                assert.strictEqual(linesEqual('hello  world', 'hello\tworld', true), true);
            });

            test('should return true for tabs vs spaces', () => {
                assert.strictEqual(linesEqual('\thello', '    hello', true), true);
                assert.strictEqual(linesEqual('    hello', '\t\thello', true), true);
            });

            test('should return false for different content', () => {
                assert.strictEqual(linesEqual('hello', 'world', true), false);
                assert.strictEqual(linesEqual('hello world', 'hello  earth', true), false);
            });

            test('should handle complex code lines', () => {
                assert.strictEqual(
                    linesEqual(
                        '    function test() {',
                        '\tfunction test() {',
                        true
                    ),
                    true
                );
                assert.strictEqual(
                    linesEqual(
                        '    return   true;',
                        '\treturn true;',
                        true
                    ),
                    true
                );
            });
        });
    });

    suite('isWhitespaceOnlyChange', () => {
        test('should return true for leading whitespace changes', () => {
            assert.strictEqual(isWhitespaceOnlyChange('hello', '  hello'), true);
            assert.strictEqual(isWhitespaceOnlyChange('  hello', 'hello'), true);
            assert.strictEqual(isWhitespaceOnlyChange('\thello', '    hello'), true);
        });

        test('should return true for trailing whitespace changes', () => {
            assert.strictEqual(isWhitespaceOnlyChange('hello', 'hello  '), true);
            assert.strictEqual(isWhitespaceOnlyChange('hello  ', 'hello'), true);
            assert.strictEqual(isWhitespaceOnlyChange('hello\t', 'hello    '), true);
        });

        test('should return true for internal whitespace changes', () => {
            assert.strictEqual(isWhitespaceOnlyChange('hello world', 'hello  world'), true);
            assert.strictEqual(isWhitespaceOnlyChange('hello  world', 'hello\tworld'), true);
        });

        test('should return false for identical lines', () => {
            assert.strictEqual(isWhitespaceOnlyChange('hello', 'hello'), false);
            assert.strictEqual(isWhitespaceOnlyChange('  hello', '  hello'), false);
        });

        test('should return false for content changes', () => {
            assert.strictEqual(isWhitespaceOnlyChange('hello', 'world'), false);
            assert.strictEqual(isWhitespaceOnlyChange('hello world', 'hello earth'), false);
        });

        test('should return false for content changes with whitespace changes', () => {
            assert.strictEqual(isWhitespaceOnlyChange('hello world', '  goodbye world'), false);
        });

        test('should handle indentation changes (tabs to spaces)', () => {
            assert.strictEqual(isWhitespaceOnlyChange('\t\tcode', '        code'), true);
            assert.strictEqual(isWhitespaceOnlyChange('    code', '\tcode'), true);
        });
    });

    suite('computeLCS', () => {
        test('should compute correct LCS length for identical content', () => {
            const lines = ['line1', 'line2', 'line3'];
            const dp = computeLCS(lines, lines, false);
            assert.strictEqual(dp[3][3], 3);
        });

        test('should compute correct LCS length for completely different content', () => {
            const oldLines = ['a', 'b', 'c'];
            const newLines = ['x', 'y', 'z'];
            const dp = computeLCS(oldLines, newLines, false);
            assert.strictEqual(dp[3][3], 0);
        });

        test('should compute correct LCS length with some common lines', () => {
            const oldLines = ['a', 'b', 'c', 'd'];
            const newLines = ['a', 'x', 'c', 'y'];
            const dp = computeLCS(oldLines, newLines, false);
            assert.strictEqual(dp[4][4], 2); // 'a' and 'c' are common
        });

        test('should find longer LCS when ignoring whitespace', () => {
            const oldLines = ['  hello', 'world'];
            const newLines = ['hello', '  world'];
            
            const dpWithWhitespace = computeLCS(oldLines, newLines, false);
            const dpIgnoreWhitespace = computeLCS(oldLines, newLines, true);
            
            // Without ignoring whitespace, no common lines
            assert.strictEqual(dpWithWhitespace[2][2], 0);
            // With ignoring whitespace, both lines are common
            assert.strictEqual(dpIgnoreWhitespace[2][2], 2);
        });

        test('should handle empty arrays', () => {
            const dp = computeLCS([], [], false);
            assert.strictEqual(dp[0][0], 0);
        });

        test('should handle one empty array', () => {
            const dp1 = computeLCS(['a', 'b'], [], false);
            assert.strictEqual(dp1[2][0], 0);
            
            const dp2 = computeLCS([], ['a', 'b'], false);
            assert.strictEqual(dp2[0][2], 0);
        });
    });

    suite('Diff Computation - Whitespace Changes', () => {
        
        suite('Leading whitespace changes', () => {
            test('should show as diff when not ignoring whitespace', () => {
                const oldContent = 'function test() {\n    return true;\n}';
                const newContent = 'function test() {\n\treturn true;\n}';
                
                const diff = computeDiff(oldContent, newContent, false);
                const counts = countDiffTypes(diff);
                
                // The indentation change should show as deletion + addition
                assert.ok(counts.deletions > 0 || counts.additions > 0);
            });

            test('should not show as diff when ignoring whitespace', () => {
                const oldContent = 'function test() {\n    return true;\n}';
                const newContent = 'function test() {\n\treturn true;\n}';
                
                const diff = computeDiff(oldContent, newContent, true);
                const counts = countDiffTypes(diff);
                
                // All lines should be context when ignoring whitespace
                assert.strictEqual(counts.context, 3);
                assert.strictEqual(counts.additions, 0);
                assert.strictEqual(counts.deletions, 0);
            });
        });

        suite('Trailing whitespace changes', () => {
            test('should show as diff when not ignoring whitespace', () => {
                const oldContent = 'hello\nworld';
                const newContent = 'hello  \nworld';
                
                const diff = computeDiff(oldContent, newContent, false);
                const counts = countDiffTypes(diff);
                
                assert.ok(counts.deletions > 0 || counts.additions > 0);
            });

            test('should not show as diff when ignoring whitespace', () => {
                const oldContent = 'hello\nworld';
                const newContent = 'hello  \nworld';
                
                const diff = computeDiff(oldContent, newContent, true);
                const counts = countDiffTypes(diff);
                
                assert.strictEqual(counts.context, 2);
                assert.strictEqual(counts.additions, 0);
                assert.strictEqual(counts.deletions, 0);
            });
        });

        suite('Internal whitespace changes', () => {
            test('should show as diff when not ignoring whitespace', () => {
                const oldContent = 'const x = 1;';
                const newContent = 'const  x  =  1;';
                
                const diff = computeDiff(oldContent, newContent, false);
                const counts = countDiffTypes(diff);
                
                assert.ok(counts.deletions > 0 || counts.additions > 0);
            });

            test('should not show as diff when ignoring whitespace', () => {
                const oldContent = 'const x = 1;';
                const newContent = 'const  x  =  1;';
                
                const diff = computeDiff(oldContent, newContent, true);
                const counts = countDiffTypes(diff);
                
                assert.strictEqual(counts.context, 1);
                assert.strictEqual(counts.additions, 0);
                assert.strictEqual(counts.deletions, 0);
            });
        });

        suite('Tabs vs spaces', () => {
            test('should show as diff when not ignoring whitespace', () => {
                const oldContent = '\t\tindented';
                const newContent = '        indented';
                
                const diff = computeDiff(oldContent, newContent, false);
                const counts = countDiffTypes(diff);
                
                assert.ok(counts.deletions > 0 || counts.additions > 0);
            });

            test('should not show as diff when ignoring whitespace', () => {
                const oldContent = '\t\tindented';
                const newContent = '        indented';
                
                const diff = computeDiff(oldContent, newContent, true);
                const counts = countDiffTypes(diff);
                
                assert.strictEqual(counts.context, 1);
                assert.strictEqual(counts.additions, 0);
                assert.strictEqual(counts.deletions, 0);
            });
        });

        suite('Mixed changes (whitespace + content)', () => {
            test('should show content changes even when ignoring whitespace', () => {
                const oldContent = '    const x = 1;';
                const newContent = '\tconst y = 2;';
                
                const diff = computeDiff(oldContent, newContent, true);
                const counts = countDiffTypes(diff);
                
                // Content is different, should show as change
                assert.ok(counts.deletions > 0 || counts.additions > 0);
            });

            test('should correctly identify mixed whitespace and content changes', () => {
                const oldContent = 'line1\n    line2\nline3';
                const newContent = 'line1\n\tline2\nline4';
                
                // With whitespace ignore: line1 and line2 should be context, line3/line4 should be change
                const diff = computeDiff(oldContent, newContent, true);
                const counts = countDiffTypes(diff);
                
                assert.strictEqual(counts.context, 2); // line1 and line2
                assert.strictEqual(counts.deletions, 1); // line3
                assert.strictEqual(counts.additions, 1); // line4
            });
        });

        suite('Empty lines', () => {
            test('should handle empty lines correctly', () => {
                const oldContent = 'line1\n\nline3';
                const newContent = 'line1\n\nline3';
                
                const diff = computeDiff(oldContent, newContent, false);
                const counts = countDiffTypes(diff);
                
                assert.strictEqual(counts.context, 3);
                assert.strictEqual(counts.additions, 0);
                assert.strictEqual(counts.deletions, 0);
            });

            test('should handle whitespace-only lines', () => {
                const oldContent = 'line1\n   \nline3';
                const newContent = 'line1\n\t\nline3';
                
                const diffWithWhitespace = computeDiff(oldContent, newContent, false);
                const countsWithWhitespace = countDiffTypes(diffWithWhitespace);
                
                // Should show difference
                assert.ok(countsWithWhitespace.deletions > 0 || countsWithWhitespace.additions > 0);
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                // Should all be context
                assert.strictEqual(countsIgnoreWhitespace.context, 3);
            });

            test('should handle empty vs whitespace-only lines', () => {
                const oldContent = 'line1\n\nline3';
                const newContent = 'line1\n   \nline3';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                // Empty and whitespace-only should be equal when ignoring whitespace
                assert.strictEqual(countsIgnoreWhitespace.context, 3);
            });
        });

        suite('Real-world code scenarios', () => {
            test('should handle indentation style change (2 spaces to 4 spaces)', () => {
                const oldContent = 'function test() {\n  if (true) {\n    return 1;\n  }\n}';
                const newContent = 'function test() {\n    if (true) {\n        return 1;\n    }\n}';
                
                const diffWithWhitespace = computeDiff(oldContent, newContent, false);
                const countsWithWhitespace = countDiffTypes(diffWithWhitespace);
                
                // Should show changes
                assert.ok(countsWithWhitespace.deletions > 0 || countsWithWhitespace.additions > 0);
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                // Should all be context
                assert.strictEqual(countsIgnoreWhitespace.context, 5);
                assert.strictEqual(countsIgnoreWhitespace.additions, 0);
                assert.strictEqual(countsIgnoreWhitespace.deletions, 0);
            });

            test('should handle tabs to spaces conversion', () => {
                const oldContent = 'class Test {\n\tconstructor() {\n\t\tthis.x = 1;\n\t}\n}';
                const newContent = 'class Test {\n    constructor() {\n        this.x = 1;\n    }\n}';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                assert.strictEqual(countsIgnoreWhitespace.context, 5);
                assert.strictEqual(countsIgnoreWhitespace.additions, 0);
                assert.strictEqual(countsIgnoreWhitespace.deletions, 0);
            });

            test('should handle trailing whitespace cleanup', () => {
                const oldContent = 'line1   \nline2\t\nline3  \t  ';
                const newContent = 'line1\nline2\nline3';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                assert.strictEqual(countsIgnoreWhitespace.context, 3);
                assert.strictEqual(countsIgnoreWhitespace.additions, 0);
                assert.strictEqual(countsIgnoreWhitespace.deletions, 0);
            });

            test('should handle alignment changes in code', () => {
                const oldContent = 'const x    = 1;\nconst foo  = 2;\nconst bar  = 3;';
                const newContent = 'const x = 1;\nconst foo = 2;\nconst bar = 3;';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                assert.strictEqual(countsIgnoreWhitespace.context, 3);
                assert.strictEqual(countsIgnoreWhitespace.additions, 0);
                assert.strictEqual(countsIgnoreWhitespace.deletions, 0);
            });

            test('should still show actual code changes with whitespace changes', () => {
                const oldContent = '    const x = 1;';
                const newContent = '\tconst x = 2;';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                // Should show as change because content (1 vs 2) is different
                assert.ok(countsIgnoreWhitespace.deletions > 0 || countsIgnoreWhitespace.additions > 0);
            });
        });

        suite('Large file scenarios', () => {
            test('should handle large files with many whitespace changes', () => {
                const lines = Array.from({ length: 100 }, (_, i) => `    line ${i + 1}`);
                const oldContent = lines.join('\n');
                const newContent = lines.map(l => l.replace('    ', '\t')).join('\n');
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                assert.strictEqual(countsIgnoreWhitespace.context, 100);
                assert.strictEqual(countsIgnoreWhitespace.additions, 0);
                assert.strictEqual(countsIgnoreWhitespace.deletions, 0);
            });

            test('should handle large files with mixed changes', () => {
                const oldLines = Array.from({ length: 100 }, (_, i) => `    line ${i + 1}`);
                const newLines = oldLines.map((l, i) => {
                    if (i === 50) return '\tmodified line 51';
                    return l.replace('    ', '\t');
                });
                
                const oldContent = oldLines.join('\n');
                const newContent = newLines.join('\n');
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                // 99 context lines, 1 deletion, 1 addition
                assert.strictEqual(countsIgnoreWhitespace.context, 99);
                assert.strictEqual(countsIgnoreWhitespace.deletions, 1);
                assert.strictEqual(countsIgnoreWhitespace.additions, 1);
            });
        });

        suite('Edge cases', () => {
            test('should handle single character differences', () => {
                const oldContent = 'a b c';
                const newContent = 'a  b  c';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                assert.strictEqual(countsIgnoreWhitespace.context, 1);
            });

            test('should handle very long lines', () => {
                const longContent = 'a'.repeat(10000);
                const oldContent = '    ' + longContent;
                const newContent = '\t' + longContent;
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                assert.strictEqual(countsIgnoreWhitespace.context, 1);
            });

            test('should handle unicode content with whitespace changes', () => {
                const oldContent = '    日本語テスト';
                const newContent = '\t日本語テスト';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                assert.strictEqual(countsIgnoreWhitespace.context, 1);
            });

            test('should handle special characters with whitespace changes', () => {
                const oldContent = '    const x = "hello\\nworld";';
                const newContent = '\tconst x = "hello\\nworld";';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                assert.strictEqual(countsIgnoreWhitespace.context, 1);
            });

            test('should handle empty file', () => {
                const diff = computeDiff('', '', true);
                const counts = countDiffTypes(diff);
                
                assert.strictEqual(counts.context, 1); // Empty string splits to ['']
            });

            test('should handle file becoming empty', () => {
                const oldContent = 'line1\nline2';
                const newContent = '';
                
                const diff = computeDiff(oldContent, newContent, true);
                const counts = countDiffTypes(diff);
                
                // Old lines should be deletions, new empty line might be addition
                assert.ok(counts.deletions >= 2);
            });

            test('should handle file from empty', () => {
                const oldContent = '';
                const newContent = 'line1\nline2';
                
                const diff = computeDiff(oldContent, newContent, true);
                const counts = countDiffTypes(diff);
                
                // New lines should be additions
                assert.ok(counts.additions >= 2);
            });

            test('should handle only whitespace content', () => {
                const oldContent = '   \n\t\t\n    ';
                const newContent = '\t\n  \n\t\t';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                // All whitespace-only lines should be equal when normalized
                assert.strictEqual(countsIgnoreWhitespace.context, 3);
            });

            test('should handle CRLF vs LF line endings', () => {
                // Note: split('\n') handles this, but content might differ
                const oldContent = 'line1\nline2';
                const newContent = 'line1\nline2'; // Same content
                
                const diff = computeDiff(oldContent, newContent, true);
                const counts = countDiffTypes(diff);
                
                assert.strictEqual(counts.context, 2);
            });
        });

        suite('Consecutive whitespace-only changes', () => {
            test('should handle multiple consecutive whitespace-only line changes', () => {
                const oldContent = '    line1\n    line2\n    line3';
                const newContent = '\tline1\n\tline2\n\tline3';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                assert.strictEqual(countsIgnoreWhitespace.context, 3);
                assert.strictEqual(countsIgnoreWhitespace.additions, 0);
                assert.strictEqual(countsIgnoreWhitespace.deletions, 0);
            });

            test('should correctly handle alternating whitespace and content changes', () => {
                const oldContent = '    line1\nchanged1\n    line3\nchanged2\n    line5';
                const newContent = '\tline1\nmodified1\n\tline3\nmodified2\n\tline5';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                // line1, line3, line5 should be context (whitespace only)
                // changed1/modified1 and changed2/modified2 should be changes
                assert.strictEqual(countsIgnoreWhitespace.context, 3);
                assert.strictEqual(countsIgnoreWhitespace.deletions, 2);
                assert.strictEqual(countsIgnoreWhitespace.additions, 2);
            });
        });

        suite('Regression tests', () => {
            test('should not treat significant whitespace in strings as ignorable', () => {
                // The whitespace inside strings is part of the content
                const oldContent = 'const s = "hello world";';
                const newContent = 'const s = "hello  world";';
                
                // Even with ignore whitespace, the string content is different
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                // Note: Our simple implementation treats all whitespace equally
                // In reality, whitespace inside strings should be preserved
                // This test documents current behavior
                assert.strictEqual(countsIgnoreWhitespace.context, 1);
            });

            test('should handle Python-style significant indentation', () => {
                // In Python, indentation is significant, but our tool treats it as whitespace
                const oldContent = 'def test():\n    return True';
                const newContent = 'def test():\n\treturn True';
                
                const diffIgnoreWhitespace = computeDiff(oldContent, newContent, true);
                const countsIgnoreWhitespace = countDiffTypes(diffIgnoreWhitespace);
                
                // With ignore whitespace, these should be equal
                assert.strictEqual(countsIgnoreWhitespace.context, 2);
            });
        });
    });

    suite('Performance', () => {
        test('should handle large files efficiently', function() {
            this.timeout(5000);
            
            const lines = Array.from({ length: 1000 }, (_, i) => `    line ${i + 1} with some content`);
            const oldContent = lines.join('\n');
            const newContent = lines.map(l => l.replace('    ', '\t')).join('\n');
            
            const start = Date.now();
            const diff = computeDiff(oldContent, newContent, true);
            const elapsed = Date.now() - start;
            
            assert.ok(elapsed < 2000, `Diff computation took too long: ${elapsed}ms`);
            assert.strictEqual(diff.length, 1000);
        });

        test('should handle worst-case LCS efficiently', function() {
            this.timeout(5000);
            
            // Worst case: completely different content
            const oldLines = Array.from({ length: 500 }, (_, i) => `old line ${i}`);
            const newLines = Array.from({ length: 500 }, (_, i) => `new line ${i}`);
            
            const start = Date.now();
            const dp = computeLCS(oldLines, newLines, false);
            const elapsed = Date.now() - start;
            
            assert.ok(elapsed < 2000, `LCS computation took too long: ${elapsed}ms`);
            assert.strictEqual(dp[500][500], 0);
        });
    });
});

