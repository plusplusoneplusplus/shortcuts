import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    filterCommentsByStatus,
    sortCommentsByLine,
    sortCommentsByColumnDescending,
    groupCommentsByLine,
    groupCommentsByAllCoveredLines,
    getCommentsForLine,
    blockHasComments,
    countCommentsByStatus,
    findCommentById,
    updateCommentStatus,
    updateCommentText,
    deleteComment,
    resolveAllComments,
    getSelectionCoverageForLine
} from '../../../src/editor/rendering/comment-state';
import { MarkdownComment, CommentSelection, CommentStatus } from '../../../src/editor/types';

function makeComment(overrides: Partial<MarkdownComment> = {}): MarkdownComment {
    return {
        id: 'c1',
        filePath: 'test.md',
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'test',
        comment: 'comment text',
        status: 'open',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        ...overrides
    };
}

describe('filterCommentsByStatus', () => {
    it('returns all comments when showResolved is true', () => {
        const comments = [
            makeComment({ id: 'c1', status: 'open' }),
            makeComment({ id: 'c2', status: 'resolved' })
        ];
        expect(filterCommentsByStatus(comments, true)).toHaveLength(2);
    });

    it('excludes resolved comments when showResolved is false', () => {
        const comments = [
            makeComment({ id: 'c1', status: 'open' }),
            makeComment({ id: 'c2', status: 'resolved' })
        ];
        const result = filterCommentsByStatus(comments, false);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('c1');
    });

    it('returns empty array for empty input', () => {
        expect(filterCommentsByStatus([], false)).toHaveLength(0);
    });
});

describe('sortCommentsByLine', () => {
    it('sorts by start line ascending', () => {
        const comments = [
            makeComment({ id: 'c1', selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 } }),
            makeComment({ id: 'c2', selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 } })
        ];
        const sorted = sortCommentsByLine(comments);
        expect(sorted[0].id).toBe('c2');
        expect(sorted[1].id).toBe('c1');
    });

    it('sorts by start column when lines are equal', () => {
        const comments = [
            makeComment({ id: 'c1', selection: { startLine: 1, startColumn: 5, endLine: 1, endColumn: 10 } }),
            makeComment({ id: 'c2', selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 } })
        ];
        const sorted = sortCommentsByLine(comments);
        expect(sorted[0].id).toBe('c2');
    });

    it('does not mutate original array', () => {
        const comments = [
            makeComment({ id: 'c1', selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 } }),
            makeComment({ id: 'c2', selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 } })
        ];
        sortCommentsByLine(comments);
        expect(comments[0].id).toBe('c1');
    });
});

describe('sortCommentsByColumnDescending', () => {
    it('sorts by start column descending', () => {
        const comments = [
            makeComment({ id: 'c1', selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 } }),
            makeComment({ id: 'c2', selection: { startLine: 1, startColumn: 10, endLine: 1, endColumn: 15 } })
        ];
        const sorted = sortCommentsByColumnDescending(comments);
        expect(sorted[0].id).toBe('c2');
    });
});

describe('groupCommentsByLine', () => {
    it('groups comments by start line', () => {
        const comments = [
            makeComment({ id: 'c1', selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 } }),
            makeComment({ id: 'c2', selection: { startLine: 1, startColumn: 6, endLine: 1, endColumn: 10 } }),
            makeComment({ id: 'c3', selection: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 } })
        ];
        const map = groupCommentsByLine(comments);
        expect(map.get(1)).toHaveLength(2);
        expect(map.get(3)).toHaveLength(1);
        expect(map.has(2)).toBe(false);
    });
});

describe('groupCommentsByAllCoveredLines', () => {
    it('includes multi-line comments on every covered line', () => {
        const comments = [
            makeComment({ id: 'c1', selection: { startLine: 2, startColumn: 1, endLine: 4, endColumn: 10 } })
        ];
        const map = groupCommentsByAllCoveredLines(comments);
        expect(map.get(2)).toHaveLength(1);
        expect(map.get(3)).toHaveLength(1);
        expect(map.get(4)).toHaveLength(1);
        expect(map.has(1)).toBe(false);
        expect(map.has(5)).toBe(false);
    });

    it('handles single-line comments', () => {
        const comments = [
            makeComment({ id: 'c1', selection: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 10 } })
        ];
        const map = groupCommentsByAllCoveredLines(comments);
        expect(map.get(3)).toHaveLength(1);
        expect(map.size).toBe(1);
    });
});

describe('getCommentsForLine', () => {
    it('returns comments for the line filtered by status', () => {
        const map = new Map<number, MarkdownComment[]>();
        map.set(1, [
            makeComment({ id: 'c1', status: 'open' }),
            makeComment({ id: 'c2', status: 'resolved' })
        ]);
        expect(getCommentsForLine(1, map, false)).toHaveLength(1);
        expect(getCommentsForLine(1, map, true)).toHaveLength(2);
    });

    it('returns empty array for line with no comments', () => {
        const map = new Map<number, MarkdownComment[]>();
        expect(getCommentsForLine(5, map, true)).toHaveLength(0);
    });
});

describe('blockHasComments', () => {
    it('returns true when block contains comments', () => {
        const map = new Map<number, MarkdownComment[]>();
        map.set(3, [makeComment({ id: 'c1' })]);
        expect(blockHasComments(1, 5, map, true)).toBe(true);
    });

    it('returns false for empty block', () => {
        const map = new Map<number, MarkdownComment[]>();
        expect(blockHasComments(1, 5, map, true)).toBe(false);
    });

    it('respects showResolved=false', () => {
        const map = new Map<number, MarkdownComment[]>();
        map.set(3, [makeComment({ id: 'c1', status: 'resolved' })]);
        expect(blockHasComments(1, 5, map, false)).toBe(false);
    });
});

