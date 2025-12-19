/**
 * Comprehensive unit tests for webview-logic module
 * 
 * These tests demonstrate the testability of the extracted business logic.
 * The webview-logic module contains pure functions that can be tested in Node.js
 * without needing a browser environment.
 */

import * as assert from 'assert';
import {
    blockHasComments,
    countCommentsByStatus,
    deleteComment,
    filterCommentsByStatus,
    findCommentById,
    getCommentsForLine,
    getSelectionCoverageForLine,
    groupCommentsByAllCoveredLines,
    groupCommentsByLine,
    resolveAllComments,
    sortCommentsByColumnDescending,
    sortCommentsByLine,
    updateCommentStatus,
    updateCommentText
} from '../../shortcuts/markdown-comments/webview-logic/comment-state';

import {
    applyCommentHighlightToRange,
    calculateColumnIndices,
    createPlainToHtmlMapping,
    getHighlightColumnsForLine
} from '../../shortcuts/markdown-comments/webview-logic/selection-utils';

import {
    applyInlineMarkdown,
    applyMarkdownHighlighting,
    escapeHtml,
    resolveImagePath
} from '../../shortcuts/markdown-comments/webview-logic/markdown-renderer';

import { splitHighlightedHtmlIntoLines } from '../../shortcuts/markdown-comments/webview-logic/highlighted-html-lines';

