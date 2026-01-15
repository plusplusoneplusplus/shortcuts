/**
 * Code Review Types
 * 
 * Types and interfaces for the code review feature that reviews
 * Git diffs against code rule files using Copilot CLI.
 */

/**
 * Output mode for code review results
 */
export type CodeReviewOutputMode = 'aiProcess' | 'clipboard' | 'editor';

/**
 * Mode for the reduce phase of code review
 */
export type CodeReviewReduceMode = 'deterministic' | 'ai';

/**
 * Configuration for code review feature
 */
export interface CodeReviewConfig {
    /** Path to folder containing rule files (relative to workspace) */
    rulesFolder: string;
    /** Glob pattern for rule files within the folder */
    rulesPattern: string;
    /** Prompt template for the review */
    promptTemplate: string;
    /** Output mode for results */
    outputMode: CodeReviewOutputMode;
    /** Maximum number of concurrent rule reviews (default: 5) */
    maxConcurrency: number;
    /** Mode for aggregating results: 'deterministic' (code-based) or 'ai' (AI-powered) */
    reduceMode: CodeReviewReduceMode;
}

/**
 * Default configuration values
 */
export const DEFAULT_CODE_REVIEW_CONFIG: CodeReviewConfig = {
    rulesFolder: '.github/cr-rules',
    rulesPattern: '**/*.md',
    promptTemplate: 'Review the following code changes against the provided coding rules. Identify violations and suggest fixes.',
    outputMode: 'aiProcess',
    maxConcurrency: 5,
    reduceMode: 'deterministic'
};

/**
 * Front matter metadata parsed from a rule file
 */
export interface RuleFrontMatter {
    /** AI model to use for this rule (e.g., 'claude-sonnet-4-5', 'gpt-4', 'haiku') */
    model?: string;
}

/**
 * A code rule loaded from a file
 */
export interface CodeRule {
    /** Filename of the rule */
    filename: string;
    /** Full path to the rule file */
    path: string;
    /** Content of the rule file (without front matter if present) */
    content: string;
    /** Raw content including front matter (defaults to content if not specified) */
    rawContent?: string;
    /** Parsed front matter metadata */
    frontMatter?: RuleFrontMatter;
}

/**
 * Diff statistics
 */
export interface DiffStats {
    /** Number of files changed */
    files: number;
    /** Number of lines added */
    additions: number;
    /** Number of lines deleted */
    deletions: number;
}

/**
 * Metadata for a code review process
 */
export interface CodeReviewMetadata {
    /** Type of review (commit, pending, staged, or range) */
    type: 'commit' | 'pending' | 'staged' | 'range';
    /** Commit SHA (for commit reviews) */
    commitSha?: string;
    /** Commit message (for commit reviews) */
    commitMessage?: string;
    /** List of rule file names used */
    rulesUsed: string[];
    /** Diff statistics */
    diffStats?: DiffStats;
    /** Repository root path (for reference-based prompts) */
    repositoryRoot?: string;
    /** Full paths to rule files (for reference-based prompts) */
    rulePaths?: string[];
}

/**
 * Metadata for a single rule review (one rule per AI process)
 */
export interface SingleRuleReviewMetadata extends CodeReviewMetadata {
    /** The specific rule being checked in this process */
    ruleFilename: string;
    /** Full path to the rule file */
    rulePath: string;
}

/**
 * Result from a single rule review process
 */
export interface SingleRuleReviewResult {
    /** The rule that was checked */
    rule: CodeRule;
    /** Process ID for tracking */
    processId: string;
    /** Whether the process succeeded */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Parsed findings from this rule */
    findings: ReviewFinding[];
    /** Raw AI response */
    rawResponse?: string;
    /** Overall assessment for this rule */
    assessment?: 'pass' | 'needs-attention' | 'fail';
}

/**
 * Aggregated result from multiple parallel rule reviews
 */
export interface AggregatedCodeReviewResult {
    /** Combined metadata from all reviews */
    metadata: CodeReviewMetadata;
    /** Summary aggregated from all rule results */
    summary: ReviewSummary;
    /** All findings from all rules, tagged with source rule */
    findings: ReviewFinding[];
    /** Individual results per rule */
    ruleResults: SingleRuleReviewResult[];
    /** Combined raw responses */
    rawResponse: string;
    /** When the aggregated review was completed */
    timestamp: Date;
    /** Statistics about the parallel execution */
    executionStats: {
        /** Total number of rules processed */
        totalRules: number;
        /** Number of successful rule reviews */
        successfulRules: number;
        /** Number of failed rule reviews */
        failedRules: number;
        /** Total execution time in ms */
        totalTimeMs: number;
    };
    /** Statistics about the reduce phase (optional for backwards compatibility) */
    reduceStats?: ReduceStats;
}

