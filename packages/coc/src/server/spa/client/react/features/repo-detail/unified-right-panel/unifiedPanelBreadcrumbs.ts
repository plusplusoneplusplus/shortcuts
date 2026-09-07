/**
 * unifiedPanelBreadcrumbs — what the panel-level toolbar row shows for the active
 * tab (AC-02).
 *
 * The row sits under the tab strip and above the active view, and it exists for
 * exactly one reason: a file tab needs breadcrumbs, and with the Explorer no
 * longer a tab there is no other place for them. Every other kind renders its
 * own toolbar inside its own view, as it always has — so this module's first
 * job is to say "not a file tab, no row".
 *
 * Its second job is deciding whether those breadcrumbs are *navigable*. A
 * breadcrumb segment here drives the file-tree column: it reveals and expands
 * that folder. That only means something when the path is a repo-relative path
 * inside the tree the column is showing, which fails in two ways:
 *
 *  - A trusted absolute path (`__trusted__:`) is not repo-relative at all. It
 *    has no row in any tree, so its segments would navigate to folders that do
 *    not exist.
 *  - A file owned by a different clone than the tree's current target — a
 *    repo-group member, a remote clone — has a path that resolves inside *its*
 *    repo, not the one on screen. Revealing `src/app.ts` in the wrong repo is
 *    worse than not revealing it.
 *
 * Both degrade to the same thing: a plain, non-interactive path label. Nothing
 * here opens, closes, or changes a tab — the toolbar is orientation, not
 * navigation between tabs.
 */

import { TRUSTED_PATH_PREFIX } from '../explorer/ExactOpen';
import type { UnifiedPanelTab } from './unifiedPanelTabsModel';

/** What the toolbar row renders for one active file tab. */
export interface UnifiedToolbarBreadcrumbs {
    /** The full path, shown in the row's tooltip when it truncates. */
    path: string;
    /**
     * Path segments root-first, or empty when the path is not a repo-relative
     * one. `Breadcrumbs` renders the last segment — the file — as plain text,
     * so only the folder segments are ever clickable.
     */
    segments: readonly string[];
    /** Whether a segment click may reveal that folder in the tree column. */
    interactive: boolean;
    /** Repo attribution, carried over from the tab, when it has one. */
    repoLabel?: string;
}

/**
 * The toolbar row's content for the active tab, or null when there should be no
 * row at all — no tab, or a kind that brings its own toolbar.
 *
 * `treeWorkspaceId` is the clone the tree column is currently showing (the dock
 * target), which is what decides whether the breadcrumbs can navigate it.
 */
export function unifiedToolbarBreadcrumbs(
    tab: UnifiedPanelTab | null | undefined,
    treeWorkspaceId: string,
): UnifiedToolbarBreadcrumbs | null {
    if (!tab || tab.kind !== 'file') return null;

    const trusted = tab.resourceId.startsWith(TRUSTED_PATH_PREFIX);
    const path = trusted ? tab.resourceId.slice(TRUSTED_PATH_PREFIX.length) : tab.resourceId;
    const interactive = !trusted && tab.ownerWorkspaceId === treeWorkspaceId;

    return {
        path,
        segments: interactive ? path.split('/').filter(Boolean) : [],
        interactive,
        ...(tab.repoLabel ? { repoLabel: tab.repoLabel } : {}),
    };
}

/**
 * The folder a breadcrumb click targets: null for the root segment, otherwise
 * the path down to and including segment `index`. The trailing segment is the
 * file itself and is never clickable, so this only ever names a directory.
 */
export function breadcrumbFolderPath(segments: readonly string[], index: number): string | null {
    if (index < 0) return null;
    return segments.slice(0, index + 1).join('/');
}