import { CommentStatus, MarkdownComment } from '../../shortcuts/markdown-comments/types';

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
        },
        {
            id: 'comment-4',
            filePath: '/test/file.md',
            selection: { startLine: 15, startColumn: 1, endLine: 15, endColumn: 10 },
            selectedText: 'Pending text',
            comment: 'This is comment 4',
            status: 'pending',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z'
        }
    ];

    suite('Comment State Management', () => {

        suite('filterCommentsByStatus', () => {
            test('should filter resolved comments when showResolved is false', () => {
                const filtered = filterCommentsByStatus(sampleComments, false);
                assert.strictEqual(filtered.length, 3);
                assert.ok(filtered.every(c => c.status !== 'resolved'));
            });

            test('should return all comments when showResolved is true', () => {
                const filtered = filterCommentsByStatus(sampleComments, true);
                assert.strictEqual(filtered.length, 4);
            });

            test('should return empty array for empty input', () => {
                const filtered = filterCommentsByStatus([], false);
                assert.strictEqual(filtered.length, 0);
            });

            test('should return empty array when all are resolved and showResolved is false', () => {
                const allResolved: MarkdownComment[] = sampleComments.map(c => ({
                    ...c,
                    status: 'resolved' as CommentStatus
                }));
                const filtered = filterCommentsByStatus(allResolved, false);
                assert.strictEqual(filtered.length, 0);
            });
        });

        suite('sortCommentsByLine', () => {
            test('should sort comments by line number', () => {
                const sorted = sortCommentsByLine(sampleComments);
                assert.strictEqual(sorted[0].id, 'comment-1'); // Line 5
                assert.strictEqual(sorted[1].id, 'comment-3'); // Line 5 (col 25)
                assert.strictEqual(sorted[2].id, 'comment-2'); // Line 10
                assert.strictEqual(sorted[3].id, 'comment-4'); // Line 15
            });

            test('should sort by column when lines are the same', () => {
                const sorted = sortCommentsByLine(sampleComments);
                // Both comment-1 and comment-3 are on line 5
                // comment-1 has column 1, comment-3 has column 25
                const line5Comments = sorted.filter(c => c.selection.startLine === 5);
                assert.strictEqual(line5Comments[0].id, 'comment-1');
                assert.strictEqual(line5Comments[1].id, 'comment-3');
            });

            test('should not modify original array', () => {
                const original = [...sampleComments];
                sortCommentsByLine(sampleComments);
                assert.deepStrictEqual(sampleComments, original);
            });

            test('should handle empty array', () => {
                const sorted = sortCommentsByLine([]);
                assert.strictEqual(sorted.length, 0);
            });

            test('should handle single comment', () => {
                const sorted = sortCommentsByLine([sampleComments[0]]);
                assert.strictEqual(sorted.length, 1);
                assert.strictEqual(sorted[0].id, 'comment-1');
            });
        });

        suite('sortCommentsByColumnDescending', () => {
            test('should sort comments by column descending', () => {
                const sorted = sortCommentsByColumnDescending(sampleComments);
                assert.strictEqual(sorted[0].id, 'comment-3'); // Column 25
                assert.strictEqual(sorted[1].id, 'comment-2'); // Column 5
                assert.strictEqual(sorted[2].id, 'comment-1'); // Column 1
                assert.strictEqual(sorted[3].id, 'comment-4'); // Column 1
            });

            test('should not modify original array', () => {
                const original = [...sampleComments];
                sortCommentsByColumnDescending(sampleComments);
                assert.deepStrictEqual(sampleComments, original);
            });

            test('should handle empty array', () => {
                const sorted = sortCommentsByColumnDescending([]);
                assert.strictEqual(sorted.length, 0);
            });
        });

        suite('groupCommentsByLine', () => {
            test('should group comments by starting line', () => {
                const grouped = groupCommentsByLine(sampleComments);
                assert.strictEqual(grouped.size, 3); // Lines 5, 10, and 15
                assert.strictEqual(grouped.get(5)?.length, 2);
                assert.strictEqual(grouped.get(10)?.length, 1);
                assert.strictEqual(grouped.get(15)?.length, 1);
            });

            test('should return empty map for empty input', () => {
                const grouped = groupCommentsByLine([]);
                assert.strictEqual(grouped.size, 0);
            });

            test('should handle all comments on same line', () => {
                const sameLine: MarkdownComment[] = sampleComments.map(c => ({
                    ...c,
                    selection: { ...c.selection, startLine: 1 }
                }));
                const grouped = groupCommentsByLine(sameLine);
                assert.strictEqual(grouped.size, 1);
                assert.strictEqual(grouped.get(1)?.length, 4);
            });
        });

        suite('groupCommentsByAllCoveredLines', () => {
            test('should include single-line comments on their line', () => {
                const singleLineComment: MarkdownComment[] = [{
                    id: 'single-1',
                    filePath: '/test/file.md',
                    selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
                    selectedText: 'Hello World',
                    comment: 'Single line comment',
                    status: 'open',
                    createdAt: '2024-01-01T00:00:00Z',
                    updatedAt: '2024-01-01T00:00:00Z'
                }];
                const grouped = groupCommentsByAllCoveredLines(singleLineComment);
                assert.strictEqual(grouped.size, 1);
                assert.strictEqual(grouped.get(5)?.length, 1);
                assert.strictEqual(grouped.get(5)?.[0].id, 'single-1');
            });

            test('should include multi-line comments on ALL lines they span', () => {
                const multiLineComment: MarkdownComment[] = [{
                    id: 'multi-1',
                    filePath: '/test/file.md',
                    selection: { startLine: 10, startColumn: 5, endLine: 14, endColumn: 15 },
                    selectedText: 'Multi-line text spanning 5 lines',
                    comment: 'This spans lines 10-14',
                    status: 'open',
                    createdAt: '2024-01-01T00:00:00Z',
                    updatedAt: '2024-01-01T00:00:00Z'
                }];
                const grouped = groupCommentsByAllCoveredLines(multiLineComment);

                // Should have entries for lines 10, 11, 12, 13, 14
                assert.strictEqual(grouped.size, 5);
                assert.strictEqual(grouped.get(10)?.length, 1);
                assert.strictEqual(grouped.get(11)?.length, 1);
                assert.strictEqual(grouped.get(12)?.length, 1);
                assert.strictEqual(grouped.get(13)?.length, 1);
                assert.strictEqual(grouped.get(14)?.length, 1);

                // All entries should reference the same comment
                assert.strictEqual(grouped.get(10)?.[0].id, 'multi-1');
                assert.strictEqual(grouped.get(14)?.[0].id, 'multi-1');
            });

            test('should handle overlapping multi-line comments', () => {
                const overlappingComments: MarkdownComment[] = [
                    {
                        id: 'overlap-1',
                        filePath: '/test/file.md',
                        selection: { startLine: 5, startColumn: 1, endLine: 8, endColumn: 10 },
                        selectedText: 'First comment',
                        comment: 'Spans 5-8',
                        status: 'open',
                        createdAt: '2024-01-01T00:00:00Z',
                        updatedAt: '2024-01-01T00:00:00Z'
                    },
                    {
                        id: 'overlap-2',
                        filePath: '/test/file.md',
                        selection: { startLine: 7, startColumn: 1, endLine: 10, endColumn: 10 },
                        selectedText: 'Second comment',
                        comment: 'Spans 7-10',
                        status: 'open',
                        createdAt: '2024-01-01T00:00:00Z',
                        updatedAt: '2024-01-01T00:00:00Z'
                    }
                ];
                const grouped = groupCommentsByAllCoveredLines(overlappingComments);

                // Lines 5, 6 should have 1 comment
                assert.strictEqual(grouped.get(5)?.length, 1);
                assert.strictEqual(grouped.get(6)?.length, 1);

                // Lines 7, 8 should have 2 comments (overlapping)
                assert.strictEqual(grouped.get(7)?.length, 2);
                assert.strictEqual(grouped.get(8)?.length, 2);

                // Lines 9, 10 should have 1 comment
                assert.strictEqual(grouped.get(9)?.length, 1);
                assert.strictEqual(grouped.get(10)?.length, 1);
            });

            test('should return empty map for empty input', () => {
                const grouped = groupCommentsByAllCoveredLines([]);
                assert.strictEqual(grouped.size, 0);
            });

            test('should handle sample comments with multi-line comment', () => {
                // sampleComments[1] spans lines 10-12
                const grouped = groupCommentsByAllCoveredLines(sampleComments);

                // Line 5 should have 2 comments (both single-line)
                assert.strictEqual(grouped.get(5)?.length, 2);

                // Lines 10, 11, 12 should all have the multi-line comment
                assert.strictEqual(grouped.get(10)?.length, 1);
                assert.strictEqual(grouped.get(11)?.length, 1);
                assert.strictEqual(grouped.get(12)?.length, 1);

                // All should reference comment-2
                assert.strictEqual(grouped.get(10)?.[0].id, 'comment-2');
                assert.strictEqual(grouped.get(11)?.[0].id, 'comment-2');
                assert.strictEqual(grouped.get(12)?.[0].id, 'comment-2');

                // Line 15 should have 1 comment
                assert.strictEqual(grouped.get(15)?.length, 1);
            });

            test('should handle comment spanning exactly 2 lines', () => {
                const twoLineComment: MarkdownComment[] = [{
                    id: 'two-line',
                    filePath: '/test/file.md',
                    selection: { startLine: 3, startColumn: 5, endLine: 4, endColumn: 10 },
                    selectedText: 'Two line text',
                    comment: 'Spans exactly 2 lines',
                    status: 'open',
                    createdAt: '2024-01-01T00:00:00Z',
                    updatedAt: '2024-01-01T00:00:00Z'
                }];
                const grouped = groupCommentsByAllCoveredLines(twoLineComment);

                assert.strictEqual(grouped.size, 2);
                assert.strictEqual(grouped.get(3)?.length, 1);
                assert.strictEqual(grouped.get(4)?.length, 1);
                assert.strictEqual(grouped.get(3)?.[0].id, 'two-line');
                assert.strictEqual(grouped.get(4)?.[0].id, 'two-line');
            });

            test('should correctly identify lines NOT covered by comments', () => {
                const multiLineComment: MarkdownComment[] = [{
                    id: 'multi-1',
                    filePath: '/test/file.md',
                    selection: { startLine: 10, startColumn: 5, endLine: 12, endColumn: 15 },
                    selectedText: 'Multi-line text',
                    comment: 'Spans 10-12',
                    status: 'open',
                    createdAt: '2024-01-01T00:00:00Z',
                    updatedAt: '2024-01-01T00:00:00Z'
                }];
                const grouped = groupCommentsByAllCoveredLines(multiLineComment);

                // Lines before and after should not be in the map
                assert.strictEqual(grouped.get(9), undefined);
                assert.strictEqual(grouped.get(13), undefined);
                assert.strictEqual(grouped.get(1), undefined);
            });
        });

        suite('getCommentsForLine', () => {
            test('should get comments for specific line', () => {
                const commentsMap = groupCommentsByLine(sampleComments);
                const line5Comments = getCommentsForLine(5, commentsMap, true);
                assert.strictEqual(line5Comments.length, 2);
            });

            test('should filter resolved when showResolved is false', () => {
                const commentsWithResolved: MarkdownComment[] = [
                    { ...sampleComments[0], status: 'resolved' as CommentStatus },
                    sampleComments[2]
                ];
                const commentsMap = groupCommentsByLine(commentsWithResolved);
                const line5Comments = getCommentsForLine(5, commentsMap, false);
                assert.strictEqual(line5Comments.length, 1);
            });

            test('should return empty array for line with no comments', () => {
                const commentsMap = groupCommentsByLine(sampleComments);
                const line100Comments = getCommentsForLine(100, commentsMap, true);
                assert.strictEqual(line100Comments.length, 0);
            });
        });

        suite('blockHasComments', () => {
            test('should return true if block contains comments', () => {
                const commentsMap = groupCommentsByLine(sampleComments);
                assert.strictEqual(blockHasComments(4, 6, commentsMap, true), true);
            });

            test('should return false if block has no comments', () => {
                const commentsMap = groupCommentsByLine(sampleComments);
                assert.strictEqual(blockHasComments(1, 3, commentsMap, true), false);
            });

            test('should respect showResolved parameter', () => {
                const onlyResolved: MarkdownComment[] = [
                    { ...sampleComments[0], status: 'resolved' as CommentStatus }
                ];
                const commentsMap = groupCommentsByLine(onlyResolved);
                assert.strictEqual(blockHasComments(4, 6, commentsMap, true), true);
                assert.strictEqual(blockHasComments(4, 6, commentsMap, false), false);
            });

            test('should handle single line block', () => {
                const commentsMap = groupCommentsByLine(sampleComments);
                assert.strictEqual(blockHasComments(5, 5, commentsMap, true), true);
                assert.strictEqual(blockHasComments(6, 6, commentsMap, true), false);
            });
        });

        suite('countCommentsByStatus', () => {
            test('should count comments correctly', () => {
                const counts = countCommentsByStatus(sampleComments);
                assert.strictEqual(counts.open, 2);
                assert.strictEqual(counts.resolved, 1);
                assert.strictEqual(counts.pending, 1);
            });

            test('should return zeros for empty array', () => {
                const counts = countCommentsByStatus([]);
                assert.strictEqual(counts.open, 0);
                assert.strictEqual(counts.resolved, 0);
                assert.strictEqual(counts.pending, 0);
            });

            test('should handle all same status', () => {
                const allOpen = sampleComments.map(c => ({ ...c, status: 'open' as CommentStatus }));
                const counts = countCommentsByStatus(allOpen);
                assert.strictEqual(counts.open, 4);
                assert.strictEqual(counts.resolved, 0);
                assert.strictEqual(counts.pending, 0);
            });
        });

        suite('findCommentById', () => {
            test('should find the correct comment', () => {
                const found = findCommentById(sampleComments, 'comment-2');
                assert.ok(found);
                assert.strictEqual(found.id, 'comment-2');
            });

            test('should return undefined for non-existent id', () => {
                const found = findCommentById(sampleComments, 'non-existent');
                assert.strictEqual(found, undefined);
            });

            test('should return undefined for empty array', () => {
                const found = findCommentById([], 'comment-1');
                assert.strictEqual(found, undefined);
            });

            test('should find first comment', () => {
                const found = findCommentById(sampleComments, 'comment-1');
                assert.ok(found);
                assert.strictEqual(found.id, 'comment-1');
            });

            test('should find last comment', () => {
                const found = findCommentById(sampleComments, 'comment-4');
                assert.ok(found);
                assert.strictEqual(found.id, 'comment-4');
            });
        });

        suite('updateCommentStatus', () => {
            test('should update the comment status', () => {
                const updated = updateCommentStatus(sampleComments, 'comment-1', 'resolved');
                const comment = findCommentById(updated, 'comment-1');
                assert.ok(comment);
                assert.strictEqual(comment.status, 'resolved');
            });

            test('should update updatedAt timestamp', () => {
                const before = new Date().toISOString();
                const updated = updateCommentStatus(sampleComments, 'comment-1', 'resolved');
                const comment = findCommentById(updated, 'comment-1');
                assert.ok(comment);
                assert.ok(comment.updatedAt >= before);
            });

            test('should not modify original array', () => {
                const original = sampleComments[0].status;
                updateCommentStatus(sampleComments, 'comment-1', 'resolved');
                assert.strictEqual(sampleComments[0].status, original);
            });

            test('should not change other comments', () => {
                const updated = updateCommentStatus(sampleComments, 'comment-1', 'resolved');
                const other = findCommentById(updated, 'comment-2');
                assert.ok(other);
                assert.strictEqual(other.status, 'resolved'); // Already was resolved
            });

            test('should handle non-existent id', () => {
                const updated = updateCommentStatus(sampleComments, 'non-existent', 'resolved');
                assert.strictEqual(updated.length, sampleComments.length);
            });
        });

        suite('updateCommentText', () => {
            test('should update the comment text', () => {
                const newText = 'Updated comment text';
                const updated = updateCommentText(sampleComments, 'comment-1', newText);
                const comment = findCommentById(updated, 'comment-1');
                assert.ok(comment);
                assert.strictEqual(comment.comment, newText);
            });

            test('should update updatedAt timestamp', () => {
                const before = new Date().toISOString();
                const updated = updateCommentText(sampleComments, 'comment-1', 'New text');
                const comment = findCommentById(updated, 'comment-1');
                assert.ok(comment);
                assert.ok(comment.updatedAt >= before);
            });

            test('should not modify original array', () => {
                const original = sampleComments[0].comment;
                updateCommentText(sampleComments, 'comment-1', 'New text');
                assert.strictEqual(sampleComments[0].comment, original);
            });

            test('should handle empty string', () => {
                const updated = updateCommentText(sampleComments, 'comment-1', '');
                const comment = findCommentById(updated, 'comment-1');
                assert.ok(comment);
                assert.strictEqual(comment.comment, '');
            });
        });

        suite('deleteComment', () => {
            test('should remove the comment', () => {
                const remaining = deleteComment(sampleComments, 'comment-1');
                assert.strictEqual(remaining.length, 3);
                assert.ok(!findCommentById(remaining, 'comment-1'));
            });

            test('should not modify original array', () => {
                const originalLength = sampleComments.length;
                deleteComment(sampleComments, 'comment-1');
                assert.strictEqual(sampleComments.length, originalLength);
            });

            test('should handle non-existent id', () => {
                const remaining = deleteComment(sampleComments, 'non-existent');
                assert.strictEqual(remaining.length, sampleComments.length);
            });

            test('should handle empty array', () => {
                const remaining = deleteComment([], 'comment-1');
                assert.strictEqual(remaining.length, 0);
            });

            test('should delete first comment', () => {
                const remaining = deleteComment(sampleComments, 'comment-1');
                assert.strictEqual(remaining[0].id, 'comment-2');
            });

            test('should delete last comment', () => {
                const remaining = deleteComment(sampleComments, 'comment-4');
                assert.strictEqual(remaining.length, 3);
                assert.ok(!findCommentById(remaining, 'comment-4'));
            });
        });

        suite('resolveAllComments', () => {
            test('should mark all open comments as resolved', () => {
                const resolved = resolveAllComments(sampleComments);
                // Only open comments are changed to resolved, pending stays pending
                const openComments = resolved.filter(c => c.status === 'open');
                assert.strictEqual(openComments.length, 0);
                // All originally open ones should now be resolved
                const originallyOpen = sampleComments.filter(c => c.status === 'open');
                originallyOpen.forEach(orig => {
                    const updated = resolved.find(c => c.id === orig.id);
                    assert.ok(updated);
                    assert.strictEqual(updated?.status, 'resolved');
                });
            });

            test('should not change already resolved comments', () => {
                const original = sampleComments.find(c => c.id === 'comment-2');
                const resolved = resolveAllComments(sampleComments);
                const stillResolved = resolved.find(c => c.id === 'comment-2');
                assert.ok(stillResolved);
                assert.strictEqual(stillResolved.status, 'resolved');
            });

            test('should not modify original array', () => {
                const originalStatuses = sampleComments.map(c => c.status);
                resolveAllComments(sampleComments);
                assert.deepStrictEqual(sampleComments.map(c => c.status), originalStatuses);
            });

            test('should handle empty array', () => {
                const resolved = resolveAllComments([]);
                assert.strictEqual(resolved.length, 0);
            });

            test('should update timestamp for resolved comments', () => {
                const before = new Date().toISOString();
                const resolved = resolveAllComments(sampleComments);
                const openComment = resolved.find(c => c.id === 'comment-1');
                assert.ok(openComment);
                assert.ok(openComment.updatedAt >= before);
            });
        });

        suite('getSelectionCoverageForLine', () => {
            test('should handle single-line selection', () => {
                const selection = { startLine: 5, startColumn: 3, endLine: 5, endColumn: 10 };
                const result = getSelectionCoverageForLine(selection, 5);
                assert.strictEqual(result.isCovered, true);
                assert.strictEqual(result.startColumn, 3);
                assert.strictEqual(result.endColumn, 10);
            });

            test('should return not covered for line before selection', () => {
                const selection = { startLine: 5, startColumn: 3, endLine: 10, endColumn: 15 };
                const result = getSelectionCoverageForLine(selection, 4);
                assert.strictEqual(result.isCovered, false);
                assert.strictEqual(result.startColumn, 0);
                assert.strictEqual(result.endColumn, 0);
            });

            test('should return not covered for line after selection', () => {
                const selection = { startLine: 5, startColumn: 3, endLine: 10, endColumn: 15 };
                const result = getSelectionCoverageForLine(selection, 11);
                assert.strictEqual(result.isCovered, false);
            });

            test('should handle first line of multi-line selection', () => {
                const selection = { startLine: 5, startColumn: 3, endLine: 10, endColumn: 15 };
                const result = getSelectionCoverageForLine(selection, 5);
                assert.strictEqual(result.isCovered, true);
                assert.strictEqual(result.startColumn, 3);
                assert.strictEqual(result.endColumn, Infinity);
            });

            test('should handle last line of multi-line selection', () => {
                const selection = { startLine: 5, startColumn: 3, endLine: 10, endColumn: 15 };
                const result = getSelectionCoverageForLine(selection, 10);
                assert.strictEqual(result.isCovered, true);
                assert.strictEqual(result.startColumn, 1);
                assert.strictEqual(result.endColumn, 15);
            });

            test('should handle middle line of multi-line selection', () => {
                const selection = { startLine: 5, startColumn: 3, endLine: 10, endColumn: 15 };
                const result = getSelectionCoverageForLine(selection, 7);
                assert.strictEqual(result.isCovered, true);
                assert.strictEqual(result.startColumn, 1);
                assert.strictEqual(result.endColumn, Infinity);
            });
        });
    });

    suite('Highlighted HTML Line Splitting', () => {
        test('should keep per-line HTML balanced when spans cross newline boundaries', () => {
            // Simulate highlight.js emitting a <span> that spans across a newline boundary
            const highlighted = '<span class="hljs-function">HRESULT ClassA::MethodA(const std::string&amp; str)\n{</span>';
            const lines = splitHighlightedHtmlIntoLines(highlighted);

            assert.strictEqual(lines.length, 2);
            // Each line should be independently balanced (no unclosed <span>)
            assert.ok(lines[0].includes('</span>'), 'First line should end with a closing span');
            assert.ok(lines[1].includes('<span class="hljs-function">'), 'Second line should reopen the span');
        });

        test('should prevent nested code-line wrappers when wrapping split lines', () => {
            // This mirrors the kind of mis-nesting you pasted: if tags are unbalanced,
            // wrapping each line in `<span class="code-line">` can nest subsequent wrappers.
            const highlighted = '<span class="hljs-function">HRESULT <span class="hljs-title">ClassA::MethodA</span>(...)\n{</span>';
            const lines = splitHighlightedHtmlIntoLines(highlighted);

            const wrapped = lines
                .map((l, idx) => `<span class="code-line" data-line="${497 + idx}">${l || ''}</span>`)
                .join('');

            assert.ok(!wrapped.includes('<span class="code-line" data-line="497"><span class="code-line"'),
                'Should not nest a code-line span inside another code-line span');
        });
    });

    suite('Selection Utilities', () => {

        suite('calculateColumnIndices', () => {
            test('should convert 1-based columns to 0-based indices', () => {
                const result = calculateColumnIndices('Hello World', 1, 6);
                assert.strictEqual(result.startIdx, 0);
                assert.strictEqual(result.endIdx, 5);
                assert.strictEqual(result.isValid, true);
            });

            test('should handle out-of-bounds columns', () => {
                const result = calculateColumnIndices('Hello', 1, 100);
                assert.strictEqual(result.startIdx, 0);
                assert.strictEqual(result.endIdx, 5);
            });

            test('should clamp negative start column', () => {
                const result = calculateColumnIndices('Hello', -5, 5);
                assert.strictEqual(result.startIdx, 0);
            });

            test('should return invalid for start after end', () => {
                const result = calculateColumnIndices('Hello', 10, 5);
                assert.strictEqual(result.isValid, false);
            });

            test('should return invalid for start beyond line length', () => {
                const result = calculateColumnIndices('Hi', 10, 15);
                assert.strictEqual(result.isValid, false);
            });

            test('should handle empty line', () => {
                const result = calculateColumnIndices('', 1, 5);
                assert.strictEqual(result.startIdx, 0);
                assert.strictEqual(result.endIdx, 0);
                assert.strictEqual(result.isValid, false);
            });

            test('should handle selection at end of line', () => {
                const result = calculateColumnIndices('Hello', 5, 6);
                assert.strictEqual(result.startIdx, 4);
                assert.strictEqual(result.endIdx, 5);
                assert.strictEqual(result.isValid, true);
            });
        });

        suite('getHighlightColumnsForLine', () => {
            test('should handle single-line selection', () => {
                const selection = { startLine: 5, startColumn: 3, endLine: 5, endColumn: 10 };
                const result = getHighlightColumnsForLine(selection, 5, 20);
                assert.strictEqual(result.startCol, 3);
                assert.strictEqual(result.endCol, 10);
            });

            test('should handle first line of multi-line selection', () => {
                const selection = { startLine: 5, startColumn: 3, endLine: 7, endColumn: 10 };
                const result = getHighlightColumnsForLine(selection, 5, 20);
                assert.strictEqual(result.startCol, 3);
                assert.strictEqual(result.endCol, 21); // lineLength + 1
            });

            test('should handle middle line of multi-line selection', () => {
                const selection = { startLine: 5, startColumn: 3, endLine: 7, endColumn: 10 };
                const result = getHighlightColumnsForLine(selection, 6, 15);
                assert.strictEqual(result.startCol, 1);
                assert.strictEqual(result.endCol, 16); // lineLength + 1
            });

            test('should handle last line of multi-line selection', () => {
                const selection = { startLine: 5, startColumn: 3, endLine: 7, endColumn: 10 };
                const result = getHighlightColumnsForLine(selection, 7, 20);
                assert.strictEqual(result.startCol, 1);
                assert.strictEqual(result.endCol, 10);
            });

            test('should handle line outside selection (fallback)', () => {
                const selection = { startLine: 5, startColumn: 3, endLine: 7, endColumn: 10 };
                const result = getHighlightColumnsForLine(selection, 1, 20);
                assert.strictEqual(result.startCol, 1);
                assert.strictEqual(result.endCol, 21);
            });

            test('should handle zero-length line', () => {
                const selection = { startLine: 5, startColumn: 1, endLine: 5, endColumn: 1 };
                const result = getHighlightColumnsForLine(selection, 5, 0);
                assert.strictEqual(result.startCol, 1);
                assert.strictEqual(result.endCol, 1);
            });
        });

        suite('createPlainToHtmlMapping', () => {
            test('should handle simple text', () => {
                const { plainLength } = createPlainToHtmlMapping('Hello');
                assert.strictEqual(plainLength, 5);
            });

            test('should handle HTML entities', () => {
                const { plainLength } = createPlainToHtmlMapping('Hello &amp; World');
                // "Hello & World" = 13 characters
                assert.strictEqual(plainLength, 13);
            });

            test('should handle HTML tags', () => {
                const { plainLength } = createPlainToHtmlMapping('<span>Hello</span>');
                assert.strictEqual(plainLength, 5);
            });

            test('should handle mixed HTML', () => {
                const { plainLength } = createPlainToHtmlMapping('<b>Hello</b> &amp; <i>World</i>');
                // "Hello & World" = 13 characters
                assert.strictEqual(plainLength, 13);
            });

            test('should return mapping arrays', () => {
                const { plainToHtmlStart, plainToHtmlEnd, plainLength } = createPlainToHtmlMapping('Hi');
                assert.strictEqual(plainLength, 2);
                assert.ok(Array.isArray(plainToHtmlStart));
                assert.ok(Array.isArray(plainToHtmlEnd));
            });

            test('should handle empty string', () => {
                const { plainLength } = createPlainToHtmlMapping('');
                assert.strictEqual(plainLength, 0);
            });

            test('should handle multiple entities', () => {
                const { plainLength } = createPlainToHtmlMapping('&lt;&gt;&amp;&quot;');
                assert.strictEqual(plainLength, 4); // < > & "
            });

            test('should handle nested tags', () => {
                const { plainLength } = createPlainToHtmlMapping('<div><span>AB</span></div>');
                assert.strictEqual(plainLength, 2);
            });

            test('should handle ampersand not part of entity', () => {
                const { plainLength } = createPlainToHtmlMapping('A & B');
                // If not a valid entity, & is treated as regular char
                assert.strictEqual(plainLength, 5);
            });
        });

        suite('applyCommentHighlightToRange', () => {
            test('should wrap plain text in highlight span', () => {
                const result = applyCommentHighlightToRange(
                    'Hello World', 'Hello World', 1, 6, 'c1', 'open'
                );
                assert.ok(result.includes('commented-text'));
                assert.ok(result.includes('data-comment-id="c1"'));
            });

            test('should handle invalid range by wrapping whole content', () => {
                const result = applyCommentHighlightToRange(
                    'Hello', 'Hello', 10, 20, 'c1', 'open'
                );
                assert.ok(result.includes('commented-text'));
            });

            test('should apply status class', () => {
                const result = applyCommentHighlightToRange(
                    'Hello World', 'Hello World', 1, 6, 'c1', 'resolved'
                );
                assert.ok(result.includes('resolved'));
            });

            test('should handle empty status class', () => {
                const result = applyCommentHighlightToRange(
                    'Hello World', 'Hello World', 1, 6, 'c1', ''
                );
                assert.ok(result.includes('commented-text'));
            });

            test('should preserve content before highlight', () => {
                const result = applyCommentHighlightToRange(
                    'Hello World', 'Hello World', 7, 12, 'c1', 'open'
                );
                assert.ok(result.includes('Hello '));
            });

            test('should handle HTML content', () => {
                const html = '<span>Hello</span>';
                const plain = 'Hello';
                const result = applyCommentHighlightToRange(html, plain, 1, 6, 'c1', 'open');
                assert.ok(result.includes('commented-text'));
            });
        });
    });

    suite('Markdown Renderer', () => {

        suite('escapeHtml', () => {
            test('should escape HTML entities', () => {
                const result = escapeHtml('<script>alert("XSS")</script>');
                assert.ok(!result.includes('<script>'));
                assert.ok(result.includes('&lt;script&gt;'));
            });

            test('should escape ampersand', () => {
                const result = escapeHtml('A & B');
                assert.ok(result.includes('&amp;'));
            });

            test('should escape quotes', () => {
                const result = escapeHtml('"test"');
                assert.ok(result.includes('&quot;'));
            });

            test('should escape single quotes', () => {
                const result = escapeHtml("'test'");
                assert.ok(result.includes('&#039;'));
            });

            test('should escape greater than', () => {
                const result = escapeHtml('a > b');
                assert.ok(result.includes('&gt;'));
            });

            test('should handle empty string', () => {
                const result = escapeHtml('');
                assert.strictEqual(result, '');
            });

            test('should handle text with no special chars', () => {
                const result = escapeHtml('Hello World');
                assert.strictEqual(result, 'Hello World');
            });

            test('should handle multiple special chars', () => {
                const result = escapeHtml('<div attr="value">text & more</div>');
                assert.ok(result.includes('&lt;'));
                assert.ok(result.includes('&gt;'));
                assert.ok(result.includes('&quot;'));
                assert.ok(result.includes('&amp;'));
            });
        });

        suite('applyInlineMarkdown', () => {
            test('should render bold text with double asterisks', () => {
                const result = applyInlineMarkdown('Hello **world**');
                assert.ok(result.includes('md-bold'));
            });

            test('should render bold text with double underscores', () => {
                const result = applyInlineMarkdown('Hello __world__');
                assert.ok(result.includes('md-bold'));
            });

            test('should render italic text with single asterisk', () => {
                const result = applyInlineMarkdown('Hello *world*');
                assert.ok(result.includes('md-italic'));
            });

            test('should render italic text with single underscore', () => {
                const result = applyInlineMarkdown('Hello _world_');
                assert.ok(result.includes('md-italic'));
            });

            test('should render bold+italic with triple asterisks', () => {
                const result = applyInlineMarkdown('Hello ***world***');
                assert.ok(result.includes('md-bold-italic'));
            });

            test('should render inline code', () => {
                const result = applyInlineMarkdown('Hello `code`');
                assert.ok(result.includes('md-inline-code'));
            });

            test('should render links', () => {
                const result = applyInlineMarkdown('[Link](https://example.com)');
                assert.ok(result.includes('md-link'));
            });

            test('should render images', () => {
                const result = applyInlineMarkdown('![alt](image.png)');
                assert.ok(result.includes('md-image'));
            });

            test('should render strikethrough', () => {
                const result = applyInlineMarkdown('~~strikethrough~~');
                assert.ok(result.includes('md-strike'));
            });

            test('should handle empty string', () => {
                const result = applyInlineMarkdown('');
                assert.strictEqual(result, '');
            });

            test('should handle text with no markdown', () => {
                const result = applyInlineMarkdown('Plain text');
                assert.ok(result.includes('Plain text'));
            });

            test('should escape HTML in text', () => {
                const result = applyInlineMarkdown('<script>alert("xss")</script>');
                assert.ok(!result.includes('<script>'));
                assert.ok(result.includes('&lt;script&gt;'));
            });

            test('should handle mixed markdown', () => {
                const result = applyInlineMarkdown('**bold** and *italic* and `code`');
                assert.ok(result.includes('md-bold'));
                assert.ok(result.includes('md-italic'));
                assert.ok(result.includes('md-inline-code'));
            });
        });

        suite('resolveImagePath', () => {
            test('should return http URLs unchanged', () => {
                const result = resolveImagePath('http://example.com/image.png');
                assert.strictEqual(result, 'http://example.com/image.png');
            });

            test('should return https URLs unchanged', () => {
                const result = resolveImagePath('https://example.com/image.png');
                assert.strictEqual(result, 'https://example.com/image.png');
            });

            test('should return data URLs unchanged', () => {
                const result = resolveImagePath('data:image/png;base64,ABC123');
                assert.strictEqual(result, 'data:image/png;base64,ABC123');
            });

            test('should mark relative paths for post-processing', () => {
                const result = resolveImagePath('./images/photo.png');
                assert.ok(result.startsWith('IMG_PATH:'));
            });

            test('should mark absolute paths for post-processing', () => {
                const result = resolveImagePath('/path/to/image.png');
                assert.ok(result.startsWith('IMG_PATH:'));
            });
        });

        suite('applyMarkdownHighlighting', () => {
            test('should render headings h1-h6', () => {
                for (let level = 1; level <= 6; level++) {
                    const heading = '#'.repeat(level) + ' Heading';
                    const result = applyMarkdownHighlighting(heading, 1, false, null);
                    assert.ok(result.html.includes(`md-h${level}`));
                }
            });

            test('should render unordered lists with dash', () => {
                const result = applyMarkdownHighlighting('- List item', 1, false, null);
                assert.ok(result.html.includes('md-list-item'));
            });

            test('should render unordered lists with asterisk', () => {
                const result = applyMarkdownHighlighting('* List item', 1, false, null);
                assert.ok(result.html.includes('md-list-item'));
            });

            test('should render unordered lists with plus', () => {
                const result = applyMarkdownHighlighting('+ List item', 1, false, null);
                assert.ok(result.html.includes('md-list-item'));
            });

            test('should render ordered lists', () => {
                const result = applyMarkdownHighlighting('1. List item', 1, false, null);
                assert.ok(result.html.includes('md-list-item'));
            });

            test('should render blockquotes', () => {
                const result = applyMarkdownHighlighting('> Quote', 1, false, null);
                assert.ok(result.html.includes('md-blockquote'));
            });

            test('should render horizontal rules with dashes', () => {
                const result = applyMarkdownHighlighting('---', 1, false, null);
                assert.ok(result.html.includes('md-hr'));
            });

            test('should render horizontal rules with asterisks', () => {
                const result = applyMarkdownHighlighting('***', 1, false, null);
                assert.ok(result.html.includes('md-hr'));
            });

            test('should render horizontal rules with underscores', () => {
                const result = applyMarkdownHighlighting('___', 1, false, null);
                assert.ok(result.html.includes('md-hr'));
            });

            test('should detect code fence start', () => {
                const result = applyMarkdownHighlighting('```javascript', 1, false, null);
                assert.strictEqual(result.inCodeBlock, true);
                assert.strictEqual(result.codeBlockLang, 'javascript');
                assert.strictEqual(result.isCodeFenceStart, true);
            });

            test('should detect code fence end', () => {
                const result = applyMarkdownHighlighting('```', 5, true, 'javascript');
                assert.strictEqual(result.inCodeBlock, false);
                assert.strictEqual(result.codeBlockLang, null);
                assert.strictEqual(result.isCodeFenceEnd, true);
            });

            test('should not apply markdown inside code block', () => {
                const result = applyMarkdownHighlighting('# Not a heading', 3, true, 'javascript');
                assert.ok(!result.html.includes('md-h1'));
            });

            test('should render checkbox unchecked', () => {
                const result = applyMarkdownHighlighting('- [ ] Todo item', 1, false, null);
                assert.ok(result.html.includes('md-checkbox'));
                assert.ok(!result.html.includes('md-checkbox-checked'));
            });

            test('should render checkbox checked', () => {
                const result = applyMarkdownHighlighting('- [x] Done item', 1, false, null);
                assert.ok(result.html.includes('md-checkbox-checked'));
            });

            test('should handle indented list items', () => {
                const result = applyMarkdownHighlighting('  - Nested item', 1, false, null);
                assert.ok(result.html.includes('md-list-item'));
            });

            test('should return default state when not in code block', () => {
                const result = applyMarkdownHighlighting('Plain text', 1, false, null);
                assert.strictEqual(result.inCodeBlock, false);
                assert.strictEqual(result.codeBlockLang, null);
            });

            test('should use plaintext as default code language', () => {
                const result = applyMarkdownHighlighting('```', 1, false, null);
                assert.strictEqual(result.codeBlockLang, 'plaintext');
            });
        });
    });

    suite('splitHighlightedHtmlIntoLines - CPP snippet regression', () => {
        /**
         * This is a dedicated regression test for the exact C++ code snippet:
         *
         * ```cpp
         * HRESULT ClassA::MethodA(const std::string& str)
         * {
         *     // todo
         * }
         * ```
         *
         * highlight.js typically wraps the function signature in a <span class="hljs-function">
         * that spans across the first two lines (the signature and the opening brace).
         * Without proper HTML-aware splitting, we get nested .code-line elements.
         */

        // Simulate the kind of HTML that highlight.js produces for this C++ snippet.
        // The key issue: <span class="hljs-function"> starts on line 1 and closes after '{' on line 2.
        const simulatedHighlightJsOutput =
            '<span class="hljs-function">HRESULT <span class="hljs-title">ClassA::MethodA</span><span class="hljs-params">(<span class="hljs-type">const</span> std::string&amp; str)</span>\n' +
            '{</span>\n' +
            '    <span class="hljs-comment">// todo</span>\n' +
            '}';

        test('should produce exactly 4 lines for the 4-line CPP snippet', () => {
            const lines = splitHighlightedHtmlIntoLines(simulatedHighlightJsOutput);
            assert.strictEqual(lines.length, 4, `Expected 4 lines but got ${lines.length}`);
        });

        test('each line should be tag-balanced (no unclosed spans)', () => {
            const lines = splitHighlightedHtmlIntoLines(simulatedHighlightJsOutput);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const openCount = (line.match(/<span\b/gi) || []).length;
                const closeCount = (line.match(/<\/span>/gi) || []).length;
                assert.strictEqual(
                    openCount,
                    closeCount,
                    `Line ${i + 1} has unbalanced spans: ${openCount} opens vs ${closeCount} closes. Line: "${line}"`
                );
            }
        });

        test('line 1 should contain the function signature', () => {
            const lines = splitHighlightedHtmlIntoLines(simulatedHighlightJsOutput);
            assert.ok(
                lines[0].includes('ClassA::MethodA'),
                `Line 1 should contain "ClassA::MethodA". Got: "${lines[0]}"`
            );
            assert.ok(
                lines[0].includes('std::string'),
                `Line 1 should contain "std::string". Got: "${lines[0]}"`
            );
        });

        test('line 2 should contain only the opening brace', () => {
            const lines = splitHighlightedHtmlIntoLines(simulatedHighlightJsOutput);
            // Strip tags to check text content
            const textContent = lines[1].replace(/<[^>]*>/g, '').trim();
            assert.strictEqual(
                textContent,
                '{',
                `Line 2 text should be "{". Got: "${textContent}"`
            );
        });

        test('line 3 should contain the comment', () => {
            const lines = splitHighlightedHtmlIntoLines(simulatedHighlightJsOutput);
            assert.ok(
                lines[2].includes('// todo'),
                `Line 3 should contain "// todo". Got: "${lines[2]}"`
            );
            assert.ok(
                lines[2].includes('hljs-comment'),
                `Line 3 should have hljs-comment class. Got: "${lines[2]}"`
            );
        });

        test('line 4 should contain only the closing brace', () => {
            const lines = splitHighlightedHtmlIntoLines(simulatedHighlightJsOutput);
            const textContent = lines[3].replace(/<[^>]*>/g, '').trim();
            assert.strictEqual(
                textContent,
                '}',
                `Line 4 text should be "}". Got: "${textContent}"`
            );
        });

        test('wrapping each line in .code-line should not produce nested .code-line elements', () => {
            const lines = splitHighlightedHtmlIntoLines(simulatedHighlightJsOutput);

            // Simulate what renderCodeBlock does: wrap each line in <span class="code-line">
            const wrappedLines = lines.map(
                (line, i) => `<span class="code-line" data-line="${i + 1}">${line}</span>`
            );
            const fullHtml = wrappedLines.join('');

            // Check that we don't have nested .code-line spans
            // A nested pattern would be: <span class="code-line"...>...<span class="code-line"...>
            const nestedPattern = /<span class="code-line"[^>]*>(?:(?!<\/span>).)*<span class="code-line"/;
            assert.ok(
                !nestedPattern.test(fullHtml),
                `Should not have nested .code-line spans. HTML: "${fullHtml}"`
            );
        });

        test('full rendering should produce valid structure for CPP snippet', () => {
            const lines = splitHighlightedHtmlIntoLines(simulatedHighlightJsOutput);

            // Build the full <pre><code>...</code></pre> structure like renderCodeBlock does
            const linesHtml = lines.map(
                (line, i) => `<span class="code-line" data-line="${497 + i}">${line || '&nbsp;'}</span>`
            ).join('');

            const fullHtml =
                '<pre class="code-block-content"><code class="hljs language-cpp">' +
                linesHtml +
                '</code></pre>';

            // Verify structure:
            // 1. Should have exactly 4 .code-line spans
            const codeLineMatches = fullHtml.match(/<span class="code-line"/g) || [];
            assert.strictEqual(
                codeLineMatches.length,
                4,
                `Should have exactly 4 .code-line spans. Got ${codeLineMatches.length}`
            );

            // 2. Each .code-line should close before the next one opens
            // Split by .code-line and verify each segment is balanced
            const segments = fullHtml.split(/<span class="code-line"[^>]*>/);
            // segments[0] is before first code-line, segments[1..4] are the line contents

            for (let i = 1; i < segments.length; i++) {
                const segment = segments[i];
                // Find where this code-line ends (first </span> that closes it)
                // The segment should end with </span> for the code-line wrapper
                assert.ok(
                    segment.includes('</span>'),
                    `Segment ${i} should contain closing </span>`
                );
            }

            // 3. The problematic HTML from the bug report had data-line="498" nested inside data-line="497"
            // Verify this doesn't happen
            const line497Start = fullHtml.indexOf('data-line="497"');
            const line498Start = fullHtml.indexOf('data-line="498"');
            const line497End = fullHtml.indexOf('</span>', line497Start);

            // line498 should start AFTER line497 ends
            assert.ok(
                line498Start > line497End,
                `data-line="498" (at ${line498Start}) should come after line 497 closes (at ${line497End})`
            );
        });
    });
});
