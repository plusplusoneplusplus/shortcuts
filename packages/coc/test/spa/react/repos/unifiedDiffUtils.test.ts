/**
 * Tests for generateUnifiedDiff — the client-side diff utility for WorkflowAIRefinePanel.
 */

import { describe, it, expect } from 'vitest';
import { generateUnifiedDiff } from '../../../../src/server/spa/client/react/repos/unifiedDiffUtils';

describe('generateUnifiedDiff', () => {
    it('produces no +/- content lines for identical input', () => {
        const text = 'name: test\ndescription: hello';
        const diff = generateUnifiedDiff(text, text);
        const lines = diff.split('\n');

        // Header lines present
        expect(lines[0]).toBe('--- a/pipeline.yaml');
        expect(lines[1]).toBe('+++ b/pipeline.yaml');
        expect(lines[2]).toMatch(/^@@/);

        // Content lines: all context (space-prefixed), no + or -
        const contentLines = lines.slice(3);
        for (const line of contentLines) {
            expect(line).not.toMatch(/^[+-]/);
            expect(line).toMatch(/^ /);
        }
    });

    it('shows added lines with + prefix', () => {
        const oldText = 'line1\nline2';
        const newText = 'line1\nline2\nline3';
        const diff = generateUnifiedDiff(oldText, newText);
        const lines = diff.split('\n');

        // Header counts
        expect(lines[2]).toBe('@@ -1,2 +1,3 @@');

        // line3 should be added
        expect(lines.some(l => l === '+line3')).toBe(true);
    });

    it('shows removed lines with - prefix', () => {
        const oldText = 'line1\nline2\nline3';
        const newText = 'line1\nline2';
        const diff = generateUnifiedDiff(oldText, newText);
        const lines = diff.split('\n');

        expect(lines[2]).toBe('@@ -1,3 +1,2 @@');
        expect(lines.some(l => l === '-line3')).toBe(true);
    });

    it('shows mixed edits with both + and - lines', () => {
        const oldText = 'name: old\ndescription: test';
        const newText = 'name: new\ndescription: test';
        const diff = generateUnifiedDiff(oldText, newText);
        const lines = diff.split('\n');

        expect(lines.some(l => l === '-name: old')).toBe(true);
        expect(lines.some(l => l === '+name: new')).toBe(true);
        expect(lines.some(l => l === ' description: test')).toBe(true);
    });

    it('handles empty old text — all lines are added', () => {
        const diff = generateUnifiedDiff('', 'line1\nline2');
        const lines = diff.split('\n');

        expect(lines[2]).toBe('@@ -1,0 +1,2 @@');
        const contentLines = lines.slice(3);
        expect(contentLines.every(l => l.startsWith('+'))).toBe(true);
        expect(contentLines.length).toBe(2);
    });

    it('handles empty new text — all lines are removed', () => {
        const diff = generateUnifiedDiff('line1\nline2', '');
        const lines = diff.split('\n');

        expect(lines[2]).toBe('@@ -1,2 +1,0 @@');
        const contentLines = lines.slice(3);
        expect(contentLines.every(l => l.startsWith('-'))).toBe(true);
        expect(contentLines.length).toBe(2);
    });

    it('uses the provided fileName in header lines', () => {
        const diff = generateUnifiedDiff('a', 'b', 'my-pipe.yaml');
        const lines = diff.split('\n');

        expect(lines[0]).toBe('--- a/my-pipe.yaml');
        expect(lines[1]).toBe('+++ b/my-pipe.yaml');
    });

    it('defaults fileName to pipeline.yaml', () => {
        const diff = generateUnifiedDiff('a', 'b');
        expect(diff).toContain('--- a/pipeline.yaml');
        expect(diff).toContain('+++ b/pipeline.yaml');
    });

    it('produces output compatible with UnifiedDiffViewer line classification', () => {
        const oldText = 'name: test\nsteps:\n  - run: echo';
        const newText = 'name: test\nsteps:\n  - run: echo hello';
        const diff = generateUnifiedDiff(oldText, newText);
        const lines = diff.split('\n');

        // Verify each line classifies correctly by prefix
        for (const line of lines) {
            if (line.startsWith('@@')) {
                // hunk-header
                continue;
            }
            if (line.startsWith('--- ') || line.startsWith('+++ ')) {
                // meta line
                continue;
            }
            if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
                // content line — valid prefix
                continue;
            }
            // Should not reach here for our generated diffs
            throw new Error(`Unexpected line format: "${line}"`);
        }
    });

    it('preserves empty lines in content', () => {
        const oldText = 'line1\n\nline3';
        const newText = 'line1\n\nline3\nline4';
        const diff = generateUnifiedDiff(oldText, newText);
        const lines = diff.split('\n');

        // The empty line should appear as a context line with just a space prefix
        expect(lines.some(l => l === ' ')).toBe(true);
        expect(lines.some(l => l === '+line4')).toBe(true);
    });
});
