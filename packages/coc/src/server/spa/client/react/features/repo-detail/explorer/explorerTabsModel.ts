/**
 * explorerTabsModel — the pure, React-free model behind the File Explorer's
 * VS Code-style editor tab strip.
 *
 * Everything here is a plain function over an immutable `ExplorerTabsState`:
 * the state shape, the open/activate/close/reorder operations, the MRU
 * bookkeeping that decides what gets focus when a tab closes, and the codec
 * that round-trips the whole thing through localStorage. Keeping it separate
 * from both the store (`explorerStateStore`) and the UI means the tab rules —
 * which are the fiddly part of this feature — are testable without a DOM.
 *
 * Three invariants hold for every value returned by this module:
 *  1. **At most one preview tab.** A preview tab is the italic, replaceable one
 *     a single click opens; opening another previewed file reuses its slot
 *     rather than growing the strip.
 *  2. **One tab per target.** Tab ids are derived from the target (a file path,
 *     a search query), so opening something already open activates it instead
 *     of creating a duplicate.
 *  3. **`mru` lists exactly the open tab ids, most-recently-active first**, and
 *     `activeId` is either null (no tabs) or `mru[0]`. Closing the active tab
 *     therefore falls back to the next entry — the most recently used survivor,
 *     not the neighbour in strip order.
 *
 * Operations return the *same* state reference when they change nothing. That
 * is load-bearing: the state is served through `useSyncExternalStore`, which
 * re-renders on every new reference and would loop on a fresh object per call.
 */

/**
 * What a tab renders. `file` tabs own a real path and go through PreviewPane;
 * `search` tabs hold the read-only text buffer produced by the content-search
 * view's "Open in Editor" action.
 */
export type ExplorerTabKind = 'file' | 'search';

export interface ExplorerTab {
    /**
     * Stable identity, derived from the target rather than a counter, so that
     * "is this already open?" is a map lookup and a persisted tab keeps its id
     * across reloads. See `fileTabId` / `searchTabId`.
     */
    id: string;
    kind: ExplorerTabKind;
    /**
     * For `file` tabs: the path passed to PreviewPane — repo-relative, or
     * carrying `TRUSTED_PATH_PREFIX` for an absolute trusted file. Empty for
     * `search` tabs, which have no file behind them.
     */
    path: string;
    /** The label the strip shows (a filename, or a search description). */
    name: string;
    /**
     * True while this is the single replaceable preview tab: rendered italic,
     * reused by the next single-click open, and promoted to a normal tab by a
     * double click or by the first edit.
     */
    preview: boolean;
    /**
     * True when the buffer must never be written: search buffers, and trusted
     * absolute-path files opened through Exact Open. Read-only tabs never
     * become dirty and never take part in a save prompt.
     */
    readOnly: boolean;
    /**
     * One-based line to reveal when the buffer loads — set when the file was
     * opened from a content-search hit or a deep link. Absent for a plain open.
     */
    line?: number;
    /** For `search` tabs only: the query whose results the buffer holds. */
    query?: string;
}

export interface ExplorerTabsState {
    /** Open tabs in strip order — the order drag-and-drop rearranges. */
    tabs: readonly ExplorerTab[];
    /** The tab whose buffer is showing, or null when nothing is open. */
    activeId: string | null;
    /** Every open tab id, most recently activated first. */
    mru: readonly string[];
}

/** The state of an Explorer that has never opened anything. */
export const EMPTY_EXPLORER_TABS: ExplorerTabsState = {
    tabs: [],
    activeId: null,
    mru: [],
};

/** Which direction `cycleTabs` walks the MRU list. */
export type TabCycleDirection = 'forward' | 'backward';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Tab id for a file path. Deduplication across every open path is this line. */
export function fileTabId(path: string): string {
    return `file:${path}`;
}

/**
 * Tab id for a search buffer. Keyed by the query so re-running "Open in Editor"
 * for the same search activates the existing buffer instead of stacking
 * near-identical tabs, while a different query gets its own.
 */
export function searchTabId(query: string): string {
    return `search:${query}`;
}

