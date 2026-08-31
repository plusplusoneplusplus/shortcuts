/**
 * usePinnedScopes — global preference store for the scope pins rendered as
 * segments in the `ScopeSlideSwitcher`.
 *
 * Reads/writes `preferences.getGlobal()` / `patchGlobal({ pinnedScopes })`,
 * following `useRecentRemotes` exactly (same client, same fire-and-forget patch,
 * same "load once, keep local state authoritative afterwards" shape).
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
import {
    MAX_PINNED_SCOPES,
    movePinnedScope,
    parsePinnedScopes,
    serializePinnedScope,
    togglePinnedScope,
    type PinnedScopeRef,
} from './pinnedScopes';

let pins: PinnedScopeRef[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of [...listeners]) listener();
}

function ensureLoaded(): void {
    if (loaded || loading) return;
    loading = getSpaCocClient().preferences.getGlobal()
        .then(prefs => { pins = parsePinnedScopes((prefs as { pinnedScopes?: unknown }).pinnedScopes); })
        .catch(() => { pins = []; })
        .finally(() => { loaded = true; loading = null; emit(); });
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

export function usePinnedScopes(): UsePinnedScopes {
    const [snapshot, setSnapshot] = useState(() => ({ pins, loaded }));

    useEffect(() => {
        const listener = () => setSnapshot({ pins, loaded });
        listeners.add(listener);
        ensureLoaded();
        // Sync up with anything that loaded/changed between render and subscribe.
        listener();
        return () => { listeners.delete(listener); };
    }, []);

    const toggle = useCallback((ref: PinnedScopeRef) => { write(togglePinnedScope(pins, ref)); }, []);
    const move = useCallback((ref: PinnedScopeRef, delta: -1 | 1) => { write(movePinnedScope(pins, ref, delta)); }, []);

    return {
        pins: snapshot.pins,
        loaded: snapshot.loaded,
        toggle,
        move,
        full: snapshot.pins.length >= MAX_PINNED_SCOPES,
    };
}
