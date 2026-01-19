/**
 * Unit tests for source mode syntax highlighting
 * Tests the applySourceModeHighlighting and applySourceModeInlineHighlighting functions
 */

import * as assert from 'assert';
import { 
    applySourceModeHighlighting, 
    applySourceModeInlineHighlighting 
} from '../../shortcuts/markdown-comments/webview-logic/markdown-renderer';

suite('Source Mode Highlighting Tests', () => {

    suite('applySourceModeHighlighting', () => {

        suite('Basic functionality', () => {

            test('should handle empty string', () => {
                const result = applySourceModeHighlighting('', false);
                assert.strictEqual(result.html, '');
                assert.strictEqual(result.inCodeBlock, false);
            });

            test('should escape HTML entities', () => {
                const result = applySourceModeHighlighting('<script>alert("xss")</script>', false);
                assert.ok(result.html.includes('&lt;script&gt;'));
                assert.ok(!result.html.includes('<script>'));
            });

            test('should strip trailing carriage return (Windows line endings)', () => {
                const result = applySourceModeHighlighting('Hello world\r', false);
                assert.ok(!result.html.includes('\r'));
                assert.ok(result.html.includes('Hello world'));
            });
        });

        suite('Headings', () => {

            test('should highlight h1 heading', () => {
                const result = applySourceModeHighlighting('# Heading 1', false);
                assert.ok(result.html.includes('class="src-h1"'));
                assert.ok(result.html.includes('class="src-hash"'));
                assert.ok(result.html.includes('#'));
                assert.ok(result.html.includes('Heading 1'));
            });

            test('should highlight h2 heading', () => {
                const result = applySourceModeHighlighting('## Heading 2', false);
                assert.ok(result.html.includes('class="src-h2"'));
            });

            test('should highlight h3 through h6 headings', () => {
                for (let i = 3; i <= 6; i++) {
                    const hashes = '#'.repeat(i);
                    const result = applySourceModeHighlighting(`${hashes} Heading ${i}`, false);
                    assert.ok(result.html.includes(`class="src-h${i}"`), `h${i} should be highlighted`);
                }
            });

            test('should apply inline highlighting within headings', () => {
                const result = applySourceModeHighlighting('## **Bold** Heading', false);
                assert.ok(result.html.includes('class="src-h2"'));
                assert.ok(result.html.includes('class="src-bold"'));
            });

            test('should not highlight # without space as heading', () => {
                const result = applySourceModeHighlighting('#NotAHeading', false);
                assert.ok(!result.html.includes('class="src-h1"'));
            });
        });

        suite('Code blocks', () => {

            test('should mark code fence start and toggle state', () => {
                const result = applySourceModeHighlighting('```javascript', false);
                assert.ok(result.html.includes('class="src-code-fence"'));
                assert.strictEqual(result.inCodeBlock, true);
            });

            test('should mark code fence end and toggle state', () => {
                const result = applySourceModeHighlighting('```', true);
                assert.ok(result.html.includes('class="src-code-fence"'));
                assert.strictEqual(result.inCodeBlock, false);
            });

            test('should NOT highlight content inside code block', () => {
                const result = applySourceModeHighlighting('# This is not a heading', true);
                assert.ok(!result.html.includes('class="src-h1"'));
                assert.ok(result.html.includes('# This is not a heading'));
                assert.strictEqual(result.inCodeBlock, true);
            });

            test('should escape HTML inside code block', () => {
                const result = applySourceModeHighlighting('<div>test</div>', true);
                assert.ok(result.html.includes('&lt;div&gt;'));
                assert.strictEqual(result.inCodeBlock, true);
            });

            test('should not highlight **bold** inside code block', () => {
                const result = applySourceModeHighlighting('**not bold**', true);
                assert.ok(!result.html.includes('class="src-bold"'));
            });
        });

        suite('Blockquotes', () => {

            test('should highlight blockquote', () => {
                const result = applySourceModeHighlighting('> This is a quote', false);
                assert.ok(result.html.includes('class="src-blockquote"'));
                assert.ok(result.html.includes('class="src-blockquote-marker"'));
            });

            test('should apply inline highlighting within blockquotes', () => {
                const result = applySourceModeHighlighting('> This is **bold** in quote', false);
                assert.ok(result.html.includes('class="src-blockquote"'));
                assert.ok(result.html.includes('class="src-bold"'));
            });
        });

        suite('Lists', () => {

            test('should highlight unordered list with dash', () => {
                const result = applySourceModeHighlighting('- List item', false);
                assert.ok(result.html.includes('class="src-list-item"'));
                assert.ok(result.html.includes('class="src-list-marker"'));
            });

            test('should highlight unordered list with asterisk', () => {
                const result = applySourceModeHighlighting('* List item', false);
                assert.ok(result.html.includes('class="src-list-item"'));
                assert.ok(result.html.includes('class="src-list-marker"'));
            });

            test('should highlight unordered list with plus', () => {
                const result = applySourceModeHighlighting('+ List item', false);
                assert.ok(result.html.includes('class="src-list-item"'));
            });

            test('should highlight ordered list', () => {
                const result = applySourceModeHighlighting('1. First item', false);
                assert.ok(result.html.includes('class="src-list-item"'));
                assert.ok(result.html.includes('class="src-list-marker"'));
            });

            test('should highlight indented list items', () => {
                const result = applySourceModeHighlighting('  - Nested item', false);
                assert.ok(result.html.includes('class="src-list-item"'));
            });

            test('should highlight checkbox unchecked', () => {
                const result = applySourceModeHighlighting('- [ ] Todo item', false);
                // Checkbox now has multiple classes including src-checkbox-clickable
                assert.ok(result.html.includes('src-checkbox'), 'Should have src-checkbox class');
                assert.ok(!result.html.includes('src-checkbox-checked'), 'Should not have checked class');
            });

            test('should highlight checkbox checked', () => {
                const result = applySourceModeHighlighting('- [x] Done item', false);
                assert.ok(result.html.includes('src-checkbox-checked'));
            });

            test('should apply inline highlighting within list items', () => {
                const result = applySourceModeHighlighting('- **Bold** item', false);
                assert.ok(result.html.includes('class="src-list-item"'));
                assert.ok(result.html.includes('class="src-bold"'));
            });
        });

        suite('Horizontal rules', () => {

            test('should highlight horizontal rule with dashes', () => {
                const result = applySourceModeHighlighting('---', false);
                assert.ok(result.html.includes('class="src-hr"'));
            });

            test('should highlight horizontal rule with asterisks', () => {
                const result = applySourceModeHighlighting('***', false);
                assert.ok(result.html.includes('class="src-hr"'));
            });

            test('should highlight horizontal rule with underscores', () => {
                const result = applySourceModeHighlighting('___', false);
                assert.ok(result.html.includes('class="src-hr"'));
            });

            test('should highlight longer horizontal rules', () => {
                const result = applySourceModeHighlighting('----------', false);
                assert.ok(result.html.includes('class="src-hr"'));
            });
        });
    });

    suite('applySourceModeInlineHighlighting', () => {

        suite('Basic functionality', () => {

            test('should handle empty string', () => {
                const result = applySourceModeInlineHighlighting('');
                assert.strictEqual(result, '');
            });

            test('should escape HTML entities', () => {
                const result = applySourceModeInlineHighlighting('<script>');
                assert.ok(result.includes('&lt;script&gt;'));
            });

            test('should preserve plain text', () => {
                const result = applySourceModeInlineHighlighting('Hello world');
                assert.strictEqual(result, 'Hello world');
            });
        });

        suite('Bold', () => {

            test('should highlight bold with asterisks', () => {
                const result = applySourceModeInlineHighlighting('This is **bold** text');
                assert.ok(result.includes('class="src-bold"'));
                assert.ok(result.includes('class="src-marker"'));
                assert.ok(result.includes('**'));
            });

            test('should highlight bold with underscores', () => {
                const result = applySourceModeInlineHighlighting('This is __bold__ text');
                assert.ok(result.includes('class="src-bold"'));
                assert.ok(result.includes('__'));
            });

            test('should highlight multiple bold sections', () => {
                const result = applySourceModeInlineHighlighting('**one** and **two**');
                const matches = result.match(/class="src-bold"/g);
                assert.strictEqual(matches?.length, 2);
            });
        });

        suite('Italic', () => {

            test('should highlight italic with asterisks', () => {
                const result = applySourceModeInlineHighlighting('This is *italic* text');
                assert.ok(result.includes('class="src-italic"'));
                assert.ok(result.includes('class="src-marker"'));
            });

            test('should highlight italic with underscores at word boundaries', () => {
                const result = applySourceModeInlineHighlighting('This is _italic_ text');
                assert.ok(result.includes('class="src-italic"'));
            });

            test('should not highlight underscores in middle of words', () => {
                const result = applySourceModeInlineHighlighting('some_variable_name');
                assert.ok(!result.includes('class="src-italic"'));
            });
        });

        suite('Bold and Italic combined', () => {

            test('should highlight bold italic with asterisks', () => {
                const result = applySourceModeInlineHighlighting('This is ***bold italic*** text');
                assert.ok(result.includes('class="src-bold-italic"'));
            });

            test('should highlight bold italic with underscores', () => {
                const result = applySourceModeInlineHighlighting('This is ___bold italic___ text');
                assert.ok(result.includes('class="src-bold-italic"'));
            });
        });

        suite('Inline code', () => {

            test('should highlight inline code', () => {
                const result = applySourceModeInlineHighlighting('Use `console.log()` here');
                assert.ok(result.includes('class="src-inline-code"'));
                assert.ok(result.includes('`console.log()`'));
            });

            test('should highlight multiple inline code sections', () => {
                const result = applySourceModeInlineHighlighting('`one` and `two`');
                const matches = result.match(/class="src-inline-code"/g);
                assert.strictEqual(matches?.length, 2);
            });
        });

        suite('Strikethrough', () => {

            test('should highlight strikethrough', () => {
                const result = applySourceModeInlineHighlighting('This is ~~deleted~~ text');
                assert.ok(result.includes('class="src-strike"'));
                assert.ok(result.includes('~~'));
            });
        });

        suite('Links', () => {

            test('should highlight links', () => {
                const result = applySourceModeInlineHighlighting('Visit [Google](https://google.com)');
                assert.ok(result.includes('class="src-link"'));
                assert.ok(result.includes('class="src-link-text"'));
                assert.ok(result.includes('class="src-link-url"'));
            });

            test('should highlight anchor links', () => {
                const result = applySourceModeInlineHighlighting('See [Section](#section)');
                assert.ok(result.includes('class="src-link"'));
            });
        });

        suite('Images', () => {

            test('should highlight images', () => {
                const result = applySourceModeInlineHighlighting('![Alt text](image.png)');
                assert.ok(result.includes('class="src-image"'));
            });

            test('should highlight images with empty alt text', () => {
                const result = applySourceModeInlineHighlighting('![](image.png)');
                assert.ok(result.includes('class="src-image"'));
            });
        });

        suite('Multiple formats in same line', () => {

            test('should highlight multiple different formats', () => {
                const result = applySourceModeInlineHighlighting('**bold** and *italic* and `code`');
                assert.ok(result.includes('class="src-bold"'));
                assert.ok(result.includes('class="src-italic"'));
                assert.ok(result.includes('class="src-inline-code"'));
            });

            test('should handle complex formatting', () => {
                const result = applySourceModeInlineHighlighting('Check [link](url) with **bold** and `code`');
                assert.ok(result.includes('class="src-link"'));
                assert.ok(result.includes('class="src-bold"'));
                assert.ok(result.includes('class="src-inline-code"'));
            });
        });
    });

    suite('Cross-platform compatibility', () => {

        test('should handle Windows CRLF line endings', () => {
            const result = applySourceModeHighlighting('# Heading\r', false);
            assert.ok(result.html.includes('class="src-h1"'));
            assert.ok(!result.html.includes('\r'));
        });

        test('should handle Unix LF line endings', () => {
            const result = applySourceModeHighlighting('# Heading', false);
            assert.ok(result.html.includes('class="src-h1"'));
        });

        test('should handle paths with forward slashes in links', () => {
            const result = applySourceModeInlineHighlighting('[file](path/to/file.md)');
            assert.ok(result.includes('class="src-link"'));
        });

        test('should handle paths with backslashes in links', () => {
            const result = applySourceModeInlineHighlighting('[file](path\\to\\file.md)');
            assert.ok(result.includes('class="src-link"'));
        });
    });

    suite('Edge cases', () => {

        test('should handle unicode characters', () => {
            const result = applySourceModeHighlighting('# 你好世界 🌍', false);
            assert.ok(result.html.includes('class="src-h1"'));
            assert.ok(result.html.includes('你好世界'));
            assert.ok(result.html.includes('🌍'));
        });

        test('should handle very long lines', () => {
            const longText = 'x'.repeat(10000);
            const result = applySourceModeHighlighting(longText, false);
            assert.ok(result.html.includes(longText));
        });

        test('should handle empty code fence language', () => {
            const result = applySourceModeHighlighting('```', false);
            assert.ok(result.html.includes('class="src-code-fence"'));
            assert.strictEqual(result.inCodeBlock, true);
        });

        test('should handle code fence with language', () => {
            const result = applySourceModeHighlighting('```typescript', false);
            assert.ok(result.html.includes('class="src-code-fence"'));
            assert.ok(result.html.includes('typescript'));
        });

        test('should handle unclosed formatting markers', () => {
            // These should not crash and should return something reasonable
            const result1 = applySourceModeInlineHighlighting('**unclosed');
            assert.ok(result1.length > 0);
            
            const result2 = applySourceModeInlineHighlighting('`unclosed');
            assert.ok(result2.length > 0);
        });

        test('should handle nested formatting attempts', () => {
            const result = applySourceModeInlineHighlighting('**bold *and italic* together**');
            assert.ok(result.length > 0);
        });

        test('should handle special regex characters in content', () => {
            const result = applySourceModeInlineHighlighting('Pattern: [a-z]+ and (group)');
            assert.ok(result.length > 0);
        });
    });
});
