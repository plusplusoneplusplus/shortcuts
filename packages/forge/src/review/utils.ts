/**
 * Review Utilities
 *
 * Helper functions for creating, computing, and manipulating
 * review comments and results.
 */

import { randomUUID } from 'node:crypto';
import type {
    ReviewComment,
    ReviewStats,
    ReviewSeverity,
    ReviewCategory,
    ReviewAssessment,
    ReviewResult,
    ReviewAuthor,
    LineRange,
} from './types';
import type { DiffSource } from '../diff/types';
import type { BaseAnchorData } from '../editor/anchor-types';

// ── Comment creation ─────────────────────────────────────────

/**
 * Fields required to create a new ReviewComment.
 * `id`, `createdAt`, and `updatedAt` are auto-generated.
 */
export interface CreateReviewCommentInput {
    filePath: string;
    severity: ReviewSeverity;
    category: ReviewCategory;
    description: string;
    author: ReviewAuthor;
    rule?: string;
    ruleFile?: string;
    suggestion?: string;
    explanation?: string;
    codeSnippet?: string;
    lineRange?: LineRange;
    anchor?: BaseAnchorData;
}

/**
 * Create a new `ReviewComment` with auto-generated id and timestamps.
 */
export function createReviewComment(input: CreateReviewCommentInput): ReviewComment {
    const now = new Date().toISOString();
    return {
        id: randomUUID(),
        filePath: input.filePath,
        severity: input.severity,
        category: input.category,
        description: input.description,
        author: input.author,
        rule: input.rule,
        ruleFile: input.ruleFile,
        suggestion: input.suggestion,
        explanation: input.explanation,
        codeSnippet: input.codeSnippet,
        lineRange: input.lineRange,
        anchor: input.anchor,
        createdAt: now,
        updatedAt: now,
    };
}

// ── Stats computation ────────────────────────────────────────

const SEVERITY_KEYS: readonly ReviewSeverity[] = ['error', 'warning', 'info', 'suggestion'];

/**
 * Compute aggregate `ReviewStats` from a list of comments.
 */
export function computeReviewStats(comments: readonly ReviewComment[]): ReviewStats {
    const bySeverity: Record<ReviewSeverity, number> = { error: 0, warning: 0, info: 0, suggestion: 0 };
    const byCategory: Partial<Record<ReviewCategory, number>> = {};
    const byRule: Record<string, number> = {};

    for (const c of comments) {
        bySeverity[c.severity]++;
        byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
        if (c.rule) {
            byRule[c.rule] = (byRule[c.rule] ?? 0) + 1;
        }
    }

    return {
        totalComments: comments.length,
        bySeverity,
        byCategory,
        byRule,
    };
}

// ── Assessment ───────────────────────────────────────────────

/**
 * Derive the overall assessment from review stats.
 *
 * - `fail`            — any errors
 * - `needs-attention`  — any warnings (no errors)
 * - `pass`            — only info/suggestion or no comments
 */
export function deriveAssessment(stats: ReviewStats): ReviewAssessment {
    if (stats.bySeverity.error > 0) return 'fail';
    if (stats.bySeverity.warning > 0) return 'needs-attention';
    return 'pass';
}

// ── Result builder ───────────────────────────────────────────

/**
 * Build a complete `ReviewResult` from comments and metadata.
 */
export function buildReviewResult(
    source: DiffSource,
    comments: ReviewComment[],
    startedAt: string,
    summaryText?: string,
): ReviewResult {
    const stats = computeReviewStats(comments);
    return {
        source,
        comments,
        stats,
        assessment: deriveAssessment(stats),
        summaryText,
        startedAt,
        completedAt: new Date().toISOString(),
    };
}

/**
 * Merge multiple review results into one.
 * Useful for combining AI and human review results.
 */
export function mergeReviewResults(
    source: DiffSource,
    results: readonly ReviewResult[],
    summaryText?: string,
): ReviewResult {
    const allComments = results.flatMap(r => r.comments);
    const earliest = results.reduce(
        (min, r) => (r.startedAt < min ? r.startedAt : min),
        results[0]?.startedAt ?? new Date().toISOString(),
    );
    return buildReviewResult(source, allComments, earliest, summaryText);
}

// ── Filtering helpers ────────────────────────────────────────

/**
 * Filter comments by severity.
 */
export function filterBySeverity(
    comments: readonly ReviewComment[],
    severities: readonly ReviewSeverity[],
): ReviewComment[] {
    const set = new Set(severities);
    return comments.filter(c => set.has(c.severity));
}

/**
 * Filter comments by category.
 */
export function filterByCategory(
    comments: readonly ReviewComment[],
    categories: readonly ReviewCategory[],
): ReviewComment[] {
    const set = new Set(categories);
    return comments.filter(c => set.has(c.category));
}

/**
 * Filter comments by file path.
 */
export function filterByFile(
    comments: readonly ReviewComment[],
    filePaths: readonly string[],
): ReviewComment[] {
    const set = new Set(filePaths);
    return comments.filter(c => set.has(c.filePath));
}

/**
 * Group comments by file path.
 */
export function groupByFile(
    comments: readonly ReviewComment[],
): Map<string, ReviewComment[]> {
    const map = new Map<string, ReviewComment[]>();
    for (const c of comments) {
        let group = map.get(c.filePath);
        if (!group) {
            group = [];
            map.set(c.filePath, group);
        }
        group.push(c);
    }
    return map;
}
