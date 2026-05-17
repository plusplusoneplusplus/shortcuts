/**
 * Shared types for the focused-diff classification feature.
 *
 * A classification assigns each `@@` hunk in a PR diff to a category
 * (logic, mechanical, test, generated) with an intensity level so the
 * UI can visually de-emphasize non-logic changes.
 */

/** The four hunk categories recognised by the classifier. */
export type HunkCategory = 'logic' | 'mechanical' | 'test' | 'generated';

/** How important a hunk is within its category. */
export type HunkIntensity = 'high' | 'low';

/** Classification result for a single `@@` hunk. */
export interface HunkClassification {
    /** File path (new-side) as it appears in the diff. */
    file: string;
    /** 0-based index of the hunk within the file's diff. */
    hunkIndex: number;
    /** Dominant category for this hunk. */
    category: HunkCategory;
    /** Reviewer-attention level. */
    intensity: HunkIntensity;
    /** One-sentence justification for the classification. */
    reason: string;
}

/** Full classification result for a PR diff. */
export interface DiffClassificationResult {
    /** Per-hunk classifications, ordered by file then hunk index. */
    classifications: HunkClassification[];
}

/** Cache key fields — used to check whether a cached result is still valid. */
export interface DiffClassificationCacheKey {
    /** PR identifier (number or string, provider-dependent). */
    prId: string;
    /** SHA of the last commit on the PR head at classification time. */
    headSha: string;
}

/** The four filter categories exposed in the UI filter bar. */
export const HUNK_CATEGORIES: readonly HunkCategory[] = ['logic', 'mechanical', 'test', 'generated'] as const;

/** Human-readable labels for each category. */
export const CATEGORY_LABELS: Record<HunkCategory, string> = {
    logic: 'Logic',
    mechanical: 'Mechanical',
    test: 'Test',
    generated: 'Generated',
};
