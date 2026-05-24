/**
 * AIReviewer — Phase 2c
 *
 * Implements `IDiffReviewer` for AI-powered code reviews.
 * Delegates to the code-review skill via `CopilotSDKService`.
 * The skill handles multi-rule parallelism internally (multi-subagent).
 */

import type { DiffSource } from '../diff/types';
import type {
    IDiffReviewer,
    ReviewComment,
    ReviewOptions,
    ReviewResult,
    ReviewSeverity,
    ReviewCategory,
    ReviewAuthor,
} from './types';
import { createReviewComment, buildReviewResult, type CreateReviewCommentInput } from './utils';
import type { CopilotSDKService, SendMessageOptions, SDKInvocationResult } from '@plusplusoneplusplus/coc-agent-sdk';

// ── AI reviewer configuration ───────────────────────────────

/**
 * Configuration for the AIReviewer.
 */
export interface AIReviewerConfig {
    /** CopilotSDKService instance for AI invocations. */
    sdkService: CopilotSDKService;
    /** Model override (e.g. 'claude-sonnet-4.6', 'gpt-5'). */
    model?: string;
    /** Working directory for the SDK session. */
    workingDirectory?: string;
    /** Skill directories containing the code-review skill. */
    skillDirectories?: string[];
    /** Disabled skills to exclude. */
    disabledSkills?: string[];
    /** Custom system prompt to append to the default. */
    systemPromptAppend?: string;
    /** Timeout in milliseconds for the AI invocation. */
    timeoutMs?: number;
}

// ── Response parsing ─────────────────────────────────────────

/**
 * Raw finding shape expected from the AI response JSON.
 * Aligned with the code-review skill output format.
 */
interface RawAIFinding {
    severity?: string;
    category?: string;
    rule?: string;
    ruleFile?: string;
    file?: string;
    filePath?: string;
    line?: number;
    endLine?: number;
    description?: string;
    suggestion?: string;
    explanation?: string;
    codeSnippet?: string;
}

const VALID_SEVERITIES = new Set<ReviewSeverity>(['error', 'warning', 'info', 'suggestion']);
const VALID_CATEGORIES = new Set<ReviewCategory>([
    'bug', 'security', 'performance', 'style', 'maintainability',
    'correctness', 'documentation', 'testing', 'general',
]);

/**
 * Normalize a severity string to a valid ReviewSeverity.
 */
function normalizeSeverity(raw?: string): ReviewSeverity {
    if (!raw) return 'info';
    const lower = raw.toLowerCase().trim();
    if (VALID_SEVERITIES.has(lower as ReviewSeverity)) return lower as ReviewSeverity;
    if (lower === 'critical' || lower === 'high') return 'error';
    if (lower === 'medium') return 'warning';
    if (lower === 'low' || lower === 'note') return 'info';
    return 'info';
}

/**
 * Normalize a category string to a valid ReviewCategory.
 */
function normalizeCategory(raw?: string): ReviewCategory {
    if (!raw) return 'general';
    const lower = raw.toLowerCase().trim();
    if (VALID_CATEGORIES.has(lower as ReviewCategory)) return lower as ReviewCategory;
    if (lower.includes('bug') || lower.includes('defect')) return 'bug';
    if (lower.includes('secur')) return 'security';
    if (lower.includes('perf')) return 'performance';
    if (lower.includes('style') || lower.includes('format')) return 'style';
    if (lower.includes('maintain') || lower.includes('readab')) return 'maintainability';
    if (lower.includes('correct')) return 'correctness';
    if (lower.includes('doc')) return 'documentation';
    if (lower.includes('test')) return 'testing';
    return 'general';
}

const AI_AUTHOR: ReviewAuthor = { name: 'AI Code Review', isAI: true };

/**
 * Parse a single raw finding into a CreateReviewCommentInput.
 */
function parseRawFinding(raw: RawAIFinding, rule?: string): CreateReviewCommentInput | undefined {
    const filePath = raw.filePath ?? raw.file;
    const description = raw.description;
    if (!filePath || !description) return undefined;

    return {
        filePath,
        severity: normalizeSeverity(raw.severity),
        category: normalizeCategory(raw.category),
        description,
        author: AI_AUTHOR,
        rule: raw.rule ?? rule,
        ruleFile: raw.ruleFile,
        suggestion: raw.suggestion,
        explanation: raw.explanation,
        codeSnippet: raw.codeSnippet,
        lineRange: raw.line != null
            ? { startLine: raw.line, endLine: raw.endLine ?? raw.line }
            : undefined,
    };
}

/**
 * Extract JSON from an AI response that may contain markdown fences or prose.
 */
export function extractJsonFromResponse(text: string): unknown | undefined {
    // Try direct JSON parse first
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        // Not direct JSON
    }

    // Try extracting from markdown code fences
    const fencePattern = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g;
    let match: RegExpExecArray | null;
    while ((match = fencePattern.exec(text)) !== null) {
        try {
            return JSON.parse(match[1].trim());
        } catch {
            continue;
        }
    }

    // Try finding a JSON array or object
    const jsonPattern = /(\[[\s\S]*\]|\{[\s\S]*\})/;
    const jsonMatch = jsonPattern.exec(text);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[1]);
        } catch {
            // Give up
        }
    }

    return undefined;
}

/**
 * Parse the AI response text into ReviewComment[].
 * Handles various response formats: array of findings, object with findings array, etc.
 */
