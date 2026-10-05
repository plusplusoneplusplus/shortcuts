import { useEffect, useSyncExternalStore } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';

/** Global display preference, shared by every diff surface and workspace. */
function createStore() {
    let enabled = false;
    let version = 0;
    let fetched = false;
    let writes = Promise.resolve();
    const listeners = new Set<() => void>();
    const apply = (next: boolean) => {
        if (enabled === next) return;
        enabled = next;
        for (const listener of listeners) listener();
    };
    return {
        getSnapshot: () => enabled,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        async reconcile() {
            if (fetched) return;
            fetched = true;
            const startVersion = version;
            try {
                const prefs = await getSpaCocClient().preferences.getGlobal();
                if (version === startVersion && typeof prefs.diffWordWrap === 'boolean') {
                    apply(prefs.diffWordWrap);
                }
            } catch { /* server unavailable — keep the session choice */ }
        },
        set(next: boolean) {
            version++;
            apply(next);
            // Preserve rapid toggle order on disk, even with slow requests.
            writes = writes.then(async () => {
                try {
                    await getSpaCocClient().preferences.patchGlobal({ diffWordWrap: next });
                } catch { /* keep the session choice if persistence fails */ }
            });
        },
    };
}

let sharedStore: ReturnType<typeof createStore> | null = null;

/** @internal Start a fresh session for tests. */
export function __resetDiffWordWrapForTesting(): void {
    sharedStore = null;
}

export function useDiffWordWrap(): [boolean, (enabled: boolean) => void] {
    const store = sharedStore ??= createStore();
    const enabled = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    useEffect(() => { void store.reconcile(); }, [store]);
    return [enabled, store.set];
}
