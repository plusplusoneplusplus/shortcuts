/**
 * Tests for comment-constants.ts
 *
 * Validates ALL_COMMENT_CATEGORIES, COMMENT_CATEGORY_REGEX, and
 * the shared resolveCommentCategory helper.
 */

import { describe, it, expect } from 'vitest';
import {
    ALL_COMMENT_CATEGORIES,
    COMMENT_CATEGORY_REGEX,
    resolveCommentCategory,
} from '../../../../src/server/spa/client/comments/comment-constants';

describe('ALL_COMMENT_CATEGORIES', () => {
    it('contains exactly 6 entries', () => {
        expect(ALL_COMMENT_CATEGORIES).toHaveLength(6);
    });

    it('includes all expected categories', () => {
        const expected = ['bug', 'question', 'suggestion', 'praise', 'nitpick', 'general'];
        for (const cat of expected) {
            expect(ALL_COMMENT_CATEGORIES).toContain(cat);
        }
    });
});

describe('COMMENT_CATEGORY_REGEX', () => {
    it('matches a [category] prefix', () => {
        expect('[bug] some text'.match(COMMENT_CATEGORY_REGEX)).not.toBeNull();
    });

    it('is case-insensitive', () => {
        expect('[BUG] text'.match(COMMENT_CATEGORY_REGEX)).not.toBeNull();
    });

    it('does not match when prefix is absent', () => {
        expect('no prefix here'.match(COMMENT_CATEGORY_REGEX)).toBeNull();
    });
});

describe('resolveCommentCategory', () => {
    it('returns the category field when it is a valid category', () => {
        expect(resolveCommentCategory('bug', 'anything')).toBe('bug');
    });

    it('returns "general" when category is undefined and there is no prefix', () => {
        expect(resolveCommentCategory(undefined, 'just a note')).toBe('general');
    });

    it('returns "general" when category is undefined and text is empty', () => {
        expect(resolveCommentCategory(undefined, '')).toBe('general');
    });

    it('parses a [category] prefix from the comment text when category is undefined', () => {
        expect(resolveCommentCategory(undefined, '[question] is this right?')).toBe('question');
    });

    it('is case-insensitive when parsing prefix', () => {
        expect(resolveCommentCategory(undefined, '[SUGGESTION] do this')).toBe('suggestion');
    });

    it('supports every category value as a text prefix', () => {
        for (const cat of ALL_COMMENT_CATEGORIES) {
            expect(resolveCommentCategory(undefined, `[${cat}] text`)).toBe(cat);
        }
    });

    it('prefers the category field over a conflicting text prefix', () => {
        expect(resolveCommentCategory('praise', '[bug] text')).toBe('praise');
    });
});
