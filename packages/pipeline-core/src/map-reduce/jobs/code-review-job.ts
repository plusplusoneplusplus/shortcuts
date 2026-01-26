/**
 * Code Review Job
 *
 * Map-reduce job wrapper for AI-powered code review.
 * Reviews code changes against a set of coding rules.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    AIInvoker,
    MapContext,
    Mapper,
    MapReduceJob,
    MapResult,
    ReduceContext,
    ReduceResult,
    WorkItem
} from '../types';
import { Rule, RuleInput, RuleSplitter, RuleWorkItemData } from '../splitters';
import { BaseReducer, Deduplicatable, DeterministicReducer, DeterministicReducerOptions, DeterministicReduceOutput } from '../reducers';

/**
 * Severity levels for code review findings
 */
export type ReviewSeverity = 'error' | 'warning' | 'info' | 'suggestion';

/**
 * A single code review finding
 */
export interface ReviewFinding extends Deduplicatable {
    /** Unique identifier */
    id: string;
    /** Severity level */
    severity: ReviewSeverity;
    /** Rule that generated this finding */
    rule: string;
    /** Source rule file */
    ruleFile?: string;
    /** File path */
    file?: string;
    /** Line number */
    line?: number;
    /** Description of the issue */
    description: string;
    /** Code snippet */
    codeSnippet?: string;
    /** Suggested fix */
    suggestion?: string;
    /** Additional explanation */
    explanation?: string;
}

/**
 * Result from a single rule review (map output)
 */
export interface RuleReviewResult {
    /** The rule that was checked */
    rule: Rule;
    /** Whether the review succeeded */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Findings from this rule */
    findings: ReviewFinding[];
    /** Raw AI response */
    rawResponse?: string;
    /** Overall assessment */
    assessment?: 'pass' | 'needs-attention' | 'fail';
}

/**
 * Summary of review results
 */
export interface ReviewSummary {
    /** Total findings count */
    totalFindings: number;
    /** Count by severity */
    bySeverity: {
        error: number;
        warning: number;
        info: number;
        suggestion: number;
    };
    /** Count by rule */
    byRule: Record<string, number>;
    /** Overall assessment */
    overallAssessment: 'pass' | 'needs-attention' | 'fail';
    /** Summary text */
    summaryText: string;
}

/**
 * Final reduced output for code review
 */
export interface CodeReviewOutput {
    /** Deduplicated findings */
    findings: ReviewFinding[];
    /** Summary statistics */
    summary: ReviewSummary;
}

/**
 * Input for code review job
 */
export interface CodeReviewInput {
    /** The diff content to review */
    diff: string;
    /** Array of rules to check against */
    rules: Rule[];
    /** Additional context */
    context?: {
        commitSha?: string;
        commitMessage?: string;
        filesChanged?: number;
        isHotfix?: boolean;
        repositoryRoot?: string;
    };
}

/**
 * Options for code review job
 */
export interface CodeReviewJobOptions {
    /** AI invoker function */
    aiInvoker: AIInvoker;
    /** Whether to use AI-powered reduce (default: false) */
    useAIReduce?: boolean;
    /** Custom prompt template for rule reviews */
    promptTemplate?: string;
    /** Custom response parser */
    responseParser?: (response: string, rule: Rule) => ReviewFinding[];
}

/**
 * Default prompt template for single-rule review
 */
const DEFAULT_REVIEW_PROMPT_TEMPLATE = `You are a code reviewer checking for ONE specific rule.

## Rule: {{ruleName}}
{{ruleContent}}

## Instructions
1. Review the diff below for violations of THIS RULE ONLY
2. For each violation found, provide:
   - severity: ERROR, WARNING, INFO, or SUGGESTION
   - file: the file path
   - line: the line number
   - description: what's wrong
   - suggestion: how to fix it
3. If no violations found, return an empty findings array
4. Be precise - only flag clear violations

## Diff to Review
\`\`\`diff
{{diff}}
\`\`\`

## Output Format
Return JSON:
{
  "assessment": "pass" | "needs-attention" | "fail",
  "findings": [
    {
      "severity": "error|warning|info|suggestion",
      "file": "path/to/file.ts",
      "line": 42,
      "description": "Description of the problem",
      "suggestion": "How to fix it"
    }
  ]
}`;

/**
 * Mapper for code review - reviews a single rule
 */
class CodeReviewMapper implements Mapper<RuleWorkItemData, RuleReviewResult> {
    constructor(
        private aiInvoker: AIInvoker,
        private promptTemplate: string,
        private responseParser?: (response: string, rule: Rule) => ReviewFinding[]
    ) {}

