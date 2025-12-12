/**
 * Unit tests for webview-logic module
 * 
 * These tests demonstrate the testability of the extracted business logic.
 * The webview-logic module contains pure functions that can be tested in Node.js
 * without needing a browser environment.
 */

import * as assert from 'assert';
import {
    filterCommentsByStatus,
    sortCommentsByLine,
    sortCommentsByColumnDescending,
    groupCommentsByLine,
    getCommentsForLine,
    blockHasComments,
    countCommentsByStatus,
    findCommentById,
    updateCommentStatus,
    updateCommentText,
    deleteComment,
    resolveAllComments
} from '../../shortcuts/markdown-comments/webview-logic/comment-state';

import {
    calculateColumnIndices,
    getHighlightColumnsForLine,
    createPlainToHtmlMapping,
    applyCommentHighlightToRange
} from '../../shortcuts/markdown-comments/webview-logic/selection-utils';

import {
    escapeHtml,
    applyInlineMarkdown,
    applyMarkdownHighlighting
} from '../../shortcuts/markdown-comments/webview-logic/markdown-renderer';

import { MarkdownComment } from '../../shortcuts/markdown-comments/types';

suite('Webview Logic Tests', () => {
    // Sample comments for testing
    const sampleComments: MarkdownComment[] = [
        {
            id: 'comment-1',
            filePath: '/test/file.md',
            selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
            selectedText: 'Hello World',
            comment: 'This is comment 1',
            status: 'open',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z'
        },
        {
            id: 'comment-2',
            filePath: '/test/file.md',
            selection: { startLine: 10, startColumn: 5, endLine: 12, endColumn: 15 },
            selectedText: 'Multi-line text',
            comment: 'This is comment 2',
            status: 'resolved',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z'
        },
        {
            id: 'comment-3',
            filePath: '/test/file.md',
            selection: { startLine: 5, startColumn: 25, endLine: 5, endColumn: 40 },
            selectedText: 'Another text',
            comment: 'This is comment 3',
            status: 'open',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z'
        }
    ];

    suite('Comment State Management', () => {
        test('filterCommentsByStatus should filter resolved comments when showResolved is false', () => {
            const filtered = filterCommentsByStatus(sampleComments, false);
            assert.strictEqual(filtered.length, 2);
            assert.ok(filtered.every(c => c.status !== 'resolved'));
        });

        test('filterCommentsByStatus should return all comments when showResolved is true', () => {
            const filtered = filterCommentsByStatus(sampleComments, true);
            assert.strictEqual(filtered.length, 3);
        });

        test('sortCommentsByLine should sort comments by line number', () => {
            const sorted = sortCommentsByLine(sampleComments);
            assert.strictEqual(sorted[0].id, 'comment-1'); // Line 5
            assert.strictEqual(sorted[2].id, 'comment-2'); // Line 10
        });

        test('sortCommentsByColumnDescending should sort comments by column descending', () => {
            const sorted = sortCommentsByColumnDescending(sampleComments);
            assert.strictEqual(sorted[0].id, 'comment-3'); // Column 25
            assert.strictEqual(sorted[1].id, 'comment-2'); // Column 5
            assert.strictEqual(sorted[2].id, 'comment-1'); // Column 1
        });

        test('groupCommentsByLine should group comments by starting line', () => {
            const grouped = groupCommentsByLine(sampleComments);
            assert.strictEqual(grouped.size, 2); // Lines 5 and 10
            assert.strictEqual(grouped.get(5)?.length, 2);
            assert.strictEqual(grouped.get(10)?.length, 1);
        });

        test('countCommentsByStatus should count comments correctly', () => {
            const counts = countCommentsByStatus(sampleComments);
            assert.strictEqual(counts.open, 2);
            assert.strictEqual(counts.resolved, 1);
            assert.strictEqual(counts.pending, 0);
        });

        test('findCommentById should find the correct comment', () => {
            const found = findCommentById(sampleComments, 'comment-2');
            assert.ok(found);
            assert.strictEqual(found.id, 'comment-2');
        });

        test('findCommentById should return undefined for non-existent id', () => {
            const found = findCommentById(sampleComments, 'non-existent');
            assert.strictEqual(found, undefined);
        });

        test('updateCommentStatus should update the comment status', () => {
            const updated = updateCommentStatus(sampleComments, 'comment-1', 'resolved');
            const comment = findCommentById(updated, 'comment-1');
            assert.ok(comment);
            assert.strictEqual(comment.status, 'resolved');
        });

        test('deleteComment should remove the comment', () => {
            const remaining = deleteComment(sampleComments, 'comment-1');
            assert.strictEqual(remaining.length, 2);
            assert.ok(!findCommentById(remaining, 'comment-1'));
        });

        test('resolveAllComments should mark all open comments as resolved', () => {
            const resolved = resolveAllComments(sampleComments);
            assert.ok(resolved.every(c => c.status === 'resolved'));
        });
    });

    suite('Selection Utilities', () => {
        test('calculateColumnIndices should convert 1-based columns to 0-based indices', () => {
            const result = calculateColumnIndices('Hello World', 1, 6);
            assert.strictEqual(result.startIdx, 0);
            assert.strictEqual(result.endIdx, 5);
            assert.strictEqual(result.isValid, true);
        });

        test('calculateColumnIndices should handle out-of-bounds columns', () => {
            const result = calculateColumnIndices('Hello', 1, 100);
            assert.strictEqual(result.startIdx, 0);
            assert.strictEqual(result.endIdx, 5);
        });

        test('getHighlightColumnsForLine should handle single-line selection', () => {
            const selection = { startLine: 5, startColumn: 3, endLine: 5, endColumn: 10 };
            const result = getHighlightColumnsForLine(selection, 5, 20);
            assert.strictEqual(result.startCol, 3);
            assert.strictEqual(result.endCol, 10);
        });

        test('getHighlightColumnsForLine should handle first line of multi-line selection', () => {
            const selection = { startLine: 5, startColumn: 3, endLine: 7, endColumn: 10 };
            const result = getHighlightColumnsForLine(selection, 5, 20);
            assert.strictEqual(result.startCol, 3);
            assert.strictEqual(result.endCol, 21); // lineLength + 1
        });

        test('getHighlightColumnsForLine should handle middle line of multi-line selection', () => {
            const selection = { startLine: 5, startColumn: 3, endLine: 7, endColumn: 10 };
            const result = getHighlightColumnsForLine(selection, 6, 15);
            assert.strictEqual(result.startCol, 1);
            assert.strictEqual(result.endCol, 16); // lineLength + 1
        });

        test('getHighlightColumnsForLine should handle last line of multi-line selection', () => {
            const selection = { startLine: 5, startColumn: 3, endLine: 7, endColumn: 10 };
            const result = getHighlightColumnsForLine(selection, 7, 20);
            assert.strictEqual(result.startCol, 1);
            assert.strictEqual(result.endCol, 10);
        });

        test('createPlainToHtmlMapping should handle HTML entities', () => {
            const { plainLength } = createPlainToHtmlMapping('Hello &amp; World');
            // "Hello & World" = 13 characters
            assert.strictEqual(plainLength, 13);
        });
    });

    suite('Markdown Renderer', () => {
        test('escapeHtml should escape HTML entities', () => {
            const result = escapeHtml('<script>alert("XSS")</script>');
            assert.ok(!result.includes('<script>'));
            assert.ok(result.includes('&lt;script&gt;'));
        });

        test('applyInlineMarkdown should render bold text', () => {
            const result = applyInlineMarkdown('Hello **world**');
            assert.ok(result.includes('md-bold'));
        });

        test('applyInlineMarkdown should render italic text', () => {
            const result = applyInlineMarkdown('Hello *world*');
            assert.ok(result.includes('md-italic'));
        });

        test('applyInlineMarkdown should render inline code', () => {
            const result = applyInlineMarkdown('Hello `code`');
            assert.ok(result.includes('md-inline-code'));
        });

        test('applyInlineMarkdown should render links', () => {
            const result = applyInlineMarkdown('[Link](https://example.com)');
            assert.ok(result.includes('md-link'));
        });

        test('applyMarkdownHighlighting should render headings', () => {
            const result = applyMarkdownHighlighting('# Heading 1', 1, false, null);
            assert.ok(result.html.includes('md-h1'));
        });

        test('applyMarkdownHighlighting should render unordered lists', () => {
            const result = applyMarkdownHighlighting('- List item', 1, false, null);
            assert.ok(result.html.includes('md-list-item'));
        });

        test('applyMarkdownHighlighting should render ordered lists', () => {
            const result = applyMarkdownHighlighting('1. List item', 1, false, null);
            assert.ok(result.html.includes('md-list-item'));
        });

        test('applyMarkdownHighlighting should render blockquotes', () => {
            const result = applyMarkdownHighlighting('> Quote', 1, false, null);
            assert.ok(result.html.includes('md-blockquote'));
        });

        test('applyMarkdownHighlighting should detect code fence start', () => {
            const result = applyMarkdownHighlighting('```javascript', 1, false, null);
            assert.strictEqual(result.inCodeBlock, true);
            assert.strictEqual(result.codeBlockLang, 'javascript');
            assert.strictEqual(result.isCodeFenceStart, true);
        });

        test('applyMarkdownHighlighting should detect code fence end', () => {
            const result = applyMarkdownHighlighting('```', 5, true, 'javascript');
            assert.strictEqual(result.inCodeBlock, false);
            assert.strictEqual(result.codeBlockLang, null);
            assert.strictEqual(result.isCodeFenceEnd, true);
        });

        test('applyMarkdownHighlighting should not apply markdown inside code block', () => {
            const result = applyMarkdownHighlighting('# Not a heading', 3, true, 'javascript');
            assert.ok(!result.html.includes('md-h1'));
        });
    });
});

