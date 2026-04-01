/**
 * Tests for buildDiffContext utility function.
 */

import { describe, it, expect } from 'vitest';
import { buildDiffContext } from '../../../../src/server/spa/client/diff-context-utils';
import type { DiffCommentSelection } from '../../../../src/server/spa/client/diff-comment-types';

describe('buildDiffContext', () => {
    const baseSelection: DiffCommentSelection = {
        diffLineStart: 10,
        diffLineEnd: 15,
        side: 'added',
    };

    it('builds context with commit hash and file path', () => {
        const result = buildDiffContext({
            selectedText: 'const x = 1;',
            selection: baseSelection,
            commitHash: 'abc123',
            filePath: 'src/index.ts',
        });
        expect(result).toBe([
            'Context from code review:',
            '- Commit: abc123',
            '- File: src/index.ts',
            '- Lines 10-15:',
            '```',
            'const x = 1;',
            '```',
            '',
            '',
        ].join('\n'));
    });

    it('omits commit hash when not provided', () => {
        const result = buildDiffContext({
            selectedText: 'line1\nline2',
            selection: baseSelection,
            filePath: 'README.md',
        });
        expect(result).toContain('- File: README.md');
        expect(result).not.toContain('- Commit:');
    });

    it('omits file path when not provided', () => {
        const result = buildDiffContext({
            selectedText: 'code here',
            selection: baseSelection,
            commitHash: 'def456',
        });
        expect(result).toContain('- Commit: def456');
        expect(result).not.toContain('- File:');
    });

    it('omits both commit hash and file path when neither provided', () => {
        const result = buildDiffContext({
            selectedText: 'code here',
            selection: baseSelection,
        });
        expect(result).not.toContain('- Commit:');
        expect(result).not.toContain('- File:');
        expect(result).toContain('- Lines 10-15:');
    });

    it('uses newLineStart/newLineEnd when available', () => {
        const selection: DiffCommentSelection = {
            diffLineStart: 10,
            diffLineEnd: 15,
            newLineStart: 42,
            newLineEnd: 47,
            side: 'added',
        };
        const result = buildDiffContext({
            selectedText: 'code',
            selection,
            filePath: 'app.ts',
        });
        expect(result).toContain('- Lines 42-47:');
        expect(result).not.toContain('- Lines 10-15:');
    });

    it('falls back to diffLineStart/diffLineEnd when newLine fields are absent', () => {
        const result = buildDiffContext({
            selectedText: 'code',
            selection: baseSelection,
        });
        expect(result).toContain('- Lines 10-15:');
    });

    it('falls back to diffLineStart/diffLineEnd when newLineStart is 0', () => {
        const selection: DiffCommentSelection = {
            diffLineStart: 5,
            diffLineEnd: 8,
            newLineStart: 0,
            newLineEnd: 3,
            side: 'removed',
        };
        const result = buildDiffContext({
            selectedText: 'code',
            selection,
        });
        expect(result).toContain('- Lines 5-8:');
    });

    it('wraps selected text in a fenced code block', () => {
        const result = buildDiffContext({
            selectedText: 'function hello() {}',
            selection: baseSelection,
        });
        const lines = result.split('\n');
        const codeBlockStart = lines.indexOf('```');
        expect(codeBlockStart).toBeGreaterThan(0);
        expect(lines[codeBlockStart + 1]).toBe('function hello() {}');
        expect(lines[codeBlockStart + 2]).toBe('```');
    });

    it('handles multi-line selected text', () => {
        const multiLine = 'line 1\nline 2\nline 3';
        const result = buildDiffContext({
            selectedText: multiLine,
            selection: baseSelection,
        });
        expect(result).toContain('line 1\nline 2\nline 3');
    });

    it('ends with two trailing newlines', () => {
        const result = buildDiffContext({
            selectedText: 'code',
            selection: baseSelection,
        });
        expect(result).toMatch(/```\n\n$/);
    });

    it('always starts with Context from code review:', () => {
        const result = buildDiffContext({
            selectedText: 'x',
            selection: baseSelection,
        });
        expect(result.startsWith('Context from code review:')).toBe(true);
    });
});
