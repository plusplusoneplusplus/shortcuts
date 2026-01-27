/**
 * Tests for Comments dropdown functionality in Markdown Review Editor
 * Tests the "Comments" dropdown that provides:
 * 1. Resolve All action
 * 2. Sign Off action
 * 3. Active comments list with navigation
 * 4. Hover preview tooltips
 */

import * as assert from 'assert';
import { MarkdownComment, CommentStatus } from '../../shortcuts/markdown-comments/types';

suite('Comments Dropdown Tests', () => {
    
    suite('Comment Filtering', () => {
        // Test filtering logic for active (open) comments
        
        function filterOpenComments(comments: MarkdownComment[]): MarkdownComment[] {
            return comments.filter(c => c.status === 'open');
        }
        
        function createMockComment(overrides: Partial<MarkdownComment> = {}): MarkdownComment {
            return {
                id: 'test-id-' + Math.random().toString(36).substr(2, 9),
                filePath: 'test.md',
                selection: {
                    startLine: 1,
                    startColumn: 1,
                    endLine: 1,
                    endColumn: 10
                },
                selectedText: 'test text',
                comment: 'Test comment',
                status: 'open',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                ...overrides
            };
        }
        
        test('should return only open comments', () => {
            const comments: MarkdownComment[] = [
                createMockComment({ status: 'open' }),
                createMockComment({ status: 'resolved' }),
                createMockComment({ status: 'open' }),
                createMockComment({ status: 'pending' })
            ];
            
            const openComments = filterOpenComments(comments);
            assert.strictEqual(openComments.length, 2);
            assert.ok(openComments.every(c => c.status === 'open'));
        });
        
        test('should return empty array when no open comments', () => {
            const comments: MarkdownComment[] = [
                createMockComment({ status: 'resolved' }),
                createMockComment({ status: 'resolved' })
            ];
            
            const openComments = filterOpenComments(comments);
            assert.strictEqual(openComments.length, 0);
        });
        
        test('should return all comments when all are open', () => {
            const comments: MarkdownComment[] = [
                createMockComment({ status: 'open' }),
                createMockComment({ status: 'open' }),
                createMockComment({ status: 'open' })
            ];
            
            const openComments = filterOpenComments(comments);
            assert.strictEqual(openComments.length, 3);
        });
        
        test('should handle empty comments array', () => {
            const openComments = filterOpenComments([]);
            assert.strictEqual(openComments.length, 0);
        });
    });
    
    suite('Comment Badge Count', () => {
        // Test badge count calculation
        
        function getOpenCommentCount(comments: Array<{ status: CommentStatus }>): number {
            return comments.filter(c => c.status === 'open').length;
        }
        
        function formatBadgeText(count: number): string {
            return `(${count})`;
        }
        
        test('should return correct count for mixed statuses', () => {
            const comments = [
                { status: 'open' as CommentStatus },
                { status: 'resolved' as CommentStatus },
                { status: 'open' as CommentStatus },
                { status: 'pending' as CommentStatus }
            ];
            assert.strictEqual(getOpenCommentCount(comments), 2);
        });
        
        test('should return 0 for no open comments', () => {
            const comments = [
                { status: 'resolved' as CommentStatus },
                { status: 'resolved' as CommentStatus }
            ];
            assert.strictEqual(getOpenCommentCount(comments), 0);
        });
        
        test('should format badge text correctly', () => {
            assert.strictEqual(formatBadgeText(0), '(0)');
            assert.strictEqual(formatBadgeText(5), '(5)');
            assert.strictEqual(formatBadgeText(100), '(100)');
        });
    });
    
    suite('Comment Text Truncation', () => {
        // Test text truncation for dropdown list display
        
        function truncateText(text: string, maxLength: number): string {
            if (text.length <= maxLength) {
                return text;
            }
            return text.substring(0, maxLength) + '...';
        }
        
        test('should not truncate short text', () => {
            const text = 'Short comment';
            assert.strictEqual(truncateText(text, 40), 'Short comment');
        });
        
        test('should truncate long text with ellipsis', () => {
            const text = 'This is a very long comment that exceeds the maximum length';
            const truncated = truncateText(text, 20);
            assert.strictEqual(truncated, 'This is a very long ...');
            assert.ok(truncated.endsWith('...'));
        });
        
        test('should handle exact length text', () => {
            const text = '12345678901234567890'; // 20 chars
            assert.strictEqual(truncateText(text, 20), text);
        });
        
        test('should handle empty text', () => {
            assert.strictEqual(truncateText('', 40), '');
        });
        
        test('should handle text at boundary', () => {
            const text = '123456789012345678901'; // 21 chars
            const truncated = truncateText(text, 20);
            assert.strictEqual(truncated, '12345678901234567890...');
        });
    });
    
    suite('Comment List Item Generation', () => {
        // Test list item HTML generation
        
        interface CommentListItem {
            commentId: string;
            displayText: string;
            lineNumber: number;
        }
        
        function generateListItem(comment: MarkdownComment, maxTextLength: number = 40): CommentListItem {
            const displayText = comment.comment.length > maxTextLength
                ? comment.comment.substring(0, maxTextLength) + '...'
                : comment.comment;
            
            return {
                commentId: comment.id,
                displayText,
                lineNumber: comment.selection.startLine
            };
        }
        
        function createMockComment(overrides: Partial<MarkdownComment> = {}): MarkdownComment {
            return {
                id: 'test-id',
                filePath: 'test.md',
                selection: {
                    startLine: 10,
                    startColumn: 1,
                    endLine: 10,
                    endColumn: 20
                },
                selectedText: 'selected text',
                comment: 'Test comment text',
                status: 'open',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                ...overrides
            };
        }
        
        test('should generate list item with correct comment ID', () => {
            const comment = createMockComment({ id: 'unique-id-123' });
            const item = generateListItem(comment);
            assert.strictEqual(item.commentId, 'unique-id-123');
        });
        
        test('should generate list item with correct line number', () => {
            const comment = createMockComment({
                selection: { startLine: 42, startColumn: 1, endLine: 42, endColumn: 10 }
            });
            const item = generateListItem(comment);
            assert.strictEqual(item.lineNumber, 42);
        });
        
        test('should truncate long comment text', () => {
            const longComment = 'This is a very long comment that definitely exceeds the forty character limit set for display';
            const comment = createMockComment({ comment: longComment });
            const item = generateListItem(comment, 40);
            assert.ok(item.displayText.length <= 43); // 40 + '...'
            assert.ok(item.displayText.endsWith('...'));
        });
        
        test('should not truncate short comment text', () => {
            const shortComment = 'Short';
            const comment = createMockComment({ comment: shortComment });
            const item = generateListItem(comment, 40);
            assert.strictEqual(item.displayText, 'Short');
        });
    });
    
    suite('Hover Preview Tooltip', () => {
        // Test hover preview content generation
        
        interface PreviewTooltipContent {
            commentText: string;
            selectionText: string;
            lineInfo: string;
        }
        
        function generatePreviewContent(
            comment: MarkdownComment,
            maxCommentLength: number = 200,
            maxSelectionLength: number = 60
        ): PreviewTooltipContent {
            const commentText = comment.comment.length > maxCommentLength
                ? comment.comment.substring(0, maxCommentLength) + '...'
                : comment.comment;
            
            const selectionText = comment.selectedText.length > maxSelectionLength
                ? comment.selectedText.substring(0, maxSelectionLength) + '...'
                : comment.selectedText;
            
            return {
                commentText,
                selectionText,
                lineInfo: `Line ${comment.selection.startLine}`
            };
        }
        
        function createMockComment(overrides: Partial<MarkdownComment> = {}): MarkdownComment {
            return {
                id: 'test-id',
                filePath: 'test.md',
                selection: {
                    startLine: 5,
                    startColumn: 1,
                    endLine: 5,
                    endColumn: 20
                },
                selectedText: 'selected text',
                comment: 'Test comment',
                status: 'open',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                ...overrides
            };
        }
        
        test('should generate correct line info', () => {
            const comment = createMockComment({
                selection: { startLine: 15, startColumn: 1, endLine: 15, endColumn: 10 }
            });
            const preview = generatePreviewContent(comment);
            assert.strictEqual(preview.lineInfo, 'Line 15');
        });
        
        test('should truncate long comment text at 200 chars', () => {
            const longComment = 'A'.repeat(250);
            const comment = createMockComment({ comment: longComment });
            const preview = generatePreviewContent(comment);
            assert.strictEqual(preview.commentText.length, 203); // 200 + '...'
            assert.ok(preview.commentText.endsWith('...'));
        });
        
        test('should truncate long selection text at 60 chars', () => {
            const longSelection = 'B'.repeat(80);
            const comment = createMockComment({ selectedText: longSelection });
            const preview = generatePreviewContent(comment);
            assert.strictEqual(preview.selectionText.length, 63); // 60 + '...'
            assert.ok(preview.selectionText.endsWith('...'));
        });
        
        test('should not truncate short texts', () => {
            const comment = createMockComment({
                comment: 'Short comment',
                selectedText: 'Short selection'
            });
            const preview = generatePreviewContent(comment);
            assert.strictEqual(preview.commentText, 'Short comment');
            assert.strictEqual(preview.selectionText, 'Short selection');
        });
        
        test('should handle empty selection text', () => {
            const comment = createMockComment({ selectedText: '' });
            const preview = generatePreviewContent(comment);
            assert.strictEqual(preview.selectionText, '');
        });
    });
    
    suite('Tooltip Positioning', () => {
        // Test tooltip positioning logic
        
        interface Rect {
            top: number;
            right: number;
            bottom: number;
            left: number;
            width: number;
            height: number;
        }
        
        interface Position {
            left: number;
            top: number;
        }
        
        function calculateTooltipPosition(
            anchorRect: Rect,
            tooltipWidth: number,
            tooltipHeight: number,
            viewportWidth: number,
            viewportHeight: number,
            gap: number = 8
        ): Position {
            // Default: position to the right of the anchor
            let left = anchorRect.right + gap;
            let top = anchorRect.top;
            
            // If it would overflow the right edge, position to the left
            if (left + tooltipWidth > viewportWidth - 10) {
                left = anchorRect.left - tooltipWidth - gap;
            }
            
            // If it would overflow the bottom edge, adjust upward
            if (top + tooltipHeight > viewportHeight - 10) {
                top = viewportHeight - tooltipHeight - 10;
            }
            
            return { left, top };
        }
        
        test('should position tooltip to the right by default', () => {
            const anchorRect: Rect = {
                top: 100, right: 200, bottom: 120, left: 100,
                width: 100, height: 20
            };
            const position = calculateTooltipPosition(anchorRect, 150, 100, 1000, 800);
            assert.strictEqual(position.left, 208); // right + gap
            assert.strictEqual(position.top, 100);
        });
        
        test('should flip to left when near right edge', () => {
            const anchorRect: Rect = {
                top: 100, right: 900, bottom: 120, left: 800,
                width: 100, height: 20
            };
            const position = calculateTooltipPosition(anchorRect, 150, 100, 1000, 800);
            assert.strictEqual(position.left, 642); // left - tooltipWidth - gap
            assert.strictEqual(position.top, 100);
        });
        
        test('should adjust upward when near bottom edge', () => {
            const anchorRect: Rect = {
                top: 750, right: 200, bottom: 770, left: 100,
                width: 100, height: 20
            };
            const position = calculateTooltipPosition(anchorRect, 150, 100, 1000, 800);
            assert.strictEqual(position.left, 208);
            assert.strictEqual(position.top, 690); // viewportHeight - tooltipHeight - margin
        });
        
        test('should handle both edge cases simultaneously', () => {
            const anchorRect: Rect = {
                top: 750, right: 950, bottom: 770, left: 850,
                width: 100, height: 20
            };
            const position = calculateTooltipPosition(anchorRect, 150, 100, 1000, 800);
            assert.strictEqual(position.left, 692); // flipped to left
            assert.strictEqual(position.top, 690); // adjusted upward
        });
    });
    
    suite('Comment Navigation', () => {
        // Test navigation logic for finding comments
        
        function findCommentById(comments: MarkdownComment[], id: string): MarkdownComment | undefined {
            return comments.find(c => c.id === id);
        }
        
        function createMockComment(overrides: Partial<MarkdownComment> = {}): MarkdownComment {
            return {
                id: 'test-id',
                filePath: 'test.md',
                selection: {
                    startLine: 1,
                    startColumn: 1,
                    endLine: 1,
                    endColumn: 10
                },
                selectedText: 'test',
                comment: 'comment',
                status: 'open',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                ...overrides
            };
        }
        
        test('should find comment by ID', () => {
            const comments = [
                createMockComment({ id: 'id-1' }),
                createMockComment({ id: 'id-2' }),
                createMockComment({ id: 'id-3' })
            ];
            const found = findCommentById(comments, 'id-2');
            assert.ok(found);
            assert.strictEqual(found?.id, 'id-2');
        });
        
        test('should return undefined for non-existent ID', () => {
            const comments = [
                createMockComment({ id: 'id-1' }),
                createMockComment({ id: 'id-2' })
            ];
            const found = findCommentById(comments, 'non-existent');
            assert.strictEqual(found, undefined);
        });
        
        test('should handle empty comments array', () => {
            const found = findCommentById([], 'any-id');
            assert.strictEqual(found, undefined);
        });
    });
    
    suite('HTML Escaping', () => {
        // Test HTML escaping for safe content display
        
        function escapeHtml(text: string): string {
            const htmlEntities: Record<string, string> = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            };
            return text.replace(/[&<>"']/g, char => htmlEntities[char]);
        }
        
        test('should escape ampersand', () => {
            assert.strictEqual(escapeHtml('A & B'), 'A &amp; B');
        });
        
        test('should escape less than', () => {
            assert.strictEqual(escapeHtml('A < B'), 'A &lt; B');
        });
        
        test('should escape greater than', () => {
            assert.strictEqual(escapeHtml('A > B'), 'A &gt; B');
        });
        
        test('should escape double quotes', () => {
            assert.strictEqual(escapeHtml('A "B" C'), 'A &quot;B&quot; C');
        });
        
        test('should escape single quotes', () => {
            assert.strictEqual(escapeHtml("A 'B' C"), 'A &#39;B&#39; C');
        });
        
        test('should escape multiple special characters', () => {
            assert.strictEqual(
                escapeHtml('<script>alert("XSS")</script>'),
                '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
            );
        });
        
        test('should not modify text without special characters', () => {
            const text = 'Normal text without special chars';
            assert.strictEqual(escapeHtml(text), text);
        });
        
        test('should handle empty string', () => {
            assert.strictEqual(escapeHtml(''), '');
        });
    });
    
    suite('Dropdown Menu State', () => {
        // Test dropdown open/close state management
        
        class DropdownState {
            private isOpen: boolean = false;
            
            toggle(): void {
                this.isOpen = !this.isOpen;
            }
            
            open(): void {
                this.isOpen = true;
            }
            
            close(): void {
                this.isOpen = false;
            }
            
            get opened(): boolean {
                return this.isOpen;
            }
        }
        
        test('should start closed', () => {
            const state = new DropdownState();
            assert.strictEqual(state.opened, false);
        });
        
        test('should toggle from closed to open', () => {
            const state = new DropdownState();
            state.toggle();
            assert.strictEqual(state.opened, true);
        });
        
        test('should toggle from open to closed', () => {
            const state = new DropdownState();
            state.open();
            state.toggle();
            assert.strictEqual(state.opened, false);
        });
        
        test('should open explicitly', () => {
            const state = new DropdownState();
            state.open();
            assert.strictEqual(state.opened, true);
        });
        
        test('should close explicitly', () => {
            const state = new DropdownState();
            state.open();
            state.close();
            assert.strictEqual(state.opened, false);
        });
        
        test('should handle multiple opens', () => {
            const state = new DropdownState();
            state.open();
            state.open();
            assert.strictEqual(state.opened, true);
        });
        
        test('should handle multiple closes', () => {
            const state = new DropdownState();
            state.close();
            state.close();
            assert.strictEqual(state.opened, false);
        });
    });
    
    suite('Comments Dropdown Integration', () => {
        // Test integration scenarios
        
        interface DropdownContext {
            comments: MarkdownComment[];
            isOpen: boolean;
        }
        
        function createMockComment(overrides: Partial<MarkdownComment> = {}): MarkdownComment {
            return {
                id: 'test-id-' + Math.random().toString(36).substr(2, 9),
                filePath: 'test.md',
                selection: {
                    startLine: 1,
                    startColumn: 1,
                    endLine: 1,
                    endColumn: 10
                },
                selectedText: 'test',
                comment: 'comment',
                status: 'open',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                ...overrides
            };
        }
        
        function getDropdownContent(context: DropdownContext): {
            badgeCount: number;
            listItems: Array<{ id: string; text: string; line: number }>;
            showEmptyMessage: boolean;
        } {
            const openComments = context.comments.filter(c => c.status === 'open');
            
            return {
                badgeCount: openComments.length,
                listItems: openComments.map(c => ({
                    id: c.id,
                    text: c.comment.length > 40 ? c.comment.substring(0, 40) + '...' : c.comment,
                    line: c.selection.startLine
                })),
                showEmptyMessage: openComments.length === 0
            };
        }
        
        test('should show correct badge and list with mixed comments', () => {
            const context: DropdownContext = {
                comments: [
                    createMockComment({ status: 'open', comment: 'First comment', selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 } }),
                    createMockComment({ status: 'resolved', comment: 'Resolved comment' }),
                    createMockComment({ status: 'open', comment: 'Second comment', selection: { startLine: 10, startColumn: 1, endLine: 10, endColumn: 10 } })
                ],
                isOpen: true
            };
            
            const content = getDropdownContent(context);
            assert.strictEqual(content.badgeCount, 2);
            assert.strictEqual(content.listItems.length, 2);
            assert.strictEqual(content.showEmptyMessage, false);
        });
        
        test('should show empty message when no open comments', () => {
            const context: DropdownContext = {
                comments: [
                    createMockComment({ status: 'resolved' }),
                    createMockComment({ status: 'resolved' })
                ],
                isOpen: true
            };
            
            const content = getDropdownContent(context);
            assert.strictEqual(content.badgeCount, 0);
            assert.strictEqual(content.listItems.length, 0);
            assert.strictEqual(content.showEmptyMessage, true);
        });
        
        test('should show all comments when all are open', () => {
            const context: DropdownContext = {
                comments: [
                    createMockComment({ status: 'open' }),
                    createMockComment({ status: 'open' }),
                    createMockComment({ status: 'open' })
                ],
                isOpen: true
            };
            
            const content = getDropdownContent(context);
            assert.strictEqual(content.badgeCount, 3);
            assert.strictEqual(content.listItems.length, 3);
            assert.strictEqual(content.showEmptyMessage, false);
        });
        
        test('should correctly format list items with line numbers', () => {
            const context: DropdownContext = {
                comments: [
                    createMockComment({ 
                        status: 'open', 
                        comment: 'Check this line',
                        selection: { startLine: 42, startColumn: 1, endLine: 42, endColumn: 10 }
                    })
                ],
                isOpen: true
            };
            
            const content = getDropdownContent(context);
            assert.strictEqual(content.listItems[0].text, 'Check this line');
            assert.strictEqual(content.listItems[0].line, 42);
        });
        
        test('should truncate long comments in list items', () => {
            const longComment = 'This is a very long comment that exceeds the forty character limit';
            const context: DropdownContext = {
                comments: [
                    createMockComment({ status: 'open', comment: longComment })
                ],
                isOpen: true
            };
            
            const content = getDropdownContent(context);
            assert.ok(content.listItems[0].text.length <= 43);
            assert.ok(content.listItems[0].text.endsWith('...'));
        });
    });
});
