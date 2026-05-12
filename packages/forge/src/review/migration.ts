/**
 * Migration Utilities — Phase 2d
 *
 * Conversion functions between the legacy `code-review-job` types
 * (`ReviewFinding`, `CodeReviewOutput`) and the new unified review
 * types (`ReviewComment`, `ReviewResult`).
 *
 * Use these to migrate existing code-review consumers to the new
 * review module incrementally.
 */

import type {
    ReviewComment,
    ReviewResult,
    ReviewSeverity,
    ReviewCategory,
    ReviewAuthor,
    LineRange,
} from './types';
import type { DiffSource } from '../diff/types';
import type {
    ReviewFinding,
    CodeReviewOutput,
    ReviewSummary,
} from '../map-reduce/jobs/code-review-job';
import { createReviewComment, buildReviewResult } from './utils';

// ── Default AI author ────────────────────────────────────────

const DEFAULT_AI_AUTHOR: ReviewAuthor = {
    name: 'AI Code Review',
    isAI: true,
};

// ── ReviewFinding → ReviewComment ────────────────────────────

/**
 * Options for converting a `ReviewFinding` to a `ReviewComment`.
 */
export interface FindingToCommentOptions {
    /** Override the default AI author. */
    author?: ReviewAuthor;
    /** Default category when the finding has no category mapping. */
    defaultCategory?: ReviewCategory;
}

/**
 * Convert a legacy `ReviewFinding` to a `ReviewComment`.
 *
 * The old `ReviewFinding` lacks `category`, `author`, and `lineRange`,
 * so these are inferred or set to defaults:
 * - `category` → defaults to `'general'`
 * - `author` → defaults to `{ name: 'AI Code Review', isAI: true }`
 * - `lineRange` → derived from `finding.line` if present
 */
export function findingToComment(
    finding: ReviewFinding,
    options?: FindingToCommentOptions,
): ReviewComment {
    const author = options?.author ?? DEFAULT_AI_AUTHOR;
    const category = options?.defaultCategory ?? 'general';

    const lineRange: LineRange | undefined = finding.line != null
        ? { startLine: finding.line, endLine: finding.line }
        : undefined;

    return createReviewComment({
        filePath: finding.file ?? '',
        severity: finding.severity,
        category,
        description: finding.description,
        author,
        rule: finding.rule,
        ruleFile: finding.ruleFile,
        suggestion: finding.suggestion,
        explanation: finding.explanation,
        codeSnippet: finding.codeSnippet,
        lineRange,
    });
}

/**
 * Batch-convert an array of `ReviewFinding`s to `ReviewComment`s.
 */
export function findingsToComments(
    findings: readonly ReviewFinding[],
    options?: FindingToCommentOptions,
): ReviewComment[] {
    return findings.map(f => findingToComment(f, options));
}

// ── ReviewComment → ReviewFinding ────────────────────────────

/**
 * Convert a `ReviewComment` back to a legacy `ReviewFinding`.
 *
 * Fields that don't exist in `ReviewFinding` (category, author,
 * lineRange, anchor, timestamps) are dropped.
 */
export function commentToFinding(comment: ReviewComment): ReviewFinding {
    return {
        id: comment.id,
        severity: comment.severity,
        rule: comment.rule ?? '',
        ruleFile: comment.ruleFile,
        file: comment.filePath,
        line: comment.lineRange?.startLine,
        description: comment.description,
        codeSnippet: comment.codeSnippet,
        suggestion: comment.suggestion,
        explanation: comment.explanation,
    };
}

/**
 * Batch-convert `ReviewComment`s back to legacy `ReviewFinding`s.
 */
export function commentsToFindings(
    comments: readonly ReviewComment[],
): ReviewFinding[] {
    return comments.map(commentToFinding);
}

// ── CodeReviewOutput → ReviewResult ──────────────────────────

/**
 * Convert a legacy `CodeReviewOutput` to a `ReviewResult`.
 *
 * @param output - The legacy code-review-job output.
 * @param source - The `DiffSource` that was reviewed.
 * @param options - Optional conversion options.
 */
export function codeReviewOutputToResult(
    output: CodeReviewOutput,
    source: DiffSource,
    options?: FindingToCommentOptions,
): ReviewResult {
    const comments = findingsToComments(output.findings, options);
    const startedAt = new Date().toISOString();
    return buildReviewResult(source, comments, startedAt, output.summary.summaryText);
}

// ── ReviewResult → CodeReviewOutput ──────────────────────────

/**
 * Convert a `ReviewResult` back to a legacy `CodeReviewOutput`.
 *
 * Useful for consumers that still expect the old shape.
 */
export function resultToCodeReviewOutput(result: ReviewResult): CodeReviewOutput {
    const findings = commentsToFindings(result.comments);

    const summary: ReviewSummary = {
        totalFindings: result.stats.totalComments,
        bySeverity: { ...result.stats.bySeverity },
        byRule: { ...result.stats.byRule },
        overallAssessment: result.assessment,
        summaryText: result.summaryText ?? '',
    };

    return { findings, summary };
}
