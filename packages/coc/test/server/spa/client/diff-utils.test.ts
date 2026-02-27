/**
 * Tests for diff-utils.ts — line-level diff computation.
 */

import { describe, it, expect } from 'vitest';
import { computeLineDiff, MAX_DIFF_LINES, type DiffLine } from '../../../../src/server/spa/client/diff-utils';

describe('computeLineDiff', () => {
    it('returns context lines for identical strings', () => {
        const result = computeLineDiff('a\nb\nc', 'a\nb\nc');
        expect(result).toEqual([
            { type: 'context', content: 'a' },
            { type: 'context', content: 'b' },
            { type: 'context', content: 'c' },
        ]);
    });

    it('detects added lines', () => {
        const result = computeLineDiff('a\nc', 'a\nb\nc');
        expect(result).not.toBeNull();
        const added = result!.filter(l => l.type === 'added');
        expect(added).toHaveLength(1);
        expect(added[0].content).toBe('b');
    });

    it('detects removed lines', () => {
        const result = computeLineDiff('a\nb\nc', 'a\nc');
        expect(result).not.toBeNull();
        const removed = result!.filter(l => l.type === 'removed');
        expect(removed).toHaveLength(1);
        expect(removed[0].content).toBe('b');
    });

    it('detects modifications as remove+add pairs', () => {
        const result = computeLineDiff('hello', 'world');
        expect(result).not.toBeNull();
        expect(result).toEqual([
            { type: 'removed', content: 'hello' },
            { type: 'added', content: 'world' },
        ]);
    });

    it('handles multi-line modifications', () => {
        const old = 'line1\nold2\nold3\nline4';
        const nw = 'line1\nnew2\nnew3\nline4';
        const result = computeLineDiff(old, nw);
        expect(result).not.toBeNull();

        const types = result!.map(l => l.type);
        // line1 and line4 should be context
        expect(result![0]).toEqual({ type: 'context', content: 'line1' });
        expect(result![result!.length - 1]).toEqual({ type: 'context', content: 'line4' });

        // Should have removed and added lines in the middle
        expect(types.filter(t => t === 'removed').length).toBe(2);
        expect(types.filter(t => t === 'added').length).toBe(2);
    });

    it('handles empty old_str (pure addition)', () => {
        const result = computeLineDiff('', 'new line');
        expect(result).not.toBeNull();
        // Empty string splits to [''], so we get one removed empty line + one added line
        expect(result!.some(l => l.type === 'added' && l.content === 'new line')).toBe(true);
    });

    it('handles empty new_str (pure deletion)', () => {
        const result = computeLineDiff('old line', '');
        expect(result).not.toBeNull();
        expect(result!.some(l => l.type === 'removed' && l.content === 'old line')).toBe(true);
    });

    it('handles both empty strings', () => {
        const result = computeLineDiff('', '');
        expect(result).not.toBeNull();
        expect(result).toEqual([{ type: 'context', content: '' }]);
    });

    it('returns null for strings exceeding MAX_DIFF_LINES', () => {
        const longStr = Array(MAX_DIFF_LINES + 1).fill('line').join('\n');
        const result = computeLineDiff(longStr, 'short');
        expect(result).toBeNull();
    });

    it('returns null when new string exceeds MAX_DIFF_LINES', () => {
        const longStr = Array(MAX_DIFF_LINES + 1).fill('line').join('\n');
        const result = computeLineDiff('short', longStr);
        expect(result).toBeNull();
    });

    it('handles trailing newlines correctly', () => {
        const result = computeLineDiff('a\n', 'a\nb\n');
        expect(result).not.toBeNull();
        const added = result!.filter(l => l.type === 'added');
        expect(added.some(l => l.content === 'b')).toBe(true);
    });

    it('preserves whitespace in content', () => {
        const result = computeLineDiff('  indented', '    more indented');
        expect(result).not.toBeNull();
        expect(result!.find(l => l.type === 'removed')?.content).toBe('  indented');
        expect(result!.find(l => l.type === 'added')?.content).toBe('    more indented');
    });

    it('handles single-line context with no changes at boundaries', () => {
        const result = computeLineDiff(
            'start\nmiddle\nend',
            'start\nchanged\nend'
        );
        expect(result).not.toBeNull();
        expect(result![0]).toEqual({ type: 'context', content: 'start' });
        expect(result![result!.length - 1]).toEqual({ type: 'context', content: 'end' });
    });
});
