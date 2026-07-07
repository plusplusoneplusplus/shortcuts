/**
 * repoSubTabs — pure definitions and visibility logic for the repo sub-tab strip.
 *
 * Extracted from RepoDetail so the same tab taxonomy and feature-flag/layout
 * filtering can be reused by the remote-first shell (RemoteScopeCluster /
 * WorkspaceTabsCluster) without duplicating logic. Keeping it pure also makes
 * it unit-testable.
 */

import type { RepoSubTab } from '../../types/dashboard';
import { SHOW_WIKI_TAB } from '../../navFlags';

export interface SubTabDef {
    key: RepoSubTab;
    label: string;
    shortcut?: string;
}

export const SUB_TABS: SubTabDef[] = [
    { key: 'chats', label: 'Chats', shortcut: 'Alt+A' },
    { key: 'cli-sessions', label: 'CLI Sessions' },
    { key: 'git', label: 'Git', shortcut: 'Alt+G' },
    { key: 'terminal', label: 'Terminal' },
    { key: 'work-items', label: 'WIs', shortcut: 'Alt+I' },
    { key: 'dreams', label: 'Dreams', shortcut: 'Alt+D' },
    { key: 'pull-requests', label: 'PRs', shortcut: 'Alt+R' },
    { key: 'explorer', label: 'Explorer', shortcut: 'Alt+E' },
    { key: 'workflows', label: 'Workflows', shortcut: 'Alt+W' },
    { key: 'schedules', label: 'Schedules', shortcut: 'Alt+S' },
    { key: 'tasks', label: 'Tasks (Dep.)', shortcut: 'Alt+T' },
    { key: 'notes', label: 'Notes', shortcut: 'Alt+N' },
    { key: 'settings', label: 'Settings', shortcut: 'Alt+C' },
    { key: 'wiki', label: 'Wiki' },
];

/** Tabs actually rendered in the UI — wiki is hidden behind a feature flag. */
export const VISIBLE_SUB_TABS: SubTabDef[] = SHOW_WIKI_TAB
    ? SUB_TABS
    : SUB_TABS.filter(t => t.key !== 'wiki');

/**
 * Logical group buckets for the desktop tab strip — used to render thin
 * vertical dividers between adjacent tabs that belong to different groups.
 * Group identity is purely visual and does not affect functionality.
 */
export const TAB_GROUP_INDEX: Record<string, number> = {
    'chats': 1, 'activity': 1, 'cli-sessions': 1, 'copilot-sessions': 1, 'git': 1, 'terminal': 1,
    'work-items': 2, 'dreams': 2, 'pull-requests': 2, 'tasks': 2,
    'explorer': 3, 'workflows': 3, 'schedules': 3,
    'notes': 4, 'settings': 4, 'wiki': 4,
};

export interface VisibleSubTabOptions {
    isGitRepo: boolean;
    terminalEnabled: boolean;
    notesEnabled: boolean;
    workflowsEnabled: boolean;
    pullRequestsEnabled: boolean;
    dreamsEnabled: boolean;
    nativeCliSessionsEnabled: boolean;
    /** When false (default), the deprecated `tasks` sub-tab is hidden in both layout modes. */
    showPlanDepTab: boolean;
    uiLayoutMode: 'classic' | 'dev-workflow';
    /**
     * When true (feature flag `splitWorkspacePanel`, default off), the split
     * "Workspace" view takes over the chat slot: the standalone `git` sub-tab is
     * hidden (its diff/stage/commit/push functionality now lives inside the split
     * panel) and the chat tab is relabeled "Workspace". The tab *key*
     * (`activity`/`chats`) is unchanged so mount/selection logic is unaffected —
     * only the label and git-visibility change. Optional so the remote-shell
     * callers, which don't host the split panel, keep today's behavior.
     */
    splitWorkspacePanelEnabled?: boolean;
    /**
     * When true (feature flag `schedulesInScheduledSlide`, default off), the
     * standalone `schedules` sub-tab is hidden. Schedule management moves into
     * the chat-list "Scheduled" slide + main pane (AC-01/02/03), so keeping the
     * tab would leave two entry points. The old `RepoSchedulesTab` code is NOT
     * deleted (deferred follow-up) — it is simply unreachable from the strip
     * while the flag is ON, and schedule deep-links keep the chat surface
     * mounted instead (Router). Optional so the remote-shell callers, which
     * don't host the Scheduled slide, keep today's Schedules tab.
     */
    schedulesInScheduledSlideEnabled?: boolean;
}

