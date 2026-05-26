/**
 * usePromptAutocompleteEnabled — global preference for inline autocomplete.
 *
 * Mirrors the pattern of `useLinkHandlers`:
 *   - Module-level shared state.
 *   - Fetches `GET /api/preferences` exactly once at startup.
 *   - All hook instances stay in sync.
 *
 * Default is disabled (false). Server-side preference `promptAutocomplete.enabled`
 * must be set to true to enable suggestions across the relevant inputs.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { getSpaCocClient } from '../api/cocClient';

let currentEnabled = false;
let serverFetched = false;
const listeners = new Set<() => void>();

function notifyAll(): void {
    for (const fn of listeners) fn();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function getSnapshot(): boolean {
    return currentEnabled;
}

/** @internal Reset module-level state for testing. */
export function __resetForTesting(): void {
    currentEnabled = false;
    serverFetched = false;
    listeners.clear();
}

export function usePromptAutocompleteEnabled(): boolean {
    const enabled = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    useEffect(() => {
        if (serverFetched) return;
        serverFetched = true;
        (async () => {
            try {
                const prefs = await getSpaCocClient().preferences.getGlobal();
                const setting = (prefs as any).promptAutocomplete;
                if (setting && typeof setting.enabled === 'boolean') {
                    if (currentEnabled !== setting.enabled) {
                        currentEnabled = setting.enabled;
                        notifyAll();
                    }
                }
            } catch {
                // Server unavailable — keep default (disabled).
            }
        })();
    }, []);

    return enabled;
}
