/**
 * Tests for category constants and getCommentCategory from task-comments-types.
 */

import { describe, it, expect } from 'vitest';
import {
    CATEGORY_INFO,
    ALL_CATEGORIES,
    getCommentCategory,
} from '../../../../src/server/spa/client/task-comments-types';
import type { TaskComment } from '../../../../src/server/spa/client/task-comments-types';

function makeComment(overrides: Partial<TaskComment> = {}): TaskComment {
    return {
        id: 'c1',
        taskId: 't1',
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
        selectedText: 'a',
        comment: 'test',
        status: 'open',
        createdAt: '',
        updatedAt: '',
        ...overrides,
    };
}

describe('CATEGORY_INFO', () => {
    it('has all 6 categories', () => {
        expect(Object.keys(CATEGORY_INFO)).toHaveLength(6);
    });

    it('each category has label and icon', () => {
        for (const cat of ALL_CATEGORIES) {
            expect(CATEGORY_INFO[cat].label).toBeTruthy();
            expect(CATEGORY_INFO[cat].icon).toBeTruthy();
        }
    });
});

describe('ALL_CATEGORIES', () => {
    it('contains all 6 category values', () => {
        expect(ALL_CATEGORIES).toEqual(['bug', 'question', 'suggestion', 'praise', 'nitpick', 'general']);
    });
});

describe('getCommentCategory', () => {
    it('returns explicit category field', () => {
        expect(getCommentCategory(makeComment({ category: 'bug' }))).toBe('bug');
        expect(getCommentCategory(makeComment({ category: 'question' }))).toBe('question');
        expect(getCommentCategory(makeComment({ category: 'suggestion' }))).toBe('suggestion');
    });

    it('falls back to text prefix', () => {
        expect(getCommentCategory(makeComment({ comment: '[bug] something' }))).toBe('bug');
        expect(getCommentCategory(makeComment({ comment: '[Question] why?' }))).toBe('question');
    });

    it('defaults to general when no category', () => {
        expect(getCommentCategory(makeComment())).toBe('general');
    });

    it('prefers explicit category over text prefix', () => {
        expect(getCommentCategory(makeComment({ category: 'praise', comment: '[bug] actually a bug' }))).toBe('praise');
    });
});
