import { useCallback, useSyncExternalStore } from 'react';
import { unifiedPanelStorageKey } from './unifiedPanelTabsModel';
import { UNIFIED_TAB_STRIP_GROUPS, type UnifiedTabStripGroup } from './unifiedPanelTabGroups';

const EMPTY: ReadonlySet<UnifiedTabStripGroup> = new Set();
const listeners = new Map<string, Set<() => void>>();
const snapshotCache = new Map<string, { raw: string; value: ReadonlySet<UnifiedTabStripGroup> }>();

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

export function readUnifiedTabGroupState(scope: string): ReadonlySet<UnifiedTabStripGroup> {
    const key = storageKey(scope);
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(key);
    } catch {
        /* Storage can be disabled. */
    }
    if (raw === null) return EMPTY;
    const cached = snapshotCache.get(key);
    if (cached?.raw === raw) return cached.value;
    let value = EMPTY;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const groups = UNIFIED_TAB_STRIP_GROUPS.filter(group => parsed.includes(group));
            if (groups.length) value = new Set(groups);
        }
    } catch {
        /* Malformed chrome state falls back to unfolded groups. */
    }
    snapshotCache.set(key, { raw, value });
    return value;
}

export function toggleGroupFolded(scope: string, group: UnifiedTabStripGroup): void {
    const next = new Set(readUnifiedTabGroupState(scope));
    if (next.has(group)) next.delete(group);
    else next.add(group);
    const key = storageKey(scope);
    const groups = UNIFIED_TAB_STRIP_GROUPS.filter(item => next.has(item));
    const raw = JSON.stringify(groups);
    try {
        localStorage.setItem(key, raw);
    } catch {
        /* Ignore quota / disabled storage. */
    }
    snapshotCache.set(key, { raw, value: groups.length ? new Set(groups) : EMPTY });
    listeners.get(key)?.forEach(listener => listener());
}

export function useUnifiedTabGroupState(scope: string): ReadonlySet<UnifiedTabStripGroup> {
    const key = storageKey(scope);
    return useSyncExternalStore(
        useCallback(listener => subscribe(key, listener), [key]),
        useCallback(() => readUnifiedTabGroupState(scope), [scope]),
        () => EMPTY,
    );
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
