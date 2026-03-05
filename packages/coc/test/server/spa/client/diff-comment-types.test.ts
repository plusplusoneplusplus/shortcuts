/**
 * Tests for diff-comment-types.ts
 *
 * Validates that the exported types are structurally correct and
 * that objects conforming to the interfaces satisfy expected shapes.
 */

import { describe, it, expect } from 'vitest';
import type {
    DiffCommentSelection,
    DiffCommentContext,
    DiffComment,
    DiffCommentsData,
    DiffCommentStatus,
} from '../../../../src/server/spa/client/diff-comment-types';
import {
    getDiffCommentCategory,
    ALL_DIFF_CATEGORIES,
    DIFF_CATEGORY_INFO,
} from '../../../../src/server/spa/client/diff-comment-types';

// ============================================================================
// DiffCommentSelection
// ============================================================================

describe('DiffCommentSelection', () => {
    it('accepts a selection with all required fields', () => {
        const sel: DiffCommentSelection = {
            diffLineStart: 0,
            diffLineEnd: 2,
            side: 'added',
            startColumn: 0,
            endColumn: 10,
        };
        expect(sel.diffLineStart).toBe(0);
        expect(sel.diffLineEnd).toBe(2);
        expect(sel.side).toBe('added');
        expect(sel.startColumn).toBe(0);
        expect(sel.endColumn).toBe(10);
    });

    it('accepts a selection with all optional fields absent', () => {
        const sel: DiffCommentSelection = {
            diffLineStart: 5,
            diffLineEnd: 5,
            side: 'context',
            startColumn: 3,
            endColumn: 7,
        };
        expect(sel.oldLineStart).toBeUndefined();
        expect(sel.oldLineEnd).toBeUndefined();
        expect(sel.newLineStart).toBeUndefined();
        expect(sel.newLineEnd).toBeUndefined();
    });

    it('accepts all side values', () => {
        const sides: DiffCommentSelection['side'][] = ['added', 'removed', 'context'];
        for (const side of sides) {
            const sel: DiffCommentSelection = {
                diffLineStart: 0, diffLineEnd: 0, side,
                startColumn: 0, endColumn: 1,
            };
            expect(sel.side).toBe(side);
        }
    });

    it('accepts fully populated selection with source line numbers', () => {
        const sel: DiffCommentSelection = {
            diffLineStart: 10,
            diffLineEnd: 12,
            side: 'removed',
            oldLineStart: 20,
            oldLineEnd: 22,
            newLineStart: 18,
            newLineEnd: 20,
            startColumn: 0,
            endColumn: 80,
        };
        expect(sel.oldLineStart).toBe(20);
        expect(sel.newLineEnd).toBe(20);
    });
});

// ============================================================================
// DiffCommentContext
// ============================================================================

describe('DiffCommentContext', () => {
    it('accepts a valid context with all required fields', () => {
        const ctx: DiffCommentContext = {
            repositoryId: 'https://github.com/org/repo',
            filePath: 'src/index.ts',
            oldRef: 'main',
            newRef: 'HEAD',
        };
        expect(ctx.repositoryId).toBeDefined();
        expect(ctx.filePath).toBe('src/index.ts');
    });

    it('accepts optional commitHash', () => {
        const ctx: DiffCommentContext = {
            repositoryId: '/local/repo',
            filePath: 'README.md',
            oldRef: 'abc123',
            newRef: 'def456',
            commitHash: 'def456abcdef',
        };
        expect(ctx.commitHash).toBe('def456abcdef');
    });

    it('allows commitHash to be omitted', () => {
        const ctx: DiffCommentContext = {
            repositoryId: '/local/repo',
            filePath: 'README.md',
            oldRef: 'HEAD~1',
            newRef: 'HEAD',
        };
        expect(ctx.commitHash).toBeUndefined();
    });
});

// ============================================================================
// DiffComment
// ============================================================================

