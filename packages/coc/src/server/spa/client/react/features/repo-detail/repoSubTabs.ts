/**
 * repoSubTabs — pure definitions and visibility logic for the repo sub-tab strip.
 *
 * Extracted from RepoDetail so the same tab taxonomy and feature-flag/layout
 * filtering can be reused by the remote-first shell (WorkspaceTabsCluster) without duplicating logic. Keeping it pure also makes
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
    { key: 'git', label: 'Git', shortcut: 'Alt+G' },
    { key: 'terminal', label: 'Terminal' },
    { key: 'dreams', label: 'Dreams', shortcut: 'Alt+D' },
    { key: 'explorer', label: 'Explorer', shortcut: 'Alt+E' },
    { key: 'workflows', label: 'Workflows', shortcut: 'Alt+W' },
    { key: 'schedules', label: 'Schedules', shortcut: 'Alt+S' },
    { key: 'tasks', label: 'Tasks (Dep.)', shortcut: 'Alt+T' },
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
    'chats': 1, 'activity': 1, 'git': 1, 'terminal': 1,
    'dreams': 2, 'tasks': 2,
    'explorer': 3, 'workflows': 3, 'schedules': 3,
    'wiki': 4,
};

export interface VisibleSubTabOptions {
    isGitRepo: boolean;
    terminalEnabled: boolean;
    workflowsEnabled: boolean;
    dreamsEnabled: boolean;
    /** When false (default), the deprecated `tasks` sub-tab is hidden in the tab strip. */
    showPlanDepTab: boolean;

    /**
     * When true (feature flag `schedulesInScheduledSlide`, default off), the
     * standalone `schedules` sub-tab is hidden. Schedule management moves into
     * the chat-list "Scheduled" slide + main pane (AC-01/02/03), so keeping the
     * tab would leave two entry points. The old `RepoSchedulesTab` code is NOT
     * deleted (deferred follow-up) — it is simply unreachable from the strip
     * while the flag is ON, and schedule deep-links keep the chat surface
     * mounted instead (Router). The remote-first shell hosts the Scheduled slide
     * too — its content is a chromeless `RepoDetail` whose `RepoChatTab` carries
     * the slide — so `WorkspaceTabsCluster` passes this flag as well. Optional
     * only because `WorkspaceIdentityChip` never renders the clone-scoped
     * `schedules` tab, so the flag is a no-op there.
     */
    schedulesInScheduledSlideEnabled?: boolean;
}

/**
 * Compute the visible sub-tabs for a repo, applying feature-flag gating,
 * git-repo gating, and classic tab labels.
 *
 * This is a verbatim extraction of the logic previously inlined in RepoDetail
 * so the two stay behaviorally identical.
 */
export function computeVisibleSubTabs(opts: VisibleSubTabOptions): SubTabDef[] {
    const {
        isGitRepo, terminalEnabled, workflowsEnabled,
        dreamsEnabled, showPlanDepTab,
        schedulesInScheduledSlideEnabled = false,
    } = opts;

    let tabs: SubTabDef[] = VISIBLE_SUB_TABS;
    if (!isGitRepo) tabs = tabs.filter(t => t.key !== 'git');
    if (!showPlanDepTab) tabs = tabs.filter(t => t.key !== 'tasks');
    if (!terminalEnabled) tabs = tabs.filter(t => t.key !== 'terminal');
    if (!workflowsEnabled) tabs = tabs.filter(t => t.key !== 'workflows');
    if (!dreamsEnabled) tabs = tabs.filter(t => t.key !== 'dreams');
    // Schedules tab retirement (AC-04): when the schedules-in-slide flag is ON,
    // hide the standalone `schedules` sub-tab.
    if (schedulesInScheduledSlideEnabled) tabs = tabs.filter(t => t.key !== 'schedules');

    tabs = tabs
        .map(t => t.key === 'chats' ? { ...t, key: 'activity' as RepoSubTab } : t)
        .map(t => t.key === 'tasks' ? { ...t, label: 'Plans (Dep.)' } : t);

    // Workspace owns Git; the desktop right panel owns Terminal and Explorer.
    // Preserve the chat aliases while giving the shared surface one label.
    tabs = tabs
        .filter(t => t.key !== 'git' && t.key !== 'terminal' && t.key !== 'explorer')
        .map(t => (t.key === 'activity' || t.key === 'chats') ? { ...t, label: 'Workspace' } : t);

    return tabs;
}

/** The workspace surface (chat + Git split): the repo's main view, aliased `chats`/`activity`. */
export function isWorkspaceSubTab(tab: RepoSubTab | null | undefined): boolean {
    return tab === 'chats' || tab === 'activity';
}

/**
 * Where a header sub-tab click goes. The desktop header has no Workspace tab,
 * so clicking the active tab again returns to the workspace.
 */
export function subTabClickTarget(activeTab: RepoSubTab | null | undefined, tab: RepoSubTab): RepoSubTab {
    return activeTab === tab ? 'activity' : tab;
}