/** The active tab object, or null when the strip is empty. */
export function activeTab(state: ExplorerTabsState): ExplorerTab | null {
    if (state.activeId === null) return null;
    return state.tabs.find(tab => tab.id === state.activeId) ?? null;
}

/** Look up an open tab by id. */
export function findTab(state: ExplorerTabsState, id: string): ExplorerTab | null {
    return state.tabs.find(tab => tab.id === id) ?? null;
}

/** True when a file path already has a tab. */
export function hasFileTab(state: ExplorerTabsState, path: string): boolean {
    return state.tabs.some(tab => tab.id === fileTabId(path));
}

/** The single preview tab, or null when every open tab is pinned. */
export function previewTab(state: ExplorerTabsState): ExplorerTab | null {
    return state.tabs.find(tab => tab.preview) ?? null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** `id` first, then the previous order with `id` removed. */
function touchMru(mru: readonly string[], id: string): readonly string[] {
    if (mru[0] === id) return mru;
    return [id, ...mru.filter(entry => entry !== id)];
}

/**
 * Build a state from a tab list plus a desired active id, repairing the MRU:
 * ids of closed tabs are dropped, tabs that were never in the MRU are appended
 * (they are the least recently used), and `activeId` is pulled to the front.
 * Every mutating operation funnels through here so invariant 3 cannot drift.
 */
function reconcile(
    prev: ExplorerTabsState,
    tabs: readonly ExplorerTab[],
    activeId: string | null,
): ExplorerTabsState {
    const open = new Set(tabs.map(tab => tab.id));
    const nextActive = activeId !== null && open.has(activeId)
        ? activeId
        : null;
    let mru: readonly string[] = prev.mru.filter(id => open.has(id));
    const known = new Set(mru);
    for (const tab of tabs) {
        if (!known.has(tab.id)) mru = [...mru, tab.id];
    }
    if (nextActive !== null) mru = touchMru(mru, nextActive);
    return finalize(prev, tabs, nextActive ?? mru[0] ?? null, mru);
}

/** Return `prev` unchanged when nothing actually moved, else the new state. */
function finalize(
    prev: ExplorerTabsState,
    tabs: readonly ExplorerTab[],
    activeId: string | null,
    mru: readonly string[],
): ExplorerTabsState {
    if (
        prev.activeId === activeId
        && sameTabs(prev.tabs, tabs)
        && sameIds(prev.mru, mru)
    ) {
        return prev;
    }
    return { tabs, activeId, mru };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

function sameTabs(a: readonly ExplorerTab[], b: readonly ExplorerTab[]): boolean {
    return a.length === b.length && a.every((tab, index) => tab === b[index]);
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

/** What `openFileTab` needs to know about the file being opened. */
export interface OpenFileTabInput {
    path: string;
    name: string;
    /** One-based line to reveal; carried onto the tab. */
    line?: number;
    /**
     * True for the single replaceable preview tab (a single tree click, a
     * search hit, a Quick Open pick). False pins the tab immediately, which is
     * what a double click and a deep link do.
     */
    preview: boolean;
    /** True for trusted absolute-path files, which are never editable. */
    readOnly?: boolean;
}

/**
 * Open (or re-activate) a file tab.
 *
 * Already open → activate it, refreshing the reveal line if this open supplied
 * one, and pinning it when the caller asked for a pinned open. Never a
 * duplicate, and never silently demoted back to preview.
 *
 * Not open, `preview: true` → take over the existing preview tab's slot so the
 * strip does not grow, or append when there is no preview tab.
 *
 * Not open, `preview: false` → append a pinned tab at the end.
 */
export function openFileTab(state: ExplorerTabsState, input: OpenFileTabInput): ExplorerTabsState {
    const id = fileTabId(input.path);
    const existingIndex = state.tabs.findIndex(tab => tab.id === id);
    if (existingIndex >= 0) {
        const existing = state.tabs[existingIndex];
        const updated: ExplorerTab = {
            ...existing,
            // A pinned open promotes; a preview open of an already-pinned tab
            // must not knock it back to replaceable.
            preview: existing.preview && input.preview,
            ...(input.line === undefined ? {} : { line: input.line }),
        };
        const tabs = sameTab(existing, updated)
            ? state.tabs
            : replaceAt(state.tabs, existingIndex, updated);
        return reconcile(state, tabs, id);
    }

    const opened: ExplorerTab = {
        id,
        kind: 'file',
        path: input.path,
        name: input.name,
        preview: input.preview,
        readOnly: input.readOnly === true,
        ...(input.line === undefined ? {} : { line: input.line }),
    };

    if (input.preview) {
        const previewIndex = state.tabs.findIndex(tab => tab.preview);
        if (previewIndex >= 0) {
            return reconcile(state, replaceAt(state.tabs, previewIndex, opened), id);
        }
    }
    return reconcile(state, [...state.tabs, opened], id);
}

/** What `openSearchTab` needs: the query, and the label to show. */
export interface OpenSearchTabInput {
    query: string;
    name: string;
}

/**
 * Open (or re-activate) the read-only buffer for a content-search result set.
 * Always a pinned normal tab: a search buffer is deliberate enough that a
 * following single click on a file should not throw it away.
 */
export function openSearchTab(state: ExplorerTabsState, input: OpenSearchTabInput): ExplorerTabsState {
    const id = searchTabId(input.query);
    const existingIndex = state.tabs.findIndex(tab => tab.id === id);
    if (existingIndex >= 0) {
        const existing = state.tabs[existingIndex];
        const updated: ExplorerTab = { ...existing, name: input.name, preview: false };
        const tabs = sameTab(existing, updated)
            ? state.tabs
            : replaceAt(state.tabs, existingIndex, updated);
        return reconcile(state, tabs, id);
    }
    const opened: ExplorerTab = {
        id,
        kind: 'search',
        path: '',
        name: input.name,
        preview: false,
        readOnly: true,
        query: input.query,
    };
    return reconcile(state, [...state.tabs, opened], id);
}

function replaceAt(tabs: readonly ExplorerTab[], index: number, tab: ExplorerTab): ExplorerTab[] {
    const next = [...tabs];
    next[index] = tab;
    return next;
}

function sameTab(a: ExplorerTab, b: ExplorerTab): boolean {
    return a.id === b.id
        && a.kind === b.kind
        && a.path === b.path
        && a.name === b.name
        && a.preview === b.preview
        && a.readOnly === b.readOnly
        && a.line === b.line
        && a.query === b.query;
}

// ---------------------------------------------------------------------------
// Activation and pinning
// ---------------------------------------------------------------------------

/** Make an open tab active, moving it to the front of the MRU. No-op if absent. */
export function activateTab(state: ExplorerTabsState, id: string): ExplorerTabsState {
    if (!state.tabs.some(tab => tab.id === id)) return state;
    return reconcile(state, state.tabs, id);
}

/**
 * Pin a preview tab so the next single-click open cannot replace it. This is
 * what a double click does, and what the first edit to a preview buffer does
 * before it becomes dirty. A no-op on an already-pinned tab.
 */
export function pinTab(state: ExplorerTabsState, id: string): ExplorerTabsState {
    const index = state.tabs.findIndex(tab => tab.id === id);
    if (index < 0 || !state.tabs[index].preview) return state;
    const tabs = replaceAt(state.tabs, index, { ...state.tabs[index], preview: false });
    return finalize(state, tabs, state.activeId, state.mru);
}

/**
 * Clear a tab's pending reveal line, once the editor has scrolled to it. Left
 * in place the line would be re-revealed every time the tab is re-activated,
 * yanking the user back from wherever they had scrolled to.
 */
export function clearTabRevealLine(state: ExplorerTabsState, id: string): ExplorerTabsState {
    const index = state.tabs.findIndex(tab => tab.id === id);
    if (index < 0 || state.tabs[index].line === undefined) return state;
    const { line: _line, ...rest } = state.tabs[index];
    return finalize(state, replaceAt(state.tabs, index, rest), state.activeId, state.mru);
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

/**
 * Close one tab. When it was the active one, the most recently used *remaining*
 * tab takes over — not the strip neighbour, so alt-tabbing between two files
 * and closing one lands you back on the other.
 */
export function closeTab(state: ExplorerTabsState, id: string): ExplorerTabsState {
    return closeTabs(state, [id]);
}

/**
 * Close several tabs at once — what the context menu's Close Others / Close to
 * the Right / Close All resolve to, and what the save prompt confirms over.
 * Ids that are not open are ignored.
 */
export function closeTabs(state: ExplorerTabsState, ids: readonly string[]): ExplorerTabsState {
    const closing = new Set(ids);
    const tabs = state.tabs.filter(tab => !closing.has(tab.id));
    if (tabs.length === state.tabs.length) return state;
    const stillActive = state.activeId !== null && !closing.has(state.activeId)
        ? state.activeId
        // The MRU is most-recent-first, so the first survivor is the right
        // fallback for a closed active tab.
        : state.mru.find(entry => !closing.has(entry)) ?? null;
    return reconcile(state, tabs, stillActive);
}

/** Ids of every tab except `id` — the Close Others target set. */
export function otherTabIds(state: ExplorerTabsState, id: string): string[] {
    return state.tabs.filter(tab => tab.id !== id).map(tab => tab.id);
}

/** Ids of the tabs sitting after `id` in strip order — Close to the Right. */
export function tabIdsToRight(state: ExplorerTabsState, id: string): string[] {
    const index = state.tabs.findIndex(tab => tab.id === id);
    if (index < 0) return [];
    return state.tabs.slice(index + 1).map(tab => tab.id);
}

/** Ids of every open tab — the Close All target set. */
export function allTabIds(state: ExplorerTabsState): string[] {
    return state.tabs.map(tab => tab.id);
}

// ---------------------------------------------------------------------------
// Reordering and cycling
// ---------------------------------------------------------------------------

/**
 * Move the tab at `fromIndex` so it sits at `toIndex` — the drag-and-drop
 * reorder. Activation and the MRU are untouched: dragging a tab rearranges the
 * strip, it does not switch buffers. Out-of-range indices are a no-op.
 */
export function moveTab(state: ExplorerTabsState, fromIndex: number, toIndex: number): ExplorerTabsState {
    const count = state.tabs.length;
    if (fromIndex < 0 || fromIndex >= count) return state;
    if (toIndex < 0 || toIndex >= count) return state;
    if (fromIndex === toIndex) return state;
    const tabs = [...state.tabs];
    const [moved] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, moved);
    return finalize(state, tabs, state.activeId, state.mru);
}

/**
 * Ctrl+Tab / Ctrl+Shift+Tab: step through the MRU list, wrapping at both ends.
 * `forward` walks toward less recently used tabs (VS Code's Ctrl+Tab), and
 * `backward` walks back toward the most recent. Returns the id to activate, or
 * null when there is nothing to cycle to.
 *
 * This deliberately reports the target rather than applying it — the caller
 * activates on key-up so a held Ctrl can walk several steps before the MRU is
 * rewritten, which is what makes repeated Ctrl+Tab reach the third tab instead
 * of ping-ponging between the first two.
 */
export function cycleTabs(state: ExplorerTabsState, direction: TabCycleDirection): string | null {
    return cycleTabsWithin(state.mru, state.activeId, direction);
}

/**
 * The same walk against an explicit MRU list. A held Ctrl+Tab activates every
 * step it passes through so the user sees where they are, and activating
 * rewrites the MRU — so the caller snapshots the list when the walk starts and
 * keeps stepping through that snapshot until the modifier is released.
 * Returns the id to activate, or null when there is nothing to cycle to.
 */
export function cycleTabsWithin(
    mru: readonly string[],
    fromId: string | null,
    direction: TabCycleDirection,
): string | null {
    if (mru.length < 2) return null;
    const current = fromId === null ? 0 : mru.indexOf(fromId);
    const from = current < 0 ? 0 : current;
    const step = direction === 'forward' ? 1 : -1;
    const next = (from + step + mru.length) % mru.length;
    return mru[next];
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Labels for the strip, VS Code style: the filename alone, and when two open
 * tabs share a filename, the shortest trailing path segments that tell them
 * apart (`src/index.ts` vs `test/index.ts`). Search tabs keep their own name.
 * Returned as tab id → label.
 */
export function tabLabels(tabs: readonly ExplorerTab[]): Map<string, string> {
    const byName = new Map<string, ExplorerTab[]>();
    for (const tab of tabs) {
        const group = byName.get(tab.name);
        if (group) group.push(tab);
        else byName.set(tab.name, [tab]);
    }
    const labels = new Map<string, string>();
    for (const [name, group] of byName) {
        if (group.length === 1 || group.some(tab => tab.kind !== 'file')) {
            for (const tab of group) labels.set(tab.id, name);
            continue;
        }
        const segments = group.map(tab => tab.path.split('/').filter(Boolean));
        // Grow the suffix a segment at a time until every path in the group is
        // distinct, so colliding files show the least context that separates
        // them rather than their whole path.
        const longest = Math.max(...segments.map(parts => parts.length));
        let depth = 1;
        while (depth < longest) {
            const suffixes = segments.map(parts => parts.slice(-depth).join('/'));
            if (new Set(suffixes).size === suffixes.length) break;
            depth += 1;
        }
        group.forEach((tab, index) => {
            labels.set(tab.id, segments[index].slice(-depth).join('/'));
        });
    }
    return labels;
}

// ---------------------------------------------------------------------------
// Persistence codec
// ---------------------------------------------------------------------------

/**
 * Serialize the tab session for localStorage. Only the structure is written —
 * unsaved buffer contents deliberately never leave memory, so a reload restores
 * the same tabs reading their files fresh from disk.
 */
export function serializeExplorerTabs(state: ExplorerTabsState): string {
    return JSON.stringify({
        tabs: state.tabs,
        activeId: state.activeId,
        mru: state.mru,
    });
}

/**
 * Parse a persisted tab session, dropping anything malformed rather than
 * throwing: a half-written or older payload should cost the user their tab
 * layout, not their Explorer. The result satisfies every invariant, so a
 * hand-edited `activeId` or a stale MRU entry is repaired on read.
 */
export function parseExplorerTabs(raw: string): ExplorerTabsState {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_EXPLORER_TABS;
    const source = parsed as { tabs?: unknown; activeId?: unknown; mru?: unknown };
    if (!Array.isArray(source.tabs)) return EMPTY_EXPLORER_TABS;

    const seen = new Set<string>();
    const tabs: ExplorerTab[] = [];
    for (const entry of source.tabs) {
        const tab = parseTab(entry);
        if (!tab || seen.has(tab.id)) continue;
        seen.add(tab.id);
        tabs.push(tab);
    }
    if (tabs.length === 0) return EMPTY_EXPLORER_TABS;

    // A payload claiming two preview tabs breaks invariant 1; keep the first.
    let previewSeen = false;
    for (let index = 0; index < tabs.length; index += 1) {
        if (!tabs[index].preview) continue;
        if (previewSeen) tabs[index] = { ...tabs[index], preview: false };
        previewSeen = true;
    }

    const mru = Array.isArray(source.mru)
        ? source.mru.filter((id): id is string => typeof id === 'string')
        : [];
    const activeId = typeof source.activeId === 'string' ? source.activeId : null;
    return reconcile({ tabs: [], activeId: null, mru }, tabs, activeId);
}

function parseTab(entry: unknown): ExplorerTab | null {
    if (!entry || typeof entry !== 'object') return null;
    const source = entry as Record<string, unknown>;
    const kind = source.kind === 'search' ? 'search' : source.kind === 'file' ? 'file' : null;
    if (kind === null) return null;
    if (typeof source.name !== 'string' || source.name.length === 0) return null;

    if (kind === 'file') {
        if (typeof source.path !== 'string' || source.path.length === 0) return null;
        return {
            id: fileTabId(source.path),
            kind,
            path: source.path,
            name: source.name,
            preview: source.preview === true,
            readOnly: source.readOnly === true,
            ...(typeof source.line === 'number' && Number.isFinite(source.line)
                ? { line: source.line }
                : {}),
        };
    }

    if (typeof source.query !== 'string') return null;
    return {
        id: searchTabId(source.query),
        kind,
        path: '',
        name: source.name,
        preview: false,
        readOnly: true,
        query: source.query,
    };
}
