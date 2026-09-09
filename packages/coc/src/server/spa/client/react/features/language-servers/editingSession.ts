/**
 * Identity of one browser editing session.
 *
 * AC-02 requires two browser windows editing the same disk file to have
 * isolated language-server document state. The host keys its sessions on
 * (workspace, editing session, definition, root), so that isolation is only as
 * good as this id: it must differ between windows/tabs and survive a reload of
 * the same tab, otherwise a refresh would strand the previous session's
 * process until its idle timer expires.
 *
 * `sessionStorage` has exactly those semantics — per tab, cleared when the tab
 * closes, preserved across reloads. When it is unavailable (SSR, a locked-down
 * browser, tests without jsdom) we fall back to a module-level id, which still
 * gives one id per JS realm.
 */

const STORAGE_KEY = 'coc.languageServers.editingSessionId';

let fallbackId: string | null = null;

function randomId(): string {
    const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (typeof cryptoLike?.randomUUID === 'function') {
        return cryptoLike.randomUUID();
    }
    return `es-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** The stable id for this browser tab. Created on first use. */
export function getEditingSessionId(): string {
    const storage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (storage) {
        try {
            const existing = storage.getItem(STORAGE_KEY);
            if (existing) {
                return existing;
            }
            const created = randomId();
            storage.setItem(STORAGE_KEY, created);
            return created;
        } catch {
            // Storage disabled by the browser; fall through to the module id.
        }
    }
    if (!fallbackId) {
        fallbackId = randomId();
    }
    return fallbackId;
}

/** Test-only: forget the cached id so the next call mints a fresh one. */
export function resetEditingSessionIdForTests(): void {
    fallbackId = null;
    const storage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    try {
        storage?.removeItem(STORAGE_KEY);
    } catch {
        // Nothing to clear.
    }
}
