/**
 * Tests for task-comments-ui.ts
 *
 * Unit tests for comment UI component logic: HTML rendering, filtering,
 * positioning, and pure utility functions. Tests run in Node (no JSDOM),
 * so we test the HTML string output and pure logic functions.
 */

import { describe, it, expect } from 'vitest';
import {
    // Category info
    CATEGORY_INFO,
    ALL_CATEGORIES,
    type CommentCategory,
    type CommentFilter,
    type StatusFilter,
    // Comment card
    renderCommentCardHTML,
    type CommentCardOptions,
    // Selection toolbar
    renderSelectionToolbarHTML,
    calculateToolbarPosition,
    MIN_SELECTION_LENGTH,
    // Comment sidebar
    renderCommentSidebarHTML,
    renderSidebarFiltersHTML,
    renderSidebarListHTML,
    getCommentCategory,
    countByCategory,
    filterComments,
    // Selection utilities
    offsetToPosition,
    // Toggle button
    renderCommentToggleHTML,
    // Inline popup
    renderInlineCommentPopupHTML,
    // Comment dropdown
    renderCommentDropdownHTML,
} from '../../../../src/server/spa/client/task-comments-ui';
import type { TaskComment } from '../../../../src/server/spa/client/task-comments-types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeComment(overrides: Partial<TaskComment> = {}): TaskComment {
    return {
        id: 'c1',
        taskId: 'task-1',
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello world',
        comment: 'This looks great',
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'Alice',
        ...overrides,
    };
}

function makeCommentWithCategory(category: CommentCategory, overrides: Partial<TaskComment> = {}): TaskComment {
    return makeComment({
        comment: '[' + category + '] Some comment',
        ...overrides,
    });
}

// ============================================================================
// Category Info
// ============================================================================

describe('CATEGORY_INFO', () => {
    it('contains all categories', () => {
        for (const cat of ALL_CATEGORIES) {
            expect(CATEGORY_INFO[cat]).toBeDefined();
            expect(CATEGORY_INFO[cat].label).toBeTruthy();
            expect(CATEGORY_INFO[cat].icon).toBeTruthy();
        }
    });

    it('has 6 categories', () => {
        expect(ALL_CATEGORIES).toHaveLength(6);
    });

    it('includes expected categories', () => {
        expect(ALL_CATEGORIES).toContain('bug');
        expect(ALL_CATEGORIES).toContain('question');
        expect(ALL_CATEGORIES).toContain('suggestion');
        expect(ALL_CATEGORIES).toContain('praise');
        expect(ALL_CATEGORIES).toContain('nitpick');
        expect(ALL_CATEGORIES).toContain('general');
    });
});

// ============================================================================
// Comment Card Rendering
// ============================================================================

describe('renderCommentCardHTML', () => {
    it('renders a basic comment card', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('class="comment-card"');
        expect(html).toContain('data-comment-id="c1"');
        expect(html).toContain('Alice');
        expect(html).toContain('This looks great');
    });

    it('includes category badge', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment, category: 'bug' });
        expect(html).toContain('comment-card__category-badge--bug');
        expect(html).toContain('Bug');
    });

    it('renders different categories correctly', () => {
        for (const cat of ALL_CATEGORIES) {
            const html = renderCommentCardHTML({ comment: makeComment(), category: cat });
            expect(html).toContain('comment-card__category-badge--' + cat);
            expect(html).toContain(CATEGORY_INFO[cat].label);
        }
    });

    it('defaults to general category', () => {
        const html = renderCommentCardHTML({ comment: makeComment() });
        expect(html).toContain('comment-card__category-badge--general');
    });

    it('renders resolved state', () => {
        const comment = makeComment({ status: 'resolved' });
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('comment-card--resolved');
        expect(html).toContain('Reopen');
        expect(html).not.toContain('>Resolve<');
    });

    it('renders open state with resolve button', () => {
        const comment = makeComment({ status: 'open' });
        const html = renderCommentCardHTML({ comment });
        expect(html).not.toContain('comment-card--resolved');
        expect(html).toContain('Resolve');
    });

    it('renders action buttons', () => {
        const html = renderCommentCardHTML({ comment: makeComment() });
        expect(html).toContain('data-action="reply"');
        expect(html).toContain('data-action="resolve"');
        expect(html).toContain('data-action="edit"');
        expect(html).toContain('data-action="delete"');
    });

    it('hides action buttons in readonly mode', () => {
        const html = renderCommentCardHTML({ comment: makeComment(), readonly: true });
        expect(html).not.toContain('data-action="reply"');
        expect(html).not.toContain('comment-card__footer');
    });

    it('displays selected text', () => {
        const comment = makeComment({ selectedText: 'selected code' });
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('comment-selected-text');
        expect(html).toContain('selected code');
    });

    it('truncates long selected text', () => {
        const longText = 'x'.repeat(300);
        const comment = makeComment({ selectedText: longText });
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('…');
        // Should not contain the full 300-char string
        expect(html).not.toContain(longText);
    });

    it('handles missing author', () => {
        const comment = makeComment({ author: undefined });
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('Anonymous');
    });

    it('includes ARIA attributes', () => {
        const html = renderCommentCardHTML({ comment: makeComment() });
        expect(html).toContain('role="article"');
        expect(html).toContain('aria-label="Comment by Alice"');
    });

    it('includes aria-label on action buttons', () => {
        const html = renderCommentCardHTML({ comment: makeComment() });
        expect(html).toContain('aria-label="Reply"');
        expect(html).toContain('aria-label="Resolve"');
        expect(html).toContain('aria-label="Edit"');
        expect(html).toContain('aria-label="Delete"');
    });

    it('escapes HTML in comment text', () => {
        const comment = makeComment({ comment: '<script>alert("xss")</script>' });
        const html = renderCommentCardHTML({ comment });
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('escapes HTML in author name', () => {
        const comment = makeComment({ author: '<b>Evil</b>' });
        const html = renderCommentCardHTML({ comment });
        expect(html).not.toContain('<b>Evil</b>');
        expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
    });

    it('escapes HTML in selected text', () => {
        const comment = makeComment({ selectedText: '<img src=x onerror=alert(1)>' });
        const html = renderCommentCardHTML({ comment });
        expect(html).not.toContain('<img');
    });

    it('renders resolved comment with reopen button', () => {
        const comment = makeComment({ status: 'resolved' });
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('data-action="reopen"');
        expect(html).not.toContain('data-action="resolve"');
    });

    it('handles empty selectedText', () => {
        const comment = makeComment({ selectedText: '' });
        const html = renderCommentCardHTML({ comment });
        expect(html).not.toContain('comment-selected-text');
    });
});

