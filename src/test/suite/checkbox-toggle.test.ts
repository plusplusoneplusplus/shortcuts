/**
 * Unit tests for markdown checkbox toggle functionality
 * Tests the checkbox rendering and toggle logic in both review and source modes
 * Supports three states: unchecked [ ], in-progress [~], checked [x]
 * 
 * Works consistently across Windows, macOS, and Linux.
 */

import * as assert from 'assert';
import { 
    applyMarkdownHighlighting, 
    applySourceModeHighlighting 
} from '../../shortcuts/markdown-comments/webview-logic/markdown-renderer';

suite('Checkbox Toggle Tests', () => {

    suite('Review Mode Checkbox Rendering', () => {

        test('should render unchecked checkbox with clickable class and data attributes', () => {
            const result = applyMarkdownHighlighting('- [ ] Todo item', 5, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('data-line="5"'), 'Should have data-line attribute');
            assert.ok(result.html.includes('data-state="unchecked"'), 'Should have data-state="unchecked"');
            assert.ok(result.html.includes('[ ]'), 'Should show unchecked checkbox');
            assert.ok(!result.html.includes('md-checkbox-checked'), 'Should not have checked class');
            assert.ok(!result.html.includes('md-checkbox-in-progress'), 'Should not have in-progress class');
        });

        test('should render checked checkbox with clickable class and data attributes', () => {
            const result = applyMarkdownHighlighting('- [x] Done item', 10, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('md-checkbox-checked'), 'Should have checked class');
            assert.ok(result.html.includes('data-line="10"'), 'Should have data-line attribute');
            assert.ok(result.html.includes('data-state="checked"'), 'Should have data-state="checked"');
            assert.ok(result.html.includes('[x]'), 'Should show checked checkbox');
        });

        test('should render in-progress checkbox with clickable class and data attributes', () => {
            const result = applyMarkdownHighlighting('- [~] In progress item', 7, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('md-checkbox-in-progress'), 'Should have in-progress class');
            assert.ok(result.html.includes('data-line="7"'), 'Should have data-line attribute');
            assert.ok(result.html.includes('data-state="in-progress"'), 'Should have data-state="in-progress"');
            assert.ok(result.html.includes('[~]'), 'Should show in-progress checkbox');
            assert.ok(!result.html.includes('md-checkbox-checked'), 'Should not have checked class');
        });

        test('should render uppercase X checkbox as checked', () => {
            const result = applyMarkdownHighlighting('- [X] Done item', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-checked'), 'Should have checked class');
            assert.ok(result.html.includes('data-state="checked"'), 'Should have data-state="checked"');
        });

        test('should render checkbox with asterisk list marker', () => {
            const result = applyMarkdownHighlighting('* [ ] Todo item', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('[ ]'), 'Should show unchecked checkbox');
        });

        test('should render checkbox with plus list marker', () => {
            const result = applyMarkdownHighlighting('+ [x] Done item', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('[x]'), 'Should show checked checkbox');
        });

        test('should render indented checkbox', () => {
            const result = applyMarkdownHighlighting('  - [ ] Nested todo', 3, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('data-line="3"'), 'Should have correct line number');
        });

        test('should render deeply indented checkbox', () => {
            const result = applyMarkdownHighlighting('    - [x] Deep nested done', 7, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('md-checkbox-checked'), 'Should have checked class');
        });

        test('should preserve checkbox text content', () => {
            const result = applyMarkdownHighlighting('- [ ] Buy groceries', 1, false, null);
            assert.ok(result.html.includes('Buy groceries'), 'Should preserve text after checkbox');
        });

        test('should apply inline markdown to checkbox text', () => {
            const result = applyMarkdownHighlighting('- [ ] **Important** task', 1, false, null);
            assert.ok(result.html.includes('md-bold'), 'Should apply bold formatting');
            assert.ok(result.html.includes('Important'), 'Should include bold text');
        });

        test('should not render checkbox without list marker', () => {
            const result = applyMarkdownHighlighting('[ ] Not a checkbox', 1, false, null);
            assert.ok(!result.html.includes('md-checkbox'), 'Should not have checkbox class');
        });

        test('should not render checkbox inside code block', () => {
            const result = applyMarkdownHighlighting('- [ ] Code checkbox', 1, true, 'text');
            assert.ok(!result.html.includes('md-checkbox'), 'Should not have checkbox class in code block');
        });
    });

    suite('Source Mode Checkbox Rendering', () => {

        test('should render unchecked checkbox with clickable class in source mode', () => {
            const result = applySourceModeHighlighting('- [ ] Todo item', false);
            assert.ok(result.html.includes('src-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('data-state="unchecked"'), 'Should have data-state="unchecked"');
            assert.ok(result.html.includes('[ ]'), 'Should show unchecked checkbox');
        });

        test('should render checked checkbox with clickable class in source mode', () => {
            const result = applySourceModeHighlighting('- [x] Done item', false);
            assert.ok(result.html.includes('src-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('src-checkbox-checked'), 'Should have checked class');
            assert.ok(result.html.includes('data-state="checked"'), 'Should have data-state="checked"');
        });

        test('should render in-progress checkbox with clickable class in source mode', () => {
            const result = applySourceModeHighlighting('- [~] In progress item', false);
            assert.ok(result.html.includes('src-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('src-checkbox-in-progress'), 'Should have in-progress class');
            assert.ok(result.html.includes('data-state="in-progress"'), 'Should have data-state="in-progress"');
            assert.ok(result.html.includes('[~]'), 'Should show in-progress checkbox');
        });

        test('should render uppercase X checkbox as checked in source mode', () => {
            const result = applySourceModeHighlighting('- [X] Done item', false);
            assert.ok(result.html.includes('src-checkbox-checked'), 'Should have checked class');
        });

        test('should not render checkbox inside code block in source mode', () => {
            const result = applySourceModeHighlighting('- [ ] Code checkbox', true);
            assert.ok(!result.html.includes('src-checkbox'), 'Should not have checkbox class in code block');
        });
    });

    suite('Checkbox State Cycle Logic', () => {

        /**
         * Simulates the cycle logic from dom-handlers.ts
         * This is extracted for unit testing without DOM dependencies
         * State cycle: unchecked -> in-progress -> checked -> unchecked
         */
        function cycleCheckboxInContent(content: string, lineNum: number, currentState: string): string {
            const lines = content.split('\n');
            const lineIndex = lineNum - 1;

            if (lineIndex < 0 || lineIndex >= lines.length) {
                return content; // Invalid line, return unchanged
            }

            const line = lines[lineIndex];
            
            // Match checkbox pattern: optional indent, list marker (- * +), space, checkbox
            const checkboxPattern = /^(\s*[-*+]\s+)\[([ xX~])\](\s*.*)$/;
            const match = line.match(checkboxPattern);

            if (!match) {
                return content; // No checkbox on this line
            }

            const prefix = match[1];  // "- " or "  - " etc.
            const suffix = match[3];  // " item text" etc.

            // Cycle the checkbox state: unchecked -> in-progress -> checked -> unchecked
            let newCheckbox: string;
            switch (currentState) {
                case 'unchecked':
                    newCheckbox = '[~]';  // unchecked -> in-progress
                    break;
                case 'in-progress':
                    newCheckbox = '[x]';  // in-progress -> checked
                    break;
                case 'checked':
                default:
                    newCheckbox = '[ ]';  // checked -> unchecked
                    break;
            }
            
            lines[lineIndex] = prefix + newCheckbox + suffix;

            return lines.join('\n');
        }

        test('should cycle unchecked to in-progress', () => {
            const content = '- [ ] Todo item';
            const result = cycleCheckboxInContent(content, 1, 'unchecked');
            assert.strictEqual(result, '- [~] Todo item');
        });

        test('should cycle in-progress to checked', () => {
            const content = '- [~] In progress item';
            const result = cycleCheckboxInContent(content, 1, 'in-progress');
            assert.strictEqual(result, '- [x] In progress item');
        });

        test('should cycle checked to unchecked', () => {
            const content = '- [x] Done item';
            const result = cycleCheckboxInContent(content, 1, 'checked');
            assert.strictEqual(result, '- [ ] Done item');
        });

        test('should cycle uppercase X to unchecked', () => {
            const content = '- [X] Done item';
            const result = cycleCheckboxInContent(content, 1, 'checked');
            assert.strictEqual(result, '- [ ] Done item');
        });

        test('should cycle checkbox with asterisk marker', () => {
            const content = '* [ ] Todo item';
            const result = cycleCheckboxInContent(content, 1, 'unchecked');
            assert.strictEqual(result, '* [~] Todo item');
        });

        test('should cycle checkbox with plus marker', () => {
            const content = '+ [~] In progress';
            const result = cycleCheckboxInContent(content, 1, 'in-progress');
            assert.strictEqual(result, '+ [x] In progress');
        });

        test('should cycle indented checkbox', () => {
            const content = '  - [ ] Nested todo';
            const result = cycleCheckboxInContent(content, 1, 'unchecked');
            assert.strictEqual(result, '  - [~] Nested todo');
        });

        test('should cycle specific line in multi-line content', () => {
            const content = '- [ ] First\n- [~] Second\n- [x] Third';
            const result = cycleCheckboxInContent(content, 2, 'in-progress');
            assert.strictEqual(result, '- [ ] First\n- [x] Second\n- [x] Third');
        });

        test('should preserve text after checkbox', () => {
            const content = '- [~] Buy groceries and milk';
            const result = cycleCheckboxInContent(content, 1, 'in-progress');
            assert.strictEqual(result, '- [x] Buy groceries and milk');
        });

        test('should handle empty checkbox text', () => {
            const content = '- [x] ';
            const result = cycleCheckboxInContent(content, 1, 'checked');
            assert.strictEqual(result, '- [ ] ');
        });

        test('should not modify non-checkbox lines', () => {
            const content = 'Regular text';
            const result = cycleCheckboxInContent(content, 1, 'unchecked');
            assert.strictEqual(result, 'Regular text');
        });

        test('should not modify invalid line numbers', () => {
            const content = '- [ ] Todo';
            const result = cycleCheckboxInContent(content, 5, 'unchecked');
            assert.strictEqual(result, '- [ ] Todo');
        });

        test('should not modify line 0', () => {
            const content = '- [ ] Todo';
            const result = cycleCheckboxInContent(content, 0, 'unchecked');
            assert.strictEqual(result, '- [ ] Todo');
        });

        test('should not modify negative line numbers', () => {
            const content = '- [ ] Todo';
            const result = cycleCheckboxInContent(content, -1, 'unchecked');
            assert.strictEqual(result, '- [ ] Todo');
        });

        test('should complete full cycle: unchecked -> in-progress -> checked -> unchecked', () => {
            let content = '- [ ] Task';
            
            // unchecked -> in-progress
            content = cycleCheckboxInContent(content, 1, 'unchecked');
            assert.strictEqual(content, '- [~] Task');
            
            // in-progress -> checked
            content = cycleCheckboxInContent(content, 1, 'in-progress');
            assert.strictEqual(content, '- [x] Task');
            
            // checked -> unchecked
            content = cycleCheckboxInContent(content, 1, 'checked');
            assert.strictEqual(content, '- [ ] Task');
        });
    });

    suite('Cross-Platform Compatibility', () => {

        test('should handle Windows CRLF line endings in checkbox', () => {
            const result = applyMarkdownHighlighting('- [ ] Todo item\r', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
            assert.ok(!result.html.includes('\r'), 'Should strip carriage return');
        });

        test('should handle Windows CRLF line endings in in-progress checkbox', () => {
            const result = applyMarkdownHighlighting('- [~] In progress\r', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-in-progress'), 'Should have in-progress class');
            assert.ok(!result.html.includes('\r'), 'Should strip carriage return');
        });

        test('should handle checkbox with special characters in text', () => {
            const result = applyMarkdownHighlighting('- [ ] Task with "quotes" & <symbols>', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('&quot;'), 'Should escape quotes');
            assert.ok(result.html.includes('&amp;'), 'Should escape ampersand');
            assert.ok(result.html.includes('&lt;'), 'Should escape less than');
        });

        test('should handle checkbox with unicode text', () => {
            const result = applyMarkdownHighlighting('- [ ] 任务 🎯', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('任务'), 'Should preserve Chinese characters');
            assert.ok(result.html.includes('🎯'), 'Should preserve emoji');
        });

        test('should handle in-progress checkbox with unicode text', () => {
            const result = applyMarkdownHighlighting('- [~] 进行中 🔄', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-in-progress'), 'Should have in-progress class');
            assert.ok(result.html.includes('进行中'), 'Should preserve Chinese characters');
        });

        test('should handle checkbox with path-like text', () => {
            const result = applyMarkdownHighlighting('- [ ] Check file at path/to/file.md', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
            assert.ok(result.html.includes('path/to/file.md'), 'Should preserve path');
        });

        test('should handle checkbox with backslash path (Windows)', () => {
            const result = applyMarkdownHighlighting('- [ ] Check file at path\\to\\file.md', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
        });
    });

    suite('Edge Cases', () => {

        test('should handle checkbox at very high line number', () => {
            const result = applyMarkdownHighlighting('- [ ] Todo', 99999, false, null);
            assert.ok(result.html.includes('data-line="99999"'), 'Should handle high line numbers');
        });

        test('should handle in-progress checkbox at very high line number', () => {
            const result = applyMarkdownHighlighting('- [~] In progress', 99999, false, null);
            assert.ok(result.html.includes('data-line="99999"'), 'Should handle high line numbers');
            assert.ok(result.html.includes('md-checkbox-in-progress'), 'Should have in-progress class');
        });

        test('should handle checkbox with only spaces after it', () => {
            const result = applyMarkdownHighlighting('- [ ]    ', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
        });

        test('should handle checkbox with tabs in text', () => {
            const result = applyMarkdownHighlighting('- [ ] Task\twith\ttabs', 1, false, null);
            assert.ok(result.html.includes('md-checkbox-clickable'), 'Should have clickable class');
        });

        test('should handle multiple checkboxes with different states on different lines', () => {
            // Test that each line gets correct line number and state
            const result1 = applyMarkdownHighlighting('- [ ] First', 1, false, null);
            const result2 = applyMarkdownHighlighting('- [~] Second', 2, false, null);
            const result3 = applyMarkdownHighlighting('- [x] Third', 3, false, null);
            
            assert.ok(result1.html.includes('data-line="1"'));
            assert.ok(result1.html.includes('data-state="unchecked"'));
            assert.ok(result2.html.includes('data-line="2"'));
            assert.ok(result2.html.includes('data-state="in-progress"'));
            assert.ok(result3.html.includes('data-line="3"'));
            assert.ok(result3.html.includes('data-state="checked"'));
        });

        test('should not treat [x] in regular text as checkbox', () => {
            const result = applyMarkdownHighlighting('The value [x] is used here', 1, false, null);
            assert.ok(!result.html.includes('md-checkbox'), 'Should not have checkbox class');
        });

        test('should not treat [~] in regular text as checkbox', () => {
            const result = applyMarkdownHighlighting('The value [~] is used here', 1, false, null);
            assert.ok(!result.html.includes('md-checkbox'), 'Should not have checkbox class');
        });

        test('should not treat checkbox-like pattern in link as checkbox', () => {
            const result = applyMarkdownHighlighting('[x](http://example.com)', 1, false, null);
            assert.ok(!result.html.includes('md-checkbox'), 'Should not have checkbox class');
        });

        test('should not treat [~] in link as checkbox', () => {
            const result = applyMarkdownHighlighting('[~](http://example.com)', 1, false, null);
            assert.ok(!result.html.includes('md-checkbox'), 'Should not have checkbox class');
        });
    });
});
