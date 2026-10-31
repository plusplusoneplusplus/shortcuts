import { TRUSTED_PATH_PREFIX } from '../explorer/ExactOpen';
import { WORKSPACE_PREVIEW_PREFIX } from '../../../shared/file-viewer/workspacePreview';
import type { UnifiedPanelTab } from './unifiedPanelTabsModel';
import { isAbsolutePath, resolveRelativePath } from '../../../utils/path-resolution';
import { parseNoteResourceId } from './unifiedNoteTabs';
import { isGroupBoundaryMove, stripGroupForKind } from './unifiedPanelTabGroups';
import { canDuplicateBrowserTab } from './unifiedBrowserTabs';

export type UnifiedPanelBulkCloseAction =
    | 'close-others'
    | 'close-right'
    | 'close-saved'
    | 'close-group'
    | 'close-others-in-group'
    | 'close-all';

export type UnifiedPanelTabMenuAction =
    | 'move-left'
    | 'move-right'
    | 'keep-open'
    | 'duplicate'
    | 'close'
    | UnifiedPanelBulkCloseAction
    | 'copy-path'
    | 'copy-relative-path'
    | 'reveal-in-explorer'
    | 'open-to-side';

export interface UnifiedPanelTabMenuItem {
    action: UnifiedPanelTabMenuAction;
    label: string;
    group: 'keep-open' | 'browser' | 'close' | 'file' | 'move';
    disabled: boolean;
}

export interface UnifiedPanelFileActionAvailability {
    copyPath: boolean;
    copyRelativePath: boolean;
    revealInExplorer: boolean;
    /** The source split is available: offer "Open to the Right". */
    openToSide?: boolean;
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
        case 'close-group':
        case 'close-others-in-group': {
            const group = stripGroupForKind(tabs[sourceIndex].kind);
            return tabs.filter(tab => stripGroupForKind(tab.kind) === group
                && (action === 'close-group' || tab.id !== sourceId)).map(tab => tab.id);
        }
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
    movableIds?: readonly string[],
    groupsEnabled = false,
): UnifiedPanelTabMenuItem[] {
    const items: UnifiedPanelTabMenuItem[] = [];
    if (movableIds) {
        const permittedIds = groupsEnabled
            ? movableIds.filter(id => !isGroupBoundaryMove(tabs, tab.id, id))
            : movableIds;
        const index = permittedIds.indexOf(tab.id);
        items.push(
            { action: 'move-left', label: 'Move left', group: 'move', disabled: index <= 0 },
            { action: 'move-right', label: 'Move right', group: 'move', disabled: index < 0 || index >= permittedIds.length - 1 },
        );
    }
    if (tab.preview) {
        items.push({ action: 'keep-open', label: 'Keep Open', group: 'keep-open', disabled: false });
    }
    // Only web tabs duplicate; file and HTML previews keep their own open rules.
    if (tab.kind === 'browser') {
        items.push({ action: 'duplicate', label: 'Duplicate', group: 'browser', disabled: !canDuplicateBrowserTab(tab) });
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
    if (groupsEnabled) {
        items.push(
            { action: 'close-group', label: 'Close all in group', group: 'close', disabled: false },
            { action: 'close-others-in-group', label: 'Close others in group', group: 'close',
                disabled: unifiedPanelBulkCloseTargets(tabs, tab.id, 'close-others-in-group', dirtyIds).length === 0 },
        );
    }
    if (fileActions.copyPath && (tab.kind === 'file' || tab.kind === 'note')) {
        items.push({ action: 'copy-path', label: 'Copy path', group: 'file', disabled: false });
    }
    if (tab.kind === 'file') {
        if (fileActions.openToSide) {
            items.push({ action: 'open-to-side', label: 'Open to the Right', group: 'file', disabled: false });
        }
        items.push(
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
    if (tab.kind !== 'file' || tab.resourceId.startsWith(TRUSTED_PATH_PREFIX)
        || tab.resourceId.startsWith(WORKSPACE_PREVIEW_PREFIX)) return null;
    return tab.resourceId;
}

export function unifiedPanelAbsoluteFilePath(
    tab: UnifiedPanelTab,
    workspaceRootPath: string | null | undefined,
): string | null {
    if (tab.kind === 'note') {
        const resource = parseNoteResourceId(tab.resourceId);
        if (!resource) return null;
        // Tasks paths are relative to their saved task root, which can differ
        // from the workspace root. Never guess a default tasks directory.
        return absoluteFilePath(resource.notePath,
            resource.fetchMode === 'tasks' ? resource.notesRoot : workspaceRootPath);
    }
    if (tab.kind !== 'file') return null;
    for (const prefix of [WORKSPACE_PREVIEW_PREFIX, TRUSTED_PATH_PREFIX]) {
        if (tab.resourceId.startsWith(prefix)) {
            const path = tab.resourceId.slice(prefix.length);
            return isAbsolutePath(path) ? path : null;
        }
    }
    return absoluteFilePath(tab.resourceId, workspaceRootPath);
}

/** Pure path arithmetic on the owner's filesystem spelling; never local I/O. */
function absoluteFilePath(path: string, root: string | null | undefined): string | null {
    if (!path || path.includes('\0')) return null;
    if (isAbsolutePath(path)) return path;
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path) || path.startsWith('~')) return null;
    if (!root || !isAbsolutePath(root)) return null;
    const resolved = resolveRelativePath(root.replace(/\\/g, '/'), path.replace(/\\/g, '/'));
    return root.includes('\\') && !root.includes('/') ? resolved.replace(/\//g, '\\') : resolved;
}

export function unifiedPanelFileActionAvailability(
    tab: UnifiedPanelTab,
    workspaceRootPath: string | null | undefined,
): UnifiedPanelFileActionAvailability {
    if (tab.kind !== 'file') {
        return {
            copyPath: unifiedPanelAbsoluteFilePath(tab, workspaceRootPath) !== null,
            copyRelativePath: false,
            revealInExplorer: false,
        };
    }
    const relativePath = unifiedPanelRelativeFilePath(tab);
    return {
        copyPath: unifiedPanelAbsoluteFilePath(tab, workspaceRootPath) !== null,
        copyRelativePath: relativePath !== null,
        revealInExplorer: relativePath !== null,
    };
}