// ============================================================================
// Selection Toolbar
// ============================================================================

describe('renderSelectionToolbarHTML', () => {
    it('renders toolbar with all category buttons', () => {
        const html = renderSelectionToolbarHTML();
        for (const cat of ALL_CATEGORIES) {
            expect(html).toContain('data-category="' + cat + '"');
        }
    });

    it('has toolbar role', () => {
        const html = renderSelectionToolbarHTML();
        expect(html).toContain('role="toolbar"');
        expect(html).toContain('aria-label="Add comment"');
    });

    it('includes icon for each category', () => {
        const html = renderSelectionToolbarHTML();
        for (const cat of ALL_CATEGORIES) {
            expect(html).toContain(CATEGORY_INFO[cat].icon);
        }
    });

    it('includes arrow element', () => {
        const html = renderSelectionToolbarHTML();
        expect(html).toContain('selection-toolbar__arrow');
    });

    it('includes accessible labels for each button', () => {
        const html = renderSelectionToolbarHTML();
        expect(html).toContain('aria-label="Bug comment"');
        expect(html).toContain('aria-label="Question comment"');
        expect(html).toContain('aria-label="Suggestion comment"');
    });

    it('includes title tooltips', () => {
        const html = renderSelectionToolbarHTML();
        expect(html).toContain('title="Bug"');
        expect(html).toContain('title="Question"');
    });
});

describe('calculateToolbarPosition', () => {
    const viewport = { width: 1024, height: 768 };
    const toolbarW = 200;
    const toolbarH = 40;

    it('positions toolbar above selection by default', () => {
        const selRect = { top: 300, left: 400, width: 100, height: 20 };
        const pos = calculateToolbarPosition(selRect, toolbarW, toolbarH, viewport);
        expect(pos.below).toBe(false);
        expect(pos.top).toBe(300 - 40 - 8); // top - height - margin
    });

    it('flips below when not enough space above', () => {
        const selRect = { top: 20, left: 400, width: 100, height: 20 };
        const pos = calculateToolbarPosition(selRect, toolbarW, toolbarH, viewport);
        expect(pos.below).toBe(true);
        expect(pos.top).toBe(20 + 20 + 8); // top + height + margin
    });

    it('centers horizontally on selection', () => {
        const selRect = { top: 300, left: 400, width: 100, height: 20 };
        const pos = calculateToolbarPosition(selRect, toolbarW, toolbarH, viewport);
        // Expected: 400 + 100/2 - 200/2 = 350
        expect(pos.left).toBe(350);
    });

    it('clamps to left edge', () => {
        const selRect = { top: 300, left: 10, width: 20, height: 20 };
        const pos = calculateToolbarPosition(selRect, toolbarW, toolbarH, viewport);
        expect(pos.left).toBe(8); // MARGIN
    });

    it('clamps to right edge', () => {
        const selRect = { top: 300, left: 950, width: 50, height: 20 };
        const pos = calculateToolbarPosition(selRect, toolbarW, toolbarH, viewport);
        expect(pos.left).toBe(1024 - 200 - 8); // viewport.width - toolbarW - MARGIN
    });

    it('handles selection at top-left corner', () => {
        const selRect = { top: 5, left: 5, width: 50, height: 15 };
        const pos = calculateToolbarPosition(selRect, toolbarW, toolbarH, viewport);
        expect(pos.below).toBe(true);
        expect(pos.left).toBe(8); // clamped
    });

    it('handles zero-width selection', () => {
        const selRect = { top: 300, left: 500, width: 0, height: 20 };
        const pos = calculateToolbarPosition(selRect, toolbarW, toolbarH, viewport);
        // left = 500 + 0/2 - 200/2 = 400
        expect(pos.left).toBe(400);
    });

    it('handles large toolbar', () => {
        const pos = calculateToolbarPosition(
            { top: 300, left: 100, width: 50, height: 20 },
            900, 50,
            viewport
        );
        expect(pos.left).toBe(8); // clamped to left margin
    });
});