describe('DiffComment', () => {
    it('accepts a fully populated comment with DiffCommentContext and DiffCommentSelection', () => {
        const comment: DiffComment = {
            id: '550e8400-e29b-41d4-a716-446655440000',
            context: {
                repositoryId: 'https://github.com/org/repo',
                filePath: 'src/utils.ts',
                oldRef: 'main',
                newRef: 'feature-branch',
                commitHash: 'abc123',
            },
            selection: {
                diffLineStart: 5,
                diffLineEnd: 7,
                side: 'added',
                oldLineStart: 5,
                oldLineEnd: 7,
                newLineStart: 6,
                newLineEnd: 8,
                startColumn: 0,
                endColumn: 40,
            },
            selectedText: 'const x = 1;',
            comment: 'review this',
            status: 'open',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            author: 'tester',
            category: 'bug',
            anchor: {
                selectedText: 'const x = 1;',
                contextBefore: '',
                contextAfter: '',
                originalLine: 6,
                textHash: 'h1',
            },
            replies: [
                { id: 'r1', author: 'reviewer', text: 'agreed', createdAt: '2026-01-01T00:01:00Z' },
            ],
            aiResponse: 'This looks like a bug.',
        };
        expect(comment.id).toBeDefined();
        expect(comment.context.repositoryId).toBe('https://github.com/org/repo');
        expect(comment.selection.side).toBe('added');
        expect(comment.anchor).toBeDefined();
    });

    it('allows optional fields to be omitted', () => {
        const comment: DiffComment = {
            id: 'c1',
            context: {
                repositoryId: '/local/repo',
                filePath: 'file.ts',
                oldRef: 'HEAD~1',
                newRef: 'HEAD',
            },
            selection: {
                diffLineStart: 0,
                diffLineEnd: 0,
                side: 'context',
                startColumn: 0,
                endColumn: 5,
            },
            selectedText: 'hello',
            comment: 'note',
            status: 'resolved',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
        };
        expect(comment.author).toBeUndefined();
        expect(comment.anchor).toBeUndefined();
        expect(comment.category).toBeUndefined();
        expect(comment.replies).toBeUndefined();
        expect(comment.aiResponse).toBeUndefined();
    });

    it('supports all status values', () => {
        const statuses: DiffCommentStatus[] = ['open', 'resolved'];
        for (const status of statuses) {
            const c: DiffComment = {
                id: 'x',
                context: { repositoryId: 'r', filePath: 'f', oldRef: 'a', newRef: 'b' },
                selection: { diffLineStart: 0, diffLineEnd: 0, side: 'added', startColumn: 0, endColumn: 0 },
                selectedText: '', comment: '', status,
                createdAt: '', updatedAt: '',
            };
            expect(c.status).toBe(status);
        }
    });
});

// ============================================================================
// DiffCommentsData
// ============================================================================

describe('DiffCommentsData', () => {
    it('holds a diffId, comments array, and version', () => {
        const data: DiffCommentsData = {
            diffId: 'repo:src/index.ts:main..HEAD',
            comments: [],
            version: 1,
        };
        expect(data.diffId).toBe('repo:src/index.ts:main..HEAD');
        expect(data.comments).toHaveLength(0);
        expect(data.version).toBe(1);
    });
});

// ============================================================================
// getDiffCommentCategory
// ============================================================================

describe('getDiffCommentCategory', () => {
    const baseComment: DiffComment = {
        id: 'c1',
        context: { repositoryId: 'r', filePath: 'f', oldRef: 'a', newRef: 'b' },
        selection: { diffLineStart: 0, diffLineEnd: 0, side: 'added', startColumn: 0, endColumn: 0 },
        selectedText: '', comment: '', status: 'open',
        createdAt: '', updatedAt: '',
    };

    it('returns "general" for a comment with no category and no prefix', () => {
        const comment: DiffComment = { ...baseComment, comment: 'just a note' };
        expect(getDiffCommentCategory(comment)).toBe('general');
    });

    it('returns the category field when set', () => {
        const comment: DiffComment = { ...baseComment, comment: 'a bug', category: 'bug' };
        expect(getDiffCommentCategory(comment)).toBe('bug');
    });

    it('parses a [bug] prefix from the comment text', () => {
        const comment: DiffComment = { ...baseComment, comment: '[bug] this is broken' };
        expect(getDiffCommentCategory(comment)).toBe('bug');
    });

    it('is case-insensitive for prefix parsing', () => {
        const comment: DiffComment = { ...baseComment, comment: '[Bug] uppercase' };
        expect(getDiffCommentCategory(comment)).toBe('bug');
    });

    it('supports all category values as prefixes', () => {
        for (const cat of ALL_DIFF_CATEGORIES) {
            const comment: DiffComment = { ...baseComment, comment: `[${cat}] text` };
            expect(getDiffCommentCategory(comment)).toBe(cat);
        }
    });
});

// ============================================================================
// DIFF_CATEGORY_INFO & ALL_DIFF_CATEGORIES
// ============================================================================

describe('DIFF_CATEGORY_INFO', () => {
    it('has an entry for every category', () => {
        for (const cat of ALL_DIFF_CATEGORIES) {
            expect(DIFF_CATEGORY_INFO[cat]).toBeDefined();
            expect(DIFF_CATEGORY_INFO[cat].label).toBeTruthy();
            expect(DIFF_CATEGORY_INFO[cat].icon).toBeTruthy();
        }
    });
});

describe('ALL_DIFF_CATEGORIES', () => {
    it('contains exactly 6 categories', () => {
        expect(ALL_DIFF_CATEGORIES).toHaveLength(6);
    });

    it('includes the expected values', () => {
        expect(ALL_DIFF_CATEGORIES).toContain('bug');
        expect(ALL_DIFF_CATEGORIES).toContain('general');
    });
});