export function parseReviewFindings(
    responseText: string,
    onComment?: (comment: ReviewComment) => void,
): ReviewComment[] {
    const parsed = extractJsonFromResponse(responseText);
    if (!parsed) return [];

    let rawFindings: RawAIFinding[] = [];

    if (Array.isArray(parsed)) {
        rawFindings = parsed;
    } else if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        // Look for common keys: findings, comments, issues, results
        for (const key of ['findings', 'comments', 'issues', 'results', 'violations']) {
            if (Array.isArray(obj[key])) {
                rawFindings = obj[key] as RawAIFinding[];
                break;
            }
        }
        // If no array found, treat the object itself as a single finding
        if (rawFindings.length === 0 && obj.description) {
            rawFindings = [obj as unknown as RawAIFinding];
        }
    }

    const comments: ReviewComment[] = [];
    for (const raw of rawFindings) {
        const input = parseRawFinding(raw);
        if (input) {
            const comment = createReviewComment(input);
            comments.push(comment);
            onComment?.(comment);
        }
    }
    return comments;
}

// ── Prompt building ──────────────────────────────────────────

/**
 * Build the diff description for the prompt based on the DiffSource kind.
 */
function describeDiffSource(source: DiffSource): string {
    switch (source.kind) {
        case 'commit':
            return `commit ${source.commitHash} in ${source.repositoryRoot}`;
        case 'range':
            return `range ${source.baseRef}..${source.headRef} in ${source.repositoryRoot}`;
        case 'working-tree':
            return `${source.scope} working tree changes in ${source.repositoryRoot}`;
        case 'pr':
            return `pull request #${source.pullRequestId} in ${source.repositoryRoot}`;
        case 'pr-iteration':
            return `pull request #${source.pullRequestId} iteration ${source.iterationId} in ${source.repositoryRoot}`;
    }
}

/**
 * Build the review prompt for the AI.
 */
function buildReviewPrompt(source: DiffSource, options?: ReviewOptions): string {
    const parts: string[] = [];

    parts.push(`Review the code changes from ${describeDiffSource(source)}.`);
    parts.push('');
    parts.push('Analyze the diff for issues across all categories: bugs, security vulnerabilities, performance problems, style issues, maintainability concerns, correctness errors, missing documentation, and testing gaps.');
    parts.push('');

    if (options?.filePaths?.length) {
        parts.push(`Focus only on these files: ${options.filePaths.join(', ')}`);
        parts.push('');
    }

    parts.push('Return your findings as a JSON array where each finding has:');
    parts.push('- severity: "error" | "warning" | "info" | "suggestion"');
    parts.push('- category: "bug" | "security" | "performance" | "style" | "maintainability" | "correctness" | "documentation" | "testing" | "general"');
    parts.push('- filePath: the file path relative to the repository root');
    parts.push('- line: the line number (1-based)');
    parts.push('- endLine: optional end line for multi-line issues');
    parts.push('- description: clear description of the issue');
    parts.push('- suggestion: how to fix it (optional)');
    parts.push('- explanation: additional rationale (optional)');
    parts.push('- codeSnippet: relevant code (optional)');
    parts.push('');
    parts.push('If no issues found, return an empty array: []');
    parts.push('Maximize coverage diversity — look for different types of issues rather than many of the same kind.');

    return parts.join('\n');
}

// ── AIReviewer class ─────────────────────────────────────────

/**
 * AI-powered diff reviewer.
 *
 * Delegates to the code-review skill via CopilotSDKService.
 * The skill handles multi-rule parallelism internally (multi-subagent).
 * The AIReviewer collects the output, parses it into ReviewComment[],
 * and streams comments via the `onComment` callback.
 */
export class AIReviewer implements IDiffReviewer {
    readonly name = 'AI Code Review';
    private readonly _config: AIReviewerConfig;

    constructor(config: AIReviewerConfig) {
        this._config = config;
    }

    async review(source: DiffSource, options?: ReviewOptions): Promise<ReviewResult> {
        const startedAt = new Date().toISOString();
        const prompt = buildReviewPrompt(source, options);

        // Check for pre-cancellation
        if (options?.signal?.aborted) {
            return buildReviewResult(source, [], startedAt, 'Review cancelled before start.');
        }

        const sendOptions: SendMessageOptions = {
            prompt,
            model: this._config.model,
            workingDirectory: this._config.workingDirectory ?? source.repositoryRoot,
            timeoutMs: this._config.timeoutMs,
            signal: options?.signal,
            streaming: true,
            skillDirectories: this._config.skillDirectories,
            disabledSkills: this._config.disabledSkills,
            onPermissionRequest: () => ({ kind: 'approve-once' as const }),
            mode: 'autopilot',
        };

        if (this._config.systemPromptAppend) {
            sendOptions.systemMessage = {
                mode: 'append',
                content: this._config.systemPromptAppend,
            };
        }

        try {
            const result: SDKInvocationResult = await this._config.sdkService.sendMessage(sendOptions);

            if (!result.success || !result.response) {
                return buildReviewResult(
                    source, [], startedAt,
                    `AI review failed: ${result.error ?? 'No response received.'}`,
                );
            }

            const comments = parseReviewFindings(result.response, options?.onComment);
            return buildReviewResult(source, comments, startedAt);

        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (options?.signal?.aborted) {
                return buildReviewResult(source, [], startedAt, 'Review cancelled.');
            }
            return buildReviewResult(source, [], startedAt, `AI review error: ${message}`);
        }
    }
}