describe('MIN_SELECTION_LENGTH', () => {
    it('is 3', () => {
        expect(MIN_SELECTION_LENGTH).toBe(3);
    });
});

// ============================================================================
// Comment Category Detection
// ============================================================================

describe('getCommentCategory', () => {
    it('detects [bug] prefix', () => {
        const c = makeComment({ comment: '[bug] This is broken' });
        expect(getCommentCategory(c)).toBe('bug');
    });

    it('detects [question] prefix', () => {
        const c = makeComment({ comment: '[question] Why is this here?' });
        expect(getCommentCategory(c)).toBe('question');
    });

    it('detects [suggestion] prefix', () => {
        const c = makeComment({ comment: '[suggestion] Consider refactoring' });
        expect(getCommentCategory(c)).toBe('suggestion');
    });

    it('detects [praise] prefix', () => {
        const c = makeComment({ comment: '[praise] Great implementation!' });
        expect(getCommentCategory(c)).toBe('praise');
    });

    it('detects [nitpick] prefix', () => {
        const c = makeComment({ comment: '[nitpick] Minor style issue' });
        expect(getCommentCategory(c)).toBe('nitpick');
    });

    it('detects [general] prefix', () => {
        const c = makeComment({ comment: '[general] Note to self' });
        expect(getCommentCategory(c)).toBe('general');
    });

    it('is case-insensitive', () => {
        const c = makeComment({ comment: '[BUG] Uppercase' });
        expect(getCommentCategory(c)).toBe('bug');
    });

    it('defaults to general when no prefix', () => {
        const c = makeComment({ comment: 'No category prefix' });
        expect(getCommentCategory(c)).toBe('general');
    });

    it('defaults to general for empty comment', () => {
        const c = makeComment({ comment: '' });
        expect(getCommentCategory(c)).toBe('general');
    });

    it('handles bracket in middle of text', () => {
        const c = makeComment({ comment: 'something [bug] in middle' });
        expect(getCommentCategory(c)).toBe('general');
    });
});

// ============================================================================
// Count and Filter
// ============================================================================

describe('countByCategory', () => {
    it('counts all comments', () => {
        const comments = [makeComment(), makeComment({ id: 'c2' })];
        const counts = countByCategory(comments);
        expect(counts.all).toBe(2);
    });

    it('counts by category', () => {
        const comments = [
            makeCommentWithCategory('bug', { id: 'c1' }),
            makeCommentWithCategory('bug', { id: 'c2' }),
            makeCommentWithCategory('question', { id: 'c3' }),
            makeComment({ id: 'c4' }), // general (no prefix)
        ];
        const counts = countByCategory(comments);
        expect(counts.bug).toBe(2);
        expect(counts.question).toBe(1);
        expect(counts.general).toBe(1);
        expect(counts.suggestion).toBe(0);
        expect(counts.all).toBe(4);
    });

    it('returns zero counts for empty array', () => {
        const counts = countByCategory([]);
        expect(counts.all).toBe(0);
        for (const cat of ALL_CATEGORIES) {
            expect(counts[cat]).toBe(0);
        }
    });
});

