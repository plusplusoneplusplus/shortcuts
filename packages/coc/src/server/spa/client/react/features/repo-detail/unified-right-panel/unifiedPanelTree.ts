/**
 * unifiedPanelTree — the file-tree column's own state: one open bit and one
 * width per panel scope (AC-01).
 *
 * The tree is a *panel-level* affordance, not a tab and not a per-tab setting.
 * It stays put across tab switches, chat switches, collapse/reopen, and reload,
 * and it renders for every tab kind — including no tabs at all. That is exactly
 * the lifetime `unifiedPanelStore` already gives the tab set, so this module
 * copies its shape: one localStorage entry per panel workspace, read through
 * `useSyncExternalStore`, snapshots cached by raw string so an unchanged store
 * hands back a referentially stable value.
 *
 * It is a separate entry from the tab set on purpose. The tab codec rejects a
 * payload it cannot version-match, and losing the tree's width because a tab
 * descriptor went stale would be a strange coupling — the column is chrome, the
 * tabs are content.
 *
 * Two width rules live here rather than in the view:
 *
 *  - **Clamp.** The tree may never squeeze the file view below
 *    `UNIFIED_PANEL_VIEW_MIN_WIDTH`, so the usable range depends on the panel's
 *    current width, which is why `clampUnifiedTreeWidth` takes both.
 *  - **Auto-collapse.** When the whole panel is dragged below
 *    `UNIFIED_TREE_MIN_WIDTH + UNIFIED_PANEL_VIEW_MIN_WIDTH` there is no honest
 *    way to show both, so the column hides. The persisted open bit is *not*
 *    flipped — widening the panel brings the tree back, because the user never
 *    asked for it to close. `isUnifiedTreeVisible` is that distinction.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/** Narrowest useful file tree, in px. Below this the labels are unreadable. */
export const UNIFIED_TREE_MIN_WIDTH = 140;

/** Widest the tree may get regardless of panel width, in px. */
export const UNIFIED_TREE_MAX_WIDTH = 480;

/** The tree's width before the user has ever dragged it, in px. */
export const UNIFIED_TREE_DEFAULT_WIDTH = 220;

/**
 * The narrowest the active tab's view may become. The tree gives up space
 * before the view does — a two-column panel where neither column works is worse
 * than a one-column panel that does.
 */
export const UNIFIED_PANEL_VIEW_MIN_WIDTH = 220;

/** Panel width below which the tree cannot be shown at all. */
export const UNIFIED_TREE_MIN_PANEL_WIDTH = UNIFIED_TREE_MIN_WIDTH + UNIFIED_PANEL_VIEW_MIN_WIDTH;

/** The tree column's persisted state for one panel scope. */
export interface UnifiedPanelTreeState {
    /** Whether the user has the column open. Survives everything but a toggle. */
    open: boolean;
    /** Requested width in px, before the panel-width clamp is applied. */
    width: number;
}

/** A panel that has never shown the tree: closed, at the default width. */
export const DEFAULT_UNIFIED_TREE_STATE: UnifiedPanelTreeState = {
    open: false,
    width: UNIFIED_TREE_DEFAULT_WIDTH,
};

/** localStorage key for one panel scope's tree column state. */
export function unifiedPanelTreeStorageKey(workspaceId: string): string {
    return `unified-right-panel:${workspaceId}:tree`;
}

// ---------------------------------------------------------------------------
// Width rules
// ---------------------------------------------------------------------------

/**
 * The widest the tree may be inside a panel of `panelWidth`, i.e. whatever is
 * left once the view keeps its minimum — floored at `UNIFIED_TREE_MIN_WIDTH` so
 * the range never inverts on a panel too narrow to hold both. Callers gate on
 * `isUnifiedTreeVisible` for that case rather than reading a bogus max.
 */
export function maxUnifiedTreeWidth(panelWidth: number): number {
    const available = panelWidth - UNIFIED_PANEL_VIEW_MIN_WIDTH;
    return Math.max(UNIFIED_TREE_MIN_WIDTH, Math.min(UNIFIED_TREE_MAX_WIDTH, available));
}

/**
 * The width the tree actually renders at: the requested width clamped into the
 * range this panel width allows. A non-finite request degrades to the default
 * rather than to `NaN` pixels.
 */
export function clampUnifiedTreeWidth(width: number, panelWidth: number): number {
    const requested = Number.isFinite(width) ? width : UNIFIED_TREE_DEFAULT_WIDTH;
    return Math.round(Math.min(maxUnifiedTreeWidth(panelWidth), Math.max(UNIFIED_TREE_MIN_WIDTH, requested)));
}

/**
 * Whether the column is on screen right now: the user has it open AND the panel
 * is wide enough to hold it beside a usable view. A panel dragged too narrow
 * hides the tree without touching the stored bit, so widening restores it.
 */
export function isUnifiedTreeVisible(state: UnifiedPanelTreeState, panelWidth: number): boolean {
    return state.open && panelWidth >= UNIFIED_TREE_MIN_PANEL_WIDTH;
}

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

/** Serialize the column state. Chrome only — no tabs, no paths, no content. */
export function serializeUnifiedTreeState(state: UnifiedPanelTreeState): string {
    return JSON.stringify({ open: state.open, width: state.width });
}

/**
 * Restore the column state. Anything unreadable degrades field-by-field to the
 * default rather than to nothing: a corrupt width should not also forget that
 * the user had the tree open. The width is stored unclamped (the clamp depends
 * on the live panel width) but is still bounded to the absolute range, so a
 * hand-edited entry cannot persist a 10000px column.
 */
