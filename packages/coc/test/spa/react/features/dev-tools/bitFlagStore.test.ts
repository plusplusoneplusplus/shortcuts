/**
 * Unit tests for the Bit flag decoder's saved-set storage (AC-04).
 *
 * The store is pure over an injected `StorageLike`, so these use a tiny fake
 * rather than jsdom's localStorage — that keeps the corrupt-JSON and
 * throwing-storage cases easy to set up and impossible to leak between tests.
 */
import { describe, expect, it } from 'vitest';

import {
    BIT_FLAG_STORAGE_KEY,
    addSet,
    defaultSetName,
    deleteSet,
    emptyStore,
    loadStore,
    nextSetId,
    saveStore,
    selectSet,
    selectedSet,
    uniqueSetName,
    updateSet,
    type BitFlagStore,
    type StorageLike,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/bitFlagStore';

/** An in-memory `StorageLike`, optionally pre-seeded with a raw blob. */
function fakeStorage(raw?: string): StorageLike & { raw(): string | null } {
    let value: string | null = raw ?? null;
    return {
        getItem: () => value,
        setItem: (_key, next) => {
            value = next;
        },
        raw: () => value,
    };
}

/** A store with `count` sets named `A`, `B`, … and the first one selected. */
function storeWith(...names: string[]): BitFlagStore {
    let store = emptyStore();
    for (const name of names) store = addSet(store, name, `enum ${name} { X = 1 };`);
    return selectSet(store, store.sets[0]!.id);
}

describe('loadStore / saveStore', () => {
    it('round-trips through storage under the versioned key', () => {
        const storage = fakeStorage();
        const store = storeWith('Perms', 'Caps');
        saveStore(storage, store);
        expect(JSON.parse(storage.raw()!)).toEqual(store);
        expect(loadStore(storage)).toEqual(store);
    });

    it('writes the key documented in the spec', () => {
        expect(BIT_FLAG_STORAGE_KEY).toBe('coc.devtools.bitFlags.v1');
    });

    it('returns an empty store when nothing has been saved', () => {
        expect(loadStore(fakeStorage())).toEqual({ sets: [], lastSelectedId: null });
    });

    it('falls back to an empty store on corrupt JSON instead of throwing', () => {
        expect(loadStore(fakeStorage('{not json'))).toEqual({ sets: [], lastSelectedId: null });
    });

    it('falls back when the blob is valid JSON of the wrong shape', () => {
        expect(loadStore(fakeStorage('[1,2,3]')).sets).toEqual([]);
        expect(loadStore(fakeStorage('"a string"')).sets).toEqual([]);
        expect(loadStore(fakeStorage('null')).sets).toEqual([]);
    });

    it('drops individual entries that are missing fields, keeping the good ones', () => {
        const raw = JSON.stringify({
            sets: [
                { id: 'set-1', name: 'Good', source: 'enum { A = 1 };' },
                { id: 'set-2', name: 'no source' },
                { name: 'no id', source: '' },
                'nonsense',
            ],
            lastSelectedId: 'set-1',
        });
        const loaded = loadStore(fakeStorage(raw));
        expect(loaded.sets.map(s => s.name)).toEqual(['Good']);
        expect(loaded.lastSelectedId).toBe('set-1');
    });

    it('repairs a lastSelectedId that points at no surviving set', () => {
        const raw = JSON.stringify({
            sets: [{ id: 'set-1', name: 'Good', source: '' }],
            lastSelectedId: 'set-99',
        });
        expect(loadStore(fakeStorage(raw)).lastSelectedId).toBe('set-1');
    });

    it('treats a null storage as no persistence rather than an error', () => {
        expect(loadStore(null)).toEqual({ sets: [], lastSelectedId: null });
        expect(() => saveStore(null, emptyStore())).not.toThrow();
    });

    it('survives a storage that throws on read and on write', () => {
        const hostile: StorageLike = {
            getItem: () => {
                throw new Error('denied');
            },
            setItem: () => {
                throw new Error('quota');
            },
        };
        expect(loadStore(hostile)).toEqual({ sets: [], lastSelectedId: null });
        expect(() => saveStore(hostile, storeWith('A'))).not.toThrow();
    });
});

describe('addSet', () => {
    it('appends the set and selects it', () => {
        const store = addSet(addSet(emptyStore(), 'Perms', 'a'), 'Caps', 'b');
        expect(store.sets.map(s => s.name)).toEqual(['Perms', 'Caps']);
        expect(selectedSet(store)?.name).toBe('Caps');
    });

    it('gives each set a fresh id', () => {
        const store = addSet(addSet(emptyStore(), 'A', ''), 'B', '');
        expect(store.sets.map(s => s.id)).toEqual(['set-1', 'set-2']);
    });

    it('reuses an id freed by a delete without colliding with a live one', () => {
        let store = addSet(addSet(emptyStore(), 'A', ''), 'B', '');
        store = deleteSet(store, 'set-1');
        expect(nextSetId(store)).toBe('set-1');
    });
});

describe('name de-duplication', () => {
    it('suffixes a duplicate name with a number', () => {
        const store = addSet(addSet(emptyStore(), 'Perms', ''), 'Perms', '');
        expect(store.sets.map(s => s.name)).toEqual(['Perms', 'Perms 2']);
    });

    it('keeps counting past an existing suffix', () => {
        let store = storeWith('Perms', 'Perms');
        store = addSet(store, 'Perms', '');
        expect(store.sets.map(s => s.name)).toEqual(['Perms', 'Perms 2', 'Perms 3']);
    });

    it('does not bump a set renamed to the name it already has', () => {
        const store = updateSet(storeWith('Perms', 'Caps'), 'set-1', { name: 'Perms' });
        expect(store.sets.map(s => s.name)).toEqual(['Perms', 'Caps']);
    });

    it('falls back to "Set" when the requested name is blank', () => {
        expect(uniqueSetName(emptyStore(), '   ')).toBe('Set');
    });
});

describe('defaultSetName', () => {
    it('uses the parsed enum name when the paste had one', () => {
        expect(defaultSetName(emptyStore(), 'FileMode')).toBe('FileMode');
    });

    it('de-duplicates the parsed enum name against saved sets', () => {
        expect(defaultSetName(storeWith('FileMode'), 'FileMode')).toBe('FileMode 2');
    });

    it('falls back to Set 1, Set 2, … for an anonymous paste', () => {
        expect(defaultSetName(emptyStore(), null)).toBe('Set 1');
        expect(defaultSetName(storeWith('Set 1'), null)).toBe('Set 2');
        expect(defaultSetName(storeWith('Set 1', 'Set 2'), null)).toBe('Set 3');
    });
});

describe('updateSet', () => {
    it('renames without touching the source', () => {
        const store = updateSet(storeWith('Perms'), 'set-1', { name: 'Permissions' });
        expect(store.sets[0]).toMatchObject({ name: 'Permissions', source: 'enum Perms { X = 1 };' });
    });

    it('saves a new source without touching the name', () => {
        const store = updateSet(storeWith('Perms'), 'set-1', { source: 'enum { B = 2 };' });
        expect(store.sets[0]).toMatchObject({ name: 'Perms', source: 'enum { B = 2 };' });
    });

    it('ignores an unknown id', () => {
        const before = storeWith('Perms');
        expect(updateSet(before, 'set-99', { name: 'nope' })).toBe(before);
    });
});

describe('deleteSet', () => {
    it('removes the set', () => {
        const store = deleteSet(storeWith('A', 'B'), 'set-1');
        expect(store.sets.map(s => s.name)).toEqual(['B']);
    });

    it('moves selection to the set that took its place', () => {
        const store = deleteSet(selectSet(storeWith('A', 'B', 'C'), 'set-2'), 'set-2');
        expect(selectedSet(store)?.name).toBe('C');
    });

    it('falls back to the new last set when the deleted one was last', () => {
        const store = deleteSet(selectSet(storeWith('A', 'B'), 'set-2'), 'set-2');
        expect(selectedSet(store)?.name).toBe('A');
    });

    it('leaves selection alone when a different set is deleted', () => {
        const store = deleteSet(selectSet(storeWith('A', 'B'), 'set-1'), 'set-2');
        expect(store.sets.map(s => s.name)).toEqual(['A']);
        expect(selectedSet(store)?.name).toBe('A');
    });

    it('clears selection when the last set goes', () => {
        const store = deleteSet(storeWith('A'), 'set-1');
        expect(store.sets).toEqual([]);
        expect(selectedSet(store)).toBeNull();
    });

    it('ignores an unknown id', () => {
        const before = storeWith('A');
        expect(deleteSet(before, 'set-99')).toBe(before);
    });
});

describe('selectSet', () => {
    it('restores the chosen set on the next load', () => {
        const storage = fakeStorage();
        saveStore(storage, selectSet(storeWith('A', 'B'), 'set-2'));
        expect(selectedSet(loadStore(storage))?.name).toBe('B');
    });

    it('ignores an id that is not in the list', () => {
        const before = storeWith('A');
        expect(selectSet(before, 'set-99')).toBe(before);
    });
});
