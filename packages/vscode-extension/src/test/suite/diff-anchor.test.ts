/**
 * Comprehensive unit tests for DiffAnchor system
 */

import * as assert from 'assert';
import {
    createDiffAnchor,
    relocateDiffAnchor,
    needsDiffRelocation,
    updateDiffAnchor,
    hashText
} from '../../shortcuts/git-diff-comments/diff-anchor';
import {
    DEFAULT_DIFF_ANCHOR_CONFIG,
    DiffAnchorConfig,
    DiffAnchor,
    DiffSelection
} from '../../shortcuts/git-diff-comments/types';

suite('DiffAnchor Tests', () => {
    suite('hashText', () => {
        test('should generate consistent hashes', () => {
            const text = 'Hello, World!';
            const hash1 = hashText(text);
            const hash2 = hashText(text);
            assert.strictEqual(hash1, hash2);
        });

        test('should generate different hashes for different text', () => {
            const hash1 = hashText('Hello');
            const hash2 = hashText('World');
            assert.notStrictEqual(hash1, hash2);
        });

        test('should handle empty strings', () => {
            const hash = hashText('');
            assert.ok(hash);
            assert.strictEqual(typeof hash, 'string');
        });

        test('should handle special characters', () => {
            const hash = hashText('Special: 🎉 émojis <tag>');
            assert.ok(hash);
        });

        test('should handle multiline text', () => {
            const hash = hashText('Line 1\nLine 2\nLine 3');
            assert.ok(hash);
        });
    });

    suite('createDiffAnchor', () => {
        test('should create anchor with correct basic properties', () => {
            const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
            const selectedText = 'Line 2';

            const anchor = createDiffAnchor(content, 2, 2, 1, 7, 'new');

            assert.strictEqual(anchor.selectedText, 'Line 2');
            assert.strictEqual(anchor.side, 'new');
            assert.strictEqual(anchor.originalLine, 2);
            assert.ok(anchor.textHash);
        });

        test('should capture context before selection', () => {
            const content = 'Before context\nSelected text\nAfter context';

            const anchor = createDiffAnchor(content, 2, 2, 1, 14, 'new');

            assert.ok(anchor.contextBefore.includes('Before context'));
        });

        test('should capture context after selection', () => {
            const content = 'Before context\nSelected text\nAfter context';

            const anchor = createDiffAnchor(content, 2, 2, 1, 14, 'new');

            assert.ok(anchor.contextAfter.includes('After context'));
        });

        test('should handle selection at start of file', () => {
            const content = 'First line\nSecond line\nThird line';

            const anchor = createDiffAnchor(content, 1, 1, 1, 11, 'new');

            assert.strictEqual(anchor.selectedText, 'First line');
            assert.strictEqual(anchor.contextBefore, '');
        });

        test('should handle selection at end of file', () => {
            const content = 'First line\nSecond line\nThird line';

            const anchor = createDiffAnchor(content, 3, 3, 1, 11, 'new');

            assert.strictEqual(anchor.selectedText, 'Third line');
            assert.strictEqual(anchor.contextAfter, '');
        });

        test('should handle multi-line selection', () => {
            const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';

            const anchor = createDiffAnchor(content, 2, 4, 1, 7, 'new');

            assert.ok(anchor.selectedText.includes('Line 2'));
            assert.ok(anchor.selectedText.includes('Line 3'));
            assert.strictEqual(anchor.originalLine, 2);
        });

        test('should handle partial line selection', () => {
            const content = 'The quick brown fox jumps over the lazy dog';

            const anchor = createDiffAnchor(content, 1, 1, 5, 10, 'new');

            assert.strictEqual(anchor.selectedText, 'quick');
            assert.ok(anchor.contextBefore.includes('The '));
            assert.ok(anchor.contextAfter.includes(' brown'));
        });

        test('should create anchor for old side selection', () => {
            const content = 'Line 1\nLine 2\nLine 3';

            const anchor = createDiffAnchor(content, 2, 2, 1, 7, 'old');

            assert.strictEqual(anchor.side, 'old');
            assert.strictEqual(anchor.originalLine, 2);
        });
    });

    suite('relocateDiffAnchor', () => {
        test('should find exact match in unchanged content', () => {
            const content = 'Line 1\nLine 2\nLine 3';

            const anchor = createDiffAnchor(content, 2, 2, 1, 7, 'new');
            const result = relocateDiffAnchor(content, anchor, 'new');

            assert.strictEqual(result.found, true);
            assert.strictEqual(result.reason, 'exact_match');
            assert.strictEqual(result.confidence, 1.0);
        });

        test('should find text after lines inserted before', () => {
            const originalContent = 'Line 1\nTarget text\nLine 3';
            const anchor = createDiffAnchor(originalContent, 2, 2, 1, 12, 'new');

            const newContent = 'Line 1\nNew line A\nNew line B\nTarget text\nLine 3';
            const result = relocateDiffAnchor(newContent, anchor, 'new');

            assert.strictEqual(result.found, true);
            // Line number should be updated
            if (result.selection?.side === 'new') {
                assert.strictEqual(result.selection?.newStartLine, 4);
            }
        });

        test('should find text after lines deleted before', () => {
            const originalContent = 'Line 1\nLine 2\nLine 3\nTarget text\nLine 5';
            const anchor = createDiffAnchor(originalContent, 4, 4, 1, 12, 'new');

            const newContent = 'Line 1\nTarget text\nLine 5';
            const result = relocateDiffAnchor(newContent, anchor, 'new');

            assert.strictEqual(result.found, true);
            if (result.selection?.side === 'new') {
                assert.strictEqual(result.selection?.newStartLine, 2);
            }
        });

        test('should handle multiple occurrences using context', () => {
            const originalContent = 'Before A\nDuplicate\nAfter A\n\nBefore B\nDuplicate\nAfter B';
            const anchor = createDiffAnchor(originalContent, 6, 6, 1, 10, 'new');

            const result = relocateDiffAnchor(originalContent, anchor, 'new');

            assert.strictEqual(result.found, true);
            // Should find the second occurrence based on context
            if (result.selection?.side === 'new') {
                assert.strictEqual(result.selection?.newStartLine, 6);
            }
        });

        test('should use fuzzy matching for slightly changed text', () => {
            const originalContent = 'Line 1\nfunction myFunc() {\nLine 3';
            const anchor = createDiffAnchor(originalContent, 2, 2, 1, 20, 'new');

            // Text slightly changed
            const newContent = 'Line 1\nfunction myFunc()  {\nLine 3';
            const result = relocateDiffAnchor(newContent, anchor, 'new');

            assert.strictEqual(result.found, true);
            assert.ok(result.confidence >= 0.6);
        });

        test('should return not_found or line_fallback when text is completely removed', () => {
            const originalContent = 'Line 1\nTarget text\nLine 3';
            const anchor = createDiffAnchor(originalContent, 2, 2, 1, 12, 'new');

            const newContent = 'Line 1\nCompletely different\nLine 3';
            const result = relocateDiffAnchor(newContent, anchor, 'new');

            // Should fall back to line fallback or not found
            if (result.found) {
                assert.strictEqual(result.reason, 'line_fallback');
                assert.ok(result.confidence < 0.5);
            } else {
                assert.strictEqual(result.reason, 'not_found');
            }
        });

        test('should handle empty content', () => {
            const originalContent = 'Some text';
            const anchor = createDiffAnchor(originalContent, 1, 1, 1, 10, 'new');

            const result = relocateDiffAnchor('', anchor, 'new');

            assert.strictEqual(result.found, false);
            assert.strictEqual(result.reason, 'not_found');
        });

        test('should handle single character selection', () => {
            const content = 'a b c d e';
            const anchor = createDiffAnchor(content, 1, 1, 3, 4, 'new');

            const result = relocateDiffAnchor(content, anchor, 'new');

            assert.strictEqual(result.found, true);
        });

        test('should preserve side information during relocation', () => {
            const content = 'Line 1\nLine 2\nLine 3';
            const anchor = createDiffAnchor(content, 2, 2, 1, 7, 'old');

            const result = relocateDiffAnchor(content, anchor, 'old');

            assert.strictEqual(result.found, true);
            assert.strictEqual(result.selection?.side, 'old');
        });

        test('should handle whitespace-only changes', () => {
            const originalContent = 'function test() {\n    return true;\n}';
            const anchor = createDiffAnchor(originalContent, 2, 2, 5, 17, 'new');

            // Different indentation
            const newContent = 'function test() {\n        return true;\n}';
            const result = relocateDiffAnchor(newContent, anchor, 'new');

            assert.strictEqual(result.found, true);
        });

        test('should use custom config for relocation', () => {
            const content = 'Line 1\nLine 2\nLine 3';

            const customConfig: DiffAnchorConfig = {
                ...DEFAULT_DIFF_ANCHOR_CONFIG,
                minSimilarityThreshold: 0.9,
                maxLineSearchDistance: 5
            };

            const anchor = createDiffAnchor(content, 2, 2, 1, 7, 'new', customConfig);
            const result = relocateDiffAnchor(content, anchor, 'new', customConfig);

            assert.strictEqual(result.found, true);
        });
    });

    suite('needsDiffRelocation', () => {
        test('should return false for unchanged content and position', () => {
            const content = 'Line 1\nLine 2\nLine 3';
            const anchor = createDiffAnchor(content, 2, 2, 1, 7, 'new');

            const needs = needsDiffRelocation(content, anchor, 2, 2, 1, 7);

            assert.strictEqual(needs, false);
        });

        test('should return true when text at position changed', () => {
            const originalContent = 'Line 1\nLine 2\nLine 3';
            const anchor = createDiffAnchor(originalContent, 2, 2, 1, 7, 'new');

            const newContent = 'Line 1\nChanged\nLine 3';
            const needs = needsDiffRelocation(newContent, anchor, 2, 2, 1, 7);

            assert.strictEqual(needs, true);
        });

        test('should return true when lines shifted', () => {
            const originalContent = 'Line 1\nLine 2\nLine 3';
            const anchor = createDiffAnchor(originalContent, 2, 2, 1, 7, 'new');

            const newContent = 'New line\nLine 1\nLine 2\nLine 3';
            const needs = needsDiffRelocation(newContent, anchor, 2, 2, 1, 7);

            assert.strictEqual(needs, true);
        });
    });

    suite('updateDiffAnchor', () => {
        test('should create new anchor with updated position', () => {
            const originalContent = 'Line 1\nLine 2\nLine 3';
            const originalAnchor = createDiffAnchor(originalContent, 2, 2, 1, 7, 'new');

            const newContent = 'New line\nLine 1\nLine 2\nLine 3';

            const updatedAnchor = updateDiffAnchor(
                newContent,
                3, 3, 1, 7,
                'new',
                originalAnchor
            );

            // Should preserve original line but update other properties
            assert.strictEqual(updatedAnchor.originalLine, 2);
            assert.ok(updatedAnchor.contextBefore.includes('Line 1'));
        });

        test('should create fresh anchor when no existing anchor', () => {
            const content = 'Line 1\nLine 2\nLine 3';

            const anchor = updateDiffAnchor(content, 2, 2, 1, 7, 'new');

            assert.ok(anchor);
            assert.strictEqual(anchor.selectedText, 'Line 2');
            assert.strictEqual(anchor.originalLine, 2);
        });
    });

    suite('Edge Cases', () => {
        test('should handle very long lines', () => {
            const longLine = 'A'.repeat(10000);
            const content = `Short\n${longLine}\nShort`;

            const anchor = createDiffAnchor(content, 2, 2, 1, 101, 'new');
            const result = relocateDiffAnchor(content, anchor, 'new');

            assert.strictEqual(result.found, true);
        });

        test('should handle many lines', () => {
            const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`);
            const content = lines.join('\n');

            const anchor = createDiffAnchor(content, 500, 500, 1, 9, 'new');
            const result = relocateDiffAnchor(content, anchor, 'new');

            assert.strictEqual(result.found, true);
            if (result.selection?.side === 'new') {
                assert.strictEqual(result.selection?.newStartLine, 500);
            }
        });

        test('should handle special regex characters in text', () => {
            const content = 'Normal\n[a-z]+ .*? \\d{3}\nNormal';

            const anchor = createDiffAnchor(content, 2, 2, 1, 18, 'new');
            const result = relocateDiffAnchor(content, anchor, 'new');

            assert.strictEqual(result.found, true);
        });

        test('should handle unicode characters', () => {
            const content = '日本語\n中文\n한국어';

            const anchor = createDiffAnchor(content, 2, 2, 1, 3, 'new');
            const result = relocateDiffAnchor(content, anchor, 'new');

            assert.strictEqual(result.found, true);
        });

        test('should handle mixed line endings', () => {
            const content = 'Line 1\r\nLine 2\nLine 3\rLine 4';

            const anchor = createDiffAnchor(content, 2, 2, 1, 7, 'new');

            // Should handle gracefully
            assert.ok(anchor);
            assert.strictEqual(anchor.selectedText, 'Line 2');
        });

        test('should handle selection spanning entire file', () => {
            const content = 'Line 1\nLine 2\nLine 3';

            const anchor = createDiffAnchor(content, 1, 3, 1, 7, 'new');
            const result = relocateDiffAnchor(content, anchor, 'new');

            assert.strictEqual(result.found, true);
        });
    });

    suite('Context Matching', () => {
        test('should prefer match with better context similarity', () => {
            const originalContent = 'AAA\nBBB\nTarget\nCCC\nDDD\n\nXXX\nYYY\nTarget\nZZZ\nWWW';
            const anchor = createDiffAnchor(originalContent, 3, 3, 1, 7, 'new');

            // Both occurrences still exist
            const result = relocateDiffAnchor(originalContent, anchor, 'new');

            assert.strictEqual(result.found, true);
            // Should find the first occurrence due to context matching
            if (result.selection?.side === 'new') {
                assert.strictEqual(result.selection?.newStartLine, 3);
            }
        });
    });

    suite('Performance', () => {
        test('should handle relocation in large files efficiently', function() {
            this.timeout(5000); // Allow up to 5 seconds

            // Create a large file
            const lines = Array.from({ length: 10000 }, (_, i) =>
                `// Line ${i + 1}: This is some code content for testing purposes`
            );
            const content = lines.join('\n');

            const anchor = createDiffAnchor(content, 5000, 5000, 1, 50, 'new');

            const start = Date.now();
            const result = relocateDiffAnchor(content, anchor, 'new');
            const elapsed = Date.now() - start;

            assert.strictEqual(result.found, true);
            assert.ok(elapsed < 1000, `Relocation took too long: ${elapsed}ms`);
        });
    });
});
