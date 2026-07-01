/**
 * spawned-tree-view-state — localStorage-backed view preferences for the
 * spawned-conversation tree in the chat list (AC-03).
 *
 * Two persisted preferences:
 *  - Feature toggle (default ON): when off, spawned descendants render as flat
 *    sibling rows instead of nesting under their root. The backend parent link
 *    (AC-01) is always applied regardless of this toggle — only rendering is
 *    affected.
 *  - Per-root collapsed set (default expanded): the set of root process ids the
 *    user has collapsed. A root absent from the set renders expanded, so the
 *    default-expanded contract holds for roots the user has never touched.
 *
 * Pure helpers + thin, defensive localStorage wrappers (safe under jsdom /
 * private mode / SSR where `localStorage` may throw or be undefined).
 */

const TOGGLE_KEY = 'coc-spawned-tree-enabled';
const COLLAPSED_KEY = 'coc-spawned-tree-collapsed';

function readStorage(key: string): string | null {
    try {
        if (typeof localStorage === 'undefined') {return null;}
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string): void {
    try {
        if (typeof localStorage === 'undefined') {return;}
        localStorage.setItem(key, value);
    } catch {
        /* ignore (private mode / quota / SSR) */
    }
}

/**
 * Whether the spawned-tree rendering toggle is enabled. Defaults ON: only an
 * explicit persisted `'false'` disables it, so a fresh user gets the tree.
 */
export function isSpawnedTreeViewEnabled(): boolean {
    return readStorage(TOGGLE_KEY) !== 'false';
}

/** Persist the spawned-tree rendering toggle. */
export function setSpawnedTreeViewEnabled(enabled: boolean): void {
    writeStorage(TOGGLE_KEY, enabled ? 'true' : 'false');
}

/**
 * Load the set of collapsed root process ids. Roots not in this set render
 * expanded (default-expanded contract). Tolerates missing / malformed JSON.
 */
export function loadCollapsedSpawnedRootIds(): Set<string> {
    const raw = readStorage(COLLAPSED_KEY);
    if (!raw) {return new Set();}
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
        }
    } catch {
        /* malformed — treat as empty */
    }
    return new Set();
}

/** Persist the collapsed-root set as a JSON array. */
export function persistCollapsedSpawnedRootIds(ids: Set<string>): void {
    writeStorage(COLLAPSED_KEY, JSON.stringify([...ids]));
}

/**
 * Return a new set with `rootId`'s collapsed state flipped, and persist it.
 * Pure with respect to the input set (does not mutate it).
 */
export function toggleCollapsedSpawnedRoot(ids: Set<string>, rootId: string): Set<string> {
    const next = new Set(ids);
    if (next.has(rootId)) {next.delete(rootId);} else {next.add(rootId);}
    persistCollapsedSpawnedRootIds(next);
    return next;
}
