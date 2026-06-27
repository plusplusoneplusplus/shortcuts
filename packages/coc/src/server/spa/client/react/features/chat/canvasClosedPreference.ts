/**
 * Per-conversation persistence for the agent canvas "closed" state.
 *
 * When a user deliberately closes the agent canvas in a chat, we remember that
 * choice in `localStorage` so switching away and back — or reloading the page —
 * keeps the panel collapsed (showing the reopen rail) instead of auto-expanding.
 * Storage stays sparse: only deliberately-closed conversations keep a key, and
 * reopening (or a fresh AI canvas edit) removes it.
 *
 * Key shape mirrors the existing per-workspace width key
 * `coc.canvasPanel.width.<workspaceId>`:
 *
 *     coc.canvasPanel.closed.<workspaceId>.<pid>
 *
 * where `pid = processId ?? bareTaskId` — the same conversation identity the
 * canvas discovery effect uses. All access is wrapped in try/catch so
 * SSR / test / quota-exceeded environments never throw.
 */

const CANVAS_CLOSED_KEY_PREFIX = 'coc.canvasPanel.closed';

/**
 * Build the per-conversation storage key, or `null` when either identity is
 * missing (in which case there is nothing to persist).
 */
export function canvasClosedStorageKey(
    workspaceId: string | null | undefined,
    pid: string | null | undefined,
): string | null {
    if (!workspaceId || !pid) {
        return null;
    }
    return `${CANVAS_CLOSED_KEY_PREFIX}.${encodeURIComponent(workspaceId)}.${encodeURIComponent(pid)}`;
}

/**
 * Returns `true` when the user has deliberately closed the canvas for this
 * conversation (the key exists). Defaults to `false` (auto-open) when no key is
 * present or storage is unavailable.
 */
export function readCanvasClosed(
    workspaceId: string | null | undefined,
    pid: string | null | undefined,
): boolean {
    const key = canvasClosedStorageKey(workspaceId, pid);
    if (!key) {
        return false;
    }
    try {
        return localStorage.getItem(key) !== null;
    } catch {
        return false;
    }
}

/**
 * Persist (`closed === true`) or clear (`closed === false`) the deliberate-close
 * flag for this conversation. Clearing removes the key so storage stays sparse.
 */
export function writeCanvasClosed(
    workspaceId: string | null | undefined,
    pid: string | null | undefined,
    closed: boolean,
): void {
    const key = canvasClosedStorageKey(workspaceId, pid);
    if (!key) {
        return;
    }
    try {
        if (closed) {
            localStorage.setItem(key, '1');
        } else {
            localStorage.removeItem(key);
        }
    } catch {
        /* ignore SSR / quota-exceeded / disabled-storage errors */
    }
}
