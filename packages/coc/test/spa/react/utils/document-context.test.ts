/**
 * Tests for extractDocumentContext utility.
 */

import { describe, it, expect } from 'vitest';
import { extractDocumentContext } from '../../../../src/server/spa/client/react/utils/document-context';
import type { TaskComment } from '../../../../src/server/spa/client/task-comments-types';

function makeComment(overrides: Partial<TaskComment> & { startLine: number; endLine: number }): TaskComment {
    const { startLine, endLine, ...rest } = overrides;
    return {
        id: 'c1',
        taskId: 'task1',
        filePath: 'test.md',
        selection: { startLine, endLine, startColumn: 1, endColumn: 1 },
        selectedText: 'selected',
        comment: 'a comment',
        status: 'open',
        author: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...rest,
    } as TaskComment;
}

const SAMPLE_DOC = [
    '# Introduction',       // line 1
    'Some intro text.',     // line 2
    '',                     // line 3
    '## Section A',         // line 4
    'Line 5 content.',      // line 5
    'Line 6 content.',      // line 6
    'Line 7 content.',      // line 7
    '',                     // line 8
    '### Subsection A1',    // line 9
    'Line 10.',             // line 10
    'Line 11.',             // line 11
    'Line 12.',             // line 12
    '',                     // line 13
    '## Section B',         // line 14
    'Line 15.',             // line 15
].join('\n');