/**
 * Compute the visible sub-tabs for a repo, applying feature-flag gating,
 * git-repo gating, and per-layout-mode relabeling/reordering.
 *
 * This is a verbatim extraction of the logic previously inlined in RepoDetail
 * so the two stay behaviorally identical.
 */
export function computeVisibleSubTabs(opts: VisibleSubTabOptions): SubTabDef[] {
    const {
        isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled,
        pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, showPlanDepTab, uiLayoutMode,
        splitWorkspacePanelEnabled = false,
        schedulesInScheduledSlideEnabled = false,
    } = opts;

    let tabs: SubTabDef[] = VISIBLE_SUB_TABS;
    if (!isGitRepo) tabs = tabs.filter(t => t.key !== 'git' && t.key !== 'pull-requests');
    if (!showPlanDepTab) tabs = tabs.filter(t => t.key !== 'tasks');
    if (!terminalEnabled) tabs = tabs.filter(t => t.key !== 'terminal');
    if (!notesEnabled) tabs = tabs.filter(t => t.key !== 'notes');
    if (!workflowsEnabled) tabs = tabs.filter(t => t.key !== 'workflows');
    if (!pullRequestsEnabled) tabs = tabs.filter(t => t.key !== 'pull-requests');
    if (!dreamsEnabled) tabs = tabs.filter(t => t.key !== 'dreams');
    if (!nativeCliSessionsEnabled) tabs = tabs.filter(t => t.key !== 'cli-sessions' && t.key !== 'copilot-sessions');
    // Schedules tab retirement (AC-04): when the schedules-in-slide flag is ON,
    // hide the standalone `schedules` sub-tab. Applied before the layout
    // relabel/reorder so the dev-workflow "Jobs" rename has nothing to act on.
    if (schedulesInScheduledSlideEnabled) tabs = tabs.filter(t => t.key !== 'schedules');

    if (uiLayoutMode === 'classic') {
        // Classic: replace Chats with Activity, relabel Tasks as Plans
        tabs = tabs
            .map(t => t.key === 'chats' ? { ...t, key: 'activity' as RepoSubTab, label: 'Activity' } : t)
            .map(t => t.key === 'tasks' ? { ...t, label: 'Plans (Dep.)' } : t);
    } else {
        // Dev-workflow: relabel and reorder tabs
        const devWorkflowRelabels: Record<string, string> = {
            'schedules': 'Jobs',
            'pull-requests': 'Full Requests',
        };
        const devWorkflowOrder: RepoSubTab[] = [
            'chats', 'cli-sessions', 'work-items', 'dreams', 'schedules', 'explorer',
            'workflows', 'git', 'terminal', 'pull-requests', 'tasks', 'settings',
        ];
        const tabMap = new Map(tabs.map(t => [t.key, t]));
        const ordered: SubTabDef[] = [];
        for (const key of devWorkflowOrder) {
            const tab = tabMap.get(key);
            if (tab) {
                const newLabel = devWorkflowRelabels[key];
                ordered.push(newLabel ? { ...tab, label: newLabel } : tab);
                tabMap.delete(key);
            }
        }
        // Append dynamic tabs (notes, wiki) that aren't in the fixed order
        for (const [, tab] of tabMap) {
            ordered.push(tab);
        }
        tabs = ordered;
    }

    // Split "Workspace" panel (feature flag). Applied last so it overrides the
    // per-layout labeling in either mode. Hide the standalone `git` sub-tab —
    // its functionality moves into the split panel — and relabel the chat tab
    // (key `activity` in classic, `chats` in dev-workflow) to "Workspace". The
    // key is left untouched so mount/selection/pinned-tab logic is unaffected.
    if (splitWorkspacePanelEnabled) {
        tabs = tabs
            .filter(t => t.key !== 'git')
            .map(t => (t.key === 'activity' || t.key === 'chats') ? { ...t, label: 'Workspace' } : t);
    }

    return tabs;
}
