import { TRUSTED_PATH_PREFIX } from '../explorer/ExactOpen';
import type { UnifiedPanelTab } from './unifiedPanelTabsModel';

export type UnifiedPanelBulkCloseAction =
    | 'close-others'
    | 'close-right'
    | 'close-saved'
    | 'close-all';

export type UnifiedPanelTabMenuAction =
    | 'keep-open'
    | 'close'
    | UnifiedPanelBulkCloseAction
    | 'copy-path'
    | 'copy-relative-path'
    | 'reveal-in-explorer';

export interface UnifiedPanelTabMenuItem {
    action: UnifiedPanelTabMenuAction;
    label: string;
    group: 'keep-open' | 'close' | 'file';
    disabled: boolean;
}

export interface UnifiedPanelFileActionAvailability {
    copyPath: boolean;
    copyRelativePath: boolean;
    revealInExplorer: boolean;
}

export function unifiedPanelBulkCloseTargets(
    tabs: readonly UnifiedPanelTab[],
    sourceId: string,
    action: UnifiedPanelBulkCloseAction,
    dirtyIds: ReadonlySet<string>,
): string[] {
    const sourceIndex = tabs.findIndex(tab => tab.id === sourceId);
    if (sourceIndex < 0) return [];
    switch (action) {
        case 'close-others':
            return tabs.filter(tab => tab.id !== sourceId).map(tab => tab.id);
        case 'close-right':
            return tabs.slice(sourceIndex + 1).map(tab => tab.id);
        case 'close-saved':
            return tabs.filter(tab => !dirtyIds.has(tab.id)).map(tab => tab.id);
        case 'close-all':
            return tabs.map(tab => tab.id);
    }
}

export function unifiedPanelTabMenuItems(
    tab: UnifiedPanelTab,
    tabs: readonly UnifiedPanelTab[],
    dirtyIds: ReadonlySet<string>,
    fileActions: UnifiedPanelFileActionAvailability = {
        copyPath: false,
        copyRelativePath: false,
        revealInExplorer: false,
    },
): UnifiedPanelTabMenuItem[] {
    const items: UnifiedPanelTabMenuItem[] = [];
    if (tab.preview) {
        items.push({ action: 'keep-open', label: 'Keep Open', group: 'keep-open', disabled: false });
    }
    items.push(
        { action: 'close', label: 'Close', group: 'close', disabled: false },
        {
            action: 'close-others',
            label: 'Close Others',
            group: 'close',
            disabled: unifiedPanelBulkCloseTargets(tabs, tab.id, 'close-others', dirtyIds).length === 0,
        },
        {
            action: 'close-right',
            label: 'Close to the Right',
            group: 'close',
            disabled: unifiedPanelBulkCloseTargets(tabs, tab.id, 'close-right', dirtyIds).length === 0,
        },
        {
            action: 'close-saved',
            label: 'Close Saved',
            group: 'close',
            disabled: unifiedPanelBulkCloseTargets(tabs, tab.id, 'close-saved', dirtyIds).length === 0,
        },
        {
            action: 'close-all',
            label: 'Close All',
            group: 'close',
            disabled: unifiedPanelBulkCloseTargets(tabs, tab.id, 'close-all', dirtyIds).length === 0,
        },
    );
    if (tab.kind === 'file') {
        items.push(
            { action: 'copy-path', label: 'Copy Path', group: 'file', disabled: !fileActions.copyPath },
            {
                action: 'copy-relative-path',
                label: 'Copy Relative Path',
                group: 'file',
                disabled: !fileActions.copyRelativePath,
            },
            {
                action: 'reveal-in-explorer',
                label: 'Reveal in Explorer',
                group: 'file',
                disabled: !fileActions.revealInExplorer,
            },
        );
    }
    return items;
}

export function unifiedPanelRelativeFilePath(tab: UnifiedPanelTab): string | null {
    if (tab.kind !== 'file' || tab.resourceId.startsWith(TRUSTED_PATH_PREFIX)) return null;
    return tab.resourceId;
}

export function unifiedPanelAbsoluteFilePath(
    tab: UnifiedPanelTab,
    workspaceRootPath: string | null | undefined,
): string | null {
    if (tab.kind !== 'file') return null;
    if (tab.resourceId.startsWith(TRUSTED_PATH_PREFIX)) {
        const trustedPath = tab.resourceId.slice(TRUSTED_PATH_PREFIX.length);
        return trustedPath || null;
    }
    const root = workspaceRootPath?.trim();
    if (!root) return null;
    const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
    const normalizedRoot = root.replace(/[\\/]+$/, '');
    const relative = tab.resourceId.replace(/^[\\/]+/, '').replace(/[\\/]/g, separator);
    return `${normalizedRoot}${separator}${relative}`;
}

export function unifiedPanelFileActionAvailability(
    tab: UnifiedPanelTab,
    workspaceRootPath: string | null | undefined,
): UnifiedPanelFileActionAvailability {
    if (tab.kind !== 'file') {
        return { copyPath: false, copyRelativePath: false, revealInExplorer: false };
    }
    const relativePath = unifiedPanelRelativeFilePath(tab);
    return {
        copyPath: unifiedPanelAbsoluteFilePath(tab, workspaceRootPath) !== null,
        copyRelativePath: relativePath !== null,
        revealInExplorer: relativePath !== null,
    };
}
