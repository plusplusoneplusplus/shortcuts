/**
 * Tests for review module types.
 *
 * Verifies type-level contracts, discriminated unions, and interface shapes.
 */

import { describe, it, expect } from 'vitest';
import type {
    ReviewSeverity,
    ReviewCategory,
    LineRange,
    ReviewAuthor,
    ReviewComment,
    ReviewStats,
    ReviewAssessment,
    ReviewResult,
    OnReviewComment,
    ReviewOptions,
    IDiffReviewer,
    ReviewSessionStatus,
    ReviewSession,
} from '../../src/review/types';
import type { DiffSource } from '../../src/diff/types';

describe('review/types', () => {
    describe('ReviewSeverity', () => {
        it('accepts all four severity levels', () => {
            const severities: ReviewSeverity[] = ['error', 'warning', 'info', 'suggestion'];
            expect(severities).toHaveLength(4);
        });
    });

    describe('ReviewCategory', () => {
        it('accepts all nine categories', () => {
            const categories: ReviewCategory[] = [
                'bug', 'security', 'performance', 'style',
                'maintainability', 'correctness', 'documentation',
                'testing', 'general',
            ];
            expect(categories).toHaveLength(9);
        });
    });

    describe('LineRange', () => {
        it('can represent a single line', () => {
            const range: LineRange = { startLine: 5, endLine: 5 };
            expect(range.startLine).toBe(range.endLine);
        });

        it('can represent a multi-line range', () => {
            const range: LineRange = { startLine: 10, endLine: 20 };
            expect(range.endLine).toBeGreaterThan(range.startLine);
        });
    });

    describe('ReviewAuthor', () => {
        it('can represent a human author', () => {
            const author: ReviewAuthor = { name: 'Alice', isAI: false };
            expect(author.isAI).toBe(false);
        });

        it('can represent an AI author', () => {
            const author: ReviewAuthor = { name: 'AI Code Review', isAI: true };
            expect(author.isAI).toBe(true);
        });
    });

    describe('ReviewComment', () => {
        it('can be constructed with required fields', () => {
            const comment: ReviewComment = {
                id: 'test-id',
                filePath: 'src/index.ts',
                severity: 'warning',
                category: 'bug',
                description: 'Potential null dereference',
                author: { name: 'AI', isAI: true },
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
            };
            expect(comment.id).toBe('test-id');
            expect(comment.severity).toBe('warning');
            expect(comment.category).toBe('bug');
        });

        it('can include optional fields', () => {
            const comment: ReviewComment = {
                id: 'test-id',
                filePath: 'src/utils.ts',
                severity: 'error',
                category: 'security',
                description: 'SQL injection vulnerability',
                suggestion: 'Use parameterized queries',
                explanation: 'User input is directly interpolated into SQL',
                codeSnippet: 'db.query(`SELECT * FROM users WHERE id = ${id}`)',
                rule: 'no-sql-injection',
                ruleFile: '.github/cr-rules/security.md',
                lineRange: { startLine: 42, endLine: 42 },
                anchor: {
                    selectedText: 'db.query',
                    contextBefore: 'function getUser(id) {\n',
                    contextAfter: '\n}',
                    originalLine: 42,
                    textHash: 'abc123',
                },
                author: { name: 'AI', isAI: true },
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
            };
            expect(comment.suggestion).toBe('Use parameterized queries');
            expect(comment.lineRange?.startLine).toBe(42);
            expect(comment.anchor?.selectedText).toBe('db.query');
        });
    });

    describe('ReviewStats', () => {
        it('has required severity breakdown', () => {
            const stats: ReviewStats = {
                totalComments: 5,
                bySeverity: { error: 1, warning: 2, info: 1, suggestion: 1 },
                byCategory: { bug: 2, style: 3 },
                byRule: { 'no-unused-vars': 3, 'prefer-const': 2 },
            };
            expect(stats.totalComments).toBe(5);
            expect(stats.bySeverity.error).toBe(1);
        });
    });

    describe('ReviewAssessment', () => {
        it('accepts all three values', () => {
            const assessments: ReviewAssessment[] = ['pass', 'needs-attention', 'fail'];
            expect(assessments).toHaveLength(3);
        });
    });

    describe('ReviewResult', () => {
        it('can be constructed with all required fields', () => {
            const source: DiffSource = {
                kind: 'commit',
                repositoryRoot: '/repo',
                commitHash: 'abc123',
            };
            const result: ReviewResult = {
                source,
                comments: [],
                stats: {
                    totalComments: 0,
                    bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                    byCategory: {},
                    byRule: {},
                },
                assessment: 'pass',
                startedAt: '2024-01-01T00:00:00Z',
                completedAt: '2024-01-01T00:00:01Z',
            };
            expect(result.assessment).toBe('pass');
            expect(result.comments).toHaveLength(0);
        });
    });

    describe('ReviewOptions', () => {
        it('allows streaming callback', () => {
            const comments: ReviewComment[] = [];
            const onComment: OnReviewComment = (c) => comments.push(c);
            const options: ReviewOptions = { onComment };
            expect(options.onComment).toBeDefined();
        });

        it('allows file path filter', () => {
            const options: ReviewOptions = { filePaths: ['src/a.ts', 'src/b.ts'] };
            expect(options.filePaths).toHaveLength(2);
        });

        it('allows abort signal', () => {
            const controller = new AbortController();
            const options: ReviewOptions = { signal: controller.signal };
            expect(options.signal?.aborted).toBe(false);
        });
    });

    describe('IDiffReviewer', () => {
        it('can be implemented as a mock', async () => {
            const source: DiffSource = {
                kind: 'working-tree',
                repositoryRoot: '/repo',
                scope: 'all',
            };
            const mockReviewer: IDiffReviewer = {
                name: 'Mock Reviewer',
                review: async (_source, _options) => ({
                    source: _source,
                    comments: [],
                    stats: {
                        totalComments: 0,
                        bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                        byCategory: {},
                        byRule: {},
                    },
                    assessment: 'pass',
                    startedAt: '2024-01-01T00:00:00Z',
                    completedAt: '2024-01-01T00:00:01Z',
                }),
            };
            const result = await mockReviewer.review(source);
            expect(result.assessment).toBe('pass');
            expect(mockReviewer.name).toBe('Mock Reviewer');
        });
    });

    describe('ReviewSessionStatus', () => {
        it('accepts all three statuses', () => {
            const statuses: ReviewSessionStatus[] = ['active', 'completed', 'cancelled'];
            expect(statuses).toHaveLength(3);
        });
    });

    describe('ReviewSession', () => {
        it('interface shape can be implemented as a mock', () => {
            const source: DiffSource = {
                kind: 'range',
                repositoryRoot: '/repo',
                baseRef: 'origin/main',
                headRef: 'feature-branch',
            };
            const comments: ReviewComment[] = [];
            const mockSession: ReviewSession = {
                id: 'session-1',
                source,
                status: 'active',
                comments,
                addComment: (input) => {
                    const comment: ReviewComment = {
                        ...input,
                        id: 'generated-id',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    };
                    comments.push(comment);
                    return comment;
                },
                updateComment: (id, updates) => {
                    const c = comments.find(c => c.id === id);
                    if (!c) return undefined;
                    Object.assign(c, updates, { updatedAt: new Date().toISOString() });
                    return c;
                },
                removeComment: (id) => {
                    const idx = comments.findIndex(c => c.id === id);
                    if (idx === -1) return false;
                    comments.splice(idx, 1);
                    return true;
                },
                complete: (summaryText) => ({
                    source,
                    comments: [...comments],
                    stats: {
                        totalComments: comments.length,
                        bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                        byCategory: {},
                        byRule: {},
                    },
                    assessment: 'pass',
                    summaryText,
                    startedAt: '2024-01-01T00:00:00Z',
                    completedAt: new Date().toISOString(),
                }),
                cancel: () => { /* noop */ },
            };
            expect(mockSession.status).toBe('active');
            expect(mockSession.id).toBe('session-1');
        });
    });
});
