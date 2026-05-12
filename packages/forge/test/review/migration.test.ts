/**
 * Migration Utilities Tests — Phase 2d
 *
 * Tests for conversion between legacy code-review-job types
 * and the new unified review types.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    findingToComment,
    findingsToComments,
    commentToFinding,
    commentsToFindings,
    codeReviewOutputToResult,
    resultToCodeReviewOutput,
} from '../../src/review/migration';
import type { ReviewComment, ReviewResult, ReviewStats } from '../../src/review/types';
import type { ReviewFinding, CodeReviewOutput, ReviewSummary } from '../../src/map-reduce/jobs/code-review-job';
import type { DiffSource } from '../../src/diff/types';
import { createReviewComment, computeReviewStats, deriveAssessment } from '../../src/review/utils';

// ── Fixtures ──────────────────────────────────────────────────

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
    return {
        id: 'finding-1',
        severity: 'warning',
        rule: 'no-console',
        ruleFile: 'rules/no-console.md',
        file: 'src/app.ts',
        line: 42,
        description: 'Remove console.log before production',
        codeSnippet: 'console.log("debug")',
        suggestion: 'Use a logger instead',
        explanation: 'Console statements should not be in production code',
        ...overrides,
    };
}

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
    return createReviewComment({
        filePath: 'src/app.ts',
        severity: 'warning',
        category: 'general',
        description: 'Remove console.log before production',
        author: { name: 'AI Code Review', isAI: true },
        rule: 'no-console',
        ruleFile: 'rules/no-console.md',
        suggestion: 'Use a logger instead',
        explanation: 'Console statements should not be in production code',
        codeSnippet: 'console.log("debug")',
        lineRange: { startLine: 42, endLine: 42 },
        ...overrides,
    });
}

function makeDiffSource(): DiffSource {
    return {
        type: 'commit',
        commitSha: 'abc123',
        repositoryRoot: '/repo',
    } as DiffSource;
}

// ── Tests ─────────────────────────────────────────────────────

describe('Migration utilities', () => {
    let dateSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        dateSpy = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-01-01T00:00:00.000Z');
    });

    afterEach(() => {
        dateSpy.mockRestore();
    });

    // ── findingToComment ──────────────────────────────────────

    describe('findingToComment', () => {
        it('converts a full ReviewFinding to ReviewComment', () => {
            const finding = makeFinding();
            const comment = findingToComment(finding);

            expect(comment.filePath).toBe('src/app.ts');
            expect(comment.severity).toBe('warning');
            expect(comment.category).toBe('general');
            expect(comment.rule).toBe('no-console');
            expect(comment.ruleFile).toBe('rules/no-console.md');
            expect(comment.description).toBe('Remove console.log before production');
            expect(comment.suggestion).toBe('Use a logger instead');
            expect(comment.explanation).toBe('Console statements should not be in production code');
            expect(comment.codeSnippet).toBe('console.log("debug")');
            expect(comment.lineRange).toEqual({ startLine: 42, endLine: 42 });
            expect(comment.author).toEqual({ name: 'AI Code Review', isAI: true });
            expect(comment.id).toBeTruthy();
            expect(comment.createdAt).toBeTruthy();
            expect(comment.updatedAt).toBeTruthy();
        });

        it('handles finding with no file', () => {
            const finding = makeFinding({ file: undefined });
            const comment = findingToComment(finding);
            expect(comment.filePath).toBe('');
        });

        it('handles finding with no line', () => {
            const finding = makeFinding({ line: undefined });
            const comment = findingToComment(finding);
            expect(comment.lineRange).toBeUndefined();
        });

        it('handles finding with no optional fields', () => {
            const finding: ReviewFinding = {
                id: 'f-1',
                severity: 'info',
                rule: 'some-rule',
                description: 'Something',
            };
            const comment = findingToComment(finding);
            expect(comment.filePath).toBe('');
            expect(comment.suggestion).toBeUndefined();
            expect(comment.explanation).toBeUndefined();
            expect(comment.codeSnippet).toBeUndefined();
            expect(comment.lineRange).toBeUndefined();
        });

        it('uses custom author when provided', () => {
            const finding = makeFinding();
            const author = { name: 'Custom Reviewer', isAI: false };
            const comment = findingToComment(finding, { author });
            expect(comment.author).toEqual(author);
        });

        it('uses custom defaultCategory when provided', () => {
            const finding = makeFinding();
            const comment = findingToComment(finding, { defaultCategory: 'security' });
            expect(comment.category).toBe('security');
        });
    });

    // ── findingsToComments ────────────────────────────────────

    describe('findingsToComments', () => {
        it('converts multiple findings', () => {
            const findings = [
                makeFinding({ id: 'f-1', severity: 'error' }),
                makeFinding({ id: 'f-2', severity: 'info' }),
            ];
            const comments = findingsToComments(findings);
            expect(comments).toHaveLength(2);
            expect(comments[0].severity).toBe('error');
            expect(comments[1].severity).toBe('info');
        });

        it('handles empty array', () => {
            expect(findingsToComments([])).toEqual([]);
        });

        it('passes options through', () => {
            const findings = [makeFinding()];
            const comments = findingsToComments(findings, { defaultCategory: 'bug' });
            expect(comments[0].category).toBe('bug');
        });
    });

    // ── commentToFinding ─────────────────────────────────────

    describe('commentToFinding', () => {
        it('converts a ReviewComment to ReviewFinding', () => {
            const comment = makeComment();
            const finding = commentToFinding(comment);

            expect(finding.id).toBe(comment.id);
            expect(finding.severity).toBe('warning');
            expect(finding.rule).toBe('no-console');
            expect(finding.ruleFile).toBe('rules/no-console.md');
            expect(finding.file).toBe('src/app.ts');
            expect(finding.line).toBe(42);
            expect(finding.description).toBe('Remove console.log before production');
            expect(finding.suggestion).toBe('Use a logger instead');
            expect(finding.explanation).toBe('Console statements should not be in production code');
            expect(finding.codeSnippet).toBe('console.log("debug")');
        });

        it('sets rule to empty string when comment has no rule', () => {
            const comment = makeComment({ rule: undefined });
            const finding = commentToFinding(comment);
            expect(finding.rule).toBe('');
        });

        it('uses startLine for finding.line', () => {
            const comment = makeComment({
                lineRange: { startLine: 10, endLine: 20 },
            });
            const finding = commentToFinding(comment);
            expect(finding.line).toBe(10);
        });

        it('sets line to undefined when no lineRange', () => {
            const comment = makeComment({ lineRange: undefined });
            const finding = commentToFinding(comment);
            expect(finding.line).toBeUndefined();
        });
    });

    // ── commentsToFindings ────────────────────────────────────

    describe('commentsToFindings', () => {
        it('converts multiple comments', () => {
            const comments = [makeComment(), makeComment()];
            const findings = commentsToFindings(comments);
            expect(findings).toHaveLength(2);
        });

        it('handles empty array', () => {
            expect(commentsToFindings([])).toEqual([]);
        });
    });

    // ── codeReviewOutputToResult ─────────────────────────────

    describe('codeReviewOutputToResult', () => {
        it('converts CodeReviewOutput to ReviewResult', () => {
            const output: CodeReviewOutput = {
                findings: [
                    makeFinding({ severity: 'error' }),
                    makeFinding({ id: 'f-2', severity: 'warning' }),
                ],
                summary: {
                    totalFindings: 2,
                    bySeverity: { error: 1, warning: 1, info: 0, suggestion: 0 },
                    byRule: { 'no-console': 2 },
                    overallAssessment: 'fail',
                    summaryText: 'Found 2 issues.',
                },
            };
            const source = makeDiffSource();
            const result = codeReviewOutputToResult(output, source);

            expect(result.source).toBe(source);
            expect(result.comments).toHaveLength(2);
            expect(result.comments[0].severity).toBe('error');
            expect(result.comments[1].severity).toBe('warning');
            expect(result.summaryText).toBe('Found 2 issues.');
            expect(result.assessment).toBe('fail');
            expect(result.stats.totalComments).toBe(2);
            expect(result.startedAt).toBeTruthy();
            expect(result.completedAt).toBeTruthy();
        });

        it('handles empty findings', () => {
            const output: CodeReviewOutput = {
                findings: [],
                summary: {
                    totalFindings: 0,
                    bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                    byRule: {},
                    overallAssessment: 'pass',
                    summaryText: 'No issues found.',
                },
            };
            const result = codeReviewOutputToResult(output, makeDiffSource());
            expect(result.comments).toHaveLength(0);
            expect(result.assessment).toBe('pass');
        });

        it('passes options to findingsToComments', () => {
            const output: CodeReviewOutput = {
                findings: [makeFinding()],
                summary: {
                    totalFindings: 1,
                    bySeverity: { error: 0, warning: 1, info: 0, suggestion: 0 },
                    byRule: { 'no-console': 1 },
                    overallAssessment: 'needs-attention',
                    summaryText: 'Found 1 issue.',
                },
            };
            const result = codeReviewOutputToResult(output, makeDiffSource(), { defaultCategory: 'performance' });
            expect(result.comments[0].category).toBe('performance');
        });
    });

    // ── resultToCodeReviewOutput ─────────────────────────────

    describe('resultToCodeReviewOutput', () => {
        it('converts ReviewResult to CodeReviewOutput', () => {
            const comments = [
                makeComment({ severity: 'error', rule: 'security-rule' }),
                makeComment({ severity: 'warning', rule: 'no-console' }),
            ];
            const stats = computeReviewStats(comments);
            const result: ReviewResult = {
                source: makeDiffSource(),
                comments,
                stats,
                assessment: deriveAssessment(stats),
                summaryText: 'Review complete.',
                startedAt: '2026-01-01T00:00:00.000Z',
                completedAt: '2026-01-01T00:01:00.000Z',
            };

            const output = resultToCodeReviewOutput(result);

            expect(output.findings).toHaveLength(2);
            expect(output.findings[0].severity).toBe('error');
            expect(output.findings[1].severity).toBe('warning');
            expect(output.summary.totalFindings).toBe(2);
            expect(output.summary.bySeverity.error).toBe(1);
            expect(output.summary.bySeverity.warning).toBe(1);
            expect(output.summary.overallAssessment).toBe('fail');
            expect(output.summary.summaryText).toBe('Review complete.');
        });

        it('handles empty result', () => {
            const result: ReviewResult = {
                source: makeDiffSource(),
                comments: [],
                stats: computeReviewStats([]),
                assessment: 'pass',
                startedAt: '2026-01-01T00:00:00.000Z',
                completedAt: '2026-01-01T00:01:00.000Z',
            };

            const output = resultToCodeReviewOutput(result);
            expect(output.findings).toHaveLength(0);
            expect(output.summary.totalFindings).toBe(0);
            expect(output.summary.overallAssessment).toBe('pass');
            expect(output.summary.summaryText).toBe('');
        });
    });

    // ── Round-trip ────────────────────────────────────────────

    describe('round-trip conversion', () => {
        it('finding → comment → finding preserves core fields', () => {
            const original = makeFinding();
            const comment = findingToComment(original);
            const roundTripped = commentToFinding(comment);

            expect(roundTripped.severity).toBe(original.severity);
            expect(roundTripped.rule).toBe(original.rule);
            expect(roundTripped.ruleFile).toBe(original.ruleFile);
            expect(roundTripped.file).toBe(original.file);
            expect(roundTripped.line).toBe(original.line);
            expect(roundTripped.description).toBe(original.description);
            expect(roundTripped.suggestion).toBe(original.suggestion);
            expect(roundTripped.explanation).toBe(original.explanation);
            expect(roundTripped.codeSnippet).toBe(original.codeSnippet);
        });

        it('output → result → output preserves summary fields', () => {
            const output: CodeReviewOutput = {
                findings: [
                    makeFinding({ severity: 'error' }),
                    makeFinding({ id: 'f-2', severity: 'info', rule: 'other-rule' }),
                ],
                summary: {
                    totalFindings: 2,
                    bySeverity: { error: 1, warning: 0, info: 1, suggestion: 0 },
                    byRule: { 'no-console': 1, 'other-rule': 1 },
                    overallAssessment: 'fail',
                    summaryText: 'Found 2 issues.',
                },
            };

            const result = codeReviewOutputToResult(output, makeDiffSource());
            const roundTripped = resultToCodeReviewOutput(result);

            expect(roundTripped.findings).toHaveLength(output.findings.length);
            expect(roundTripped.summary.totalFindings).toBe(output.summary.totalFindings);
            expect(roundTripped.summary.overallAssessment).toBe(output.summary.overallAssessment);
            expect(roundTripped.summary.summaryText).toBe(output.summary.summaryText);
        });
    });
});
