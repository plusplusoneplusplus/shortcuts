/**
 * useLinkHandlers — persisted link-handler config hook.
 *
 * Mirrors the pattern of `useUiLayoutMode`:
 * - Module-level shared state so all hook instances stay in sync.
 * - Fetches `GET /api/preferences` exactly once at startup.
 * - `setHandlerEnabled(name, enabled)` writes back via `PATCH /api/preferences`
 *   (fire-and-forget) and notifies all subscribers immediately.
 *
 * All handlers are disabled by default (absent key = disabled).
 */

import { useEffect, useSyncExternalStore } from 'react';
import { getApiBase } from '../utils/config';

// ── Module-level shared store ────────────────────────────────────────────────

let currentConfig: Record<string, boolean> = {};
let serverFetched = false;
const listeners = new Set<() => void>();

function notifyAll(): void {
    for (const fn of listeners) fn();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function getSnapshot(): Record<string, boolean> {
    return currentConfig;
}

/** @internal Reset module-level state for testing. */
export function __resetForTesting(): void {
    currentConfig = {};
    serverFetched = false;
    listeners.clear();
}

/**
 * Returns the current link-handler config snapshot.
 * Safe to call from non-React code (e.g. vanilla event listeners).
 */
export function getLinkHandlersConfig(): Record<string, boolean> {
    return currentConfig;
}

function setSharedHandlerEnabled(name: string, enabled: boolean): void {
    const next = { ...currentConfig, [name]: enabled };
    currentConfig = next;
    notifyAll();
    fetch(getApiBase() + '/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkHandlers: next }),
    }).catch(() => {});
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useLinkHandlers(): [
    config: Record<string, boolean>,
    setHandlerEnabled: (name: string, enabled: boolean) => void,
] {
    const config = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    useEffect(() => {
        if (serverFetched) return;
        serverFetched = true;
        (async () => {
            try {
                const res = await fetch(getApiBase() + '/preferences');
                if (!res.ok) return;
                const prefs = await res.json();
                const serverHandlers = prefs.linkHandlers;
                if (typeof serverHandlers === 'object' && serverHandlers !== null) {
                    currentConfig = serverHandlers as Record<string, boolean>;
                    notifyAll();
                }
            } catch {
                // Server unavailable — keep defaults (all disabled)
            }
        })();
    }, []);

    return [config, setSharedHandlerEnabled];
}
