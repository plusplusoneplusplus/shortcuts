import {
    parseUnifiedPanelNavigationHistory,
    serializeUnifiedPanelNavigationHistory,
    type UnifiedPanelNavigationHistory,
} from './unifiedPanelNavigationHistory';

const histories = new Map<string, UnifiedPanelNavigationHistory>();

const KEY_PREFIX = 'unified-right-panel:';
const KEY_SUFFIX = ':navigation';

/** localStorage key for one panel scope's file location history. */
export function unifiedPanelNavigationStorageKey(workspaceId: string): string {
    return `${KEY_PREFIX}${workspaceId}${KEY_SUFFIX}`;
}

export function readUnifiedPanelNavigationHistory(
    workspaceId: string,
): UnifiedPanelNavigationHistory {
    const cached = histories.get(workspaceId);
    if (cached) return cached;
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(unifiedPanelNavigationStorageKey(workspaceId));
    } catch {
        /* ignore */
    }
    const history = parseUnifiedPanelNavigationHistory(raw, workspaceId);
    histories.set(workspaceId, history);
    return history;
}

export function writeUnifiedPanelNavigationHistory(
    workspaceId: string,
    history: UnifiedPanelNavigationHistory,
): void {
    const previous = histories.get(workspaceId);
    histories.set(workspaceId, history);
    // A replay flag flip changes nothing on disk.
    if (previous && previous.entries === history.entries && previous.index === history.index) return;
    try {
        localStorage.setItem(
            unifiedPanelNavigationStorageKey(workspaceId),
            serializeUnifiedPanelNavigationHistory(history),
        );
    } catch {
        /* ignore */
    }
}

export function clearUnifiedPanelNavigationHistory(workspaceId?: string): void {
    const keys: string[] = [];
    if (workspaceId === undefined) {
        histories.clear();
        try {
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (key?.startsWith(KEY_PREFIX) && key.endsWith(KEY_SUFFIX)) keys.push(key);
            }
        } catch {
            /* ignore */
        }
    } else {
        histories.delete(workspaceId);
        keys.push(unifiedPanelNavigationStorageKey(workspaceId));
    }
    for (const key of keys) {
        try {
            localStorage.removeItem(key);
        } catch {
            /* ignore */
        }
    }
}
