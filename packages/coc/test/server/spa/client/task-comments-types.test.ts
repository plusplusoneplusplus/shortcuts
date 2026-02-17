/**
 * Tests for task-comments-types.ts
 *
 * Validates that the exported types are structurally correct and
 * that objects conforming to the interfaces satisfy expected shapes.
 */

import { describe, it, expect } from 'vitest';
import type {
    CommentSelection,
    CommentAnchor,
    TaskComment,
    TaskCommentsData,
    TaskCommentStatus,
} from '../../../../src/server/spa/client/task-comments-types';

// ============================================================================
// CommentSelection
// ============================================================================

describe('CommentSelection', () => {
    it('accepts valid selection coordinates', () => {
        const sel: CommentSelection = {
            startLine: 1,
            startColumn: 5,
            endLine: 3,
            endColumn: 10,
        };
        expect(sel.startLine).toBe(1);
        expect(sel.endColumn).toBe(10);
    });

    it('supports single-line selection', () => {
        const sel: CommentSelection = {
            startLine: 5,
            startColumn: 1,
            endLine: 5,
            endColumn: 20,
        };
        expect(sel.startLine).toBe(sel.endLine);
    });
});

// ============================================================================
// CommentAnchor
// ============================================================================

describe('CommentAnchor', () => {
    it('accepts valid anchor data', () => {
        const anchor: CommentAnchor = {
            selectedText: 'hello world',
            contextBefore: 'prefix text',
            contextAfter: 'suffix text',
            originalLine: 10,
            textHash: 'abc123',
        };
        expect(anchor.selectedText).toBe('hello world');
        expect(anchor.originalLine).toBe(10);
    });

    it('allows empty context strings', () => {
        const anchor: CommentAnchor = {
            selectedText: 'x',
            contextBefore: '',
            contextAfter: '',
            originalLine: 1,
            textHash: 'h',
        };
        expect(anchor.contextBefore).toBe('');
        expect(anchor.contextAfter).toBe('');
    });
});

// ============================================================================
// TaskComment
// ============================================================================

describe('TaskComment', () => {
    it('accepts a fully-populated comment', () => {
        const comment: TaskComment = {
            id: '550e8400-e29b-41d4-a716-446655440000',
            taskId: 'task-1',
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
            selectedText: 'some text',
            comment: 'review this',
            status: 'open',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            author: 'tester',
            anchor: {
                selectedText: 'some text',
                contextBefore: '',
                contextAfter: '',
                originalLine: 1,
                textHash: 'h1',
            },
        };
        expect(comment.id).toBeDefined();
        expect(comment.taskId).toBe('task-1');
    });

    it('allows optional fields to be omitted', () => {
        const comment: TaskComment = {
            id: 'c1',
            taskId: 't1',
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
            selectedText: 'a',
            comment: 'b',
            status: 'resolved',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
        };
        expect(comment.author).toBeUndefined();
        expect(comment.anchor).toBeUndefined();
    });

    it('supports both status values', () => {
        const statuses: TaskCommentStatus[] = ['open', 'resolved'];
        for (const status of statuses) {
            const c: TaskComment = {
                id: 'x', taskId: 'y',
                selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
                selectedText: '', comment: '', status,
                createdAt: '', updatedAt: '',
            };
            expect(c.status).toBe(status);
        }
    });
});

// ============================================================================
// TaskCommentsData
// ============================================================================

describe('TaskCommentsData', () => {
    it('holds a task ID, comments array, and version', () => {
        const data: TaskCommentsData = {
            taskId: 'task-42',
            comments: [],
            version: 1,
        };
        expect(data.taskId).toBe('task-42');
        expect(data.comments).toHaveLength(0);
        expect(data.version).toBe(1);
    });
});