/**
 * Result of loading rules from a folder
 */
export interface RulesLoadResult {
    /** Successfully loaded rules */
    rules: CodeRule[];
    /** Errors encountered during loading */
    errors: string[];
}

/**
 * Validation result for code review configuration
 */
export interface ConfigValidationResult {
    /** Whether the configuration is valid */
    valid: boolean;
    /** Error message if not valid */
    error?: string;
    /** Warning message (non-fatal) */
    warning?: string;
}

/**
 * Large diff warning threshold in bytes
 */
export const LARGE_DIFF_THRESHOLD = 50 * 1024; // 50KB

/**
 * Severity levels for code review findings
 */
export type ReviewSeverity = 'error' | 'warning' | 'info' | 'suggestion';

/**
 * A single code review finding/violation
 */
export interface ReviewFinding {
    /** Unique identifier for the finding */
    id: string;
    /** Severity level */
    severity: ReviewSeverity;
    /** The rule that was violated (from AI response) */
    rule: string;
    /** The source rule file that generated this finding */
    ruleFile?: string;
    /** File path where the issue was found */
    file?: string;
    /** Line number (if applicable) */
    line?: number;
    /** Description of the issue */
    description: string;
    /** The problematic code snippet */
    codeSnippet?: string;
    /** Suggested fix or improvement */
    suggestion?: string;
    /** Additional context or explanation */
    explanation?: string;
}

/**
 * Summary statistics for a code review
 */
export interface ReviewSummary {
    /** Total number of findings */
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
    /** Brief summary text */
    summaryText: string;
}

/**
 * Structured code review result
 */
export interface CodeReviewResult {
    /** Metadata about the review */
    metadata: CodeReviewMetadata;
    /** Summary of the review */
    summary: ReviewSummary;
    /** Individual findings */
    findings: ReviewFinding[];
    /** Raw AI response (for reference) */
    rawResponse: string;
    /** When the review was completed */
    timestamp: Date;
}

/**
 * Serialized code review result for storage
 */
export interface SerializedCodeReviewResult {
    metadata: CodeReviewMetadata;
    summary: ReviewSummary;
    findings: ReviewFinding[];
    rawResponse: string;
    timestamp: string; // ISO string
}

/**
 * Convert CodeReviewResult to serialized format
 */
export function serializeCodeReviewResult(result: CodeReviewResult): SerializedCodeReviewResult {
    return {
        metadata: result.metadata,
        summary: result.summary,
        findings: result.findings,
        rawResponse: result.rawResponse,
        timestamp: result.timestamp.toISOString()
    };
}

/**
 * Convert serialized format back to CodeReviewResult
 */
export function deserializeCodeReviewResult(serialized: SerializedCodeReviewResult): CodeReviewResult {
    return {
        metadata: serialized.metadata,
        summary: serialized.summary,
        findings: serialized.findings,
        rawResponse: serialized.rawResponse,
        timestamp: new Date(serialized.timestamp)
    };
}

/**
 * Prompt suffix to request structured response from AI
 */
export const STRUCTURED_RESPONSE_PROMPT = `

---

Please provide your response in the following structured format:

## Summary
Provide a brief overall assessment (1-2 sentences).
Overall: [PASS | NEEDS_ATTENTION | FAIL]

## Findings

For each issue found, use this format:

### [SEVERITY] Rule: [Rule Name]
- **File:** [filename or "N/A"]
- **Line:** [line number or "N/A"]
- **Issue:** [Description of the problem]
- **Code:** \`[problematic code snippet]\`
- **Suggestion:** [How to fix it]
- **Explanation:** [Why this matters]

Where SEVERITY is one of: ERROR, WARNING, INFO, SUGGESTION

## When No Violations Are Found

If the code follows the rule and no issues are found, use this format:

## Summary
The code follows the provided rule. No violations detected.
Overall: PASS

## Findings

No violations found.
`;

/**
 * Prompt template for single-rule code review
 */
export const SINGLE_RULE_PROMPT_TEMPLATE = `Review the following code changes against the specific coding rule provided below. Focus ONLY on violations of this single rule.`;

/**
 * Configuration for prompt mode
 */
export type PromptMode = 'embedded' | 'reference';

/**
 * Options for building the code review prompt
 */
export interface PromptBuildOptions {
    /** Whether to use reference-based prompts (commit ID, file paths) instead of embedding content */
    mode: PromptMode;
}

/**
 * Regex patterns for parsing structured response
 */
