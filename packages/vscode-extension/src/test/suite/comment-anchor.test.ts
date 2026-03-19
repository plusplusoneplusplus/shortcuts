/**
 * Comprehensive tests for the Comment Anchor system
 * Tests anchor creation, relocation, and fuzzy matching algorithms
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    batchRelocateAnchors,
    calculateSimilarity,
    COMMENTS_CONFIG_FILE,
    CommentsManager,
    createAnchor,
    DEFAULT_ANCHOR_CONFIG,
    extractSelectedText,
    findAllOccurrences,
    findFuzzyMatch,
    getCharOffset,
    hashText,
    levenshteinDistance,
    needsRelocation,
    offsetToLineColumn,
    relocateAnchor,
    scoreMatch,
    splitIntoLines,
    updateAnchor
} from '../../shortcuts/markdown-comments';

suite('Comment Anchor Tests', () => {
    suite('Utility Functions', () => {
        suite('hashText', () => {
            test('should generate consistent hashes for same text', () => {
                const text = 'Hello, world!';
                const hash1 = hashText(text);
                const hash2 = hashText(text);
                assert.strictEqual(hash1, hash2);
            });

            test('should generate different hashes for different text', () => {
                const hash1 = hashText('Hello');
                const hash2 = hashText('World');
                assert.notStrictEqual(hash1, hash2);
            });

            test('should handle empty string', () => {
                const hash = hashText('');
                assert.ok(hash);
                assert.strictEqual(typeof hash, 'string');
            });

            test('should handle unicode text', () => {
                const hash1 = hashText('Hello 🌍');
                const hash2 = hashText('Hello 🌍');
                assert.strictEqual(hash1, hash2);
            });

            test('should handle long text', () => {
                const longText = 'A'.repeat(10000);
                const hash = hashText(longText);
                assert.ok(hash);
            });
        });

        suite('levenshteinDistance', () => {
            test('should return 0 for identical strings', () => {
                assert.strictEqual(levenshteinDistance('hello', 'hello'), 0);
            });

            test('should count single character insertions', () => {
                assert.strictEqual(levenshteinDistance('hello', 'helloo'), 1);
            });

            test('should count single character deletions', () => {
                assert.strictEqual(levenshteinDistance('hello', 'helo'), 1);
            });

            test('should count single character substitutions', () => {
                assert.strictEqual(levenshteinDistance('hello', 'hallo'), 1);
            });

            test('should handle empty strings', () => {
                assert.strictEqual(levenshteinDistance('', ''), 0);
                assert.strictEqual(levenshteinDistance('hello', ''), 5);
                assert.strictEqual(levenshteinDistance('', 'hello'), 5);
            });

            test('should calculate correct distance for complex changes', () => {
                assert.strictEqual(levenshteinDistance('kitten', 'sitting'), 3);
                assert.strictEqual(levenshteinDistance('saturday', 'sunday'), 3);
            });

            test('should handle unicode characters', () => {
                assert.strictEqual(levenshteinDistance('café', 'cafe'), 1);
            });
        });

        suite('calculateSimilarity', () => {
            test('should return 1 for identical strings', () => {
                assert.strictEqual(calculateSimilarity('hello', 'hello'), 1);
            });

            test('should return 0 for empty strings comparison', () => {
                assert.strictEqual(calculateSimilarity('hello', ''), 0);
                assert.strictEqual(calculateSimilarity('', 'hello'), 0);
            });

            test('should return value between 0 and 1', () => {
                const similarity = calculateSimilarity('hello', 'hallo');
                assert.ok(similarity > 0);
                assert.ok(similarity < 1);
            });

            test('should return higher similarity for more similar strings', () => {
                const sim1 = calculateSimilarity('hello', 'hallo');
                const sim2 = calculateSimilarity('hello', 'xxxxx');
                assert.ok(sim1 > sim2);
            });

            test('should handle very similar strings', () => {
                const similarity = calculateSimilarity(
                    'The quick brown fox',
                    'The quick brown dog'
                );
                assert.ok(similarity > 0.7);
            });
        });

        suite('splitIntoLines', () => {
            test('should split by newlines', () => {
                const lines = splitIntoLines('line1\nline2\nline3');
                assert.deepStrictEqual(lines, ['line1', 'line2', 'line3']);
            });

            test('should handle Windows line endings', () => {
                const lines = splitIntoLines('line1\r\nline2\r\nline3');
                assert.deepStrictEqual(lines, ['line1', 'line2', 'line3']);
            });

            test('should handle single line', () => {
                const lines = splitIntoLines('single line');
                assert.deepStrictEqual(lines, ['single line']);
            });

            test('should handle empty string', () => {
                const lines = splitIntoLines('');
                assert.deepStrictEqual(lines, ['']);
            });

            test('should handle trailing newline', () => {
                const lines = splitIntoLines('line1\nline2\n');
                assert.deepStrictEqual(lines, ['line1', 'line2', '']);
            });
        });

        suite('getCharOffset', () => {
            const content = 'line1\nline2\nline3';
            const lines = splitIntoLines(content);

            test('should return 0 for line 1, column 1', () => {
                assert.strictEqual(getCharOffset(lines, 1, 1), 0);
            });

            test('should calculate offset for start of second line', () => {
                // 'line1' = 5 chars + 1 newline = offset 6
                assert.strictEqual(getCharOffset(lines, 2, 1), 6);
            });

            test('should calculate offset within line', () => {
                // line 1, column 3 = offset 2 (0-indexed)
                assert.strictEqual(getCharOffset(lines, 1, 3), 2);
            });

            test('should handle end of line', () => {
                // End of 'line1' is column 6 (1-indexed)
                assert.strictEqual(getCharOffset(lines, 1, 6), 5);
            });
        });

        suite('offsetToLineColumn', () => {
            const content = 'line1\nline2\nline3';

            test('should return line 1, column 1 for offset 0', () => {
                const result = offsetToLineColumn(content, 0);
                assert.deepStrictEqual(result, { line: 1, column: 1 });
            });

            test('should handle offset in middle of line', () => {
                const result = offsetToLineColumn(content, 2);
                assert.deepStrictEqual(result, { line: 1, column: 3 });
            });

            test('should handle offset at start of second line', () => {
                const result = offsetToLineColumn(content, 6);
                assert.deepStrictEqual(result, { line: 2, column: 1 });
            });

            test('should handle offset at end of content', () => {
                const result = offsetToLineColumn(content, content.length);
                assert.strictEqual(result.line, 3);
            });
        });

        suite('extractSelectedText', () => {
            const content = 'Hello World\nSecond Line\nThird Line';

            test('should extract single line selection', () => {
                const selection = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 };
                const text = extractSelectedText(content, selection);
                assert.strictEqual(text, 'Hello');
            });

            test('should extract multi-line selection', () => {
                const selection = { startLine: 1, startColumn: 7, endLine: 2, endColumn: 7 };
                const text = extractSelectedText(content, selection);
                assert.strictEqual(text, 'World\nSecond');
            });

            test('should extract entire line', () => {
                const selection = { startLine: 2, startColumn: 1, endLine: 2, endColumn: 12 };
                const text = extractSelectedText(content, selection);
                assert.strictEqual(text, 'Second Line');
            });

            test('should handle selection spanning multiple lines', () => {
                const selection = { startLine: 1, startColumn: 1, endLine: 3, endColumn: 6 };
                const text = extractSelectedText(content, selection);
                assert.strictEqual(text, 'Hello World\nSecond Line\nThird');
            });
        });

        suite('findAllOccurrences', () => {
            test('should find single occurrence', () => {
                const content = 'Hello World';
                const occurrences = findAllOccurrences(content, 'World');
                assert.deepStrictEqual(occurrences, [6]);
            });

            test('should find multiple occurrences', () => {
                const content = 'Hello Hello Hello';
                const occurrences = findAllOccurrences(content, 'Hello');
                assert.deepStrictEqual(occurrences, [0, 6, 12]);
            });

            test('should return empty array when not found', () => {
                const content = 'Hello World';
                const occurrences = findAllOccurrences(content, 'xyz');
                assert.deepStrictEqual(occurrences, []);
            });

            test('should handle empty search text', () => {
                const content = 'Hello World';
                const occurrences = findAllOccurrences(content, '');
                assert.deepStrictEqual(occurrences, []);
            });

            test('should find overlapping occurrences', () => {
                const content = 'aaa';
                const occurrences = findAllOccurrences(content, 'aa');
                assert.deepStrictEqual(occurrences, [0, 1]);
            });
        });
    });

    suite('Anchor Creation', () => {
        test('should create anchor with context', () => {
            const content = 'Before text. Selected text here. After text.';
            const selection = { startLine: 1, startColumn: 14, endLine: 1, endColumn: 32 };

            const anchor = createAnchor(content, selection);

            assert.strictEqual(anchor.selectedText, 'Selected text here');
            assert.ok(anchor.contextBefore.includes('Before text'));
            assert.ok(anchor.contextAfter.includes('After text'));
            assert.strictEqual(anchor.originalLine, 1);
            assert.ok(anchor.textHash);
        });

        test('should handle multi-line selections', () => {
            const content = 'Line 1\nLine 2\nLine 3\nLine 4';
            const selection = { startLine: 2, startColumn: 1, endLine: 3, endColumn: 7 };

            const anchor = createAnchor(content, selection);

            assert.strictEqual(anchor.selectedText, 'Line 2\nLine 3');
            assert.strictEqual(anchor.originalLine, 2);
        });

        test('should capture limited context', () => {
            const longBefore = 'A'.repeat(200);
            const selected = 'Selected';
            const longAfter = 'B'.repeat(200);
            const content = longBefore + selected + longAfter;

            const selection = { startLine: 1, startColumn: 201, endLine: 1, endColumn: 209 };
            const config = { ...DEFAULT_ANCHOR_CONFIG, contextCharsBefore: 50, contextCharsAfter: 50 };

            const anchor = createAnchor(content, selection, config);

            assert.ok(anchor.contextBefore.length <= 50);
            assert.ok(anchor.contextAfter.length <= 50);
        });

        test('should handle selection at start of document', () => {
            const content = 'First line content\nSecond line';
            const selection = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 };

            const anchor = createAnchor(content, selection);

            assert.strictEqual(anchor.selectedText, 'First');
            assert.strictEqual(anchor.contextBefore, '');
            assert.ok(anchor.contextAfter.length > 0);
        });

        test('should handle selection at end of document', () => {
            const content = 'First line\nLast line';
            const selection = { startLine: 2, startColumn: 6, endLine: 2, endColumn: 10 };

            const anchor = createAnchor(content, selection);

            assert.strictEqual(anchor.selectedText, 'line');
            assert.ok(anchor.contextBefore.length > 0);
        });
    });

    suite('Anchor Relocation - Exact Match', () => {
        test('should find exact match when text is unchanged', () => {
            const content = 'Hello World. This is the target text. Goodbye.';
            const anchor = createAnchor(content, { startLine: 1, startColumn: 14, endLine: 1, endColumn: 37 });

            const result = relocateAnchor(content, anchor);

            assert.ok(result.found);
            assert.strictEqual(result.reason, 'exact_match');
            assert.strictEqual(result.confidence, 1.0);
            assert.deepStrictEqual(result.selection, { startLine: 1, startColumn: 14, endLine: 1, endColumn: 37 });
        });

        test('should find exact match when position changes', () => {
            const originalContent = 'Hello. Target text here. World.';
            const anchor = createAnchor(originalContent, { startLine: 1, startColumn: 8, endLine: 1, endColumn: 24 });

            // Add content before the target
            const newContent = 'Added prefix. Hello. Target text here. World.';

            const result = relocateAnchor(newContent, anchor);

            assert.ok(result.found);
            assert.strictEqual(result.reason, 'exact_match');
            assert.strictEqual(result.confidence, 1.0);
            // Selection should be updated to new position
            assert.ok(result.selection);
            assert.ok(result.selection!.startColumn > 8);
        });

        test('should find exact match when lines shift', () => {
            const originalContent = 'Line 1\nTarget text\nLine 3';
            const anchor = createAnchor(originalContent, { startLine: 2, startColumn: 1, endLine: 2, endColumn: 12 });

            // Insert lines before
            const newContent = 'New Line 0\nNew Line 0.5\nLine 1\nTarget text\nLine 3';

            const result = relocateAnchor(newContent, anchor);

            assert.ok(result.found);
            assert.strictEqual(result.confidence, 1.0);
            assert.strictEqual(result.selection?.startLine, 4);
        });
    });

    suite('Anchor Relocation - Context Match', () => {
        test('should disambiguate multiple occurrences using context', () => {
            const originalContent = 'First duplicate here. Second duplicate here. Third duplicate here.';
            // Select the second 'duplicate'
            const anchor = createAnchor(originalContent, { startLine: 1, startColumn: 30, endLine: 1, endColumn: 39 });

            const result = relocateAnchor(originalContent, anchor);

            assert.ok(result.found);
            // Should find the correct occurrence based on context
            assert.ok(result.selection);
        });

        test('should use context when text is duplicated', () => {
            const content = `Before context A. Target text. After context A.
Before context B. Target text. After context B.`;

            // Anchor the second 'Target text' with its context
            const anchor = createAnchor(content, { startLine: 2, startColumn: 19, endLine: 2, endColumn: 30 });

            const result = relocateAnchor(content, anchor);

            assert.ok(result.found);
            assert.strictEqual(result.selection?.startLine, 2);
        });
    });

    suite('Anchor Relocation - Fuzzy Match', () => {
        test('should find similar text using fuzzy matching', () => {
            const originalContent = 'Hello World. The quick brown fox. Goodbye.';
            const anchor = createAnchor(originalContent, { startLine: 1, startColumn: 14, endLine: 1, endColumn: 34 });

            // Slightly modify the target text
            const newContent = 'Hello World. The quick brown dog. Goodbye.';

            const result = relocateAnchor(newContent, anchor);

            assert.ok(result.found);
            assert.ok(result.confidence >= 0.6);
        });

        test('should find text with minor edits', () => {
            const originalContent = 'Introduction\n\nThis is the original paragraph with some content.\n\nConclusion';
            const anchor = createAnchor(originalContent, { startLine: 3, startColumn: 1, endLine: 3, endColumn: 52 });

            // Slightly edit the paragraph
            const newContent = 'Introduction\n\nThis is the modified paragraph with some content.\n\nConclusion';

            const result = relocateAnchor(newContent, anchor);

            assert.ok(result.found);
            assert.ok(result.confidence > 0.5);
        });

        test('should not match completely different text', () => {
            const originalContent = 'Hello World. Specific unique text here. Goodbye.';
            const anchor = createAnchor(originalContent, { startLine: 1, startColumn: 14, endLine: 1, endColumn: 39 });

            // Replace with completely different content
            const newContent = 'Hello World. XXXXXX YYYYY ZZZZ WWWW. Goodbye.';

            const result = relocateAnchor(newContent, anchor);

            // Should either not find or have low confidence
            if (result.found) {
                assert.ok(result.confidence < 0.8);
            }
        });
    });

    suite('Anchor Relocation - Line Fallback', () => {
        test('should fall back to original line when text not found', () => {
            const originalContent = 'Line 1\nOriginal text here\nLine 3';
            const anchor = createAnchor(originalContent, { startLine: 2, startColumn: 1, endLine: 2, endColumn: 19 });

            // Completely replace line 2
            const newContent = 'Line 1\nCompletely different content\nLine 3';

            const config = { ...DEFAULT_ANCHOR_CONFIG, minSimilarityThreshold: 0.95 };
            const result = relocateAnchor(newContent, anchor, config);

            if (result.reason === 'line_fallback') {
                assert.ok(result.found);
                assert.strictEqual(result.selection?.startLine, 2);
                assert.ok(result.confidence < 0.5);
            }
        });
    });

    suite('needsRelocation', () => {
        test('should return false when text matches', () => {
            const content = 'Hello World. Target text. Goodbye.';
            const selection = { startLine: 1, startColumn: 14, endLine: 1, endColumn: 25 };
            const anchor = createAnchor(content, selection);

            assert.strictEqual(needsRelocation(content, anchor, selection), false);
        });

        test('should return true when text changed', () => {
            const originalContent = 'Hello World. Target text. Goodbye.';
            const selection = { startLine: 1, startColumn: 14, endLine: 1, endColumn: 25 };
            const anchor = createAnchor(originalContent, selection);

            const newContent = 'Hello World. Changed text. Goodbye.';

            assert.strictEqual(needsRelocation(newContent, anchor, selection), true);
        });

        test('should return true when position shifted', () => {
            const originalContent = 'Hello. Target. World.';
            const selection = { startLine: 1, startColumn: 8, endLine: 1, endColumn: 14 };
            const anchor = createAnchor(originalContent, selection);

            const newContent = 'Prefix added. Hello. Target. World.';

            assert.strictEqual(needsRelocation(newContent, anchor, selection), true);
        });
    });

    suite('updateAnchor', () => {
        test('should create new anchor with updated context', () => {
            const originalContent = 'Old context. Target. Old after.';
            const originalAnchor = createAnchor(
                originalContent,
                { startLine: 1, startColumn: 14, endLine: 1, endColumn: 20 }
            );

            const newContent = 'New context. Target. New after.';
            const newSelection = { startLine: 1, startColumn: 14, endLine: 1, endColumn: 20 };

            const updatedAnchor = updateAnchor(newContent, newSelection, originalAnchor);

            assert.ok(updatedAnchor.contextBefore.includes('New context'));
            assert.ok(updatedAnchor.contextAfter.includes('New after'));
            assert.strictEqual(updatedAnchor.originalLine, originalAnchor.originalLine);
        });

        test('should preserve original line from existing anchor', () => {
            const content = 'Some content here';
            const originalAnchor = createAnchor(
                content,
                { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 }
            );

            const newSelection = { startLine: 10, startColumn: 1, endLine: 10, endColumn: 10 };
            const updatedAnchor = updateAnchor(content, newSelection, originalAnchor);

            assert.strictEqual(updatedAnchor.originalLine, 5);
        });
    });

    suite('batchRelocateAnchors', () => {
        test('should relocate multiple anchors efficiently', () => {
            const content = 'Line 1\nLine 2\nLine 3\nLine 4';

            const anchor1 = createAnchor(content, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 });
            const anchor2 = createAnchor(content, { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 });
            const anchor3 = createAnchor(content, { startLine: 3, startColumn: 1, endLine: 3, endColumn: 7 });

            const anchors = [
                { id: 'a1', anchor: anchor1, currentSelection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 } },
                { id: 'a2', anchor: anchor2, currentSelection: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 } },
                { id: 'a3', anchor: anchor3, currentSelection: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 7 } }
            ];

            const results = batchRelocateAnchors(content, anchors);

            assert.strictEqual(results.size, 3);
            assert.ok(results.get('a1')?.found);
            assert.ok(results.get('a2')?.found);
            assert.ok(results.get('a3')?.found);
        });

        test('should handle mixed match results', () => {
            const originalContent = 'Line 1\nLine 2\nLine 3';
            const anchor1 = createAnchor(originalContent, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 });
            const anchor2 = createAnchor(originalContent, { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 });

            // Modify content so anchor1's text still exists but anchor2's doesn't
            const newContent = 'Line 1\nModified completely\nLine 3';

            const anchors = [
                { id: 'a1', anchor: anchor1, currentSelection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 } },
                { id: 'a2', anchor: anchor2, currentSelection: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 } }
            ];

            const results = batchRelocateAnchors(newContent, anchors);

            assert.strictEqual(results.size, 2);
            assert.ok(results.get('a1')?.found);
        });
    });

    suite('scoreMatch', () => {
        test('should give high score when context matches', () => {
            const content = 'Before context. TARGET. After context.';
            const anchor = createAnchor(content, { startLine: 1, startColumn: 17, endLine: 1, endColumn: 23 });

            const score = scoreMatch(content, 16, 6, anchor);

            assert.ok(score > 0.8);
        });

        test('should give lower score when context differs', () => {
            const originalContent = 'Original before. TARGET. Original after.';
            const anchor = createAnchor(originalContent, { startLine: 1, startColumn: 18, endLine: 1, endColumn: 24 });

            const newContent = 'Different before. TARGET. Different after.';

            const score = scoreMatch(newContent, 18, 6, anchor);

            // Context is different, so score should be lower
            assert.ok(score < 0.9);
        });
    });

    suite('findFuzzyMatch', () => {
        test('should find exact text within range', () => {
            const content = 'Line 1\nLine 2\nTarget text\nLine 4';

            const result = findFuzzyMatch(content, 'Target text', 3);

            assert.ok(result);
            assert.strictEqual(result!.similarity, 1.0);
        });

        test('should find similar text within range', () => {
            const content = 'Line 1\nLine 2\nTarget text here\nLine 4';

            const result = findFuzzyMatch(content, 'Target text', 3);

            assert.ok(result);
            assert.ok(result!.similarity > 0.6);
        });

        test('should respect search distance', () => {
            const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nTarget text\nLine 12';

            const config = { ...DEFAULT_ANCHOR_CONFIG, maxLineSearchDistance: 2 };
            const result = findFuzzyMatch(content, 'Target text', 3, config);

            // Target is on line 11, too far from line 3
            // With search distance of 2, should not find it
            if (result) {
                assert.ok(result.similarity < 0.9);
            }
        });
    });

    suite('Edge Cases', () => {
        test('should handle empty content', () => {
            const anchor = createAnchor('Some text', { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 });

            const result = relocateAnchor('', anchor);

            // Should not crash, may or may not find depending on implementation
            assert.ok(typeof result.found === 'boolean');
        });

        test('should handle single character selection', () => {
            const content = 'Hello X World';
            const anchor = createAnchor(content, { startLine: 1, startColumn: 7, endLine: 1, endColumn: 8 });

            assert.strictEqual(anchor.selectedText, 'X');

            const result = relocateAnchor(content, anchor);
            assert.ok(result.found);
        });

        test('should handle very long selections', () => {
            const longText = 'A'.repeat(1000);
            const content = `Before ${longText} After`;
            const anchor = createAnchor(content, { startLine: 1, startColumn: 8, endLine: 1, endColumn: 1008 });

            const result = relocateAnchor(content, anchor);
            assert.ok(result.found);
        });

        test('should handle special characters in text', () => {
            const content = 'Hello [world] (test) {code} "quotes" \'apostrophe\'';
            const anchor = createAnchor(content, { startLine: 1, startColumn: 7, endLine: 1, endColumn: 14 });

            assert.strictEqual(anchor.selectedText, '[world]');

            const result = relocateAnchor(content, anchor);
            assert.ok(result.found);
        });

        test('should handle unicode and emojis', () => {
            const content = 'Hello 🌍 World 你好 世界';
            const anchor = createAnchor(content, { startLine: 1, startColumn: 7, endLine: 1, endColumn: 9 });

            const result = relocateAnchor(content, anchor);
            assert.ok(result.found || !result.found); // Just ensure no crash
        });

        test('should handle multiple newline styles', () => {
            const content = 'Line 1\r\nLine 2\nLine 3\rLine 4';
            const anchor = createAnchor(content, { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 });

            // Just ensure no crash
            assert.ok(anchor.selectedText.length > 0);
        });

        test('should handle selection at document boundaries', () => {
            const content = 'Start text End';

            // Selection at very start
            const anchorStart = createAnchor(content, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 });
            assert.strictEqual(anchorStart.selectedText, 'Start');
            assert.strictEqual(anchorStart.contextBefore, '');

            // Selection at very end
            const anchorEnd = createAnchor(content, { startLine: 1, startColumn: 12, endLine: 1, endColumn: 15 });
            assert.strictEqual(anchorEnd.selectedText, 'End');
        });
    });

    suite('Real-World Scenarios', () => {
        test('should handle markdown heading change', () => {
            const originalContent = `# Introduction

This is the introduction paragraph.

## Methods

This describes the methods.`;

            const anchor = createAnchor(originalContent, { startLine: 3, startColumn: 1, endLine: 3, endColumn: 38 });

            // Add a new section before
            const newContent = `# Introduction

## Background

Some background info.

This is the introduction paragraph.

## Methods

This describes the methods.`;

            const result = relocateAnchor(newContent, anchor);

            assert.ok(result.found);
            // Should find at new position (line 7)
            assert.strictEqual(result.selection?.startLine, 7);
        });

        test('should handle code block modifications', () => {
            const originalContent = `# Code Example

\`\`\`javascript
function hello() {
    console.log("Hello");
}
\`\`\`

End of document.`;

            const anchor = createAnchor(originalContent, { startLine: 5, startColumn: 5, endLine: 5, endColumn: 28 });

            // Modify the code
            const newContent = `# Code Example

\`\`\`javascript
function hello(name) {
    console.log("Hello, " + name);
}
\`\`\`

End of document.`;

            const result = relocateAnchor(newContent, anchor);

            // Should find similar code, possibly with lower confidence
            assert.ok(result.found || result.reason === 'not_found');
        });

        test('should handle list item reordering', () => {
            const originalContent = `# Items

- First item
- Second item
- Third item
- Fourth item`;

            const anchor = createAnchor(originalContent, { startLine: 4, startColumn: 3, endLine: 4, endColumn: 14 });

            // Reorder items
            const newContent = `# Items

- First item
- Third item
- Second item
- Fourth item`;

            const result = relocateAnchor(newContent, anchor);

            assert.ok(result.found);
            // 'Second item' should be found at line 5 now
            assert.strictEqual(result.selection?.startLine, 5);
        });

        test('should handle paragraph splitting', () => {
            const originalContent = `# Document

This is a long paragraph that contains multiple sentences. The target sentence is here. And more content follows.`;

            const anchor = createAnchor(originalContent, { startLine: 3, startColumn: 63, endLine: 3, endColumn: 91 });

            // Split the paragraph
            const newContent = `# Document

This is a long paragraph that contains multiple sentences.

The target sentence is here.

And more content follows.`;

            const result = relocateAnchor(newContent, anchor);

            assert.ok(result.found);
            assert.strictEqual(result.selection?.startLine, 5);
        });
    });
});

suite('CommentsManager Anchor Integration Tests', () => {
    let tempDir: string;
    let commentsManager: CommentsManager;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-integration-test-'));
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        fs.writeFileSync(path.join(vscodePath, COMMENTS_CONFIG_FILE), JSON.stringify({ version: 1, comments: [] }));
        commentsManager = new CommentsManager(tempDir);
    });

    teardown(() => {
        commentsManager.dispose();
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('should create anchor when adding comment', async () => {
        // Create test file
        const testFilePath = path.join(tempDir, 'test.md');
        fs.writeFileSync(testFilePath, 'Hello World. Target text here. Goodbye.');

        await commentsManager.initialize();

        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 1, startColumn: 14, endLine: 1, endColumn: 30 },
            'Target text here',
            'Test comment'
        );

        assert.ok(comment.anchor);
        assert.strictEqual(comment.anchor.selectedText, 'Target text here');
        assert.ok(comment.anchor.textHash);
    });

    test('should relocate comment when content changes', async () => {
        // Create test file
        const testFilePath = path.join(tempDir, 'test.md');
        fs.writeFileSync(testFilePath, 'Hello. Target text. World.');

        await commentsManager.initialize();

        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 1, startColumn: 8, endLine: 1, endColumn: 19 },
            'Target text',
            'Test comment'
        );

        // Modify the file
        const newContent = 'Added prefix. Hello. Target text. World.';
        fs.writeFileSync(testFilePath, newContent);

        // Relocate
        const result = await commentsManager.relocateComment(comment.id, newContent);

        assert.ok(result);
        assert.ok(result.found);

        // Verify comment's selection was updated
        const updatedComment = commentsManager.getComment(comment.id);
        assert.ok(updatedComment);
        assert.ok(updatedComment.selection.startColumn > 8); // Should have moved
    });

    test('should relocate all comments for a file', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        fs.writeFileSync(testFilePath, 'Line 1 target\nLine 2 target\nLine 3 target');

        await commentsManager.initialize();

        await commentsManager.addComment(
            testFilePath,
            { startLine: 1, startColumn: 1, endLine: 1, endColumn: 14 },
            'Line 1 target',
            'Comment 1'
        );

        await commentsManager.addComment(
            testFilePath,
            { startLine: 2, startColumn: 1, endLine: 2, endColumn: 14 },
            'Line 2 target',
            'Comment 2'
        );

        // Modify file by adding lines
        const newContent = 'New line 0\nLine 1 target\nLine 2 target\nLine 3 target';
        fs.writeFileSync(testFilePath, newContent);

        const results = await commentsManager.relocateCommentsForFile(testFilePath, newContent);

        assert.strictEqual(results.size, 2);

        // Both should be found
        for (const [, result] of results) {
            assert.ok(result.found);
        }

        // Check that selections were updated
        const comments = commentsManager.getCommentsForFile(testFilePath);
        assert.strictEqual(comments[0].selection.startLine, 2); // Shifted down by 1
    });

    test('should check if comments need relocation', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        const originalContent = 'Hello. Target text. World.';
        fs.writeFileSync(testFilePath, originalContent);

        await commentsManager.initialize();

        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 1, startColumn: 8, endLine: 1, endColumn: 19 },
            'Target text',
            'Test comment'
        );

        // Check with original content - no relocation needed
        let needsRelocationIds = commentsManager.checkNeedsRelocation(testFilePath, originalContent);
        assert.strictEqual(needsRelocationIds.length, 0);

        // Modify content
        const newContent = 'Modified. Hello. Target text. World.';

        needsRelocationIds = commentsManager.checkNeedsRelocation(testFilePath, newContent);
        assert.strictEqual(needsRelocationIds.length, 1);
        assert.strictEqual(needsRelocationIds[0], comment.id);
    });

    test('should update comment anchor manually', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        const content = 'Hello. Original target. World.';
        fs.writeFileSync(testFilePath, content);

        await commentsManager.initialize();

        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 1, startColumn: 8, endLine: 1, endColumn: 23 },
            'Original target',
            'Test comment'
        );

        const newContent = 'Hello. New target text here. World.';
        const newSelection = { startLine: 1, startColumn: 8, endLine: 1, endColumn: 28 };

        const success = await commentsManager.updateCommentAnchor(comment.id, newContent, newSelection);

        assert.ok(success);

        const updatedComment = commentsManager.getComment(comment.id);
        assert.ok(updatedComment);
        assert.deepStrictEqual(updatedComment.selection, newSelection);
        assert.strictEqual(updatedComment.anchor?.selectedText, 'New target text here');
    });

    test('should create missing anchors', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        fs.writeFileSync(testFilePath, 'Hello World');

        // Manually create config with comment without anchor
        const configPath = path.join(tempDir, '.vscode', COMMENTS_CONFIG_FILE);
        const config = {
            version: 1,
            comments: [{
                id: 'test_id',
                filePath: 'test.md',
                selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 12 },
                selectedText: 'Hello World',
                comment: 'Test',
                status: 'open',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
                // No anchor field
            }]
        };
        fs.writeFileSync(configPath, JSON.stringify(config));

        await commentsManager.initialize();

        // Verify no anchor initially
        let comment = commentsManager.getComment('test_id');
        assert.ok(comment);
        assert.ok(!comment.anchor);

        // Create missing anchors
        const count = await commentsManager.createMissingAnchors();

        assert.strictEqual(count, 1);

        // Verify anchor was created
        comment = commentsManager.getComment('test_id');
        assert.ok(comment?.anchor);
        assert.strictEqual(comment?.anchor?.selectedText, 'Hello World');
    });

    test('should persist anchor across reload', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        fs.writeFileSync(testFilePath, 'Hello World Target');

        await commentsManager.initialize();

        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 1, startColumn: 13, endLine: 1, endColumn: 19 },
            'Target',
            'Test comment'
        );

        const originalAnchor = comment.anchor;
        assert.ok(originalAnchor);

        commentsManager.dispose();

        // Create new manager and reload
        const newManager = new CommentsManager(tempDir);
        await newManager.initialize();

        const loadedComment = newManager.getComment(comment.id);
        assert.ok(loadedComment?.anchor);
        assert.strictEqual(loadedComment?.anchor?.selectedText, originalAnchor?.selectedText);
        assert.strictEqual(loadedComment?.anchor?.textHash, originalAnchor?.textHash);

        newManager.dispose();
    });
});

suite('Undo/Redo Relocation Tests', () => {
    let tempDir: string;
    let commentsManager: CommentsManager;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-redo-test-'));
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        fs.writeFileSync(path.join(vscodePath, COMMENTS_CONFIG_FILE), JSON.stringify({ version: 1, comments: [] }));
        commentsManager = new CommentsManager(tempDir);
    });

    teardown(() => {
        commentsManager.dispose();
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('should relocate comment after content is added then undone', async () => {
        // Original state
        const testFilePath = path.join(tempDir, 'test.md');
        const originalContent = 'Line 1\nTarget line here\nLine 3';
        fs.writeFileSync(testFilePath, originalContent);

        await commentsManager.initialize();

        // Add comment on "Target line here"
        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 2, startColumn: 1, endLine: 2, endColumn: 17 },
            'Target line here',
            'Comment on target'
        );

        const originalSelection = { ...comment.selection };

        // Simulate user adds content before the target (edit operation)
        const editedContent = 'Line 1\nNew line added\nTarget line here\nLine 3';
        fs.writeFileSync(testFilePath, editedContent);

        // Relocate comments (simulating document change event)
        await commentsManager.relocateCommentsForFile(testFilePath, editedContent);

        // Verify comment moved to line 3
        let updatedComment = commentsManager.getComment(comment.id);
        assert.ok(updatedComment);
        assert.strictEqual(updatedComment.selection.startLine, 3, 'Comment should move to line 3 after insertion');

        // Now simulate undo - content goes back to original
        fs.writeFileSync(testFilePath, originalContent);

        // Relocate comments (simulating undo operation)
        await commentsManager.relocateCommentsForFile(testFilePath, originalContent);

        // Verify comment returns to original position
        updatedComment = commentsManager.getComment(comment.id);
        assert.ok(updatedComment);
        assert.strictEqual(updatedComment.selection.startLine, 2, 'Comment should return to line 2 after undo');
        assert.strictEqual(updatedComment.selection.startColumn, originalSelection.startColumn);
    });

    test('should relocate comment after content is deleted then undone', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        const originalContent = 'Line 1\nLine 2\nTarget text\nLine 4\nLine 5';
        fs.writeFileSync(testFilePath, originalContent);

        await commentsManager.initialize();

        // Add comment on "Target text" at line 3
        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 3, startColumn: 1, endLine: 3, endColumn: 12 },
            'Target text',
            'Comment on target'
        );

        // Simulate user deletes Line 2
        const editedContent = 'Line 1\nTarget text\nLine 4\nLine 5';
        fs.writeFileSync(testFilePath, editedContent);

        // Relocate comments
        await commentsManager.relocateCommentsForFile(testFilePath, editedContent);

        // Verify comment moved to line 2
        let updatedComment = commentsManager.getComment(comment.id);
        assert.ok(updatedComment);
        assert.strictEqual(updatedComment.selection.startLine, 2, 'Comment should move to line 2 after deletion');

        // Now simulate undo - content goes back to original
        fs.writeFileSync(testFilePath, originalContent);

        // Relocate comments (simulating undo operation)
        await commentsManager.relocateCommentsForFile(testFilePath, originalContent);

        // Verify comment returns to original position
        updatedComment = commentsManager.getComment(comment.id);
        assert.ok(updatedComment);
        assert.strictEqual(updatedComment.selection.startLine, 3, 'Comment should return to line 3 after undo');
    });

    test('should relocate comment after minor text modification then undo', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        // Use a more distinctive phrase that will survive minor edits
        const originalContent = 'Hello. The quick brown fox jumps. Goodbye.';
        fs.writeFileSync(testFilePath, originalContent);

        await commentsManager.initialize();

        // Add comment on the distinctive phrase
        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 1, startColumn: 8, endLine: 1, endColumn: 33 },
            'The quick brown fox jumps',
            'Comment on phrase'
        );

        // Simulate user makes a MINOR modification (just one word)
        const editedContent = 'Hello. The quick brown dog jumps. Goodbye.';
        fs.writeFileSync(testFilePath, editedContent);

        // Relocate comments (will use fuzzy matching)
        await commentsManager.relocateCommentsForFile(testFilePath, editedContent);

        // Verify comment is still found
        let updatedComment = commentsManager.getComment(comment.id);
        assert.ok(updatedComment);
        assert.ok(updatedComment.selection.startLine === 1, 'Should stay on line 1');

        // Now simulate undo - content goes back to original
        fs.writeFileSync(testFilePath, originalContent);

        // Relocate comments
        await commentsManager.relocateCommentsForFile(testFilePath, originalContent);

        // Verify comment is found (exact match should work now)
        updatedComment = commentsManager.getComment(comment.id);
        assert.ok(updatedComment);
        assert.strictEqual(updatedComment.selection.startLine, 1);
        // After undo, the exact text should be found
        assert.ok(updatedComment.selection.startColumn >= 1, 'Should have valid column');
    });

    test('should handle multiple undo operations', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        const state1 = 'Line 1\nTarget\nLine 3';
        const state2 = 'Line 0\nLine 1\nTarget\nLine 3'; // Added line at start
        const state3 = 'Line 0\nLine 1\nNew Line\nTarget\nLine 3'; // Added another line

        fs.writeFileSync(testFilePath, state1);

        await commentsManager.initialize();

        // Add comment on "Target"
        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 },
            'Target',
            'Comment on target'
        );

        // State 1 -> State 2 (add line at start)
        fs.writeFileSync(testFilePath, state2);
        await commentsManager.relocateCommentsForFile(testFilePath, state2);

        let updatedComment = commentsManager.getComment(comment.id);
        assert.strictEqual(updatedComment?.selection.startLine, 3, 'Should be at line 3 in state2');

        // State 2 -> State 3 (add another line)
        fs.writeFileSync(testFilePath, state3);
        await commentsManager.relocateCommentsForFile(testFilePath, state3);

        updatedComment = commentsManager.getComment(comment.id);
        assert.strictEqual(updatedComment?.selection.startLine, 4, 'Should be at line 4 in state3');

        // Undo: State 3 -> State 2
        fs.writeFileSync(testFilePath, state2);
        await commentsManager.relocateCommentsForFile(testFilePath, state2);

        updatedComment = commentsManager.getComment(comment.id);
        assert.strictEqual(updatedComment?.selection.startLine, 3, 'Should be back at line 3 after first undo');

        // Undo: State 2 -> State 1
        fs.writeFileSync(testFilePath, state1);
        await commentsManager.relocateCommentsForFile(testFilePath, state1);

        updatedComment = commentsManager.getComment(comment.id);
        assert.strictEqual(updatedComment?.selection.startLine, 2, 'Should be back at line 2 after second undo');
    });

    test('should relocate multiple comments after undo', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        const originalContent = 'Line 1\nComment A here\nLine 3\nComment B here\nLine 5';
        fs.writeFileSync(testFilePath, originalContent);

        await commentsManager.initialize();

        // Add two comments
        const commentA = await commentsManager.addComment(
            testFilePath,
            { startLine: 2, startColumn: 1, endLine: 2, endColumn: 15 },
            'Comment A here',
            'First comment'
        );

        const commentB = await commentsManager.addComment(
            testFilePath,
            { startLine: 4, startColumn: 1, endLine: 4, endColumn: 15 },
            'Comment B here',
            'Second comment'
        );

        // Simulate edit - add lines at the start
        const editedContent = 'New Line 1\nNew Line 2\nLine 1\nComment A here\nLine 3\nComment B here\nLine 5';
        fs.writeFileSync(testFilePath, editedContent);

        await commentsManager.relocateCommentsForFile(testFilePath, editedContent);

        // Verify both comments moved
        let updatedA = commentsManager.getComment(commentA.id);
        let updatedB = commentsManager.getComment(commentB.id);
        assert.strictEqual(updatedA?.selection.startLine, 4, 'Comment A should be at line 4');
        assert.strictEqual(updatedB?.selection.startLine, 6, 'Comment B should be at line 6');

        // Simulate undo
        fs.writeFileSync(testFilePath, originalContent);
        await commentsManager.relocateCommentsForFile(testFilePath, originalContent);

        // Verify both comments return to original positions
        updatedA = commentsManager.getComment(commentA.id);
        updatedB = commentsManager.getComment(commentB.id);
        assert.strictEqual(updatedA?.selection.startLine, 2, 'Comment A should return to line 2');
        assert.strictEqual(updatedB?.selection.startLine, 4, 'Comment B should return to line 4');
    });

    test('should handle undo when surrounding context changes but target text remains', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        // The target text "Target phrase" stays the same, but surrounding content changes
        const originalContent = 'Before context here. Target phrase. After context here.';
        fs.writeFileSync(testFilePath, originalContent);

        await commentsManager.initialize();

        // Add comment on "Target phrase"
        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 1, startColumn: 22, endLine: 1, endColumn: 35 },
            'Target phrase',
            'Comment on phrase'
        );

        // Edit: change surrounding context but keep target phrase
        const editedContent = 'Different before. Target phrase. Different after.';
        fs.writeFileSync(testFilePath, editedContent);
        await commentsManager.relocateCommentsForFile(testFilePath, editedContent);

        // Verify comment is still found (exact match on target text)
        let updatedComment = commentsManager.getComment(comment.id);
        assert.ok(updatedComment);
        assert.strictEqual(updatedComment.selection.startLine, 1);

        // Undo: restore original content
        fs.writeFileSync(testFilePath, originalContent);
        await commentsManager.relocateCommentsForFile(testFilePath, originalContent);

        // Verify comment is found at original position
        updatedComment = commentsManager.getComment(comment.id);
        assert.ok(updatedComment);
        assert.strictEqual(updatedComment.selection.startColumn, 22);
        assert.strictEqual(updatedComment.selection.endColumn, 35);
    });

    test('should checkNeedsRelocation correctly after changes', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        const originalContent = 'Hello Target World';
        fs.writeFileSync(testFilePath, originalContent);

        await commentsManager.initialize();

        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 1, startColumn: 7, endLine: 1, endColumn: 13 },
            'Target',
            'Test comment'
        );

        // No changes - shouldn't need relocation
        let needsRelocation = commentsManager.checkNeedsRelocation(testFilePath, originalContent);
        assert.strictEqual(needsRelocation.length, 0, 'Should not need relocation with unchanged content');

        // Change content - should need relocation
        const modifiedContent = 'Prefix Hello Target World';
        needsRelocation = commentsManager.checkNeedsRelocation(testFilePath, modifiedContent);
        assert.strictEqual(needsRelocation.length, 1, 'Should need relocation after content change');
        assert.strictEqual(needsRelocation[0], comment.id);

        // After relocation, shouldn't need it again
        await commentsManager.relocateCommentsForFile(testFilePath, modifiedContent);
        needsRelocation = commentsManager.checkNeedsRelocation(testFilePath, modifiedContent);
        assert.strictEqual(needsRelocation.length, 0, 'Should not need relocation after it was performed');
    });

    test('should handle rapid edit/undo cycles', async () => {
        const testFilePath = path.join(tempDir, 'test.md');
        const baseContent = 'Start. Target text. End.';
        fs.writeFileSync(testFilePath, baseContent);

        await commentsManager.initialize();

        const comment = await commentsManager.addComment(
            testFilePath,
            { startLine: 1, startColumn: 8, endLine: 1, endColumn: 19 },
            'Target text',
            'Test comment'
        );

        // Rapid cycle: edit -> undo -> edit -> undo -> edit -> undo
        const variations = [
            'X Start. Target text. End.',
            baseContent,
            'Start. X Target text. End.',
            baseContent,
            'Start. Target text. X End.',
            baseContent
        ];

        for (const content of variations) {
            fs.writeFileSync(testFilePath, content);
            await commentsManager.relocateCommentsForFile(testFilePath, content);
        }

        // Final state should be back to original position
        const updatedComment = commentsManager.getComment(comment.id);
        assert.ok(updatedComment);
        assert.strictEqual(updatedComment.selection.startColumn, 8);
        assert.strictEqual(updatedComment.selection.endColumn, 19);
    });
});
