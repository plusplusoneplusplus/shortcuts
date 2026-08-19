/**
 * Named saved sets for the Bit flag decoder card (AC-04).
 *
 * Pasted C++ definitions are worth keeping — re-pasting the same enum every
 * time you want to decode a value is the whole annoyance the card exists to
 * remove. Storage is `localStorage` and nothing else: the Dev Tools panel is
 * documented as "localStorage, no server round-trips", so there is deliberately
 * no sync, no sharing, and no server route here.
 *
 * Only the raw pasted `source` is persisted. Parsed flags are derived on load
 * by `parseFlagDefinitions`, so improving the parser retro-fixes every saved
 * set instead of leaving stale parse output on disk.
 *
 * Every function is pure over an injected `StorageLike`, which keeps the tests
 * deterministic and means a browser that denies storage access degrades to an
 * in-memory session rather than crashing the panel.
 */

/** The slice of the DOM `Storage` interface this module needs. */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** One saved paste. `source` is the raw text; flags are re-derived on load. */
export interface SavedFlagSet {
    id: string;
    name: string;
    source: string;
}

export interface BitFlagStore {
    sets: SavedFlagSet[];
    /** The set to re-select when the card reopens, or null if none. */
    lastSelectedId: string | null;
}

export const BIT_FLAG_STORAGE_KEY = 'coc.devtools.bitFlags.v1';

/** The state a first-run — or a corrupt — read falls back to. */
export function emptyStore(): BitFlagStore {
    return { sets: [], lastSelectedId: null };
}

/**
 * The real browser store, or null when there is no `localStorage` (SSR, a
 * privacy mode that throws on access). Callers treat null as "no persistence".
 */
export function browserStorage(): StorageLike | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

function isSet(value: unknown): value is SavedFlagSet {
    if (!value || typeof value !== 'object') return false;
    const set = value as Record<string, unknown>;
    return (
        typeof set.id === 'string' &&
        set.id !== '' &&
        typeof set.name === 'string' &&
        typeof set.source === 'string'
    );
}

/**
 * Reads the saved sets. Anything unreadable — missing key, invalid JSON, an
 * array where an object belongs, entries with the wrong shape — degrades to an
 * empty list rather than throwing, because a bad storage blob must never take
 * the whole Dev Tools panel down with it.
 */
export function loadStore(storage: StorageLike | null): BitFlagStore {
    if (!storage) return emptyStore();
    let raw: string | null;
    try {
        raw = storage.getItem(BIT_FLAG_STORAGE_KEY);
    } catch {
        return emptyStore();
    }
    if (!raw) return emptyStore();
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return emptyStore();
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyStore();
    const record = parsed as Record<string, unknown>;
    const sets = Array.isArray(record.sets) ? record.sets.filter(isSet) : [];
    const last = typeof record.lastSelectedId === 'string' ? record.lastSelectedId : null;
    // A dangling lastSelectedId would leave the dropdown pointing at nothing.
    const lastSelectedId = sets.some(s => s.id === last) ? last : (sets[0]?.id ?? null);
    return { sets, lastSelectedId };
}

/** Writes the store. A storage that rejects the write is ignored, not fatal. */
export function saveStore(storage: StorageLike | null, store: BitFlagStore): void {
    if (!storage) return;
    try {
        storage.setItem(BIT_FLAG_STORAGE_KEY, JSON.stringify(store));
    } catch {
        /* quota or denied permission — the session keeps working in memory */
    }
}

/**
 * A set id that cannot collide with one already saved. Deterministic (no
 * randomness, no clock) so tests can assert exact output.
 */
export function nextSetId(store: BitFlagStore): string {
    const taken = new Set(store.sets.map(s => s.id));
    for (let n = 1; ; n += 1) {
        const id = `set-${n}`;
        if (!taken.has(id)) return id;
    }
}

/**
 * `base`, or `base 2` / `base 3` / … when that name is already taken. The set
 * at `excludeId` does not count against itself, so renaming a set to its own
 * name is a no-op rather than a bump to `Foo 2`.
 */
export function uniqueSetName(store: BitFlagStore, base: string, excludeId?: string): string {
    const trimmed = base.trim() || 'Set';
    const taken = new Set(store.sets.filter(s => s.id !== excludeId).map(s => s.name));
    if (!taken.has(trimmed)) return trimmed;
    for (let n = 2; ; n += 1) {
        const candidate = `${trimmed} ${n}`;
        if (!taken.has(candidate)) return candidate;
    }
}

/**
 * The name a freshly pasted set gets: the enum's own name when the paste had
 * one, else `Set 1`, `Set 2`, … counting past the names already in use.
 */
export function defaultSetName(store: BitFlagStore, parsedName: string | null): string {
    if (parsedName && parsedName.trim()) return uniqueSetName(store, parsedName);
    const taken = new Set(store.sets.map(s => s.name));
    for (let n = 1; ; n += 1) {
        const candidate = `Set ${n}`;
        if (!taken.has(candidate)) return candidate;
    }
}

/** Appends a set and selects it. The name is de-duplicated on the way in. */
export function addSet(store: BitFlagStore, name: string, source: string): BitFlagStore {
    const id = nextSetId(store);
    const set: SavedFlagSet = { id, name: uniqueSetName(store, name), source };
    return { sets: [...store.sets, set], lastSelectedId: id };
}

/**
 * Applies `patch` to one set. A renamed set is de-duplicated against the
 * others; an unknown id leaves the store untouched.
 */
export function updateSet(
    store: BitFlagStore,
    id: string,
    patch: { name?: string; source?: string },
): BitFlagStore {
    if (!store.sets.some(s => s.id === id)) return store;
    const sets = store.sets.map(set => {
        if (set.id !== id) return set;
        const name = patch.name === undefined ? set.name : uniqueSetName(store, patch.name, id);
        const source = patch.source === undefined ? set.source : patch.source;
        return { ...set, name, source };
    });
    return { ...store, sets };
}

/**
 * Removes a set. When the deleted set was selected, selection falls to the one
 * that took its place in the list (or the new last one), so the card always has
 * something loaded if any set remains.
 */
export function deleteSet(store: BitFlagStore, id: string): BitFlagStore {
    const index = store.sets.findIndex(s => s.id === id);
    if (index < 0) return store;
    const sets = store.sets.filter(s => s.id !== id);
    if (store.lastSelectedId !== id) return { sets, lastSelectedId: store.lastSelectedId };
    const fallback = sets[index] ?? sets[sets.length - 1] ?? null;
    return { sets, lastSelectedId: fallback ? fallback.id : null };
}

/** Marks a set as the one to restore next time. Unknown ids are ignored. */
export function selectSet(store: BitFlagStore, id: string): BitFlagStore {
    if (!store.sets.some(s => s.id === id)) return store;
    return { ...store, lastSelectedId: id };
}

/** The currently selected set, or null when the list is empty. */
export function selectedSet(store: BitFlagStore): SavedFlagSet | null {
    return store.sets.find(s => s.id === store.lastSelectedId) ?? null;
}