describe('filterComments', () => {
    const comments = [
        makeCommentWithCategory('bug', { id: 'c1', status: 'open' }),
        makeCommentWithCategory('bug', { id: 'c2', status: 'resolved' }),
        makeCommentWithCategory('question', { id: 'c3', status: 'open' }),
        makeComment({ id: 'c4', status: 'open' }), // general
    ];

    it('returns all when both filters are "all"', () => {
        const result = filterComments(comments, 'all', 'all');
        expect(result).toHaveLength(4);
    });

    it('filters by category', () => {
        const result = filterComments(comments, 'bug', 'all');
        expect(result).toHaveLength(2);
        expect(result.every(c => c.comment.startsWith('[bug]'))).toBe(true);
    });

    it('filters by status', () => {
        const result = filterComments(comments, 'all', 'open');
        expect(result).toHaveLength(3);
    });

    it('filters by both category and status', () => {
        const result = filterComments(comments, 'bug', 'open');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('c1');
    });

    it('returns empty for non-matching filter', () => {
        const result = filterComments(comments, 'praise', 'all');
        expect(result).toHaveLength(0);
    });

    it('filters resolved comments', () => {
        const result = filterComments(comments, 'all', 'resolved');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('c2');
    });
});

// ============================================================================
// Sidebar Rendering
// ============================================================================

describe('renderSidebarFiltersHTML', () => {
    it('renders filter buttons for all categories', () => {
        const counts = countByCategory([]);
        const html = renderSidebarFiltersHTML(counts, 'all', 'all');
        expect(html).toContain('data-filter="all"');
        for (const cat of ALL_CATEGORIES) {
            expect(html).toContain('data-filter="' + cat + '"');
        }
    });

    it('marks active category filter', () => {
        const counts = countByCategory([]);
        const html = renderSidebarFiltersHTML(counts, 'bug', 'all');
        expect(html).toContain('data-filter="bug"');
        // The bug button should have the active class
        expect(html).toContain('comment-sidebar__filter-btn--active" data-filter="bug"');
    });

    it('renders status filter buttons', () => {
        const counts = countByCategory([]);
        const html = renderSidebarFiltersHTML(counts, 'all', 'all');
        expect(html).toContain('data-status-filter="all"');
        expect(html).toContain('data-status-filter="open"');
        expect(html).toContain('data-status-filter="resolved"');
    });

    it('displays count badges', () => {
        const counts = countByCategory([
            makeCommentWithCategory('bug', { id: 'c1' }),
            makeCommentWithCategory('bug', { id: 'c2' }),
        ]);
        const html = renderSidebarFiltersHTML(counts, 'all', 'all');
        expect(html).toContain('>2<'); // total count for all
        // Bug count should show 2
        expect(html).toContain('comment-sidebar__count');
    });

    it('includes aria-pressed attributes', () => {
        const counts = countByCategory([]);
        const html = renderSidebarFiltersHTML(counts, 'all', 'open');
        expect(html).toContain('aria-pressed="true"');
        expect(html).toContain('aria-pressed="false"');
    });
});

describe('renderSidebarListHTML', () => {
    it('renders empty state when no comments', () => {
        const html = renderSidebarListHTML([]);
        expect(html).toContain('comment-sidebar__empty');
        expect(html).toContain('No comments');
    });

    it('renders comment items', () => {
        const comments = [makeComment({ id: 'c1' }), makeComment({ id: 'c2' })];
        const html = renderSidebarListHTML(comments);
        expect(html).toContain('data-comment-id="c1"');
        expect(html).toContain('data-comment-id="c2"');
        expect(html).toContain('comment-sidebar__item');
    });

    it('marks active comment', () => {
        const comments = [makeComment({ id: 'c1' })];
        const html = renderSidebarListHTML(comments, 'c1');
        expect(html).toContain('comment-sidebar__item--active');
    });

    it('does not mark non-active comment', () => {
        const comments = [makeComment({ id: 'c1' })];
        const html = renderSidebarListHTML(comments, 'other');
        expect(html).not.toContain('comment-sidebar__item--active');
    });

    it('marks resolved comments', () => {
        const comments = [makeComment({ id: 'c1', status: 'resolved' })];
        const html = renderSidebarListHTML(comments);
        expect(html).toContain('comment-sidebar__item--resolved');
    });

    it('truncates long comment text', () => {
        const longComment = 'x'.repeat(200);
        const html = renderSidebarListHTML([makeComment({ comment: longComment })]);
        expect(html).toContain('…');
    });

    it('includes category badge in items', () => {
        const comments = [makeCommentWithCategory('bug', { id: 'c1' })];
        const html = renderSidebarListHTML(comments);
        expect(html).toContain('comment-card__category-badge--bug');
    });

    it('includes accessible attributes', () => {
        const html = renderSidebarListHTML([makeComment()]);
        expect(html).toContain('tabindex="0"');
        expect(html).toContain('role="button"');
        expect(html).toContain('aria-label=');
    });

    it('escapes HTML in comment text', () => {
        const html = renderSidebarListHTML([makeComment({ comment: '<img src=x>' })]);
        expect(html).not.toContain('<img');
    });
});

