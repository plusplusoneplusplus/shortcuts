/**
 * Scope pop-out windows — shared plumbing for "Open a scope in its own window".
 *
 * A popped-out window loads the SAME SPA (the full App, not a reduced popout
 * shell) but is locked to a single scope: the scope switcher is hidden and
 * `selectedRepoId` is forced to the target workspace. The lock is signalled by
 * a `?window=<workspaceId>` query param that the App reads on boot.
 *
 * Kept dependency-free so it can be imported by the App boot path, both tab
 * renderers (RepoTabStrip / ScopeSlideSwitcher), and unit tests without pulling
 * in React context. Repos (`ws-v2-…`) and the virtual scopes (`my_work` /
 * `my_life`) are all addressed the same way — no special-casing.
 */

/** Query-param key that puts the app into locked single-scope window mode. */
export const SCOPE_WINDOW_PARAM = 'window';

/**
 * Deterministic per-scope `window.open` target name. Reusing the same name for
 * a given scope makes the browser/Electron reuse (and focus) the existing
 * window instead of spawning a duplicate — that is the AC-03 "one window per
 * scope" mechanism.
 */
export function getScopeWindowName(workspaceId: string): string {
    return `coc-window-${workspaceId}`;
}

/**
 * Build the locked-window URL for a scope. `base` is normally
 * `window.location.origin + window.location.pathname` (matching the other
 * pop-out helpers). The result carries `?window=<id>`; the app boots the full
 * SPA and enters locked single-scope mode from that param.
 */
export function buildScopePopOutUrl(base: string, workspaceId: string): string {
    const params = new URLSearchParams();
    params.set(SCOPE_WINDOW_PARAM, workspaceId);
    return `${base}?${params.toString()}`;
}

/**
 * Read the locked scope id from a URL search string (defaults to the current
 * `window.location.search`). Returns the target workspace id when the app is in
 * locked single-scope window mode, or `null` for a normal (unlocked) window.
 */
export function readLockedWorkspaceId(search?: string): string | null {
    let raw = search;
    if (raw === undefined) {
        raw = typeof window !== 'undefined' ? window.location.search : '';
    }
    if (!raw) return null;
    const value = new URLSearchParams(raw).get(SCOPE_WINDOW_PARAM);
    return value && value.length > 0 ? value : null;
}

export interface OpenScopePopOutOptions {
    workspaceId: string;
    /** Optional toast surface for the blocked-popup case. Matches ToastContext's `addToast`. */
    addToast?: (message: string, type?: 'error' | 'success' | 'info') => void;
    /** Overridable for tests; defaults to `window.open`. */
    open?: typeof window.open;
}

/**
 * Open (or focus, if already open) a scope's locked window. Uses the
 * deterministic per-scope window name so a repeat call targets the same native
 * window rather than opening a duplicate. Returns the opened `Window` (or the
 * existing one) when successful, else `null` (e.g. popup blocked).
 */
export function openScopePopOut({ workspaceId, addToast, open }: OpenScopePopOutOptions): Window | null {
    const opener = open ?? (typeof window !== 'undefined' ? window.open.bind(window) : undefined);
    if (!opener) return null;
    const base = window.location.origin + window.location.pathname;
    const url = buildScopePopOutUrl(base, workspaceId);
    const win = opener(url, getScopeWindowName(workspaceId));
    if (!win) {
        addToast?.('Pop-out blocked. Allow popups for this site and try again.', 'error');
        return null;
    }
    // Bring an already-open window to the front (AC-03 focus-existing).
    try {
        win.focus();
    } catch {
        /* cross-origin / detached — best effort */
    }
    return win;
}
