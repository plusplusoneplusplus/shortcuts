/**
 * useDiffEngine — which engine renders the working-tree file diff.
 *
 * 'legacy' → classic UnifiedDiffViewer / SideBySideDiffViewer
 * 'monaco' → MonacoFileDiffViewer
 *
 * Stored globally in server-side GlobalPreferences (`diffEngine`) so the
 * choice follows the user across machines, and cached in localStorage so the
 * first paint after a reload already uses the right engine. All hook
 * instances share one store.
 *
 * Reconcile rules:
 * - The localStorage cache supplies the initial value synchronously.
 * - The server value wins when it arrives, unless the user (or another tab)
 *   changed the engine while the request was pending.
 * - A failed server write keeps the local choice for the session.
 * - A `storage` event from another tab updates this tab.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { GlobalPreferences } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../../api/cocClient';

export type DiffEngine = 'legacy' | 'monaco';

/** Engine used when neither the cache nor the server has a valid value. */
export const DEFAULT_DIFF_ENGINE: DiffEngine = 'legacy';

export const DIFF_ENGINE_STORAGE_KEY = 'coc-diff-engine';

export function isDiffEngine(value: unknown): value is DiffEngine {
    return value === 'legacy' || value === 'monaco';
}

/** Any stored or server value → a usable engine; unknown/absent → default. */
export function resolveDiffEngine(value: unknown): DiffEngine {
    return isDiffEngine(value) ? value : DEFAULT_DIFF_ENGINE;
}

export interface DiffEngineStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export interface DiffEngineStoreDeps {
    storage: () => DiffEngineStorage | null;
    getGlobal: () => Promise<Pick<GlobalPreferences, 'diffEngine'>>;
    patchGlobal: (patch: Pick<GlobalPreferences, 'diffEngine'>) => Promise<unknown>;
}

export interface DiffEngineStore {
    getSnapshot(): DiffEngine;
    subscribe(listener: () => void): () => void;
    /** User choice: applies now, caches locally, persists to the server. */
    set(next: DiffEngine): void;
    /** Fetch the server value once per store. Resolves when reconciled. */
    reconcile(): Promise<void>;
    /** Apply another tab's cached value (from a `storage` event). */
    applyStorageValue(raw: string | null): void;
}

export function createDiffEngineStore(deps: DiffEngineStoreDeps): DiffEngineStore {
    const readCache = (): DiffEngine => {
        try {
            return resolveDiffEngine(deps.storage()?.getItem(DIFF_ENGINE_STORAGE_KEY));
        } catch {
            return DEFAULT_DIFF_ENGINE;
        }
    };
    const writeCache = (value: DiffEngine) => {
        try { deps.storage()?.setItem(DIFF_ENGINE_STORAGE_KEY, value); } catch { /* storage unavailable */ }
    };

    let current = readCache();
    // Bumped on every local or cross-tab change so a pending server read
    // can tell it is stale.
    let localVersion = 0;
    let reconciling: Promise<void> | null = null;
    const listeners = new Set<() => void>();

    const apply = (next: DiffEngine) => {
        if (next === current) return;
        current = next;
        for (const fn of listeners) fn();
    };

    return {
        getSnapshot: () => current,
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        set(next) {
            localVersion++;
            writeCache(next);
            apply(next);
            let pending: Promise<unknown>;
            try {
                pending = deps.patchGlobal({ diffEngine: next });
            } catch {
                return;
            }
            pending.catch(() => { /* keep the local choice for this session */ });
        },
        reconcile() {
            if (reconciling) return reconciling;
            const startVersion = localVersion;
            reconciling = (async () => {
                try {
                    const prefs = await deps.getGlobal();
                    if (localVersion !== startVersion) return;
                    if (!isDiffEngine(prefs.diffEngine)) return;
                    writeCache(prefs.diffEngine);
                    apply(prefs.diffEngine);
                } catch {
                    // Server unavailable — keep the cached value.
                }
            })();
            return reconciling;
        },
        applyStorageValue(raw) {
            if (!isDiffEngine(raw)) return;
            localVersion++;
            apply(raw);
        },
    };
}

function browserStorage(): DiffEngineStorage | null {
    return typeof localStorage === 'undefined' ? null : localStorage;
}

function createDefaultStore(): DiffEngineStore {
    return createDiffEngineStore({
        storage: browserStorage,
        getGlobal: () => getSpaCocClient().preferences.getGlobal(),
        patchGlobal: (patch) => getSpaCocClient().preferences.patchGlobal(patch),
    });
}

let sharedStore: DiffEngineStore | null = null;

function getSharedStore(): DiffEngineStore {
    if (!sharedStore) sharedStore = createDefaultStore();
    return sharedStore;
}

/** @internal Drop the shared store so the next hook re-reads the cache. */
export function __resetDiffEngineForTesting(): void {
    sharedStore = null;
}

export function useDiffEngine(): [DiffEngine, (engine: DiffEngine) => void] {
    const store = getSharedStore();
    const engine = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

    useEffect(() => { void store.reconcile(); }, [store]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handler = (e: StorageEvent) => {
            if (e.key === DIFF_ENGINE_STORAGE_KEY) store.applyStorageValue(e.newValue);
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, [store]);

    return [engine, store.set];
}