describe('renderCommentSidebarHTML', () => {
    it('renders full sidebar structure', () => {
        const comments = [makeComment()];
        const html = renderCommentSidebarHTML(comments, 'all', 'all');
        expect(html).toContain('class="comment-sidebar"');
        expect(html).toContain('comment-sidebar__header');
        expect(html).toContain('comment-sidebar__filters');
        expect(html).toContain('comment-sidebar__list');
    });

    it('shows total comment count in title', () => {
        const comments = [makeComment({ id: 'c1' }), makeComment({ id: 'c2' })];
        const html = renderCommentSidebarHTML(comments, 'all', 'all');
        expect(html).toContain('Comments (2)');
    });

    it('includes close button', () => {
        const html = renderCommentSidebarHTML([], 'all', 'all');
        expect(html).toContain('comment-sidebar__close');
        expect(html).toContain('aria-label="Close comments panel"');
    });

    it('renders filtered results', () => {
        const comments = [
            makeCommentWithCategory('bug', { id: 'c1' }),
            makeCommentWithCategory('question', { id: 'c2' }),
        ];
        const html = renderCommentSidebarHTML(comments, 'bug', 'all');
        expect(html).toContain('data-comment-id="c1"');
        expect(html).not.toContain('data-comment-id="c2"');
    });

    it('has proper ARIA attributes', () => {
        const html = renderCommentSidebarHTML([], 'all', 'all');
        expect(html).toContain('role="complementary"');
        expect(html).toContain('aria-label="Comments"');
    });

    it('has list role on comment container', () => {
        const html = renderCommentSidebarHTML([], 'all', 'all');
        expect(html).toContain('role="list"');
    });
});

// ============================================================================
// Selection Utilities
// ============================================================================

describe('offsetToPosition', () => {
    it('returns line 1 column 1 for offset 0', () => {
        const pos = offsetToPosition('hello\nworld', 0);
        expect(pos).toEqual({ line: 1, column: 1 });
    });

    it('returns correct position mid-line', () => {
        const pos = offsetToPosition('hello\nworld', 3);
        expect(pos).toEqual({ line: 1, column: 4 });
    });

    it('returns correct position at newline', () => {
        const pos = offsetToPosition('hello\nworld', 5);
        expect(pos).toEqual({ line: 1, column: 6 });
    });

    it('returns correct position on second line', () => {
        const pos = offsetToPosition('hello\nworld', 6);
        expect(pos).toEqual({ line: 2, column: 1 });
    });

    it('returns correct position mid second line', () => {
        const pos = offsetToPosition('hello\nworld', 8);
        expect(pos).toEqual({ line: 2, column: 3 });
    });

    it('handles single line text', () => {
        const pos = offsetToPosition('hello', 3);
        expect(pos).toEqual({ line: 1, column: 4 });
    });

    it('handles empty text', () => {
        const pos = offsetToPosition('', 0);
        expect(pos).toEqual({ line: 1, column: 1 });
    });

    it('clamps offset to text length', () => {
        const pos = offsetToPosition('hi', 100);
        expect(pos).toEqual({ line: 1, column: 3 });
    });

    it('handles negative offset', () => {
        const pos = offsetToPosition('hello', -5);
        expect(pos).toEqual({ line: 1, column: 1 });
    });

    it('handles multiple lines', () => {
        const text = 'line1\nline2\nline3';
        expect(offsetToPosition(text, 12)).toEqual({ line: 3, column: 1 });
        expect(offsetToPosition(text, 14)).toEqual({ line: 3, column: 3 });
    });

    it('handles empty lines', () => {
        const text = 'a\n\nb';
        expect(offsetToPosition(text, 2)).toEqual({ line: 2, column: 1 });
        expect(offsetToPosition(text, 3)).toEqual({ line: 3, column: 1 });
    });

    it('handles Windows-style line endings as two characters', () => {
        // offsetToPosition treats \r\n as two separate characters
        const text = 'ab\r\ncd';
        // offset 3 is '\n', offset 4 is 'c'
        const pos = offsetToPosition(text, 4);
        expect(pos.line).toBe(2);
        expect(pos.column).toBe(1);
    });
});

// ============================================================================
// Comment Toggle Button
// ============================================================================

describe('renderCommentToggleHTML', () => {
    it('renders button with count', () => {
        const html = renderCommentToggleHTML(5, false);
        expect(html).toContain('comment-toggle-btn');
        expect(html).toContain('5');
    });

    it('renders active state', () => {
        const html = renderCommentToggleHTML(3, true);
        expect(html).toContain('comment-toggle-btn--active');
        expect(html).toContain('aria-expanded="true"');
    });

    it('renders inactive state', () => {
        const html = renderCommentToggleHTML(0, false);
        expect(html).not.toContain('comment-toggle-btn--active');
        expect(html).toContain('aria-expanded="false"');
    });

    it('includes accessible label', () => {
        const html = renderCommentToggleHTML(0, false);
        expect(html).toContain('aria-label="Toggle comments"');
    });

    it('has correct id', () => {
        const html = renderCommentToggleHTML(0, false);
        expect(html).toContain('id="comment-toggle-btn"');
    });

    it('shows zero count', () => {
        const html = renderCommentToggleHTML(0, false);
        expect(html).toContain('0');
    });
});

