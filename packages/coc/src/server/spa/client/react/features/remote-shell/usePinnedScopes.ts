/**
 * usePinnedScopes — global preference store for the scope pins rendered as
 * segments in the `ScopeSlideSwitcher`.
 *
 * Reads/writes `preferences.getGlobal()` / `patchGlobal({ pinnedScopes })`,
 * using the page-origin preferences client. Early clicks replay over the loaded
 * list before persistence, keeping saved pins and the user's latest intent.
 *
 * Unlike `useRecentRemotes` the state is held in a tiny module-level store
 * rather than per-hook `useState`: the pin *toggles* live on the picker rows
 * inside `WorkspaceIdentityChip` while the pin *segments* live in
 * `ScopeSlideSwitcher`, two sibling components with no common owner below
 * TopBar. Per-hook state would let them drift — pinning a repo in the picker
 * would not add a segment until a reload. A store keeps one list and notifies
 * both.
 *
 * Pins are global, not per-scope: My Work and My Life are peer scopes in the
 * same tablist, not containers, so there is no context a pin could belong to.
 */
import { useCallback, useEffect, useState } from 'react';
import { getSpaCocClient } from '../../api/cocClient';
import type { RepoGroup } from '../../repos/repoGrouping';
import {
    MAX_PINNED_SCOPES,
    isPinnedScope,
    movePinnedScope,
    parsePinnedScopes,
    qualifyWorkspacePins,
    serializePinnedScope,
    togglePinnedScope,
    type PinnedScopeRef,
} from './pinnedScopes';

let pins: PinnedScopeRef[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
type PinMutation = (current: PinnedScopeRef[]) => PinnedScopeRef[];
let pendingMutations: PinMutation[] = [];
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of [...listeners]) listener();
}

function ensureLoaded(): void {
    if (loaded || loading) return;
    loading = getSpaCocClient().preferences.getGlobal()
        .then(prefs => { pins = parsePinnedScopes((prefs as { pinnedScopes?: unknown }).pinnedScopes); })
        .catch(() => { pins = []; })
        .finally(() => {
            const pending = pendingMutations;
            pendingMutations = [];
            pins = pending.reduce((current, mutate) => mutate(current), pins);
            loaded = true;
            loading = null;
            if (pending.length) write(pins);
            else emit();
        });
}

function mutatePins(mutate: PinMutation): void {
    if (!loaded) {
        // Keep early clicks visible, then replay their intent over stored pins.
        // Writing this partial list now would discard pins still being loaded.
        pendingMutations.push(mutate);
        pins = mutate(pins);
        emit();
    } else write(mutate(pins));
}

function write(next: PinnedScopeRef[]): void {
    pins = next;
    getSpaCocClient().preferences
        .patchGlobal({ pinnedScopes: next.map(serializePinnedScope) } as Record<string, unknown>)
        .catch(() => {});
    emit();
}

/** Test seam — the store outlives a single `render()`, so tests must clear it. */
export function __resetPinnedScopesStore(): void {
    pins = [];
    loaded = false;
    loading = null;
    pendingMutations = [];
    listeners.clear();
}

export interface UsePinnedScopes {
    pins: PinnedScopeRef[];
    loaded: boolean;
    /** Pin if absent, unpin if present. No-op past `MAX_PINNED_SCOPES`. */
    toggle: (ref: PinnedScopeRef) => void;
    /** Move one slot left (`-1`) or right (`1`). */
    move: (ref: PinnedScopeRef, delta: -1 | 1) => void;
    /** True once the list is full and further pins would be refused. */
    full: boolean;
}

export function usePinnedScopes(groups?: readonly RepoGroup[]): UsePinnedScopes {
    const [snapshot, setSnapshot] = useState(() => ({ pins, loaded }));

    useEffect(() => {
        const listener = () => setSnapshot({ pins, loaded });
        listeners.add(listener);
        ensureLoaded();
        // Sync up with anything that loaded/changed between render and subscribe.
        listener();
        return () => { listeners.delete(listener); };
    }, []);

    useEffect(() => {
        if (!snapshot.loaded || !groups) return;
        const qualified = qualifyWorkspacePins(pins, groups);
        if (qualified !== pins) write(qualified);
    }, [groups, snapshot.loaded, snapshot.pins]);

    const toggle = useCallback((ref: PinnedScopeRef) => {
        const shouldPin = !isPinnedScope(pins, ref);
        mutatePins(current => isPinnedScope(current, ref) === shouldPin ? current : togglePinnedScope(current, ref));
    }, []);
    const move = useCallback((ref: PinnedScopeRef, delta: -1 | 1) => { mutatePins(current => movePinnedScope(current, ref, delta)); }, []);

    return {
        pins: snapshot.pins,
        loaded: snapshot.loaded,
        toggle,
        move,
        full: snapshot.pins.length >= MAX_PINNED_SCOPES,
    };
}
