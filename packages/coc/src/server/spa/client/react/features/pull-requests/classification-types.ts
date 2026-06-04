/**
 * Shared types for the focused-diff classification feature.
 *
 * A classification assigns each `@@` hunk in a PR diff to a category
 * (logic, mechanical, test, simple, generated) with an intensity level so the
 * UI can visually de-emphasize non-logic changes.
 */

/** The hunk categories recognised by the classifier. */
export type HunkCategory = 'logic' | 'mechanical' | 'test' | 'simple' | 'generated';

/** How important a hunk is within its category. */
export type HunkIntensity = 'high' | 'low';

/** Compact usage evidence for critical existing-function changes. */
export interface CriticalUsageEntry {
    /** Repo-relative file path for the usage or caller. */
    file: string;
    /** Optional function/symbol/route/command name at the usage site. */
    symbol?: string;
    /** Optional 1-based line number for the usage site. */
    line?: number;
    /** Short explanation of why this usage matters. */
    description: string;
}

/** One frame in a representative call path for critical changes. */
export interface CriticalCallPathFrame {
    /** Repo-relative file path for this frame. */
    file: string;
    /** Function/symbol/route/command name for this frame. */
    symbol: string;
    /** Optional 1-based line number for this frame. */
    line?: number;
    /** Optional short frame note. */
    description?: string;
}

/** Metadata shown for critical existing-function changes. */
export interface CriticalHunkMetadata {
    /** Short criticality label, e.g. "exported API" or "persistence path". */
    label: string;
    /** One short statement of reviewer-impact. */
    impactSummary: string;
    /** Up to 3 compact usage/caller entries. */
    usages: CriticalUsageEntry[];
    /** One representative call path, up to 4 frames. */
    callPath: CriticalCallPathFrame[];
    /** True when usage evidence could not be determined. */
    usageNotDetermined?: boolean;
    /** True when call-stack evidence could not be determined. */
    callStackNotDetermined?: boolean;
}

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
    /** Required when category is `test`; explains fidelity level and why. */
    testFidelityComment?: string;
    /** Required for non-trivial `logic` hunks; concise behavior summary. */
    summaryComment?: string;
    /** Present when the hunk changes a critical existing function/handler/path. */
    critical?: CriticalHunkMetadata;
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

/** The filter categories exposed in the UI filter bar. */
export const HUNK_CATEGORIES: readonly HunkCategory[] = ['logic', 'mechanical', 'test', 'simple', 'generated'] as const;

/** Human-readable labels for each category. */
export const CATEGORY_LABELS: Record<HunkCategory, string> = {
    logic: 'Logic',
    mechanical: 'Mechanical',
    test: 'Test',
    simple: 'Simple function',
    generated: 'Generated',
};
