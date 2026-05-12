/**
 * HumanReviewer — Phase 2b
 *
 * Implements `IDiffReviewer` for human-driven reviews.
 * Uses `ReviewSession` as an interactive handle where comments
 * can be added/updated/removed before completing the review.
 */

import { randomUUID } from 'node:crypto';
import type { DiffSource } from '../diff/types';
import type {
    IDiffReviewer,
    ReviewComment,
    ReviewOptions,
    ReviewResult,
    ReviewSession,
    ReviewSessionStatus,
    ReviewAuthor,
} from './types';
import { createReviewComment, buildReviewResult, type CreateReviewCommentInput } from './utils';

/**
 * Configuration for the HumanReviewer.
 */
export interface HumanReviewerConfig {
    /** The human author identity. */
    author: ReviewAuthor;
}

/**
 * A concrete `ReviewSession` implementation backed by a mutable comment list.
 */
export class DefaultReviewSession implements ReviewSession {
    readonly id: string;
    readonly source: DiffSource;
    private _status: ReviewSessionStatus = 'active';
    private _comments: ReviewComment[] = [];
    private readonly _startedAt: string;
    private readonly _author: ReviewAuthor;
    private readonly _onComment?: (comment: ReviewComment) => void;

    constructor(
        source: DiffSource,
        author: ReviewAuthor,
        onComment?: (comment: ReviewComment) => void,
    ) {
        this.id = randomUUID();
        this.source = source;
        this._author = author;
        this._startedAt = new Date().toISOString();
        this._onComment = onComment;
    }

    get status(): ReviewSessionStatus {
        return this._status;
    }

    get comments(): ReadonlyArray<ReviewComment> {
        return this._comments;
    }

    addComment(input: Omit<ReviewComment, 'id' | 'createdAt' | 'updatedAt'>): ReviewComment {
        this._assertActive();
        const comment = createReviewComment({
            ...input,
            author: input.author ?? this._author,
        } as CreateReviewCommentInput);
        this._comments.push(comment);
        this._onComment?.(comment);
        return comment;
    }

    updateComment(
        id: string,
        updates: Partial<Pick<ReviewComment, 'description' | 'severity' | 'category' | 'suggestion' | 'explanation'>>,
    ): ReviewComment | undefined {
        this._assertActive();
        const idx = this._comments.findIndex(c => c.id === id);
        if (idx === -1) return undefined;

        const existing = this._comments[idx];
        const updated: ReviewComment = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString(),
        };
        this._comments[idx] = updated;
        return updated;
    }

    removeComment(id: string): boolean {
        this._assertActive();
        const idx = this._comments.findIndex(c => c.id === id);
        if (idx === -1) return false;
        this._comments.splice(idx, 1);
        return true;
    }

    complete(summaryText?: string): ReviewResult {
        this._assertActive();
        this._status = 'completed';
        return buildReviewResult(this.source, [...this._comments], this._startedAt, summaryText);
    }

    cancel(): void {
        this._assertActive();
        this._status = 'cancelled';
    }

    private _assertActive(): void {
        if (this._status !== 'active') {
            throw new Error(`Review session is ${this._status} — cannot modify`);
        }
    }
}

/**
 * Human-driven diff reviewer.
 *
 * The `review()` method creates a `ReviewSession`, waits for
 * a consumer-supplied `sessionHandler` callback to populate it
 * with comments, and returns the final `ReviewResult`.
 *
 * Usage:
 * ```ts
 * const reviewer = new HumanReviewer({
 *   author: { name: 'Jane', isAI: false },
 * });
 *
 * const result = await reviewer.review(diffSource, {
 *   onComment: (c) => console.log('New comment:', c.description),
 *   sessionHandler: async (session) => {
 *     session.addComment({ filePath: 'foo.ts', ... });
 *     session.complete('Looks good overall.');
 *   },
 * });
 * ```
 */
export class HumanReviewer implements IDiffReviewer {
    readonly name: string;
    private readonly _author: ReviewAuthor;

    constructor(config: HumanReviewerConfig) {
        if (!config.author.name) {
            throw new Error('HumanReviewer requires a non-empty author name');
        }
        if (config.author.isAI) {
            throw new Error('HumanReviewer author must have isAI = false');
        }
        this._author = config.author;
        this.name = config.author.name;
    }

    /**
     * Review a diff by delegating to a session handler.
     *
     * The session handler receives a `ReviewSession` and should
     * add comments then call `session.complete()` or `session.cancel()`.
     *
     * If the handler doesn't complete/cancel the session, it is
     * auto-completed after the handler resolves.
     */
    async review(
        source: DiffSource,
        options?: HumanReviewOptions,
    ): Promise<ReviewResult> {
        const session = new DefaultReviewSession(source, this._author, options?.onComment);

        if (options?.sessionHandler) {
            await options.sessionHandler(session);
        }

        // Auto-complete if the handler didn't complete or cancel
        if (session.status === 'active') {
            return session.complete();
        }

        if (session.status === 'cancelled') {
            // Return an empty result for cancelled sessions
            return buildReviewResult(source, [], new Date().toISOString(), 'Review cancelled.');
        }

        // Already completed by the handler — build from session comments
        return buildReviewResult(source, [...session.comments], new Date().toISOString());
    }

    /**
     * Create a standalone review session (for interactive/long-lived use).
     */
    createSession(source: DiffSource, onComment?: (comment: ReviewComment) => void): DefaultReviewSession {
        return new DefaultReviewSession(source, this._author, onComment);
    }
}

/**
 * Extended review options for HumanReviewer.
 */
export interface HumanReviewOptions extends ReviewOptions {
    /**
     * Callback that receives a `ReviewSession` for interactive comment management.
     * Must call `session.complete()` or `session.cancel()` when done, otherwise
     * the session is auto-completed.
     */
    sessionHandler?: (session: ReviewSession) => Promise<void>;
}
