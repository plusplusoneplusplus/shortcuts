import { useCallback, useSyncExternalStore } from 'react';
import { unifiedPanelStorageKey } from './unifiedPanelTabsModel';
import { moveGroupInOrder, normalizeGroupOrder, UNIFIED_TAB_STRIP_GROUPS, type UnifiedTabStripGroup } from './unifiedPanelTabGroups';

const EMPTY: ReadonlySet<UnifiedTabStripGroup> = new Set();
const listeners = new Map<string, Set<() => void>>();
const snapshotCache = new Map<string, { raw: string; value: GroupLayout }>();

function storageKey(scope: string): string {
    return unifiedPanelStorageKey(scope).replace(/:tabs$/, ':groups');
}

function subscribe(key: string, listener: () => void): () => void {
    let set = listeners.get(key);
    if (!set) listeners.set(key, set = new Set());
    set.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === key) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(key);
        window.removeEventListener('storage', onStorage);
    };
}

interface GroupLayout {
    folded: ReadonlySet<UnifiedTabStripGroup>;
    order: readonly UnifiedTabStripGroup[];
}

const DEFAULT_LAYOUT: GroupLayout = { folded: EMPTY, order: normalizeGroupOrder(undefined) };

/**
 * One record per panel scope: `{ folded, order }`. A bare array is the older
 * folded-only form and still reads as fold state with the default order.
 */
function readLayout(scope: string): GroupLayout {
    const key = storageKey(scope);
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(key);
    } catch {
        /* Storage can be disabled. */
    }
    if (raw === null) return DEFAULT_LAYOUT;
    const cached = snapshotCache.get(key);
    if (cached?.raw === raw) return cached.value;
    let value = DEFAULT_LAYOUT;
    try {
        const parsed: unknown = JSON.parse(raw);
        const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as { folded?: unknown; order?: unknown } : null;
        const folded = Array.isArray(parsed) ? parsed : record?.folded;
        const groups = Array.isArray(folded) ? UNIFIED_TAB_STRIP_GROUPS.filter(group => folded.includes(group)) : [];
        value = {
            folded: groups.length ? new Set(groups) : EMPTY,
            order: record ? normalizeGroupOrder(record.order) : DEFAULT_LAYOUT.order,
        };
    } catch {
        /* Malformed chrome state falls back to unfolded groups in default order. */
    }
    snapshotCache.set(key, { raw, value });
    return value;
}

function writeLayout(scope: string, folded: ReadonlySet<UnifiedTabStripGroup>, order: readonly UnifiedTabStripGroup[]): void {
    const key = storageKey(scope);
    const groups = UNIFIED_TAB_STRIP_GROUPS.filter(item => folded.has(item));
    const value: GroupLayout = { folded: groups.length ? new Set(groups) : EMPTY, order: normalizeGroupOrder(order) };
    const raw = JSON.stringify({ folded: groups, order: value.order });
    try {
        localStorage.setItem(key, raw);
    } catch {
        /* Ignore quota / disabled storage. */
    }
    snapshotCache.set(key, { raw, value });
    listeners.get(key)?.forEach(listener => listener());
}

export function readUnifiedTabGroupState(scope: string): ReadonlySet<UnifiedTabStripGroup> {
    return readLayout(scope).folded;
}

export function readUnifiedTabGroupOrder(scope: string): readonly UnifiedTabStripGroup[] {
    return readLayout(scope).order;
}

export function toggleGroupFolded(scope: string, group: UnifiedTabStripGroup): void {
    const { folded, order } = readLayout(scope);
    const next = new Set(folded);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    writeLayout(scope, next, order);
}

/** Move a whole group block before `beforeGroup`, or last when it is null. */
export function moveTabGroup(scope: string, group: UnifiedTabStripGroup, beforeGroup: UnifiedTabStripGroup | null): void {
    const { folded, order } = readLayout(scope);
    const next = moveGroupInOrder(order, group, beforeGroup);
    if (next.every((entry, index) => entry === order[index])) return;
    writeLayout(scope, folded, next);
}

function useGroupLayout<T>(scope: string, select: (layout: GroupLayout) => T): T {
    const key = storageKey(scope);
    return useSyncExternalStore(
        useCallback(listener => subscribe(key, listener), [key]),
        () => select(readLayout(scope)),
        () => select(DEFAULT_LAYOUT),
    );
}

export function useUnifiedTabGroupState(scope: string): ReadonlySet<UnifiedTabStripGroup> {
    return useGroupLayout(scope, layout => layout.folded);
}

export function useUnifiedTabGroupOrder(scope: string): readonly UnifiedTabStripGroup[] {
    return useGroupLayout(scope, layout => layout.order);
}

export function clearUnifiedTabGroupState(scope?: string): void {
    const keys = new Set(scope === undefined
        ? [...snapshotCache.keys(), ...listeners.keys()]
        : [storageKey(scope)]);
    if (scope === undefined) {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith('unified-right-panel:') && key.endsWith(':groups')) keys.add(key);
            }
        } catch {
            /* Ignore disabled storage. */
        }
    }
    for (const key of keys) {
        try {
            localStorage.removeItem(key);
        } catch {
            /* Ignore disabled storage. */
        }
        snapshotCache.delete(key);
        listeners.get(key)?.forEach(listener => listener());
    }
}
