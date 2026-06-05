/**
 * Pure helpers for PR popout file rail priority ordering, category counting,
 * and next/previous priority navigation.
 *
 * These helpers operate on plain data and a `getFileBadge` lookup so they can
 * be unit-tested without React, the DOM, or live classification state.
 *
 * Priority tier (highest first):
 *   1. high-intensity logic
 *   2. low-intensity logic
 *   3. test (any intensity)
 *   4. mechanical (any intensity)
 *   5. simple function (any intensity)
 *   6. generated (any intensity)
 *   7. unclassified (no badge / classification not yet available)
 *
 * Within a tier, unreviewed files come before reviewed files, and the
 * original input order is preserved as the final tiebreaker (stable sort).
 */

import type {
    HunkCategory,
    HunkIntensity,
} from '../../pull-requests/classification-types';
import type { FileChange } from './FileTree';

export interface FileBadgeLike {
    category: HunkCategory;
    intensity: HunkIntensity;
}

export interface CategoryCounts {
    logic: number;
    mechanical: number;
    test: number;
    simple: number;
    generated: number;
    /** Files with no badge (unclassified or classification not ready). */
    unclassified: number;
    /** Files in `logic` with intensity `high`. */
    logicHigh: number;
    /** Total files counted. */
    total: number;
}

/** Lower number = higher priority. */
function priorityTier(badge: FileBadgeLike | undefined): number {
    if (!badge) return 6;
    if (badge.category === 'logic') return badge.intensity === 'high' ? 0 : 1;
    if (badge.category === 'test') return 2;
    if (badge.category === 'mechanical') return 3;
    if (badge.category === 'simple') return 4;
    if (badge.category === 'generated') return 5;
    return 6;
}

export function computeCategoryCounts(
    files: ReadonlyArray<FileChange>,
    getFileBadge: (path: string) => FileBadgeLike | undefined,
): CategoryCounts {
    const counts: CategoryCounts = {
        logic: 0,
        mechanical: 0,
        test: 0,
        simple: 0,
        generated: 0,
        unclassified: 0,
        logicHigh: 0,
        total: files.length,
    };
    for (const f of files) {
        const b = getFileBadge(f.path);
        if (!b) {
            counts.unclassified++;
            continue;
        }
        switch (b.category) {
            case 'logic':
                counts.logic++;
                if (b.intensity === 'high') counts.logicHigh++;
                break;
            case 'mechanical':
                counts.mechanical++;
                break;
            case 'test':
                counts.test++;
                break;
            case 'simple':
                counts.simple++;
                break;
            case 'generated':
                counts.generated++;
                break;
        }
    }
    return counts;
}

export interface PriorityContext {
    getFileBadge: (path: string) => FileBadgeLike | undefined;
    /** Files that the reviewer has explicitly marked reviewed. */
    reviewedFiles?: ReadonlySet<string>;
}

/**
 * Stable sort of files by review priority.
 *
 * Returns a new array — the input is not mutated.
 */
export function sortFilesByPriority<T extends FileChange>(
    files: ReadonlyArray<T>,
    ctx: PriorityContext,
): T[] {
    const reviewed = ctx.reviewedFiles ?? new Set<string>();
    return files
        .map((f, idx) => ({
            f,
            idx,
            tier: priorityTier(ctx.getFileBadge(f.path)),
            isReviewed: reviewed.has(f.path),
        }))
        .sort((a, b) => {
            // Unreviewed before reviewed.
            if (a.isReviewed !== b.isReviewed) return a.isReviewed ? 1 : -1;
            if (a.tier !== b.tier) return a.tier - b.tier;
            return a.idx - b.idx;
        })
        .map(x => x.f);
}

export interface PickPriorityOptions {
    /** Path of the currently selected file (may be null when nothing selected). */
    currentPath: string | null;
    /** 'next' moves toward later items in priority order; 'prev' moves backward. */
    direction: 'next' | 'prev';
    /** Active classification filters. When provided, files outside these
     *  categories are skipped unless that would leave no candidates. */
    activeFilters?: ReadonlySet<HunkCategory>;
}

interface PickResult {
    /** The next/previous priority file path, or null if none available. */
    path: string | null;
    /** True when filters were ignored to avoid trapping the reviewer. */
    filtersIgnored: boolean;
}

/**
 * Pick the next/previous priority file to navigate to.
 *
 * Order of preference:
 *   1. Unreviewed files matching `activeFilters` in priority order.
 *   2. If 1 yields no candidate (e.g. everything matching is reviewed or
 *      filters exclude everything), retry without filters but still
 *      preferring unreviewed.
 *   3. If still nothing, return null (caller should disable controls).
 *
 * "Next" returns the candidate immediately after `currentPath` in the
 * priority-sorted candidate list; "prev" returns the one immediately before.
 * When `currentPath` is null or not in the list, "next" returns the first
 * candidate and "prev" returns the last.
 */
export function pickPriorityFile(
    files: ReadonlyArray<FileChange>,
    ctx: PriorityContext,
    opts: PickPriorityOptions,
): PickResult {
    const activeFilters = opts.activeFilters;
    const reviewed = ctx.reviewedFiles ?? new Set<string>();

    const matchesFilter = (path: string): boolean => {
        if (!activeFilters || activeFilters.size === 0) return true;
        const b = ctx.getFileBadge(path);
        if (!b) return false; // unclassified files are filtered out when a filter is active
        return activeFilters.has(b.category);
    };

    const buildCandidates = (useFilters: boolean): FileChange[] => {
        const sorted = sortFilesByPriority(files, ctx);
        const unreviewed = sorted.filter(f => !reviewed.has(f.path));
        const reviewedSorted = sorted.filter(f => reviewed.has(f.path));
        const ordered = [...unreviewed, ...reviewedSorted];
        if (!useFilters) return ordered;
        return ordered.filter(f => matchesFilter(f.path));
    };

    const tryPick = (candidates: FileChange[]): string | null => {
        if (candidates.length === 0) return null;
        const idx = opts.currentPath
            ? candidates.findIndex(f => f.path === opts.currentPath)
            : -1;
        if (opts.direction === 'next') {
            if (idx < 0) return candidates[0].path;
            return idx + 1 < candidates.length ? candidates[idx + 1].path : null;
        }
        // prev
        if (idx < 0) return candidates[candidates.length - 1].path;
        return idx - 1 >= 0 ? candidates[idx - 1].path : null;
    };

    // Pass 1: with filters.
    const filtered = buildCandidates(true);
    if (filtered.length > 0) {
        return { path: tryPick(filtered), filtersIgnored: false };
    }

    // Pass 2: filters eliminate everything → fall back without filters so the
    // user is never trapped with no nav options at all.
    if (activeFilters && activeFilters.size > 0) {
        const unfiltered = buildCandidates(false);
        const fallback = tryPick(unfiltered);
        if (fallback !== null && fallback !== opts.currentPath) {
            return { path: fallback, filtersIgnored: true };
        }
    }

    return { path: null, filtersIgnored: false };
}