describe('extractDocumentContext', () => {
    it('returns empty context for null comment', () => {
        const ctx = extractDocumentContext(SAMPLE_DOC, null);
        expect(ctx.surroundingLines).toBe('');
        expect(ctx.nearestHeading).toBeNull();
        expect(ctx.allHeadings).toEqual([]);
    });

    it('returns empty context for undefined comment', () => {
        const ctx = extractDocumentContext(SAMPLE_DOC, undefined);
        expect(ctx.surroundingLines).toBe('');
        expect(ctx.nearestHeading).toBeNull();
        expect(ctx.allHeadings).toEqual([]);
    });

    it('returns all headings in order', () => {
        const comment = makeComment({ startLine: 10, endLine: 10 });
        const ctx = extractDocumentContext(SAMPLE_DOC, comment);
        expect(ctx.allHeadings).toEqual(['Introduction', 'Section A', 'Subsection A1', 'Section B']);
    });

    it('finds nearest heading at or before selection', () => {
        const comment = makeComment({ startLine: 10, endLine: 10 });
        const ctx = extractDocumentContext(SAMPLE_DOC, comment);
        expect(ctx.nearestHeading).toBe('Subsection A1');
    });

    it('returns nearestHeading as null when no headings before selection', () => {
        const doc = 'No headings here\nJust plain text\nAnother line';
        const comment = makeComment({ startLine: 2, endLine: 2 });
        const ctx = extractDocumentContext(doc, comment);
        expect(ctx.nearestHeading).toBeNull();
        expect(ctx.allHeadings).toEqual([]);
    });

    it('uses last heading before selection when multiple exist', () => {
        const comment = makeComment({ startLine: 15, endLine: 15 });
        const ctx = extractDocumentContext(SAMPLE_DOC, comment);
        expect(ctx.nearestHeading).toBe('Section B');
    });

    it('excludes selected lines from surrounding context', () => {
        const comment = makeComment({ startLine: 6, endLine: 7 });
        const ctx = extractDocumentContext(SAMPLE_DOC, comment, 3);
        const lines = ctx.surroundingLines.split('\n');
        expect(lines).not.toContain('Line 6 content.');
        expect(lines).not.toContain('Line 7 content.');
    });

    it('includes lines within contextRadius around selection', () => {
        const comment = makeComment({ startLine: 6, endLine: 6 });
        const ctx = extractDocumentContext(SAMPLE_DOC, comment, 2);
        const lines = ctx.surroundingLines.split('\n');
        // Lines 4-5 before, 7-8 after (line 6 excluded)
        expect(lines).toContain('## Section A');
        expect(lines).toContain('Line 5 content.');
        expect(lines).toContain('Line 7 content.');
    });

    it('clamps ctxStart to 0 when selection is on line 1', () => {
        const comment = makeComment({ startLine: 1, endLine: 1 });
        const ctx = extractDocumentContext(SAMPLE_DOC, comment, 5);
        // Should not crash; surrounding lines should be lines 2-6
        expect(ctx.surroundingLines).toContain('Some intro text.');
        expect(ctx.nearestHeading).toBe('Introduction');
    });

    it('clamps ctxEnd to lines.length when selection is on last line', () => {
        const comment = makeComment({ startLine: 15, endLine: 15 });
        const ctx = extractDocumentContext(SAMPLE_DOC, comment, 5);
        // Should not crash; surrounding lines should include lines before 15
        expect(ctx.surroundingLines).toContain('Line 12.');
    });

    it('handles CRLF line endings', () => {
        const crlfDoc = '# Heading\r\nLine 2\r\nLine 3\r\nLine 4\r\nLine 5';
        const comment = makeComment({ startLine: 3, endLine: 3 });
        const ctx = extractDocumentContext(crlfDoc, comment, 2);
        expect(ctx.nearestHeading).toBe('Heading');
        expect(ctx.allHeadings).toEqual(['Heading']);
        const lines = ctx.surroundingLines.split('\n');
        expect(lines).not.toContain('Line 3');
        expect(lines).toContain('Line 2');
        expect(lines).toContain('Line 4');
    });

    it('handles CR-only line endings', () => {
        const crDoc = '# Title\rLine 2\rLine 3';
        const comment = makeComment({ startLine: 2, endLine: 2 });
        const ctx = extractDocumentContext(crDoc, comment, 5);
        expect(ctx.nearestHeading).toBe('Title');
    });

    it('returns empty surroundingLines for empty rawContent', () => {
        const comment = makeComment({ startLine: 1, endLine: 1 });
        const ctx = extractDocumentContext('', comment);
        expect(ctx.surroundingLines).toBe('');
        expect(ctx.nearestHeading).toBeNull();
        expect(ctx.allHeadings).toEqual([]);
    });

    it('handles single-line document', () => {
        const doc = '# Only heading';
        const comment = makeComment({ startLine: 1, endLine: 1 });
        const ctx = extractDocumentContext(doc, comment);
        expect(ctx.nearestHeading).toBe('Only heading');
        expect(ctx.allHeadings).toEqual(['Only heading']);
        expect(ctx.surroundingLines).toBe('');
    });

    it('uses default contextRadius of 5', () => {
        // Line 10, default radius 5 → ctxStart=4 (line 5), ctxEnd=15 (line 15)
        const comment = makeComment({ startLine: 10, endLine: 10 });
        const ctx = extractDocumentContext(SAMPLE_DOC, comment);
        const lines = ctx.surroundingLines.split('\n');
        expect(lines).toContain('Line 5 content.');
        expect(lines).toContain('Line 15.');
        expect(lines).not.toContain('Line 10.');
    });

    it('handles multi-line selection', () => {
        const comment = makeComment({ startLine: 5, endLine: 7 });
        const ctx = extractDocumentContext(SAMPLE_DOC, comment, 2);
        const lines = ctx.surroundingLines.split('\n');
        // Lines 5, 6, 7 should all be excluded
        expect(lines).not.toContain('Line 5 content.');
        expect(lines).not.toContain('Line 6 content.');
        expect(lines).not.toContain('Line 7 content.');
        // But surrounding lines should be included
        expect(lines).toContain('');  // line 3 or 8
    });

    it('parses H1 through H6 headings', () => {
        const doc = [
            '# H1',
            '## H2',
            '### H3',
            '#### H4',
            '##### H5',
            '###### H6',
            'Not a heading',
            '####### Seven hashes',
        ].join('\n');
        const comment = makeComment({ startLine: 8, endLine: 8 });
        const ctx = extractDocumentContext(doc, comment);
        expect(ctx.allHeadings).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    });

    it('includes heading on same line as startLine', () => {
        const doc = '## Heading on line 1\nContent';
        const comment = makeComment({ startLine: 1, endLine: 1 });
        const ctx = extractDocumentContext(doc, comment);
        expect(ctx.nearestHeading).toBe('Heading on line 1');
    });
});
