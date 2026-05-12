/**
 * Review Module
 *
 * Unified diff review abstraction — types, utilities, and interfaces
 * for both AI and human code review.
 */

export * from './types';
export {
    CreateReviewCommentInput,
    createReviewComment,
    computeReviewStats,
    deriveAssessment,
    buildReviewResult,
    mergeReviewResults,
    filterBySeverity,
    filterByCategory,
    filterByFile,
    groupByFile,
} from './utils';
export {
    HumanReviewer,
    HumanReviewerConfig,
    HumanReviewOptions,
    DefaultReviewSession,
} from './human-reviewer';
export {
    AIReviewer,
    AIReviewerConfig,
    parseReviewFindings,
    extractJsonFromResponse,
} from './ai-reviewer';
