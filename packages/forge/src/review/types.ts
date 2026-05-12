/**
 * IDiffReviewer — Phase 2a Types
 *
 * Core types for the unified diff review abstraction.
 * Builds on Phase 1 IDiffProvider and existing anchor/editor types.
 */

import type { DiffSource } from '../diff/types';
import type { BaseAnchorData } from '../editor/anchor-types';

// ── Review comment categories ────────────────────────────────

/**
 * Severity levels for review comments.
 */
export type ReviewSeverity = 'error' | 'warning' | 'info' | 'suggestion';

/**
 * Category of a review comment — classifies the nature of the finding.
 */
export type ReviewCategory =
    | 'bug'
    | 'security'
    | 'performance'
    | 'style'
    | 'maintainability'
    | 'correctness'
    | 'documentation'
    | 'testing'
    | 'general';

// ── Line range ───────────────────────────────────────────────

/**
 * A range of lines in a file. Both values are 1-based and inclusive.
 */
export interface LineRange {
    /** Start line (1-based, inclusive). */
    startLine: number;
    /** End line (1-based, inclusive). */
    endLine: number;
}

// ── Review comment ───────────────────────────────────────────

/**
 * Author of a review comment — distinguishes human from AI reviewers.
 */
export interface ReviewAuthor {
    /** Display name. */
    name: string;
    /** Whether this author is an AI reviewer. */
    isAI: boolean;
}

/**
 * A single review comment on a diff.
 *
 * Refactored from `ReviewFinding` — adds content anchor (eager),
 * category enum, line range, author, and timestamp.
 */
export interface ReviewComment {
    /** Unique identifier (UUID). */
    id: string;
    /** File path relative to repository root. */
    filePath: string;
    /** Severity level. */
    severity: ReviewSeverity;
    /** Category of the finding. */
    category: ReviewCategory;
    /** Rule or skill that generated this finding (if AI). */
    rule?: string;
    /** Source rule file path (if applicable). */
    ruleFile?: string;
    /** Description of the issue. */
    description: string;
    /** Suggested fix or improvement. */
    suggestion?: string;
    /** Additional explanation or rationale. */
    explanation?: string;
    /** Code snippet illustrating the issue. */
    codeSnippet?: string;
    /** Line range in the new (right-side) file. */
    lineRange?: LineRange;
    /** Content anchor for robust relocation after edits. Eagerly computed. */
    anchor?: BaseAnchorData;
    /** Author of this comment. */
    author: ReviewAuthor;
    /** ISO 8601 timestamp when created. */
    createdAt: string;
    /** ISO 8601 timestamp when last updated. */
    updatedAt: string;
}

// ── Review result ────────────────────────────────────────────

/**
 * Aggregate statistics for a completed review.
 */
export interface ReviewStats {
    /** Total comment count. */
    totalComments: number;
    /** Count by severity. */
    bySeverity: Record<ReviewSeverity, number>;
    /** Count by category. */
    byCategory: Partial<Record<ReviewCategory, number>>;
    /** Count by rule (for AI reviews). */
    byRule: Record<string, number>;
}

/**
 * Overall assessment of the reviewed diff.
 */
export type ReviewAssessment = 'pass' | 'needs-attention' | 'fail';

/**
 * The result of a completed review.
 */
export interface ReviewResult {
    /** The diff source that was reviewed. */
    source: DiffSource;
    /** All review comments. */
    comments: ReviewComment[];
    /** Aggregate statistics. */
    stats: ReviewStats;
    /** Overall assessment. */
    assessment: ReviewAssessment;
    /** Human-readable summary text. */
    summaryText?: string;
    /** ISO 8601 timestamp when the review started. */
    startedAt: string;
    /** ISO 8601 timestamp when the review completed. */
    completedAt: string;
}

// ── Review options ───────────────────────────────────────────

/**
 * Callback invoked as each comment is produced (streaming).
 */
export type OnReviewComment = (comment: ReviewComment) => void;

/**
 * Options for a review invocation.
 */
export interface ReviewOptions {
    /**
     * Streaming callback — invoked for each comment as it is produced.
     * The final `ReviewResult.comments` array contains the complete set.
     */
    onComment?: OnReviewComment;
    /**
     * Limit review to specific file paths (repo-relative).
     * When omitted, all files in the diff are reviewed.
     */
    filePaths?: string[];
    /**
     * Abort signal for cancellation.
     */
    signal?: AbortSignal;
}

// ── IDiffReviewer interface ──────────────────────────────────

/**
 * Unified interface for reviewing diffs.
 *
 * Implementations include:
 * - `AIReviewer`    — delegates to code-review skill via CopilotSDKService
 * - `HumanReviewer` — wraps existing DiffComment infrastructure
 */
export interface IDiffReviewer {
    /** Human-readable name for this reviewer (e.g. "AI Code Review", "Jane Doe"). */
    readonly name: string;

    /**
     * Review a diff and return the result.
     *
     * @param source  - The diff source to review.
     * @param options - Optional review configuration (streaming callback, file filter, etc.).
     * @returns The complete review result.
     */
    review(source: DiffSource, options?: ReviewOptions): Promise<ReviewResult>;
}

// ── Review session (human reviewer handle) ───────────────────

/**
 * Status of a human review session.
 */
export type ReviewSessionStatus = 'active' | 'completed' | 'cancelled';

/**
 * A mutable handle for human review sessions.
 *
 * Allows adding, updating, and removing comments interactively,
 * then completing or cancelling the session to produce a `ReviewResult`.
 */
export interface ReviewSession {
    /** Unique session identifier. */
    readonly id: string;
    /** The diff source being reviewed. */
    readonly source: DiffSource;
    /** Current session status. */
    readonly status: ReviewSessionStatus;
    /** Current comments in the session. */
    readonly comments: ReadonlyArray<ReviewComment>;

    /** Add a comment to the session. Returns the created comment. */
    addComment(comment: Omit<ReviewComment, 'id' | 'createdAt' | 'updatedAt'>): ReviewComment;
    /** Update an existing comment. Returns the updated comment or undefined if not found. */
    updateComment(id: string, updates: Partial<Pick<ReviewComment, 'description' | 'severity' | 'category' | 'suggestion' | 'explanation'>>): ReviewComment | undefined;
    /** Remove a comment by ID. Returns true if found and removed. */
    removeComment(id: string): boolean;
    /** Complete the session and produce a ReviewResult. */
    complete(summaryText?: string): ReviewResult;
    /** Cancel the session. */
    cancel(): void;
}