describe('countCommentsByStatus', () => {
    it('counts each status correctly', () => {
        const comments = [
            makeComment({ id: 'c1', status: 'open' }),
            makeComment({ id: 'c2', status: 'resolved' }),
            makeComment({ id: 'c3', status: 'pending' }),
            makeComment({ id: 'c4', status: 'open' })
        ];
        const counts = countCommentsByStatus(comments);
        expect(counts).toEqual({ open: 2, resolved: 1, pending: 1 });
    });

    it('returns zeros for empty array', () => {
        expect(countCommentsByStatus([])).toEqual({ open: 0, resolved: 0, pending: 0 });
    });
});

describe('findCommentById', () => {
    it('finds existing comment', () => {
        const comments = [makeComment({ id: 'c1' }), makeComment({ id: 'c2' })];
        expect(findCommentById(comments, 'c2')?.id).toBe('c2');
    });

    it('returns undefined for missing comment', () => {
        expect(findCommentById([], 'missing')).toBeUndefined();
    });
});

describe('updateCommentStatus', () => {
    let dateSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        dateSpy = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2024-06-01T00:00:00.000Z');
    });
    afterEach(() => {
        dateSpy.mockRestore();
    });

    it('updates status of the target comment', () => {
        const comments = [makeComment({ id: 'c1', status: 'open' })];
        const updated = updateCommentStatus(comments, 'c1', 'resolved');
        expect(updated[0].status).toBe('resolved');
        expect(updated[0].updatedAt).toBe('2024-06-01T00:00:00.000Z');
    });

    it('does not modify other comments', () => {
        const comments = [
            makeComment({ id: 'c1', status: 'open' }),
            makeComment({ id: 'c2', status: 'open' })
        ];
        const updated = updateCommentStatus(comments, 'c1', 'resolved');
        expect(updated[1].status).toBe('open');
    });
});

describe('updateCommentText', () => {
    it('updates the comment text', () => {
        const comments = [makeComment({ id: 'c1', comment: 'old' })];
        const updated = updateCommentText(comments, 'c1', 'new text');
        expect(updated[0].comment).toBe('new text');
    });
});

describe('deleteComment', () => {
    it('removes the comment by id', () => {
        const comments = [makeComment({ id: 'c1' }), makeComment({ id: 'c2' })];
        const result = deleteComment(comments, 'c1');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('c2');
    });

    it('returns same array if id not found', () => {
        const comments = [makeComment({ id: 'c1' })];
        expect(deleteComment(comments, 'missing')).toHaveLength(1);
    });
});

describe('resolveAllComments', () => {
    it('resolves all open comments', () => {
        const comments = [
            makeComment({ id: 'c1', status: 'open' }),
            makeComment({ id: 'c2', status: 'resolved' }),
            makeComment({ id: 'c3', status: 'open' })
        ];
        const result = resolveAllComments(comments);
        expect(result[0].status).toBe('resolved');
        expect(result[1].status).toBe('resolved');
        expect(result[2].status).toBe('resolved');
    });

    it('does not modify already resolved comments', () => {
        const original = makeComment({ id: 'c1', status: 'resolved', updatedAt: '2024-01-01T00:00:00.000Z' });
        const result = resolveAllComments([original]);
        expect(result[0].updatedAt).toBe('2024-01-01T00:00:00.000Z');
    });
});

describe('getSelectionCoverageForLine', () => {
    it('returns not covered for lines outside selection', () => {
        const selection: CommentSelection = { startLine: 3, startColumn: 5, endLine: 5, endColumn: 10 };
        expect(getSelectionCoverageForLine(selection, 1)).toEqual({ isCovered: false, startColumn: 0, endColumn: 0 });
        expect(getSelectionCoverageForLine(selection, 6)).toEqual({ isCovered: false, startColumn: 0, endColumn: 0 });
    });

    it('returns exact columns for single-line selection', () => {
        const selection: CommentSelection = { startLine: 3, startColumn: 5, endLine: 3, endColumn: 10 };
        expect(getSelectionCoverageForLine(selection, 3)).toEqual({ isCovered: true, startColumn: 5, endColumn: 10 });
    });

    it('returns start column for first line of multi-line', () => {
        const selection: CommentSelection = { startLine: 3, startColumn: 5, endLine: 5, endColumn: 10 };
        const result = getSelectionCoverageForLine(selection, 3);
        expect(result.isCovered).toBe(true);
        expect(result.startColumn).toBe(5);
        expect(result.endColumn).toBe(Infinity);
    });

    it('returns end column for last line of multi-line', () => {
        const selection: CommentSelection = { startLine: 3, startColumn: 5, endLine: 5, endColumn: 10 };
        const result = getSelectionCoverageForLine(selection, 5);
        expect(result.isCovered).toBe(true);
        expect(result.startColumn).toBe(1);
        expect(result.endColumn).toBe(10);
    });

    it('returns full line for middle lines', () => {
        const selection: CommentSelection = { startLine: 3, startColumn: 5, endLine: 5, endColumn: 10 };
        const result = getSelectionCoverageForLine(selection, 4);
        expect(result.isCovered).toBe(true);
        expect(result.startColumn).toBe(1);
        expect(result.endColumn).toBe(Infinity);
    });
});
