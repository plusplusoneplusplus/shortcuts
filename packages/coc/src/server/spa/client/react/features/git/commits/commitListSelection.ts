/**
 * Pure selection transitions for CommitList.
 *
 * Every desktop and mobile gesture that changes which commits are selected
 * funnels through these helpers so the single/multi/range/keyboard paths
 * cannot drift apart. They take and return plain data — no React state — so
 * the ordering guarantee (`onMultiSelect` always receives commits in display
 * order) is testable without rendering the list.
 */

import type { GitCommitItem } from './commitListTypes';

/**
 * Normalize the two selection prop shapes into one set. `selectedHashes`
 * supersedes `selectedHash` when present, matching the prop contract.
 */
export function resolveSelectedSet(
    selectedHashes: ReadonlySet<string> | undefined,
    selectedHash: string | null | undefined,
): ReadonlySet<string> {
    if (selectedHashes) return selectedHashes;
    return selectedHash ? new Set([selectedHash]) : new Set<string>();
}

/** Add `hash` to the set when absent, remove it when present. */
export function toggleHash(current: ReadonlySet<string>, hash: string): Set<string> {
    const next = new Set(current);
    if (next.has(hash)) next.delete(hash);
    else next.add(hash);
    return next;
}

/**
 * Project a hash set back onto the commit array. Filtering the array (rather
 * than mapping the set) is what keeps the emitted selection in display order.
 */
export function commitsInSet(commits: GitCommitItem[], hashes: ReadonlySet<string>): GitCommitItem[] {
    return commits.filter(c => hashes.has(c.hash));
}

/** The hash keyboard navigation moves relative to: explicit single selection, else the last multi-selected. */
export function resolveFocusedHash(
    selectedHash: string | null | undefined,
    selectedHashes: ReadonlySet<string> | undefined,
): string | null {
    if (selectedHash) return selectedHash;
    if (selectedHashes && selectedHashes.size > 0) return [...selectedHashes][selectedHashes.size - 1];
    return null;
}

/**
 * Index that ArrowUp/ArrowDown should move to. Clamps at both ends and treats
 * "nothing focused" (idx === -1) as "start at the top" for ArrowDown.
 */
export function computeKeyboardTargetIndex(
    commitCount: number,
    focusedIndex: number,
    direction: 'up' | 'down',
): number | null {
    if (commitCount === 0) return null;
    if (direction === 'down') {
        return focusedIndex < commitCount - 1 ? focusedIndex + 1 : Math.max(0, focusedIndex);
    }
    return focusedIndex > 0 ? focusedIndex - 1 : 0;
}

/**
 * Shift+click / Shift+Arrow range from `anchorHash` to `targetHash`, inclusive
 * and order-independent. Falls back to just the target commit when either end
 * is no longer in the list (e.g. the anchor scrolled out of a refreshed page).
 */
export function computeRangeSelection(
    commits: GitCommitItem[],
    anchorHash: string | null,
    target: GitCommitItem,
): GitCommitItem[] {
    const anchorIdx = anchorHash ? commits.findIndex(c => c.hash === anchorHash) : -1;
    const targetIdx = commits.findIndex(c => c.hash === target.hash);
    if (anchorIdx === -1 || targetIdx === -1) return [target];
    const [start, end] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
    return commits.slice(start, end + 1);
}

/** Result of a toggle-style transition: the new selection plus the new anchor. */
export interface ToggleSelectionResult {
    selected: GitCommitItem[];
    /** null clears the anchor (selection became empty). */
    anchorHash: string | null;
    /** True when the transition emptied the selection, so mobile mode should exit. */
    isEmpty: boolean;
}

/**
 * Ctrl/Cmd+click, mobile tap-to-toggle, and swipe-right toggle all share this
 * transition: flip one commit's membership and report the resulting anchor.
 */
export function computeToggleSelection(
    commits: GitCommitItem[],
    current: ReadonlySet<string>,
    commit: GitCommitItem,
): ToggleSelectionResult {
    const next = toggleHash(current, commit.hash);
    const isEmpty = next.size === 0;
    return {
        selected: commitsInSet(commits, next),
        anchorHash: isEmpty ? null : commit.hash,
        isEmpty,
    };
}

/** Shift+Arrow extension: additively grow the selection to include `commit`. */
export function computeAdditiveSelection(
    commits: GitCommitItem[],
    current: ReadonlySet<string>,
    commit: GitCommitItem,
): GitCommitItem[] {
    const next = new Set(current);
    next.add(commit.hash);
    return commitsInSet(commits, next);
}