export const RESPONSE_PATTERNS = {
    /** Match overall assessment */
    overallAssessment: /Overall:\s*(PASS|NEEDS_ATTENTION|FAIL)/i,
    /** Match summary section */
    summarySection: /##\s*Summary\s*\n([\s\S]*?)(?=##\s*Findings|$)/i,
    /** Match findings section */
    findingsSection: /##\s*Findings\s*\n([\s\S]*?)$/i,
    /** Match individual finding */
    finding: /###\s*\[(ERROR|WARNING|INFO|SUGGESTION)\]\s*Rule:\s*(.+?)\n([\s\S]*?)(?=###\s*\[|$)/gi,
    /** Match finding details */
    findingFile: /\*\*File:\*\*\s*(.+?)(?:\n|$)/i,
    findingLine: /\*\*Line:\*\*\s*(\d+|N\/A)/i,
    findingIssue: /\*\*Issue:\*\*\s*([\s\S]*?)(?=\*\*(?:Code|Suggestion|Explanation):|$)/i,
    findingCode: /\*\*Code:\*\*\s*`([^`]*)`/i,
    findingSuggestion: /\*\*Suggestion:\*\*\s*([\s\S]*?)(?=\*\*Explanation:|$)/i,
    findingExplanation: /\*\*Explanation:\*\*\s*([\s\S]*?)$/i
};

/**
 * Context for the reduce phase
 */
export interface ReduceContext {
    /** Original review metadata */
    metadata: CodeReviewMetadata;
    /** Total execution time of map phase in ms */
    mapPhaseTimeMs: number;
    /** Number of files changed */
    filesChanged: number;
    /** Whether this is a hotfix review */
    isHotfix?: boolean;
}

/**
 * Result of the reduce phase
 */
export interface ReduceResult {
    /** Deduplicated and prioritized findings */
    findings: ReviewFinding[];
    /** Generated summary */
    summary: ReviewSummary;
    /** Statistics about deduplication */
    reduceStats: ReduceStats;
}

/**
 * Statistics about the reduce phase
 */
export interface ReduceStats {
    /** Number of findings before deduplication */
    originalCount: number;
    /** Number of findings after deduplication */
    dedupedCount: number;
    /** Number of findings merged */
    mergedCount: number;
    /** Time taken for reduce phase in ms */
    reduceTimeMs: number;
    /** Whether AI reduce was used */
    usedAIReduce: boolean;
}

/**
 * Prompt template for AI-powered reduce phase
 */
export const AI_REDUCE_PROMPT_TEMPLATE = `You are synthesizing a code review from multiple specialized reviewers.

## Context
- Files changed: {{filesChanged}}
- Review type: {{reviewType}}

## Raw Findings
{{findingsCount}} findings from {{rulesCount}} rules:

{{formattedFindings}}

## Your Tasks

### 1. Deduplicate
Multiple rules may flag the same underlying issue differently. Merge findings that:
- Point to the same code location AND describe the same problem
- Are redundant (one finding is a subset of another)

Keep the clearest, most actionable description.

### 2. Resolve Conflicts
When rules disagree:
- Security > Correctness > Performance > Maintainability > Style
- Consider the context (hot path vs. cold path, public API vs. internal)
- Pick the better suggestion, explain briefly why

### 3. Prioritize
Order findings by:
1. Critical: Bugs, security issues, data loss risks
2. Major: Logic errors, missing error handling, breaking changes
3. Minor: Performance improvements, better patterns
4. Nitpick: Style, naming, minor cleanup

### 4. Synthesize Report
Create a clean, actionable review that a developer can work through.

## Output Format
Return JSON (and ONLY JSON, no markdown code fences):
{
  "summary": "2-3 sentence overall assessment",
  "overallSeverity": "clean|minor-issues|needs-work|critical",
  "mustFix": [
    "Brief description of blocking issues (if any)"
  ],
  "findings": [
    {
      "id": "f1",
      "severity": "error|warning|info|suggestion",
      "category": "security|reliability|performance|maintainability|style",
      "file": "path/to/file.ts",
      "line": 42,
      "issue": "Clear description of the problem",
      "suggestion": "Specific fix recommendation",
      "fromRules": ["rule-id-1", "rule-id-2"]
    }
  ],
  "stats": {
    "totalIssues": 5,
    "deduplicated": 2,
    "byCategory": {"reliability": 3, "style": 2},
    "bySeverity": {"error": 2, "warning": 3}
  }
}`;

/**
 * Parsed result from AI reduce response
 */
export interface AIReduceResponse {
    summary: string;
    overallSeverity: 'clean' | 'minor-issues' | 'needs-work' | 'critical';
    mustFix?: string[];
    findings: Array<{
        id: string;
        severity: string;
        category?: string;
        file?: string;
        line?: number;
        issue: string;
        suggestion?: string;
        fromRules?: string[];
    }>;
    stats?: {
        totalIssues: number;
        deduplicated: number;
        byCategory?: Record<string, number>;
        bySeverity?: Record<string, number>;
    };
}

