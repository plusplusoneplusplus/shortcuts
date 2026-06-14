/**
 * useRemoteShell — client preference toggling the remote-first 2-row shell.
 *
 * When enabled, the dashboard's top navigation switches from per-clone repo
 * tabs to a remote-first model:
 *   • Row 1 (RemoteTopBar) — one tab per git remote (origin), with a clone
 *     count, aggregate status and unseen badge.
 *   • Row 2 (RemoteSubBar) — remote-scoped tabs (Work Items, Pull Requests) on
 *     the left, a clone-switcher popover + clone-scoped tabs (Activity, CLI
 *     Sessions, Git, Terminal, …) on the right, plus compact Ask / Queue.
 *
 * Backed by localStorage (purely client-side — no server preference needed)
 * with a module-level store so all hook instances stay in sync. Mirrors the
 * shared-store shape of useUiLayoutMode.
 */

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'coc-remote-shell-enabled';

function readInitial(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

let enabled = readInitial();
const listeners = new Set<() => void>();

function notifyAll(): void {
    for (const fn of listeners) fn();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function getSnapshot(): boolean {
    return enabled;
}

/** Read the current value synchronously without subscribing (non-component code). */
export function getRemoteShellEnabled(): boolean {
    return enabled;
}

export function setRemoteShellEnabled(next: boolean): void {
    if (next === enabled) return;
    enabled = next;
    try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
        // Storage unavailable (private mode / SSR) — keep the in-memory value.
    }
    notifyAll();
}

/** @internal Reset module-level state for testing. */
export function __resetRemoteShellForTesting(): void {
    enabled = false;
    listeners.clear();
}

/** @internal Force a value for testing without touching localStorage. */
export function __setRemoteShellForTesting(next: boolean): void {
    enabled = next;
    notifyAll();
}

export function useRemoteShell(): [boolean, (next: boolean) => void] {
    const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return [value, setRemoteShellEnabled];
}
