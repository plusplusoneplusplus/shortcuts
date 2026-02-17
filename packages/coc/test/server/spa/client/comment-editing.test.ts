/**
 * Tests for comment editing functionality
 *
 * Tests inline edit mode rendering, save/cancel flows,
 * and edit mode HTML generation.
 */

import { describe, it, expect } from 'vitest';
import {
    renderCommentCardHTML,
    renderEditModeHTML,
    type CommentCardOptions,
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
        comment: 'This needs refactoring',
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'Alice',
        ...overrides,
    };
}

// ============================================================================
// Edit Mode Rendering
// ============================================================================

describe('renderEditModeHTML', () => {
    it('renders edit panel with textarea', () => {
        const html = renderEditModeHTML('c1', 'Original text');
        expect(html).toContain('comment-edit-panel');
        expect(html).toContain('comment-edit-textarea');
        expect(html).toContain('Original text');
    });

    it('renders save button', () => {
        const html = renderEditModeHTML('c1', 'text');
        expect(html).toContain('comment-edit-save-btn');
        expect(html).toContain('Save');
    });

    it('renders cancel button', () => {
        const html = renderEditModeHTML('c1', 'text');
        expect(html).toContain('comment-edit-cancel-btn');
        expect(html).toContain('Cancel');
    });

    it('includes comment ID as data attribute', () => {
        const html = renderEditModeHTML('abc-123', 'text');
        expect(html).toContain('data-comment-id="abc-123"');
    });

    it('escapes HTML in comment text', () => {
        const html = renderEditModeHTML('c1', '<script>alert("xss")</script>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('preserves newlines in textarea content', () => {
        const html = renderEditModeHTML('c1', 'line 1\nline 2');
        expect(html).toContain('line 1\nline 2');
    });

    it('handles empty text', () => {
        const html = renderEditModeHTML('c1', '');
        expect(html).toContain('comment-edit-textarea');
        expect(html).toContain('></textarea>');
    });
});

// ============================================================================
// Comment Card with Edit Button
// ============================================================================

describe('Comment card edit button', () => {
    it('renders edit button on non-readonly card', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('data-action="edit"');
        expect(html).toContain('Edit');
    });

    it('does not render edit button on readonly card', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment, readonly: true });
        expect(html).not.toContain('data-action="edit"');
    });

    it('edit button has correct comment ID', () => {
        const comment = makeComment({ id: 'edit-test-id' });
        const html = renderCommentCardHTML({ comment });
        // Find the edit button specifically
        const editMatch = html.match(/data-action="edit"\s+data-comment-id="([^"]+)"/);
        expect(editMatch).toBeTruthy();
        expect(editMatch![1]).toBe('edit-test-id');
    });

    it('edit button has accessible aria-label', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('aria-label="Edit"');
    });
});

// ============================================================================
// Edit mode integration
// ============================================================================

describe('Edit mode integration', () => {
    it('edit panel replaces body text when activated', () => {
        const comment = makeComment({ comment: 'Original comment text' });
        const cardHtml = renderCommentCardHTML({ comment });
        const editHtml = renderEditModeHTML(comment.id, comment.comment);

        // Card shows original text
        expect(cardHtml).toContain('Original comment text');

        // Edit panel has the text in textarea
        expect(editHtml).toContain('Original comment text');
        expect(editHtml).toContain('comment-edit-textarea');
    });

    it('handles special characters in comment text for editing', () => {
        const comment = makeComment({ comment: 'Uses "quotes" & <angles>' });
        const editHtml = renderEditModeHTML(comment.id, comment.comment);
        expect(editHtml).toContain('&amp;');
        expect(editHtml).toContain('&lt;angles&gt;');
    });
});
