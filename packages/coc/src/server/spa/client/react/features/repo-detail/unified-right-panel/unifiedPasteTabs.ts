import { unifiedPanelStorageKey, type OpenUnifiedTabInput, type UnifiedPanelState } from './unifiedPanelTabsModel';

/** Stable FNV-1a hash over UTF-16 code units, without putting paste text in ids. */
export function pasteResourceId(content: string): string {
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < content.length; index += 1) {
        hash = BigInt.asUintN(64, (hash ^ BigInt(content.charCodeAt(index))) * 0x100000001b3n);
    }
    return `paste:${content.length}:${hash.toString(16).padStart(16, '0')}`;
}

/** Descriptor only: the raw snapshot stays in client memory, outside panel state. */
export function pasteOpenInput(
    content: string,
    context: Pick<OpenUnifiedTabInput, 'ownerWorkspaceId' | 'ownerRoutingRef' | 'chatId' | 'repoLabel'>,
): OpenUnifiedTabInput {
    return {
        ...context,
        kind: 'paste',
        resourceId: pasteResourceId(content),
        label: `Pasted text (${content.length} chars)`,
    };
}

// A panel scope owns its snapshots; draft inheritance can share one snapshot
// across tab ids, chats, and concrete owners inside that scope.
const snapshots = new Map<string, Map<string, string>>();

export function storePasteSnapshot(workspaceId: string, resourceId: string, content: string): void {
    const key = unifiedPanelStorageKey(workspaceId);
    let scope = snapshots.get(key);
    if (!scope) {
        scope = new Map();
        snapshots.set(key, scope);
    }
    if (!scope.has(resourceId)) scope.set(resourceId, content);
}

export function readPasteSnapshot(workspaceId: string, resourceId: string): string | undefined {
    return snapshots.get(unifiedPanelStorageKey(workspaceId))?.get(resourceId);
}

/** Called by every panel write, including closes while the panel is unmounted. */
export function prunePasteSnapshots(storageKey: string, state: UnifiedPanelState): void {
    const scope = snapshots.get(storageKey);
    if (!scope) return;
    const live = new Set(Object.values(state.chatTabs).flatMap(tabs =>
        tabs.filter(tab => tab.kind === 'paste').map(tab => tab.resourceId)));
    for (const resourceId of scope.keys()) {
        if (!live.has(resourceId)) scope.delete(resourceId);
    }
    if (scope.size === 0) snapshots.delete(storageKey);
}

export function clearPasteSnapshots(workspaceId?: string): void {
    if (workspaceId === undefined) snapshots.clear();
    else snapshots.delete(unifiedPanelStorageKey(workspaceId));
}
