import { describe, it, expect } from 'vitest';
import {
    calculateColumnIndices,
    getHighlightColumnsForLine,
    createPlainToHtmlMapping,
    applyCommentHighlightToRange
} from '../../../src/editor/rendering/selection-utils';
import { CommentSelection } from '../../../src/editor/types';

describe('calculateColumnIndices', () => {
    it('converts 1-based columns to 0-based indices', () => {
        const result = calculateColumnIndices('hello world', 1, 6);
        expect(result.startIdx).toBe(0);
        expect(result.endIdx).toBe(5);
        expect(result.isValid).toBe(true);
    });

    it('clamps to line boundaries', () => {
        const result = calculateColumnIndices('short', 1, 100);
        expect(result.endIdx).toBe(5);
    });

    it('marks invalid when start >= end', () => {
        const result = calculateColumnIndices('test', 5, 3);
        expect(result.isValid).toBe(false);
    });

    it('marks invalid when start is past line length', () => {
        const result = calculateColumnIndices('ab', 10, 20);
        expect(result.isValid).toBe(false);
    });
});

describe('getHighlightColumnsForLine', () => {
    it('returns exact range for single-line comment', () => {
        const selection: CommentSelection = { startLine: 5, startColumn: 3, endLine: 5, endColumn: 8 };
        const result = getHighlightColumnsForLine(selection, 5, 20);
        expect(result).toEqual({ startCol: 3, endCol: 8 });
    });

    it('returns start to end-of-line for first line of multi-line', () => {
        const selection: CommentSelection = { startLine: 2, startColumn: 5, endLine: 4, endColumn: 10 };
        const result = getHighlightColumnsForLine(selection, 2, 20);
        expect(result).toEqual({ startCol: 5, endCol: 21 });
    });

    it('returns 1 to endColumn for last line of multi-line', () => {
        const selection: CommentSelection = { startLine: 2, startColumn: 5, endLine: 4, endColumn: 10 };
        const result = getHighlightColumnsForLine(selection, 4, 20);
        expect(result).toEqual({ startCol: 1, endCol: 10 });
    });

    it('returns full line for middle line of multi-line', () => {
        const selection: CommentSelection = { startLine: 2, startColumn: 5, endLine: 4, endColumn: 10 };
        const result = getHighlightColumnsForLine(selection, 3, 15);
        expect(result).toEqual({ startCol: 1, endCol: 16 });
    });

    it('returns fallback for out-of-range line', () => {
        const selection: CommentSelection = { startLine: 2, startColumn: 5, endLine: 4, endColumn: 10 };
        const result = getHighlightColumnsForLine(selection, 10, 20);
        expect(result).toEqual({ startCol: 1, endCol: 21 });
    });
});

describe('createPlainToHtmlMapping', () => {
    it('maps plain characters to HTML positions', () => {
        const { plainToHtmlStart, plainToHtmlEnd, plainLength } = createPlainToHtmlMapping('hello');
        expect(plainLength).toBe(5);
        expect(plainToHtmlStart[0]).toBe(0);
        expect(plainToHtmlEnd[4]).toBe(5);
    });

    it('handles HTML tags correctly', () => {
        const html = '<b>hi</b>';
        const { plainLength } = createPlainToHtmlMapping(html);
        expect(plainLength).toBe(2); // "hi"
    });

    it('handles HTML entities', () => {
        const html = '&amp;';
        const { plainLength } = createPlainToHtmlMapping(html);
        expect(plainLength).toBe(1);
    });

    it('handles mixed HTML content', () => {
        const html = '<span>a&lt;b</span>';
        const { plainLength } = createPlainToHtmlMapping(html);
        expect(plainLength).toBe(3); // "a", "<" entity, "b"
    });
});

describe('applyCommentHighlightToRange', () => {
    it('wraps a range of plain text with highlight span', () => {
        const result = applyCommentHighlightToRange(
            'hello world', 'hello world', 1, 6, 'comment-1', 'open'
        );
        expect(result).toContain('commented-text');
        expect(result).toContain('data-comment-id="comment-1"');
    });

    it('wraps entire line when range is invalid', () => {
        const result = applyCommentHighlightToRange(
            'short', 'short', 10, 20, 'c1', 'open'
        );
        expect(result).toContain('commented-text');
        expect(result).toContain('short');
    });

    it('handles HTML content with entities', () => {
        const html = '&lt;div&gt;';
        const plain = '<div>';
        const result = applyCommentHighlightToRange(html, plain, 1, 4, 'c1', 'open');
        expect(result).toContain('commented-text');
    });

    it('includes type class when provided', () => {
        const result = applyCommentHighlightToRange(
            'text', 'text', 1, 5, 'c1', 'open', 'ai-suggestion'
        );
        expect(result).toContain('ai-suggestion');
    });
});
