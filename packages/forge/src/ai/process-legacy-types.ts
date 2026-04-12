/**
 * Legacy process metadata types — kept for backward-compatible deserialization.
 *
 * These types are no longer the recommended way to attach feature-specific data
 * to an AIProcess. New features should use `GenericProcessMetadata` (via the
 * `metadata` field on AIProcess) instead.
 *
 * IMPORTANT: Despite the "legacy" label, these types are still read by
 * `SqliteProcessStore.rowToProcess()` when deserializing processes that were
 * persisted with the old `__codeReviewMetadata`, `__discoveryMetadata`, and
 * `__codeReviewGroupMetadata` envelope keys. Do NOT delete these types until
 * the migration to `GenericProcessMetadata` is complete and all legacy database
 * rows have been migrated.
 */

/**
 * Code review specific metadata stored in the legacy envelope field
 * `__codeReviewMetadata`. New code reviews should use `GenericProcessMetadata`
 * with `type: 'code-review'`.
 */
export interface CodeReviewProcessMetadata {
    /** Type of review */
    reviewType: 'commit' | 'pending' | 'staged' | 'range';
    /** Commit SHA (for commit reviews) */
    commitSha?: string;
    /** Commit message */
    commitMessage?: string;
    /** Rules used for the review */
    rulesUsed: string[];
    /** Diff statistics */
    diffStats?: {
        files: number;
        additions: number;
        deletions: number;
    };
}

/**
 * Discovery process specific metadata stored in the legacy envelope field
 * `__discoveryMetadata`.
 */
export interface DiscoveryProcessMetadata {
    /** Feature description being searched */
    featureDescription: string;
    /** Keywords used in the search */
    keywords?: string[];
    /** Target group path (if scoped to a group) */
    targetGroupPath?: string;
    /** Search scope settings */
    scope?: {
        includeSourceFiles: boolean;
        includeDocs: boolean;
        includeConfigFiles: boolean;
        includeGitHistory: boolean;
    };
    /** Number of results found */
    resultCount?: number;
}

/**
 * Metadata for grouped code review processes stored in the legacy envelope field
 * `__codeReviewGroupMetadata`. New grouped reviews should use `GenericGroupMetadata`
 * with `type: 'code-review-group'`.
 */
export interface CodeReviewGroupMetadata {
    /** Type of review */
    reviewType: 'commit' | 'pending' | 'staged' | 'range';
    /** Commit SHA (for commit reviews) */
    commitSha?: string;
    /** Commit message */
    commitMessage?: string;
    /** All rules being reviewed */
    rulesUsed: string[];
    /** Diff statistics */
    diffStats?: {
        files: number;
        additions: number;
        deletions: number;
    };
    /** Child process IDs (individual rule reviews) */
    childProcessIds: string[];
    /** Execution statistics */
    executionStats?: {
        totalRules: number;
        successfulRules: number;
        failedRules: number;
        totalTimeMs: number;
    };
}