// ============================================================================
// Edge Cases and Integration
// ============================================================================

describe('Comment UI integration scenarios', () => {
    it('full flow: create comments, count, filter, render sidebar', () => {
        const comments: TaskComment[] = [
            makeCommentWithCategory('bug', { id: 'c1', status: 'open' }),
            makeCommentWithCategory('bug', { id: 'c2', status: 'resolved' }),
            makeCommentWithCategory('suggestion', { id: 'c3', status: 'open' }),
            makeComment({ id: 'c4', status: 'open' }),
        ];

        // Count
        const counts = countByCategory(comments);
        expect(counts.all).toBe(4);
        expect(counts.bug).toBe(2);
        expect(counts.suggestion).toBe(1);
        expect(counts.general).toBe(1);

        // Filter bugs only
        const bugs = filterComments(comments, 'bug', 'all');
        expect(bugs).toHaveLength(2);

        // Filter open bugs
        const openBugs = filterComments(comments, 'bug', 'open');
        expect(openBugs).toHaveLength(1);
        expect(openBugs[0].id).toBe('c1');

        // Render sidebar with bug filter
        const html = renderCommentSidebarHTML(comments, 'bug', 'all', 'c1');
        expect(html).toContain('data-comment-id="c1"');
        expect(html).toContain('data-comment-id="c2"');
        expect(html).not.toContain('data-comment-id="c3"');
        expect(html).not.toContain('data-comment-id="c4"');
        expect(html).toContain('comment-sidebar__item--active');
    });

    it('renders many comments without error', () => {
        const comments: TaskComment[] = [];
        for (let i = 0; i < 200; i++) {
            comments.push(makeComment({ id: 'c' + i, comment: 'Comment number ' + i }));
        }

        const html = renderCommentSidebarHTML(comments, 'all', 'all');
        expect(html).toContain('Comments (200)');
        expect(html).toContain('data-comment-id="c0"');
        expect(html).toContain('data-comment-id="c199"');
    });

    it('comment card for each status renders correctly', () => {
        const statuses: TaskComment['status'][] = ['open', 'resolved'];
        for (const status of statuses) {
            const comment = makeComment({ status });
            const html = renderCommentCardHTML({ comment });
            expect(html).toContain('comment-card');
            if (status === 'resolved') {
                expect(html).toContain('comment-card--resolved');
            }
        }
    });
});

// ============================================================================
// getCommentCategory — field-based lookup
// ============================================================================

describe('getCommentCategory (field-based)', () => {
    it('returns category from field when set', () => {
        const comment = makeComment({ category: 'bug' as any, comment: 'Some issue' });
        expect(getCommentCategory(comment)).toBe('bug');
    });

    it('prefers field over text prefix', () => {
        const comment = makeComment({ category: 'suggestion' as any, comment: '[bug] Some issue' });
        expect(getCommentCategory(comment)).toBe('suggestion');
    });

    it('falls back to text prefix when field is not set', () => {
        const comment = makeComment({ comment: '[question] Why is this?' });
        expect(getCommentCategory(comment)).toBe('question');
    });

    it('falls back to general when no field and no prefix', () => {
        const comment = makeComment({ comment: 'Just a comment' });
        expect(getCommentCategory(comment)).toBe('general');
    });

    it('ignores invalid category field values', () => {
        const comment = makeComment({ category: 'invalid' as any, comment: '[praise] Nice work' });
        expect(getCommentCategory(comment)).toBe('praise');
    });

    it('handles undefined category field', () => {
        const comment = makeComment({ category: undefined });
        expect(getCommentCategory(comment)).toBe('general');
    });

    it('handles all valid category values via field', () => {
        for (const cat of ALL_CATEGORIES) {
            const comment = makeComment({ category: cat as any, comment: 'test' });
            expect(getCommentCategory(comment)).toBe(cat);
        }
    });
});

// ============================================================================
// Selection Toolbar — input panel rendering
// ============================================================================

