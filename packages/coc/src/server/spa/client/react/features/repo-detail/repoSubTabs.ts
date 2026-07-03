/**
 * repoSubTabs — pure definitions and visibility logic for the repo sub-tab strip.
 *
 * Extracted from RepoDetail so the same tab taxonomy and feature-flag/layout
 * filtering can be reused by the remote-first shell (RemoteSubBar) without
 * duplicating logic. Keeping it pure also makes it unit-testable.
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
    { key: 'work-items', label: 'Work Items', shortcut: 'Alt+I' },
    { key: 'dreams', label: 'Dreams', shortcut: 'Alt+D' },
    { key: 'pull-requests', label: 'Pull Requests', shortcut: 'Alt+R' },
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
    return tabs;
}
