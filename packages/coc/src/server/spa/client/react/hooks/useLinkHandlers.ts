/**
 * useLinkHandlers — persisted link-handler config hook.
 *
 * Mirrors the pattern of `useUiLayoutMode`:
 * - Module-level shared state so all hook instances stay in sync.
 * - Fetches `GET /api/preferences` exactly once at startup.
 * - `setHandlerEnabled(name, enabled)` writes back via `PATCH /api/preferences`
 *   (fire-and-forget) and notifies all subscribers immediately.
 *
 * All built-in handlers are enabled by default (absent key = enabled).
 */

import { useEffect, useSyncExternalStore } from 'react';
import { getSpaCocClient } from '../api/cocClient';
import { DEFAULT_LINK_HANDLERS_CONFIG } from '../utils/link-handler';

// ── Module-level shared store ────────────────────────────────────────────────

let currentConfig: Record<string, boolean> = { ...DEFAULT_LINK_HANDLERS_CONFIG };
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
    currentConfig = { ...DEFAULT_LINK_HANDLERS_CONFIG };
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
    getSpaCocClient().preferences.patchGlobal({ linkHandlers: next } as any).catch(() => {});
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
                const prefs = await getSpaCocClient().preferences.getGlobal();
                const serverHandlers = (prefs as any).linkHandlers;
                if (typeof serverHandlers === 'object' && serverHandlers !== null) {
                    currentConfig = {
                        ...DEFAULT_LINK_HANDLERS_CONFIG,
                        ...(serverHandlers as Record<string, boolean>),
                    };
                    notifyAll();
                }
            } catch {
                // Server unavailable — keep defaults.
            }
        })();
    }, []);

    return [config, setSharedHandlerEnabled];
}
