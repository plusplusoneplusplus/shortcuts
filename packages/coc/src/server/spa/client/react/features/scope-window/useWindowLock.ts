/**
 * useWindowLock — React glue for the AC-02 locked single-scope window.
 *
 * A popped-out window boots the full SPA with `?window=<workspaceId>` in its
 * URL (see `scopeWindow.ts`). `useLockedWorkspaceId` reads that param once (it
 * never changes for the life of a window), and `useEnforceWindowLock` pins the
 * window to that scope: it forces `location.hash` onto the locked scope on boot
 * and on any drift, and sets the native OS window title to the scope's display
 * name so a monitor full of popped-out windows stays identifiable.
 *
 * Consumers of `useLockedWorkspaceId` (e.g. `TopBar`) hide the scope switcher
 * when it returns a non-null id — a locked window has no cross-scope UI.
 */

import { useEffect, useRef } from 'react';
import { useApp } from '../../contexts/AppContext';
import { readLockedWorkspaceId } from './scopeWindow';
import { enforceLockedHash } from './windowLock';

/**
 * The scope id this window is locked to, or null for a normal (unlocked)
 * window. Read once from the URL and kept stable for the window's lifetime.
 */
export function useLockedWorkspaceId(): string | null {
    const ref = useRef<string | null | undefined>(undefined);
    if (ref.current === undefined) {
        ref.current = readLockedWorkspaceId();
    }
    return ref.current;
}

/**
 * Pin the window to its locked scope. No-op in a normal window. In a locked
 * window it (a) forces the hash onto `#repos/{lockedId}` on boot and whenever it
 * drifts to another scope, and (b) mirrors the scope's display name into
 * `document.title` (updated once workspaces load so the name resolves).
 */
export function useEnforceWindowLock(): void {
    const { state } = useApp();
    const lockedWorkspaceId = useLockedWorkspaceId();

    // Keep the hash pinned to the locked scope — on boot and on any drift.
    useEffect(() => {
        if (!lockedWorkspaceId) return;
        const enforce = () => {
            const next = enforceLockedHash(window.location.hash, lockedWorkspaceId);
            if (next !== null) window.location.hash = next;
        };
        enforce();
        window.addEventListener('hashchange', enforce);
        return () => window.removeEventListener('hashchange', enforce);
    }, [lockedWorkspaceId]);

    // Set the OS window title to the scope's display name (resolves once the
    // workspaces list has loaded; falls back to the id until then).
    useEffect(() => {
        if (!lockedWorkspaceId) return;
        const ws = (state.workspaces as Array<{ id: string; name?: string }> | undefined)
            ?.find(w => w.id === lockedWorkspaceId);
        document.title = ws?.name ?? lockedWorkspaceId;
    }, [lockedWorkspaceId, state.workspaces]);
}