describe('renderSelectionToolbarHTML (input panel)', () => {
    it('includes categories container', () => {
        const html = renderSelectionToolbarHTML();
        expect(html).toContain('selection-toolbar__categories');
    });

    it('includes input panel', () => {
        const html = renderSelectionToolbarHTML();
        expect(html).toContain('selection-toolbar__input-panel');
    });

    it('includes textarea', () => {
        const html = renderSelectionToolbarHTML();
        expect(html).toContain('selection-toolbar__textarea');
        expect(html).toContain('placeholder="Add your comment…"');
    });

    it('includes submit button with Ctrl+Enter hint', () => {
        const html = renderSelectionToolbarHTML();
        expect(html).toContain('selection-toolbar__submit-btn');
        expect(html).toContain('Ctrl+Enter');
    });

    it('includes cancel button', () => {
        const html = renderSelectionToolbarHTML();
        expect(html).toContain('selection-toolbar__cancel-btn');
        expect(html).toContain('Cancel');
    });

    it('marks general as default active category', () => {
        const html = renderSelectionToolbarHTML();
        expect(html).toContain('selection-toolbar__btn--general selection-toolbar__btn--active');
    });

    it('no other category is active by default', () => {
        const html = renderSelectionToolbarHTML();
        // Only general should have the active class
        const matches = html.match(/selection-toolbar__btn--active/g);
        expect(matches).toHaveLength(1);
    });
});

// ============================================================================
// Inline Comment Popup
// ============================================================================