    async map(
        item: WorkItem<RuleWorkItemData>,
        context: MapContext
    ): Promise<RuleReviewResult> {
        const { rule, targetContent } = item.data;

        // Build prompt
        const prompt = this.buildPrompt(rule, targetContent);

        try {
            // Get model from rule's front matter
            const model = rule.frontMatter?.model as string | undefined;

            // Invoke AI
            const result = await this.aiInvoker(prompt, { model });

            if (result.success && result.response) {
                const findings = this.parseResponse(result.response, rule);
                const assessment = this.determineAssessment(findings);

                return {
                    rule,
                    success: true,
                    findings,
                    rawResponse: result.response,
                    assessment
                };
            }

            return {
                rule,
                success: false,
                error: result.error || 'Unknown error',
                findings: []
            };
        } catch (error) {
            return {
                rule,
                success: false,
                error: error instanceof Error ? error.message : String(error),
                findings: []
            };
        }
    }

    private buildPrompt(rule: Rule, diff: string): string {
        return this.promptTemplate
            .replace(/\{\{ruleName\}\}/g, rule.filename)
            .replace(/\{\{ruleContent\}\}/g, rule.content)
            .replace(/\{\{diff\}\}/g, diff);
    }

    private parseResponse(response: string, rule: Rule): ReviewFinding[] {
        if (this.responseParser) {
            return this.responseParser(response, rule);
        }

        return this.defaultParseResponse(response, rule);
    }

    private defaultParseResponse(response: string, rule: Rule): ReviewFinding[] {
        try {
            // Try to extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return [];
            }

            const parsed = JSON.parse(jsonMatch[0]);
            const findings: ReviewFinding[] = [];

            if (parsed.findings && Array.isArray(parsed.findings)) {
                for (let i = 0; i < parsed.findings.length; i++) {
                    const f = parsed.findings[i];
                    findings.push({
                        id: `${rule.filename}-${i}`,
                        severity: this.mapSeverity(f.severity),
                        rule: rule.filename,
                        ruleFile: rule.filename,
                        file: f.file,
                        line: f.line,
                        description: f.description || f.issue || '',
                        codeSnippet: f.code || f.codeSnippet,
                        suggestion: f.suggestion,
                        explanation: f.explanation
                    });
                }
            }

            return findings;
        } catch {
            return [];
        }
    }

    private mapSeverity(severity: string): ReviewSeverity {
        const lower = (severity || '').toLowerCase();
        if (lower === 'error' || lower === 'critical') {
            return 'error';
        }
        if (lower === 'warning' || lower === 'major') {
            return 'warning';
        }
        if (lower === 'info' || lower === 'minor') {
            return 'info';
        }
        return 'suggestion';
    }

    private determineAssessment(findings: ReviewFinding[]): 'pass' | 'needs-attention' | 'fail' {
        if (findings.some(f => f.severity === 'error')) {
            return 'fail';
        }
        if (findings.some(f => f.severity === 'warning')) {
            return 'needs-attention';
        }
        return 'pass';
    }
}

/**
 * Reducer for code review - aggregates findings from all rules
 */
class CodeReviewReducer extends BaseReducer<RuleReviewResult, CodeReviewOutput> {
    private deterministicReducer: DeterministicReducer<ReviewFinding>;

    constructor() {
        super();

        const options: DeterministicReducerOptions<ReviewFinding> = {
            getKey: (finding) => {
                const file = finding.file || 'global';
                const line = finding.line || 0;
                const descNormalized = (finding.description || '')
                    .toLowerCase()
                    .replace(/\s+/g, ' ')
                    .trim()
                    .substring(0, 100);
                return `${file}:${line}:${descNormalized}`;
            },

            merge: (existing, newFinding) => {
                const severityRank: Record<ReviewSeverity, number> = {
                    'error': 4,
                    'warning': 3,
                    'info': 2,
                    'suggestion': 1
                };

                const keepNew = severityRank[newFinding.severity] > severityRank[existing.severity];
                const base = keepNew ? newFinding : existing;
                const other = keepNew ? existing : newFinding;

                return {
                    ...base,
                    rule: base.rule === other.rule ? base.rule : `${base.rule}, ${other.rule}`,
                    suggestion: (base.suggestion?.length || 0) >= (other.suggestion?.length || 0)
                        ? base.suggestion
                        : other.suggestion,
                    explanation: (base.explanation?.length || 0) >= (other.explanation?.length || 0)
                        ? base.explanation
                        : other.explanation
                };
            },

            sort: (a, b) => {
                const severityOrder: Record<ReviewSeverity, number> = {
                    'error': 0,
                    'warning': 1,
                    'info': 2,
                    'suggestion': 3
                };

                const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
                if (severityDiff !== 0) {
                    return severityDiff;
                }

                const fileA = a.file || '';
                const fileB = b.file || '';
                const fileDiff = fileA.localeCompare(fileB);
                if (fileDiff !== 0) {
                    return fileDiff;
                }

                return (a.line || 0) - (b.line || 0);
            },

            summarize: (items) => {
                const bySeverity = { error: 0, warning: 0, info: 0, suggestion: 0 };
                const byRule: Record<string, number> = {};

                for (const finding of items) {
                    bySeverity[finding.severity]++;
                    byRule[finding.rule] = (byRule[finding.rule] || 0) + 1;
                }

                return { bySeverity, byRule };
            }
        };

        this.deterministicReducer = new DeterministicReducer(options);
    }

