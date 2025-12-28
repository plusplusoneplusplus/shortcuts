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
}

/**
 * Default configuration values
 */
export const DEFAULT_CODE_REVIEW_CONFIG: CodeReviewConfig = {
    rulesFolder: '.github/cr-rules',
    rulesPattern: '**/*.md',
    promptTemplate: 'Review the following code changes against the provided coding rules. Identify violations and suggest fixes.',
    outputMode: 'aiProcess'
};

/**
 * A code rule loaded from a file
 */
export interface CodeRule {
    /** Filename of the rule */
    filename: string;
    /** Full path to the rule file */
    path: string;
    /** Content of the rule file */
    content: string;
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
    /** Type of review (commit or pending) */
    type: 'commit' | 'pending' | 'staged';
    /** Commit SHA (for commit reviews) */
    commitSha?: string;
    /** Commit message (for commit reviews) */
    commitMessage?: string;
    /** List of rule file names used */
    rulesUsed: string[];
    /** Diff statistics */
    diffStats?: DiffStats;
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

