/**
 * Tests for the Line Change Tracker utility
 * Tests diff computation for showing change indicators in the Markdown Review Editor
 */

import * as assert from 'assert';
import { computeLineChanges, lineChangesToMap, LineChange } from '../../shortcuts/markdown-comments/line-change-tracker';

suite('Line Change Tracker Tests', () => {
    suite('computeLineChanges', () => {
        test('should return empty array for identical content', () => {
            const content = 'line 1\nline 2\nline 3';
            const changes = computeLineChanges(content, content);
            assert.strictEqual(changes.length, 0);
        });

        test('should detect single line addition at end', () => {
            // Use trailing newlines to avoid line-ending modification artifacts
            const oldContent = 'line 1\nline 2\n';
            const newContent = 'line 1\nline 2\nline 3\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 1);
            assert.deepStrictEqual(changes[0], { line: 3, type: 'added' });
        });

        test('should detect single line addition at beginning', () => {
            const oldContent = 'line 2\nline 3\n';
            const newContent = 'line 1\nline 2\nline 3\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 1);
            assert.deepStrictEqual(changes[0], { line: 1, type: 'added' });
        });

        test('should detect single line modification', () => {
            const oldContent = 'line 1\noriginal line\nline 3\n';
            const newContent = 'line 1\nmodified line\nline 3\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 1);
            assert.deepStrictEqual(changes[0], { line: 2, type: 'modified' });
        });

        test('should detect multiple consecutive additions', () => {
            const oldContent = 'line 1\nline 4\n';
            const newContent = 'line 1\nline 2\nline 3\nline 4\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 2);
            assert.deepStrictEqual(changes[0], { line: 2, type: 'added' });
            assert.deepStrictEqual(changes[1], { line: 3, type: 'added' });
        });

        test('should detect multiple modifications', () => {
            const oldContent = 'line 1\nold A\nold B\nline 4\n';
            const newContent = 'line 1\nnew A\nnew B\nline 4\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 2);
            assert.deepStrictEqual(changes[0], { line: 2, type: 'modified' });
            assert.deepStrictEqual(changes[1], { line: 3, type: 'modified' });
        });

        test('should handle mixed modifications and additions', () => {
            const oldContent = 'line 1\nold line\nline 3\n';
            const newContent = 'line 1\nmodified line\nnew line\nline 3\n';
            const changes = computeLineChanges(oldContent, newContent);

            // One modification (replaced 'old line') and one addition
            assert.strictEqual(changes.length, 2);
            assert.deepStrictEqual(changes[0], { line: 2, type: 'modified' });
            assert.deepStrictEqual(changes[1], { line: 3, type: 'added' });
        });

        test('should handle deletion followed by more additions', () => {
            const oldContent = 'line 1\nremove me\nline 3\n';
            const newContent = 'line 1\nnew A\nnew B\nnew C\nline 3\n';
            const changes = computeLineChanges(oldContent, newContent);

            // First line is a modification (replacement), rest are additions
            assert.strictEqual(changes.length, 3);
            assert.deepStrictEqual(changes[0], { line: 2, type: 'modified' });
            assert.deepStrictEqual(changes[1], { line: 3, type: 'added' });
            assert.deepStrictEqual(changes[2], { line: 4, type: 'added' });
        });

        test('should handle complete replacement', () => {
            const oldContent = 'old 1\nold 2\nold 3\n';
            const newContent = 'new 1\nnew 2\nnew 3\n';
            const changes = computeLineChanges(oldContent, newContent);

            // All lines are modifications
            assert.strictEqual(changes.length, 3);
            assert.deepStrictEqual(changes[0], { line: 1, type: 'modified' });
            assert.deepStrictEqual(changes[1], { line: 2, type: 'modified' });
            assert.deepStrictEqual(changes[2], { line: 3, type: 'modified' });
        });

        test('should handle empty old content (all new)', () => {
            const oldContent = '';
            const newContent = 'line 1\nline 2\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 2);
            assert.deepStrictEqual(changes[0], { line: 1, type: 'added' });
            assert.deepStrictEqual(changes[1], { line: 2, type: 'added' });
        });

        test('should handle complete deletion (no new changes)', () => {
            const oldContent = 'line 1\nline 2\n';
            const newContent = '';
            const changes = computeLineChanges(oldContent, newContent);

            // No changes to new content - it's empty
            assert.strictEqual(changes.length, 0);
        });

        test('should handle single line content', () => {
            const oldContent = 'old line\n';
            const newContent = 'new line\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 1);
            assert.deepStrictEqual(changes[0], { line: 1, type: 'modified' });
        });

        test('should handle whitespace-only changes', () => {
            const oldContent = 'line 1\nline 2\n';
            const newContent = 'line 1\nline 2  \n'; // trailing spaces
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 1);
            assert.deepStrictEqual(changes[0], { line: 2, type: 'modified' });
        });

        test('should handle changes in the middle of the document', () => {
            const oldContent = 'header\nkeep 1\nold middle\nkeep 2\nfooter\n';
            const newContent = 'header\nkeep 1\nnew middle\nkeep 2\nfooter\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 1);
            assert.deepStrictEqual(changes[0], { line: 3, type: 'modified' });
        });

        test('should handle large additions (typical AI edit scenario)', () => {
            const oldContent = '# Title\n\nSome content.\n';
            const newContent = '# Title\n\n## New Section\n\nThis is a new paragraph added by AI.\n\nSome content.\n';
            const changes = computeLineChanges(oldContent, newContent);

            // Lines 3-6 are new
            assert.ok(changes.length >= 3);
            assert.ok(changes.some(c => c.type === 'added'));
        });
    });

    suite('lineChangesToMap', () => {
        test('should convert empty array to empty map', () => {
            const map = lineChangesToMap([]);
            assert.strictEqual(map.size, 0);
        });

        test('should convert single change to map', () => {
            const changes: LineChange[] = [{ line: 5, type: 'added' }];
            const map = lineChangesToMap(changes);

            assert.strictEqual(map.size, 1);
            assert.strictEqual(map.get(5), 'added');
        });

        test('should convert multiple changes to map', () => {
            const changes: LineChange[] = [
                { line: 1, type: 'modified' },
                { line: 3, type: 'added' },
                { line: 5, type: 'modified' }
            ];
            const map = lineChangesToMap(changes);

            assert.strictEqual(map.size, 3);
            assert.strictEqual(map.get(1), 'modified');
            assert.strictEqual(map.get(3), 'added');
            assert.strictEqual(map.get(5), 'modified');
        });

        test('should return null for unchanged lines', () => {
            const changes: LineChange[] = [{ line: 2, type: 'added' }];
            const map = lineChangesToMap(changes);

            assert.strictEqual(map.get(1), undefined);
            assert.strictEqual(map.get(3), undefined);
        });

        test('should handle last change winning for duplicate lines', () => {
            const changes: LineChange[] = [
                { line: 5, type: 'added' },
                { line: 5, type: 'modified' } // Same line, should overwrite
            ];
            const map = lineChangesToMap(changes);

            assert.strictEqual(map.size, 1);
            assert.strictEqual(map.get(5), 'modified');
        });
    });

    suite('Edge Cases', () => {
        test('should handle CRLF line endings', () => {
            const oldContent = 'line 1\r\nline 2\r\nline 3\r\n';
            const newContent = 'line 1\r\nmodified\r\nline 3\r\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 1);
            assert.deepStrictEqual(changes[0], { line: 2, type: 'modified' });
        });

        test('should handle mixed line endings', () => {
            const oldContent = 'line 1\nline 2\r\nline 3\n';
            const newContent = 'line 1\nmodified\r\nline 3\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 1);
            assert.deepStrictEqual(changes[0], { line: 2, type: 'modified' });
        });

        test('should handle very long lines', () => {
            const longLine = 'x'.repeat(10000);
            const oldContent = `short\n${longLine}\nshort\n`;
            const newContent = `short\n${longLine}y\nshort\n`; // Add one char
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 1);
            assert.deepStrictEqual(changes[0], { line: 2, type: 'modified' });
        });

        test('should handle unicode content', () => {
            const oldContent = '你好\n世界\n';
            const newContent = '你好\n宇宙\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 1);
            assert.deepStrictEqual(changes[0], { line: 2, type: 'modified' });
        });

        test('should handle emoji content', () => {
            const oldContent = 'Hello 👋\nWorld 🌍\n';
            const newContent = 'Hello 👋\nUniverse 🌌\n';
            const changes = computeLineChanges(oldContent, newContent);

            assert.strictEqual(changes.length, 1);
            assert.deepStrictEqual(changes[0], { line: 2, type: 'modified' });
        });
    });
});
