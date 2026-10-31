import type { UnifiedPanelTab, UnifiedTabKind } from './unifiedPanelTabsModel';

export type UnifiedTabStripGroup = 'tools' | 'files' | 'web' | 'canvas';

export const UNIFIED_TAB_STRIP_GROUPS: readonly UnifiedTabStripGroup[] = ['tools', 'files', 'web', 'canvas'];

export function stripGroupForKind(kind: UnifiedTabKind): UnifiedTabStripGroup {
    switch (kind) {
        case 'terminal':
        case 'notes':
        case 'settings':
        case 'work-items':
        case 'pull-requests':
        case 'todo':
        case 'git':
            return 'tools';
        case 'file':
        case 'diff':
        case 'note':
        case 'paste':
        case 'external':
            return 'files';
        case 'browser':
        case 'html-page':
            return 'web';
        case 'canvas':
            return 'canvas';
        default: {
            const exhaustive: never = kind;
            return exhaustive;
        }
    }
}

export interface GroupStripTabsOptions {
    activeId?: string | null;
    previewId?: string | null;
    pinnedId?: string | null;
    cap?: number;
    folded: ReadonlySet<UnifiedTabStripGroup>;
    narrow: boolean;
    dirtyIds?: ReadonlySet<string>;
    errorIds?: ReadonlySet<string>;
}

export interface UnifiedTabStripGroupModel {
    group: UnifiedTabStripGroup;
    tabs: UnifiedPanelTab[];
    shown: UnifiedPanelTab[];
    hidden: UnifiedPanelTab[];
    hasActive: boolean;
    hiddenDirty: boolean;
    hiddenError: boolean;
}

export function groupStripTabs(
    tabs: readonly UnifiedPanelTab[],
    options: GroupStripTabsOptions,
): UnifiedTabStripGroupModel[] {
    const { activeId, previewId, pinnedId, folded, narrow, dirtyIds, errorIds } = options;
    const cap = Number.isFinite(options.cap) ? Math.max(0, Math.floor(options.cap!)) : 3;
    return UNIFIED_TAB_STRIP_GROUPS.flatMap(group => {
        const members = tabs.filter(tab => stripGroupForKind(tab.kind) === group);
        if (!members.length) return [];
        const hasActive = members.some(tab => tab.id === activeId);
        const selected = new Set<string>();
        const compact = folded.has(group) || (narrow && !hasActive);
        const priority = compact ? [pinnedId, hasActive ? activeId : null] : [pinnedId, activeId, previewId];
        for (const id of priority) {
            if (id != null && members.some(tab => tab.id === id)) selected.add(id);
        }
        if (!compact) {
            for (const tab of members) {
                if (selected.size >= cap) break;
                selected.add(tab.id);
            }
        }
        // Overflow selections occupy a stable trailing slot, not the position
        // where their saved descriptor happens to sit among the other survivors.
        const promoted = compact ? [] : [activeId, previewId].filter((id, index, ids): id is string =>
            id != null && selected.has(id) && ids.indexOf(id) === index
            && members.findIndex(tab => tab.id === id) >= cap);
        const shown = [
            ...members.filter(tab => selected.has(tab.id) && !promoted.includes(tab.id)),
            ...promoted.map(id => members.find(tab => tab.id === id)!),
        ];
        const hidden = members.filter(tab => !selected.has(tab.id));
        return [{
            group, tabs: members, shown, hidden, hasActive,
            hiddenDirty: hidden.some(tab => dirtyIds?.has(tab.id)),
            hiddenError: hidden.some(tab => errorIds?.has(tab.id)),
        }];
    });
}

export interface CategoryStripTabsOptions {
    activeId?: string | null;
    /** The tab last shown in each category, remembered by the strip. */
    lastUsedIds?: Partial<Record<UnifiedTabStripGroup, string>>;
    dirtyIds?: ReadonlySet<string>;
    errorIds?: ReadonlySet<string>;
}

/**
 * One chip per non-empty category. The chip's tab is the active tab when the
 * category holds it, else the category's last-used tab, else its last tab in
 * saved order (the most recently opened one). Every other tab is `hidden`,
 * reachable from the category's own menu.
 */
export function categoryStripTabs(
    tabs: readonly UnifiedPanelTab[],
    options: CategoryStripTabsOptions,
): UnifiedTabStripGroupModel[] {
    const { activeId, lastUsedIds, dirtyIds, errorIds } = options;
    return UNIFIED_TAB_STRIP_GROUPS.flatMap(group => {
        const members = tabs.filter(tab => stripGroupForKind(tab.kind) === group);
        if (!members.length) return [];
        const find = (id: string | null | undefined) => (id == null ? undefined : members.find(tab => tab.id === id));
        const current = find(activeId) ?? find(lastUsedIds?.[group]) ?? members[members.length - 1];
        const hidden = members.filter(tab => tab !== current);
        return [{
            group, tabs: members, shown: [current], hidden, hasActive: current.id === activeId,
            hiddenDirty: hidden.some(tab => dirtyIds?.has(tab.id)),
            hiddenError: hidden.some(tab => errorIds?.has(tab.id)),
        }];
    });
}

export function isGroupBoundaryMove(tabs: readonly UnifiedPanelTab[], fromId: string, toId: string): boolean {
    const from = tabs.find(tab => tab.id === fromId);
    const to = tabs.find(tab => tab.id === toId);
    return !from || !to || stripGroupForKind(from.kind) !== stripGroupForKind(to.kind);
}
