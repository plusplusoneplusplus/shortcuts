/**
 * Tests for HumanReviewer — Phase 2b
 *
 * Covers DefaultReviewSession lifecycle, HumanReviewer.review() with
 * session handlers, streaming callbacks, and error cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HumanReviewer, DefaultReviewSession } from '../../src/review/human-reviewer';
import type { ReviewComment, ReviewSession, ReviewAuthor } from '../../src/review/types';
import type { DiffSource } from '../../src/diff/types';

const testAuthor: ReviewAuthor = { name: 'Test User', isAI: false };

function makeDiffSource(): DiffSource {
    return { type: 'commit', commitSha: 'abc123', repoPath: '/repo' };
}

describe('DefaultReviewSession', () => {
    let session: DefaultReviewSession;

    beforeEach(() => {
        session = new DefaultReviewSession(makeDiffSource(), testAuthor);
    });

    it('initializes with active status and empty comments', () => {
        expect(session.status).toBe('active');
        expect(session.comments).toHaveLength(0);
        expect(session.id).toBeTruthy();
        expect(session.source.type).toBe('commit');
    });

    describe('addComment', () => {
        it('creates a comment with auto-generated id and timestamps', () => {
            const comment = session.addComment({
                filePath: 'src/foo.ts',
                severity: 'warning',
                category: 'bug',
                description: 'Potential null deref',
                author: testAuthor,
            });

            expect(comment.id).toBeTruthy();
            expect(comment.filePath).toBe('src/foo.ts');
            expect(comment.severity).toBe('warning');
            expect(comment.category).toBe('bug');
            expect(comment.description).toBe('Potential null deref');
            expect(comment.createdAt).toBeTruthy();
            expect(comment.updatedAt).toBe(comment.createdAt);
            expect(session.comments).toHaveLength(1);
        });

        it('invokes onComment callback', () => {
            const onComment = vi.fn();
            const s = new DefaultReviewSession(makeDiffSource(), testAuthor, onComment);

            const comment = s.addComment({
                filePath: 'a.ts',
                severity: 'info',
                category: 'style',
                description: 'Use const',
                author: testAuthor,
            });

            expect(onComment).toHaveBeenCalledOnce();
            expect(onComment).toHaveBeenCalledWith(comment);
        });

        it('throws when session is completed', () => {
            session.complete();
            expect(() =>
                session.addComment({
                    filePath: 'a.ts',
                    severity: 'info',
                    category: 'general',
                    description: 'x',
                    author: testAuthor,
                }),
            ).toThrow('completed');
        });

        it('throws when session is cancelled', () => {
            session.cancel();
            expect(() =>
                session.addComment({
                    filePath: 'a.ts',
                    severity: 'info',
                    category: 'general',
                    description: 'x',
                    author: testAuthor,
                }),
            ).toThrow('cancelled');
        });
    });

    describe('updateComment', () => {
        it('updates fields and bumps updatedAt', async () => {
            const comment = session.addComment({
                filePath: 'b.ts',
                severity: 'error',
                category: 'security',
                description: 'SQL injection',
                author: testAuthor,
            });

            // Small delay to ensure different timestamp
            await new Promise(r => setTimeout(r, 5));

            const updated = session.updateComment(comment.id, {
                severity: 'warning',
                description: 'Parameterized query recommended',
            });

            expect(updated).toBeDefined();
            expect(updated!.severity).toBe('warning');
            expect(updated!.description).toBe('Parameterized query recommended');
            expect(updated!.category).toBe('security'); // unchanged
            expect(updated!.updatedAt >= comment.createdAt).toBe(true);
        });

        it('returns undefined for unknown id', () => {
            expect(session.updateComment('nonexistent', { description: 'x' })).toBeUndefined();
        });

        it('throws when session is not active', () => {
            session.complete();
            expect(() => session.updateComment('x', { description: 'y' })).toThrow('completed');
        });
    });

    describe('removeComment', () => {
        it('removes an existing comment', () => {
            const c = session.addComment({
                filePath: 'c.ts',
                severity: 'info',
                category: 'general',
                description: 'test',
                author: testAuthor,
            });

            expect(session.removeComment(c.id)).toBe(true);
            expect(session.comments).toHaveLength(0);
        });

        it('returns false for unknown id', () => {
            expect(session.removeComment('nope')).toBe(false);
        });

        it('throws when session is not active', () => {
            session.cancel();
            expect(() => session.removeComment('x')).toThrow('cancelled');
        });
    });

    describe('complete', () => {
        it('returns a ReviewResult with stats', () => {
            session.addComment({
                filePath: 'a.ts',
                severity: 'error',
                category: 'bug',
                description: 'Error 1',
                author: testAuthor,
            });
            session.addComment({
                filePath: 'b.ts',
                severity: 'warning',
                category: 'performance',
                description: 'Warn 1',
                author: testAuthor,
            });

            const result = session.complete('Overall review summary');

            expect(result.comments).toHaveLength(2);
            expect(result.stats.totalComments).toBe(2);
            expect(result.stats.bySeverity.error).toBe(1);
            expect(result.stats.bySeverity.warning).toBe(1);
            expect(result.assessment).toBe('fail'); // has errors
            expect(result.summaryText).toBe('Overall review summary');
            expect(result.source.type).toBe('commit');
            expect(session.status).toBe('completed');
        });

        it('returns pass assessment for no comments', () => {
            const result = session.complete();
            expect(result.assessment).toBe('pass');
            expect(result.comments).toHaveLength(0);
        });
    });

    describe('cancel', () => {
        it('sets status to cancelled', () => {
            session.cancel();
            expect(session.status).toBe('cancelled');
        });

        it('throws when called twice', () => {
            session.cancel();
            expect(() => session.cancel()).toThrow('cancelled');
        });
    });
});

describe('HumanReviewer', () => {
    let reviewer: HumanReviewer;

    beforeEach(() => {
        reviewer = new HumanReviewer({ author: testAuthor });
    });

    it('exposes the author name', () => {
        expect(reviewer.name).toBe('Test User');
    });

    describe('constructor validation', () => {
        it('rejects empty author name', () => {
            expect(() => new HumanReviewer({ author: { name: '', isAI: false } })).toThrow('non-empty author name');
        });

        it('rejects AI author', () => {
            expect(() => new HumanReviewer({ author: { name: 'Bot', isAI: true } })).toThrow('isAI = false');
        });
    });

    describe('review()', () => {
        it('auto-completes when handler does not call complete/cancel', async () => {
            const result = await reviewer.review(makeDiffSource(), {
                sessionHandler: async (session) => {
                    session.addComment({
                        filePath: 'x.ts',
                        severity: 'info',
                        category: 'style',
                        description: 'Minor style issue',
                        author: testAuthor,
                    });
                    // intentionally not calling complete()
                },
            });

            expect(result.comments).toHaveLength(1);
            expect(result.assessment).toBe('pass'); // info only
        });

        it('returns handler-completed result', async () => {
            const result = await reviewer.review(makeDiffSource(), {
                sessionHandler: async (session) => {
                    session.addComment({
                        filePath: 'y.ts',
                        severity: 'error',
                        category: 'correctness',
                        description: 'Off by one',
                        author: testAuthor,
                    });
                    session.complete('Needs fixes');
                },
            });

            expect(result.comments).toHaveLength(1);
            expect(result.assessment).toBe('fail');
        });

        it('returns empty result for cancelled session', async () => {
            const result = await reviewer.review(makeDiffSource(), {
                sessionHandler: async (session) => {
                    session.addComment({
                        filePath: 'z.ts',
                        severity: 'error',
                        category: 'bug',
                        description: 'some bug',
                        author: testAuthor,
                    });
                    session.cancel();
                },
            });

            expect(result.comments).toHaveLength(0);
            expect(result.summaryText).toBe('Review cancelled.');
        });

        it('works with no options', async () => {
            const result = await reviewer.review(makeDiffSource());
            expect(result.comments).toHaveLength(0);
            expect(result.assessment).toBe('pass');
        });

        it('streams comments via onComment callback', async () => {
            const streamed: ReviewComment[] = [];

            await reviewer.review(makeDiffSource(), {
                onComment: (c) => streamed.push(c),
                sessionHandler: async (session) => {
                    session.addComment({
                        filePath: 'a.ts',
                        severity: 'warning',
                        category: 'maintainability',
                        description: 'Complex function',
                        author: testAuthor,
                    });
                    session.addComment({
                        filePath: 'b.ts',
                        severity: 'info',
                        category: 'documentation',
                        description: 'Missing JSDoc',
                        author: testAuthor,
                    });
                    session.complete();
                },
            });

            expect(streamed).toHaveLength(2);
            expect(streamed[0].filePath).toBe('a.ts');
            expect(streamed[1].filePath).toBe('b.ts');
        });
    });

    describe('createSession()', () => {
        it('creates a standalone session', () => {
            const session = reviewer.createSession(makeDiffSource());
            expect(session.status).toBe('active');
            expect(session.comments).toHaveLength(0);
        });

        it('streams via provided callback', () => {
            const streamed: ReviewComment[] = [];
            const session = reviewer.createSession(makeDiffSource(), (c) => streamed.push(c));

            session.addComment({
                filePath: 'q.ts',
                severity: 'suggestion',
                category: 'testing',
                description: 'Add unit test',
                author: testAuthor,
            });

            expect(streamed).toHaveLength(1);
        });
    });
});