export function parseUnifiedTreeState(raw: string | null): UnifiedPanelTreeState {
    if (!raw) return DEFAULT_UNIFIED_TREE_STATE;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return DEFAULT_UNIFIED_TREE_STATE;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_UNIFIED_TREE_STATE;
    const value = parsed as Record<string, unknown>;
    const open = value.open === true;
    const width = typeof value.width === 'number' && Number.isFinite(value.width)
        ? Math.round(Math.min(UNIFIED_TREE_MAX_WIDTH, Math.max(UNIFIED_TREE_MIN_WIDTH, value.width)))
        : UNIFIED_TREE_DEFAULT_WIDTH;
    if (open === DEFAULT_UNIFIED_TREE_STATE.open && width === DEFAULT_UNIFIED_TREE_STATE.width) {
        return DEFAULT_UNIFIED_TREE_STATE;
    }
    return { open, width };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const listeners = new Map<string, Set<() => void>>();

/** Last (raw string → parsed state) per key, for referential stability. */
const snapshotCache = new Map<string, { raw: string; value: UnifiedPanelTreeState }>();

function subscribe(storageKey: string, listener: () => void): () => void {
    let set = listeners.get(storageKey);
    if (!set) {
        set = new Set();
        listeners.set(storageKey, set);
    }
    set.add(listener);
    return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(storageKey);
    };
}

/**
 * Read a panel scope's tree state. Unreadable storage (disabled, quota-blocked,
 * private mode) degrades to the default rather than throwing.
 */
export function readUnifiedTreeState(workspaceId: string): UnifiedPanelTreeState {
    const storageKey = unifiedPanelTreeStorageKey(workspaceId);
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(storageKey);
    } catch {
        raw = null;
    }
    if (raw == null) return DEFAULT_UNIFIED_TREE_STATE;
    const cached = snapshotCache.get(storageKey);
    if (cached && cached.raw === raw) return cached.value;
    const value = parseUnifiedTreeState(raw);
    snapshotCache.set(storageKey, { raw, value });
    return value;
}

/** Persist a panel scope's tree state and wake every subscriber on that key. */
export function writeUnifiedTreeState(workspaceId: string, next: UnifiedPanelTreeState): void {
    const storageKey = unifiedPanelTreeStorageKey(workspaceId);
    const raw = serializeUnifiedTreeState(next);
    try {
        localStorage.setItem(storageKey, raw);
    } catch {
        /* ignore quota / disabled storage */
    }
    snapshotCache.set(storageKey, { raw, value: next });
    listeners.get(storageKey)?.forEach(listener => listener());
}

/** The tree column controller for one panel scope, shared by every consumer. */
export interface UnifiedPanelTreeApi {
    /** The persisted state — what the user asked for, before any width clamp. */
    state: UnifiedPanelTreeState;
    /** Flip the column open or closed. */
    toggleOpen: () => void;
    /** Open or close the column explicitly (the `+` menu's Explorer action). */
    setOpen: (open: boolean) => void;
    /** Record a new requested width; bounded to the absolute range on write. */
    setWidth: (width: number) => void;
}

/**
 * The React face of the tree column state. Every consumer of a panel scope —
 * the column itself, the toolbar toggle, the tab-strip fallback toggle — shares
 * one value, because the toggle and the column are in different subtrees.
 */
export function useUnifiedPanelTree(workspaceId: string): UnifiedPanelTreeApi {
    const storageKey = unifiedPanelTreeStorageKey(workspaceId);
    const state = useSyncExternalStore(
        useCallback(listener => subscribe(storageKey, listener), [storageKey]),
        useCallback(() => readUnifiedTreeState(workspaceId), [workspaceId]),
        // Server render has no localStorage: start closed and hydrate on mount.
        () => DEFAULT_UNIFIED_TREE_STATE,
    );

    const setOpen = useCallback((open: boolean) => {
        const current = readUnifiedTreeState(workspaceId);
        if (current.open === open) return;
        writeUnifiedTreeState(workspaceId, { ...current, open });
    }, [workspaceId]);

    const toggleOpen = useCallback(() => {
        const current = readUnifiedTreeState(workspaceId);
        writeUnifiedTreeState(workspaceId, { ...current, open: !current.open });
    }, [workspaceId]);

    const setWidth = useCallback((width: number) => {
        const current = readUnifiedTreeState(workspaceId);
        const next = Number.isFinite(width)
            ? Math.round(Math.min(UNIFIED_TREE_MAX_WIDTH, Math.max(UNIFIED_TREE_MIN_WIDTH, width)))
            : UNIFIED_TREE_DEFAULT_WIDTH;
        if (current.width === next) return;
        writeUnifiedTreeState(workspaceId, { ...current, width: next });
    }, [workspaceId]);

    return useMemo(() => ({ state, toggleOpen, setOpen, setWidth }), [state, toggleOpen, setOpen, setWidth]);
}

/**
 * Drop a panel scope's persisted column state — or every scope's with no
 * argument (used to isolate tests). Subscribers re-render against the default.
 */
export function clearUnifiedTreeState(workspaceId?: string): void {
    const keys = workspaceId === undefined
        ? [...snapshotCache.keys(), ...listeners.keys()]
        : [unifiedPanelTreeStorageKey(workspaceId)];
    for (const key of new Set(keys)) {
        try {
            localStorage.removeItem(key);
        } catch {
            /* ignore */
        }
        snapshotCache.delete(key);
        listeners.get(key)?.forEach(listener => listener());
    }
}
