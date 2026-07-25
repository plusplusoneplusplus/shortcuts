/**
 * Window-lock enforcement — pure helpers for the AC-02 locked single-scope
 * window. A popped-out window carries `?window=<workspaceId>` (see
 * `scopeWindow.ts`); once the app boots it must stay pinned to that scope: the
 * hash always selects the locked scope and cannot drift to another repo.
 *
 * These helpers are React-free so the enforcement logic is unit-testable without
 * a DOM. The React glue that wires them to `location.hash` / `document.title`
 * lives in `useWindowLock.ts`.
 */

import { hashSegments, decodeSegment, repoHashBase } from '../../layout/routePath';

/**
 * Parse the selected repo/scope id out of a `#repos/{id}/...` hash. Returns null
 * for any non-repo route (e.g. `#admin`, `#wiki`, or an empty hash) — those do
 * not select a scope, so a locked window redirects them to its scope.
 */
export function parseRepoIdFromHash(hash: string): string | null {
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[1]) {
        return decodeSegment(parts[1].split('?')[0]);
    }
    return null;
}

/**
 * Given the current hash and the locked scope id, return the hash the window
 * should navigate to, or null when the hash already selects the locked scope
 * (no redirect needed). Keeps the locked window pinned: an empty hash, a
 * top-level route, or a hash pointing at a *different* repo all resolve to the
 * bare `#repos/{lockedId}` route (which the router then expands to the scope's
 * remembered sub-route).
 */
export function enforceLockedHash(currentHash: string, lockedWorkspaceId: string): string | null {
    if (parseRepoIdFromHash(currentHash) === lockedWorkspaceId) return null;
    return repoHashBase(lockedWorkspaceId);
}
