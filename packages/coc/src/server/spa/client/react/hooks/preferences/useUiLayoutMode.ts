/**
 * useUiLayoutMode — persisted UI layout mode hook.
 *
 * 'classic'      → unified Activity tab (all processes in one view)
 * 'dev-workflow'  → split Chats + Work Items + Tasks tabs
 * 'notes-centric' → Notes first, with Git and Work Items nearby
 *
 * Backed by server-side GlobalPreferences (GET/PATCH /api/preferences).
 * All hook instances share state via a module-level store so that
 * changing the mode in one component updates all others immediately.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { UiLayoutMode } from '../../types/dashboard';
import { getApiBase } from '../../utils/config';

const DEFAULT_MODE: UiLayoutMode = 'classic';

function isUiLayoutMode(value: unknown): value is UiLayoutMode {
    return value === 'classic' || value === 'dev-workflow' || value === 'notes-centric';
}

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

/** @internal Reset module-level state for testing. */
export function __resetForTesting(): void {
    currentMode = DEFAULT_MODE;
    serverFetched = false;
    listeners.clear();
}

function setSharedMode(next: UiLayoutMode): void {
    if (next === currentMode) return;
    currentMode = next;
    notifyAll();
    // Persist to server (fire-and-forget)
    fetch(getApiBase() + '/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uiLayoutMode: next }),
    }).catch(() => {});
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
                const res = await fetch(getApiBase() + '/preferences');
                if (!res.ok) return;
                const prefs = await res.json();
                const serverMode = prefs.uiLayoutMode;
                if (isUiLayoutMode(serverMode) && serverMode !== currentMode) {
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
