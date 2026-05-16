/**
 * useUiLayoutMode — persisted UI layout mode hook.
 *
 * 'classic'      → unified Activity tab (all processes in one view)
 * 'dev-workflow'  → split Chats + Work Items + Tasks tabs
 *
 * Backed by server-side GlobalPreferences (GET/PATCH /api/preferences).
 * All hook instances share state via a module-level store so that
 * changing the mode in one component updates all others immediately.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { UiLayoutMode } from '../../types/dashboard';
import { getSpaCocClient } from '../../api/cocClient';

const DEFAULT_MODE: UiLayoutMode = 'dev-workflow';

// ── Module-level shared store ────────────────────────────────────────────────
let currentMode: UiLayoutMode = DEFAULT_MODE;
let serverFetched = false;
const listeners = new Set<() => void>();

function notifyAll(): void {
    for (const fn of listeners) fn();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function getSnapshot(): UiLayoutMode {
    return currentMode;
}

/**
 * Read the current UI layout mode synchronously without subscribing.
 * Use from non-component code (e.g. the Router hash parser) where a hook
 * isn't available. Returns the cached mode; the server-fetched value
 * propagates through useSyncExternalStore once the hook mounts.
 */
export function getUiLayoutMode(): UiLayoutMode {
    return currentMode;
}

/** @internal Reset module-level state for testing. */
export function __resetForTesting(): void {
    currentMode = DEFAULT_MODE;
    serverFetched = false;
    listeners.clear();
}

/** @internal Force a specific mode for testing without API calls. */
export function __setModeForTesting(mode: UiLayoutMode): void {
    currentMode = mode;
    notifyAll();
}

function setSharedMode(next: UiLayoutMode): void {
    if (next === currentMode) return;
    currentMode = next;
    notifyAll();
    // Persist to server (fire-and-forget)
    getSpaCocClient().preferences.patchGlobal({ uiLayoutMode: next }).catch(() => {});
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useUiLayoutMode(): [UiLayoutMode, (mode: UiLayoutMode) => void] {
    const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    // Fetch server state once across all instances
    useEffect(() => {
        if (serverFetched) return;
        serverFetched = true;
        (async () => {
            try {
                const prefs = await getSpaCocClient().preferences.getGlobal();
                const serverMode = prefs.uiLayoutMode;
                if ((serverMode === 'classic' || serverMode === 'dev-workflow') && serverMode !== currentMode) {
                    currentMode = serverMode;
                    notifyAll();
                }
            } catch {
                // Server unavailable — keep default
            }
        })();
    }, []);

    return [mode, setSharedMode];
}
