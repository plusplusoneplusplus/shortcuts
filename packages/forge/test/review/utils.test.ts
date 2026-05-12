/**
 * Tests for review utility functions.
 *
 * Covers comment creation, stats computation, assessment derivation,
 * result building, merging, and filtering helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createReviewComment,
    computeReviewStats,
    deriveAssessment,
    buildReviewResult,
    mergeReviewResults,
    filterBySeverity,
    filterByCategory,
    filterByFile,
    groupByFile,
} from '../../src/review/utils';
import type {
    ReviewComment,
    ReviewStats,
    ReviewAuthor,
} from '../../src/review/types';
import type { DiffSource } from '../../src/diff/types';

// ── Fixtures ─────────────────────────────────────────────────

const aiAuthor: ReviewAuthor = { name: 'AI', isAI: true };
const humanAuthor: ReviewAuthor = { name: 'Alice', isAI: false };

const commitSource: DiffSource = {
    kind: 'commit',
    repositoryRoot: '/repo',
    commitHash: 'abc123',
};

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
    return {
        id: 'test-id',
        filePath: 'src/index.ts',
        severity: 'warning',
        category: 'bug',
        description: 'Test finding',
        author: aiAuthor,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        ...overrides,
    };
}

describe('review/utils', () => {
    describe('createReviewComment', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('creates a comment with auto-generated id and timestamps', () => {
            const comment = createReviewComment({
                filePath: 'src/app.ts',
                severity: 'error',
                category: 'security',
                description: 'SQL injection',
                author: aiAuthor,
            });

            expect(comment.id).toBeDefined();
            expect(comment.id.length).toBeGreaterThan(0);
            expect(comment.filePath).toBe('src/app.ts');
            expect(comment.severity).toBe('error');
            expect(comment.category).toBe('security');
            expect(comment.description).toBe('SQL injection');
            expect(comment.author).toEqual(aiAuthor);
            expect(comment.createdAt).toBe('2024-06-15T12:00:00.000Z');
            expect(comment.updatedAt).toBe('2024-06-15T12:00:00.000Z');
        });

        it('includes optional fields when provided', () => {
            const comment = createReviewComment({
                filePath: 'src/db.ts',
                severity: 'warning',
                category: 'performance',
                description: 'N+1 query',
                author: aiAuthor,
                rule: 'no-n-plus-one',
                ruleFile: 'rules/perf.md',
                suggestion: 'Use batch loading',
                explanation: 'This causes N+1 queries',
                codeSnippet: 'for (const user of users) { await getOrders(user.id); }',
                lineRange: { startLine: 10, endLine: 12 },
                anchor: {
                    selectedText: 'getOrders',
                    contextBefore: 'for (',
                    contextAfter: ')',
                    originalLine: 11,
                    textHash: 'hash123',
                },
            });

            expect(comment.rule).toBe('no-n-plus-one');
            expect(comment.lineRange).toEqual({ startLine: 10, endLine: 12 });
            expect(comment.anchor?.selectedText).toBe('getOrders');
        });

        it('generates unique IDs for each call', () => {
            const c1 = createReviewComment({
                filePath: 'a.ts',
                severity: 'info',
                category: 'general',
                description: 'First',
                author: aiAuthor,
            });
            const c2 = createReviewComment({
                filePath: 'b.ts',
                severity: 'info',
                category: 'general',
                description: 'Second',
                author: aiAuthor,
            });
            expect(c1.id).not.toBe(c2.id);
        });
    });

    describe('computeReviewStats', () => {
        it('returns zero stats for empty comments', () => {
            const stats = computeReviewStats([]);
            expect(stats.totalComments).toBe(0);
            expect(stats.bySeverity).toEqual({ error: 0, warning: 0, info: 0, suggestion: 0 });
            expect(stats.byCategory).toEqual({});
            expect(stats.byRule).toEqual({});
        });

        it('counts severity correctly', () => {
            const comments = [
                makeComment({ severity: 'error' }),
                makeComment({ severity: 'error' }),
                makeComment({ severity: 'warning' }),
                makeComment({ severity: 'info' }),
                makeComment({ severity: 'suggestion' }),
            ];
            const stats = computeReviewStats(comments);
            expect(stats.totalComments).toBe(5);
            expect(stats.bySeverity.error).toBe(2);
            expect(stats.bySeverity.warning).toBe(1);
            expect(stats.bySeverity.info).toBe(1);
            expect(stats.bySeverity.suggestion).toBe(1);
        });

        it('counts categories correctly', () => {
            const comments = [
                makeComment({ category: 'bug' }),
                makeComment({ category: 'bug' }),
                makeComment({ category: 'style' }),
            ];
            const stats = computeReviewStats(comments);
            expect(stats.byCategory).toEqual({ bug: 2, style: 1 });
        });

        it('counts rules correctly', () => {
            const comments = [
                makeComment({ rule: 'no-unused-vars' }),
                makeComment({ rule: 'no-unused-vars' }),
                makeComment({ rule: 'prefer-const' }),
                makeComment({}), // no rule
            ];
            const stats = computeReviewStats(comments);
            expect(stats.byRule).toEqual({ 'no-unused-vars': 2, 'prefer-const': 1 });
        });
    });

    describe('deriveAssessment', () => {
        it('returns pass when no errors or warnings', () => {
            const stats: ReviewStats = {
                totalComments: 2,
                bySeverity: { error: 0, warning: 0, info: 1, suggestion: 1 },
                byCategory: {},
                byRule: {},
            };
            expect(deriveAssessment(stats)).toBe('pass');
        });

        it('returns pass when no comments', () => {
            const stats: ReviewStats = {
                totalComments: 0,
                bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                byCategory: {},
                byRule: {},
            };
            expect(deriveAssessment(stats)).toBe('pass');
        });

        it('returns needs-attention when warnings present but no errors', () => {
            const stats: ReviewStats = {
                totalComments: 1,
                bySeverity: { error: 0, warning: 1, info: 0, suggestion: 0 },
                byCategory: {},
                byRule: {},
            };
            expect(deriveAssessment(stats)).toBe('needs-attention');
        });

        it('returns fail when errors present', () => {
            const stats: ReviewStats = {
                totalComments: 3,
                bySeverity: { error: 1, warning: 1, info: 1, suggestion: 0 },
                byCategory: {},
                byRule: {},
            };
            expect(deriveAssessment(stats)).toBe('fail');
        });
    });

    describe('buildReviewResult', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-06-15T12:30:00Z'));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('builds a complete result from comments', () => {
            const comments = [
                makeComment({ severity: 'error', category: 'bug' }),
                makeComment({ severity: 'warning', category: 'style' }),
            ];
            const result = buildReviewResult(commitSource, comments, '2024-06-15T12:00:00Z', 'All looks good');

            expect(result.source).toBe(commitSource);
            expect(result.comments).toHaveLength(2);
            expect(result.stats.totalComments).toBe(2);
            expect(result.assessment).toBe('fail'); // has an error
            expect(result.summaryText).toBe('All looks good');
            expect(result.startedAt).toBe('2024-06-15T12:00:00Z');
            expect(result.completedAt).toBe('2024-06-15T12:30:00.000Z');
        });

        it('returns pass assessment for empty comments', () => {
            const result = buildReviewResult(commitSource, [], '2024-06-15T12:00:00Z');
            expect(result.assessment).toBe('pass');
            expect(result.stats.totalComments).toBe(0);
        });
    });

    describe('mergeReviewResults', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-06-15T13:00:00Z'));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('merges multiple results into one', () => {
            const r1 = buildReviewResult(
                commitSource,
                [makeComment({ severity: 'info' })],
                '2024-06-15T12:00:00Z',
            );
            const r2 = buildReviewResult(
                commitSource,
                [makeComment({ severity: 'error' }), makeComment({ severity: 'warning' })],
                '2024-06-15T12:30:00Z',
            );

            const merged = mergeReviewResults(commitSource, [r1, r2], 'Merged summary');
            expect(merged.comments).toHaveLength(3);
            expect(merged.stats.totalComments).toBe(3);
            expect(merged.assessment).toBe('fail'); // has error from r2
            expect(merged.summaryText).toBe('Merged summary');
            expect(merged.startedAt).toBe('2024-06-15T12:00:00Z'); // earliest
        });

        it('handles empty results array', () => {
            const merged = mergeReviewResults(commitSource, []);
            expect(merged.comments).toHaveLength(0);
            expect(merged.assessment).toBe('pass');
        });
    });

    describe('filterBySeverity', () => {
        it('filters to matching severities', () => {
            const comments = [
                makeComment({ severity: 'error' }),
                makeComment({ severity: 'warning' }),
                makeComment({ severity: 'info' }),
                makeComment({ severity: 'suggestion' }),
            ];
            const result = filterBySeverity(comments, ['error', 'warning']);
            expect(result).toHaveLength(2);
            expect(result.every(c => c.severity === 'error' || c.severity === 'warning')).toBe(true);
        });

        it('returns empty for no matches', () => {
            const comments = [makeComment({ severity: 'info' })];
            expect(filterBySeverity(comments, ['error'])).toHaveLength(0);
        });
    });

    describe('filterByCategory', () => {
        it('filters to matching categories', () => {
            const comments = [
                makeComment({ category: 'bug' }),
                makeComment({ category: 'style' }),
                makeComment({ category: 'security' }),
            ];
            const result = filterByCategory(comments, ['bug', 'security']);
            expect(result).toHaveLength(2);
        });
    });

    describe('filterByFile', () => {
        it('filters to matching file paths', () => {
            const comments = [
                makeComment({ filePath: 'src/a.ts' }),
                makeComment({ filePath: 'src/b.ts' }),
                makeComment({ filePath: 'src/c.ts' }),
            ];
            const result = filterByFile(comments, ['src/a.ts', 'src/c.ts']);
            expect(result).toHaveLength(2);
            expect(result.map(c => c.filePath)).toEqual(['src/a.ts', 'src/c.ts']);
        });
    });

    describe('groupByFile', () => {
        it('groups comments by file path', () => {
            const comments = [
                makeComment({ filePath: 'src/a.ts' }),
                makeComment({ filePath: 'src/b.ts' }),
                makeComment({ filePath: 'src/a.ts' }),
            ];
            const groups = groupByFile(comments);
            expect(groups.size).toBe(2);
            expect(groups.get('src/a.ts')).toHaveLength(2);
            expect(groups.get('src/b.ts')).toHaveLength(1);
        });

        it('returns empty map for empty comments', () => {
            const groups = groupByFile([]);
            expect(groups.size).toBe(0);
        });
    });
});
