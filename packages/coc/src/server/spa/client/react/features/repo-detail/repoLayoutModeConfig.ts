import type { RepoSubTab, UiLayoutMode } from '../../types/dashboard';

export type RepoLayoutTab = { key: RepoSubTab; label: string; shortcut?: string };

const DEV_WORKFLOW_RELABELS: Partial<Record<RepoSubTab, string>> = {
    'schedules': 'Jobs',
    'pull-requests': 'Full Requests',
};

const DEV_WORKFLOW_ORDER: RepoSubTab[] = [
    'chats', 'work-items', 'schedules', 'explorer',
    'workflows', 'git', 'pull-requests', 'tasks', 'settings',
];

const NOTES_CENTRIC_RELABELS: Partial<Record<RepoSubTab, string>> = {
    'chats': 'Activity',
    'schedules': 'Jobs',
};

const NOTES_CENTRIC_ORDER: RepoSubTab[] = [
    'notes', 'git', 'work-items', 'chats', 'schedules', 'explorer',
    'workflows', 'pull-requests', 'tasks', 'terminal', 'wiki', 'settings',
];

export function getRepoTabsForLayout(tabs: readonly RepoLayoutTab[], mode: UiLayoutMode): RepoLayoutTab[] {
    if (mode === 'classic') {
        return tabs
            .map(t => t.key === 'chats' ? { ...t, key: 'activity' as RepoSubTab, label: 'Activity' } : t)
            .map(t => t.key === 'tasks' ? { ...t, label: 'Plans (Dep.)' } : t);
    }

    if (mode === 'notes-centric') {
        return orderAndRelabelTabs(tabs, NOTES_CENTRIC_ORDER, NOTES_CENTRIC_RELABELS);
    }

    return orderAndRelabelTabs(tabs, DEV_WORKFLOW_ORDER, DEV_WORKFLOW_RELABELS);
}

export function getMobilePinnedTabsForLayout(mode: UiLayoutMode): RepoSubTab[] {
    if (mode === 'classic') return ['activity', 'tasks', 'git'];
    if (mode === 'notes-centric') return ['notes', 'git', 'work-items'];
    return ['chats', 'work-items', 'schedules'];
}

export function getDefaultRepoSubTabForLayout(mode: UiLayoutMode, availableTabs: readonly RepoLayoutTab[]): RepoSubTab | undefined {
    const available = new Set(availableTabs.map(t => t.key));
    const priorities: RepoSubTab[] = mode === 'classic'
        ? ['activity']
        : mode === 'notes-centric'
            ? ['notes', 'git', 'work-items', 'chats']
            : ['chats'];

    return priorities.find(tab => available.has(tab)) ?? availableTabs[0]?.key;
}

export function isChatBackedLayoutMode(mode: UiLayoutMode): boolean {
    return mode === 'dev-workflow' || mode === 'notes-centric';
}

function orderAndRelabelTabs(
    tabs: readonly RepoLayoutTab[],
    order: readonly RepoSubTab[],
    relabels: Partial<Record<RepoSubTab, string>>,
): RepoLayoutTab[] {
    const tabMap = new Map(tabs.map(t => [t.key, t]));
    const ordered: RepoLayoutTab[] = [];
    for (const key of order) {
        const tab = tabMap.get(key);
        if (tab) {
            ordered.push(relabelTab(tab, relabels));
            tabMap.delete(key);
        }
    }
    for (const [, tab] of tabMap) {
        ordered.push(relabelTab(tab, relabels));
    }
    return ordered;
}

function relabelTab(tab: RepoLayoutTab, relabels: Partial<Record<RepoSubTab, string>>): RepoLayoutTab {
    const label = relabels[tab.key];
    return label ? { ...tab, label } : tab;
}
