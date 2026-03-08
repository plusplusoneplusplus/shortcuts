/**
 * Tests for shared-comment-types.ts
 *
 * Validates the AnyComment union type, type guards, and category helpers
 * work correctly with both TaskComment and DiffComment.
 */

import { describe, it, expect } from 'vitest';
import type { TaskComment } from '../../../../src/server/spa/client/task-comments-types';
import type { DiffComment } from '../../../../src/server/spa/client/diff-comment-types';
import {
    isTaskComment,
    isDiffComment,
    getAnyCommentCategory,
    getAnyCommentCategoryInfo,
} from '../../../../src/server/spa/client/shared-comment-types';
import type { AnyComment, AnyCommentReply, AnyCommentCategory } from '../../../../src/server/spa/client/shared-comment-types';

// ============================================================================
// Test fixtures
// ============================================================================

const taskComment: TaskComment = {
    id: 'tc1',
    taskId: 'task-1',
    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
    selectedText: 'some text',
    comment: 'review this',
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    author: 'tester',
    category: 'bug',
    replies: [{ id: 'r1', author: 'reviewer', text: 'agreed', createdAt: '2026-01-01T00:01:00Z' }],
    aiResponse: 'AI says fix it.',
};

const diffComment: DiffComment = {
    id: 'dc1',
    context: {
        repositoryId: 'https://github.com/org/repo',
        filePath: 'src/utils.ts',
        oldRef: 'main',
        newRef: 'feature-branch',
    },
    selection: {
        diffLineStart: 5,
        diffLineEnd: 7,
        side: 'added',
        startColumn: 0,
        endColumn: 40,
    },
    selectedText: 'const x = 1;',
    comment: 'looks wrong',
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    author: 'reviewer',
    category: 'suggestion',
    replies: [{ id: 'r2', author: 'AI', text: 'fixed', createdAt: '2026-01-01T00:02:00Z', isAI: true }],
    aiResponse: 'Consider refactoring.',
};

const orphanedDiffComment: DiffComment = {
    ...diffComment,
    id: 'dc-orphan',
    status: 'orphaned',
};

// ============================================================================
// Union type compatibility
// ============================================================================

describe('AnyComment union type', () => {
    it('accepts a TaskComment', () => {
        const c: AnyComment = taskComment;
        expect(c.id).toBe('tc1');
        expect(c.comment).toBe('review this');
        expect(c.status).toBe('open');
    });

    it('accepts a DiffComment', () => {
        const c: AnyComment = diffComment;
        expect(c.id).toBe('dc1');
        expect(c.comment).toBe('looks wrong');
    });

    it('accepts an orphaned DiffComment', () => {
        const c: AnyComment = orphanedDiffComment;
        expect(c.status).toBe('orphaned');
    });

    it('shared fields are accessible without narrowing', () => {
        const comments: AnyComment[] = [taskComment, diffComment];
        for (const c of comments) {
            expect(c.id).toBeDefined();
            expect(c.selectedText).toBeDefined();
            expect(c.comment).toBeDefined();
            expect(c.status).toBeDefined();
            expect(c.createdAt).toBeDefined();
            expect(c.updatedAt).toBeDefined();
        }
    });
});

describe('AnyCommentReply union type', () => {
    it('accepts a TaskCommentReply', () => {
        const r: AnyCommentReply = { id: 'r1', author: 'user', text: 'hello', createdAt: '2026-01-01T00:00:00Z' };
        expect(r.id).toBe('r1');
    });

    it('accepts a DiffCommentReply with isAI', () => {
        const r: AnyCommentReply = { id: 'r2', author: 'AI', text: 'response', createdAt: '2026-01-01T00:00:00Z', isAI: true };
        expect(r.isAI).toBe(true);
    });
});

describe('AnyCommentCategory type', () => {
    it('accepts all category values', () => {
        const categories: AnyCommentCategory[] = ['bug', 'question', 'suggestion', 'praise', 'nitpick', 'general'];
        expect(categories).toHaveLength(6);
    });
});

// ============================================================================
// Type guards
// ============================================================================