describe('renderInlineCommentPopupHTML', () => {
    it('renders popup wrapper with comment id', () => {
        const comment = makeComment({ id: 'popup-1' });
        const html = renderInlineCommentPopupHTML(comment);
        expect(html).toContain('class="comment-inline-popup"');
        expect(html).toContain('data-popup-comment-id="popup-1"');
    });

    it('contains the comment card inside', () => {
        const comment = makeComment({ comment: 'Great work here' });
        const html = renderInlineCommentPopupHTML(comment);
        expect(html).toContain('class="comment-card');
        expect(html).toContain('Great work here');
    });

    it('includes arrow element', () => {
        const html = renderInlineCommentPopupHTML(makeComment());
        expect(html).toContain('comment-inline-popup__arrow');
    });

    it('detects category from comment', () => {
        const comment = makeComment({ category: 'bug' as any, comment: 'Found a bug' });
        const html = renderInlineCommentPopupHTML(comment);
        expect(html).toContain('comment-card__category-badge--bug');
    });

    it('renders action buttons by default', () => {
        const html = renderInlineCommentPopupHTML(makeComment());
        expect(html).toContain('data-action="reply"');
        expect(html).toContain('data-action="resolve"');
        expect(html).toContain('data-action="delete"');
    });

    it('hides action buttons in readonly mode', () => {
        const html = renderInlineCommentPopupHTML(makeComment(), true);
        expect(html).not.toContain('data-action="reply"');
        expect(html).not.toContain('comment-card__footer');
    });

    it('shows resolved state correctly', () => {
        const comment = makeComment({ status: 'resolved' });
        const html = renderInlineCommentPopupHTML(comment);
        expect(html).toContain('comment-card--resolved');
        expect(html).toContain('data-action="reopen"');
    });

    it('escapes HTML in comment id', () => {
        const comment = makeComment({ id: '<script>xss</script>' });
        const html = renderInlineCommentPopupHTML(comment);
        expect(html).not.toContain('<script>xss</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('includes selected text when present', () => {
        const comment = makeComment({ selectedText: 'some code snippet' });
        const html = renderInlineCommentPopupHTML(comment);
        expect(html).toContain('some code snippet');
        expect(html).toContain('comment-selected-text');
    });

    it('shows author name', () => {
        const comment = makeComment({ author: 'Bob' });
        const html = renderInlineCommentPopupHTML(comment);
        expect(html).toContain('Bob');
    });
});

// ============================================================================
// Comment Dropdown
// ============================================================================

describe('renderCommentDropdownHTML', () => {
    it('renders empty state when no comments', () => {
        const html = renderCommentDropdownHTML([]);
        expect(html).toContain('comment-dropdown');
        expect(html).toContain('comment-dropdown__empty');
        expect(html).toContain('No comments yet');
    });

    it('renders items for each comment', () => {
        const comments = [
            makeComment({ id: 'd1', comment: 'First comment' }),
            makeComment({ id: 'd2', comment: 'Second comment' }),
        ];
        const html = renderCommentDropdownHTML(comments);
        expect(html).toContain('data-comment-id="d1"');
        expect(html).toContain('data-comment-id="d2"');
        expect(html).toContain('First comment');
        expect(html).toContain('Second comment');
    });

    it('shows category icon for each item', () => {
        const comments = [
            makeCommentWithCategory('bug', { id: 'd1' }),
            makeCommentWithCategory('question', { id: 'd2' }),
        ];
        const html = renderCommentDropdownHTML(comments);
        expect(html).toContain(CATEGORY_INFO.bug.icon);
        expect(html).toContain(CATEGORY_INFO.question.icon);
    });

    it('shows line number label', () => {
        const comment = makeComment({
            id: 'd1',
            selection: { startLine: 42, startColumn: 1, endLine: 42, endColumn: 10 },
        });
        const html = renderCommentDropdownHTML([comment]);
        expect(html).toContain('L42');
        expect(html).toContain('comment-dropdown__line');
    });

    it('marks resolved items', () => {
        const comment = makeComment({ id: 'd1', status: 'resolved' });
        const html = renderCommentDropdownHTML([comment]);
        expect(html).toContain('comment-dropdown__item--resolved');
        expect(html).toContain('\u2705');
    });

    it('does not mark open items as resolved', () => {
        const comment = makeComment({ id: 'd1', status: 'open' });
        const html = renderCommentDropdownHTML([comment]);
        expect(html).not.toContain('comment-dropdown__item--resolved');
    });

    it('truncates long comment text at 60 chars', () => {
        const longComment = 'x'.repeat(100);
        const html = renderCommentDropdownHTML([makeComment({ comment: longComment })]);
        expect(html).toContain('…');
        expect(html).not.toContain(longComment);
    });

    it('does not truncate short comment text', () => {
        const shortComment = 'Short text';
        const html = renderCommentDropdownHTML([makeComment({ comment: shortComment })]);
        expect(html).toContain('Short text');
        expect(html).not.toContain('…');
    });

    it('has listbox role and accessible label', () => {
        const html = renderCommentDropdownHTML([makeComment()]);
        expect(html).toContain('role="listbox"');
        expect(html).toContain('aria-label="Comments list"');
    });

    it('items have option role and tabindex', () => {
        const html = renderCommentDropdownHTML([makeComment()]);
        expect(html).toContain('role="option"');
        expect(html).toContain('tabindex="0"');
    });

    it('escapes HTML in comment text', () => {
        const comment = makeComment({ comment: '<img src=x onerror=alert(1)>' });
        const html = renderCommentDropdownHTML([comment]);
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
    });

    it('handles comment without selection', () => {
        const comment = makeComment({ id: 'd1' });
        delete (comment as any).selection;
        const html = renderCommentDropdownHTML([comment]);
        expect(html).toContain('data-comment-id="d1"');
        expect(html).not.toContain('comment-dropdown__line');
    });

    it('renders many comments without error', () => {
        const comments: TaskComment[] = [];
        for (let i = 0; i < 50; i++) {
            comments.push(makeComment({ id: 'dd' + i, comment: 'Comment ' + i }));
        }
        const html = renderCommentDropdownHTML(comments);
        expect(html).toContain('data-comment-id="dd0"');
        expect(html).toContain('data-comment-id="dd49"');
    });

    it('uses category-specific badge class for icon', () => {
        const comment = makeCommentWithCategory('suggestion', { id: 'd1' });
        const html = renderCommentDropdownHTML([comment]);
        expect(html).toContain('comment-card__category-badge--suggestion');
    });

    it('renders mixed resolved and open items', () => {
        const comments = [
            makeComment({ id: 'd1', status: 'open' }),
            makeComment({ id: 'd2', status: 'resolved' }),
            makeComment({ id: 'd3', status: 'open' }),
        ];
        const html = renderCommentDropdownHTML(comments);
        const resolvedMatches = html.match(/comment-dropdown__item--resolved/g);
        expect(resolvedMatches).toHaveLength(1);
    });
});

// ============================================================================
// Inline Popup + Dropdown Integration
// ============================================================================

describe('Inline popup and dropdown integration', () => {
    it('popup renders with correct category from field', () => {
        for (const cat of ALL_CATEGORIES) {
            const comment = makeComment({ category: cat as any, comment: 'test' });
            const html = renderInlineCommentPopupHTML(comment);
            expect(html).toContain('comment-card__category-badge--' + cat);
        }
    });

    it('dropdown shows all comments from a mixed set', () => {
        const comments = [
            makeCommentWithCategory('bug', { id: 'i1', status: 'open' }),
            makeCommentWithCategory('suggestion', { id: 'i2', status: 'resolved' }),
            makeComment({ id: 'i3', status: 'open' }),
        ];
        const html = renderCommentDropdownHTML(comments);
        expect(html).toContain('data-comment-id="i1"');
        expect(html).toContain('data-comment-id="i2"');
        expect(html).toContain('data-comment-id="i3"');
    });

    it('popup and dropdown render independently', () => {
        const comment = makeComment({ id: 'dual-1', comment: 'Test comment' });
        const popupHtml = renderInlineCommentPopupHTML(comment);
        const dropdownHtml = renderCommentDropdownHTML([comment]);

        expect(popupHtml).toContain('comment-inline-popup');
        expect(popupHtml).not.toContain('comment-dropdown');
        expect(dropdownHtml).toContain('comment-dropdown');
        expect(dropdownHtml).not.toContain('comment-inline-popup');
    });
});