    async reduce(
        results: MapResult<RuleReviewResult>[],
        context: ReduceContext
    ): Promise<ReduceResult<CodeReviewOutput>> {
        const startTime = Date.now();

        // Collect all findings from successful results
        const allFindings: ReviewFinding[][] = [];
        const ruleResults: RuleReviewResult[] = [];

        for (const result of results) {
            if (result.success && result.output) {
                const ruleResult = result.output;
                ruleResults.push(ruleResult);

                if (ruleResult.success && ruleResult.findings) {
                    // Tag findings with rule file
                    const taggedFindings = ruleResult.findings.map(f => ({
                        ...f,
                        ruleFile: ruleResult.rule.filename,
                        rule: f.rule || ruleResult.rule.filename
                    }));
                    allFindings.push(taggedFindings);
                }
            }
        }

        // Use deterministic reducer to deduplicate
        const mockMapResults: MapResult<ReviewFinding[]>[] = allFindings.map((findings, i) => ({
            workItemId: `findings-${i}`,
            success: true,
            output: findings,
            executionTimeMs: 0
        }));

        const deterministicResult = await this.deterministicReducer.reduce(mockMapResults, context);
        const dedupedFindings = deterministicResult.output.items;

        // Create summary
        const summary = this.createSummary(dedupedFindings, ruleResults);

        const reduceTimeMs = Date.now() - startTime;

        return {
            output: {
                findings: dedupedFindings,
                summary
            },
            stats: {
                inputCount: allFindings.reduce((sum, arr) => sum + arr.length, 0),
                outputCount: dedupedFindings.length,
                mergedCount: deterministicResult.stats.mergedCount,
                reduceTimeMs,
                usedAIReduce: false
            }
        };
    }

    private createSummary(findings: ReviewFinding[], ruleResults: RuleReviewResult[]): ReviewSummary {
        const bySeverity = { error: 0, warning: 0, info: 0, suggestion: 0 };
        const byRule: Record<string, number> = {};

        for (const finding of findings) {
            bySeverity[finding.severity]++;
            byRule[finding.rule] = (byRule[finding.rule] || 0) + 1;
        }

        // Determine overall assessment
        let overallAssessment: 'pass' | 'needs-attention' | 'fail' = 'pass';

        if (bySeverity.error > 0) {
            overallAssessment = 'fail';
        } else if (bySeverity.warning > 0) {
            overallAssessment = 'needs-attention';
        }

        // Also check individual rule assessments
        for (const result of ruleResults) {
            if (result.assessment === 'fail') {
                overallAssessment = 'fail';
                break;
            }
            if (result.assessment === 'needs-attention' && overallAssessment !== 'fail') {
                overallAssessment = 'needs-attention';
            }
        }

        // Generate summary text
        const failedRules = ruleResults.filter(r => !r.success).length;
        let summaryText: string;

        if (failedRules > 0) {
            summaryText = `Reviewed against ${ruleResults.length} rules (${failedRules} failed). `;
        } else {
            summaryText = `Reviewed against ${ruleResults.length} rules. `;
        }

        if (findings.length === 0) {
            summaryText += 'No issues found.';
        } else {
            summaryText += `Found ${findings.length} issue(s): ${bySeverity.error} error(s), ${bySeverity.warning} warning(s), ${bySeverity.info} info, ${bySeverity.suggestion} suggestion(s).`;
        }

        return {
            totalFindings: findings.length,
            bySeverity,
            byRule,
            overallAssessment,
            summaryText
        };
    }
}

/**
 * Create a code review job
 */
export function createCodeReviewJob(
    options: CodeReviewJobOptions
): MapReduceJob<CodeReviewInput, RuleWorkItemData, RuleReviewResult, CodeReviewOutput> {
    const promptTemplate = options.promptTemplate || DEFAULT_REVIEW_PROMPT_TEMPLATE;

    // Create splitter that converts CodeReviewInput to RuleInput
    const ruleSplitter = new RuleSplitter();

    // Create a wrapper splitter for CodeReviewInput
    const splitter = {
        split: (input: CodeReviewInput) => {
            const ruleInput: RuleInput = {
                rules: input.rules,
                targetContent: input.diff,
                context: input.context
            };
            return ruleSplitter.split(ruleInput);
        }
    };

    return {
        id: 'code-review',
        name: 'Code Review',
        splitter,
        mapper: new CodeReviewMapper(options.aiInvoker, promptTemplate, options.responseParser),
        reducer: new CodeReviewReducer(),
        options: {
            maxConcurrency: 5,
            reduceMode: options.useAIReduce ? 'ai' : 'deterministic',
            showProgress: true,
            retryOnFailure: false
        }
    };
}

// Re-export types
export type { Rule, RuleInput, RuleWorkItemData } from '../splitters';
