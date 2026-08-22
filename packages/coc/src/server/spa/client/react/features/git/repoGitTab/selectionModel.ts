/**
 * Pure selection model for the Git tab's right panel.
 *
 * Refresh-time reconciliation used to live inline in `refreshAll`, where the
 * branching (keep / retarget / fall back to HEAD / clear) was hard to reason
 * about and impossible to test without mounting the whole tab. It is a pure
 * function of (current view, freshly loaded commits, caller options), so it
 * lives here.
 */

import type { GitCommitItem } from '../commits/CommitList';
import type { RefreshSelectionOptions, RightPanelView } from './types';

/** Views that survive a refresh untouched — they are not commit-scoped. */
const REFRESH_STABLE_VIEWS: ReadonlySet<RightPanelView['type']> = new Set([
    'branch-file',
    'branch-range',
    'working-tree-file',
    'working-tree-comments',
    'branch-range-comments',
]);

/** The commit hash a view is pinned to, or null for non-commit views. */
export function selectedCommitHashOf(view: RightPanelView | null): string | null {
    if (view?.type === 'commit') return view.commit.hash;
    if (view?.type === 'commit-file') return view.hash;
    return null;
}

/** Every commit hash a view counts as selected (multi-select aware). */
export function selectedHashesOf(view: RightPanelView | null): ReadonlySet<string> {
    if (view?.type === 'multi-commit') return new Set(view.commits.map(c => c.hash));
    if (view?.type === 'commit') return new Set([view.commit.hash]);
    if (view?.type === 'commit-file') return new Set([view.hash]);
    return new Set();
}

/**
 * Decide the right-panel view after a refresh.
 *
 * `changed: false` means "leave the current view alone" — distinct from
 * `next: null`, which means "clear the panel".
 */
export function reconcileSelectionAfterRefresh(
    current: RightPanelView | null,
    loaded: readonly GitCommitItem[],
    options?: RefreshSelectionOptions,
): { changed: boolean; next: RightPanelView | null } {
    const head = loaded.length > 0 ? { type: 'commit' as const, commit: loaded[0] } : null;

    // Explicit post-action targeting (amend/drop): prefer the requested hash,
    // otherwise fall back to HEAD.
    if (options?.selectHash || options?.selectFallbackToHead) {
        const found = options.selectHash
            ? loaded.find(c => c.hash === options.selectHash)
            : undefined;
        return { changed: true, next: found ? { type: 'commit', commit: found } : head };
    }

    const prevHash = selectedCommitHashOf(current);
    if (prevHash) {
        const found = loaded.find(c => c.hash === prevHash);
        if (found) {
            // A commit-file view stays on its file; only a whole-commit view retargets.
            if (current?.type === 'commit-file') return { changed: false, next: current };
            return { changed: true, next: { type: 'commit', commit: found } };
        }
        return { changed: true, next: head };
    }

    // Branch / working-tree views are not commit-scoped, so a refresh leaves them be.
    if (current && REFRESH_STABLE_VIEWS.has(current.type)) return { changed: false, next: current };
    // No prior selection — keep the list visible (preserves mobile back state).
    if (current === null) return { changed: false, next: null };
    // Remaining case: a multi-commit selection collapses to HEAD.
    return head ? { changed: true, next: head } : { changed: false, next: current };
}