describe('isTaskComment', () => {
    it('returns true for a TaskComment', () => {
        expect(isTaskComment(taskComment)).toBe(true);
    });

    it('returns false for a DiffComment', () => {
        expect(isTaskComment(diffComment)).toBe(false);
    });

    it('narrows the type so taskId is accessible', () => {
        const c: AnyComment = taskComment;
        if (isTaskComment(c)) {
            expect(c.taskId).toBe('task-1');
        } else {
            throw new Error('expected TaskComment');
        }
    });
});

describe('isDiffComment', () => {
    it('returns true for a DiffComment', () => {
        expect(isDiffComment(diffComment)).toBe(true);
    });

    it('returns false for a TaskComment', () => {
        expect(isDiffComment(taskComment)).toBe(false);
    });

    it('narrows the type so context is accessible', () => {
        const c: AnyComment = diffComment;
        if (isDiffComment(c)) {
            expect(c.context.repositoryId).toBe('https://github.com/org/repo');
        } else {
            throw new Error('expected DiffComment');
        }
    });

    it('returns true for an orphaned DiffComment', () => {
        expect(isDiffComment(orphanedDiffComment)).toBe(true);
    });
});

// ============================================================================
// getAnyCommentCategory
// ============================================================================

describe('getAnyCommentCategory', () => {
    it('returns the category field from a TaskComment', () => {
        expect(getAnyCommentCategory(taskComment)).toBe('bug');
    });

    it('returns the category field from a DiffComment', () => {
        expect(getAnyCommentCategory(diffComment)).toBe('suggestion');
    });

    it('defaults to "general" for a TaskComment without category', () => {
        const c: TaskComment = { ...taskComment, category: undefined, comment: 'plain comment' };
        expect(getAnyCommentCategory(c)).toBe('general');
    });

    it('defaults to "general" for a DiffComment without category', () => {
        const c: DiffComment = { ...diffComment, category: undefined, comment: 'plain comment' };
        expect(getAnyCommentCategory(c)).toBe('general');
    });

    it('parses text prefix from a TaskComment', () => {
        const c: TaskComment = { ...taskComment, category: undefined, comment: '[question] why?' };
        expect(getAnyCommentCategory(c)).toBe('question');
    });

    it('parses text prefix from a DiffComment', () => {
        const c: DiffComment = { ...diffComment, category: undefined, comment: '[nitpick] spacing' };
        expect(getAnyCommentCategory(c)).toBe('nitpick');
    });
});

// ============================================================================
// getAnyCommentCategoryInfo
// ============================================================================

describe('getAnyCommentCategoryInfo', () => {
    it('returns label and icon for a TaskComment', () => {
        const info = getAnyCommentCategoryInfo(taskComment);
        expect(info.label).toBe('Bug');
        expect(info.icon).toBe('🐛');
    });

    it('returns label and icon for a DiffComment', () => {
        const info = getAnyCommentCategoryInfo(diffComment);
        expect(info.label).toBe('Suggestion');
        expect(info.icon).toBe('💡');
    });

    it('returns "General" info for a comment without category', () => {
        const c: TaskComment = { ...taskComment, category: undefined, comment: 'no prefix' };
        const info = getAnyCommentCategoryInfo(c);
        expect(info.label).toBe('General');
        expect(info.icon).toBe('💬');
    });

    it('returns correct info for every category value', () => {
        const expected: Record<string, { label: string; icon: string }> = {
            bug: { label: 'Bug', icon: '🐛' },
            question: { label: 'Question', icon: '❓' },
            suggestion: { label: 'Suggestion', icon: '💡' },
            praise: { label: 'Praise', icon: '🌟' },
            nitpick: { label: 'Nitpick', icon: '🔍' },
            general: { label: 'General', icon: '💬' },
        };
        for (const [cat, exp] of Object.entries(expected)) {
            const c: TaskComment = { ...taskComment, category: cat as AnyCommentCategory };
            const info = getAnyCommentCategoryInfo(c);
            expect(info).toEqual(exp);
        }
    });
});
