/**
 * unifiedPanelTabsModel — the pure, React-free model behind the unified right
 * panel's Cursor-style resource tab strip (feature flag `unifiedRightPanel`).
 *
 * Everything here is a plain function over an immutable `UnifiedPanelState`:
 * the descriptor shape, the identity rule that makes "open this again" focus an
 * existing tab, the workspace/chat ownership split, reorder, close, and the
 * versioned codec that round-trips the whole thing through localStorage.
 * Keeping it apart from the UI means the ownership and identity rules — the
 * fiddly part — are testable without a DOM.
 *
 * Four invariants hold for every value this module returns:
 *  1. **Ownership follows the kind.** Terminal, Explorer, and Notes tabs belong
 *     to the workspace and stay visible across chat switches; file, canvas, and
 *     diff tabs belong to the chat that opened them (or to the workspace when
 *     no chat is selected). See `scopeForKind`.
 *  2. **One tab per resource per scope.** Ids are derived from kind + scope +
 *     owning clone + canonical resource id, so opening the same file twice
 *     focuses one tab, while the same relative path in two repo-group members —
 *     or in two different chats — stays two distinct tabs.
 *  3. **Strip order is workspace tabs, then the selected chat's tabs.** Reorder
 *     moves a tab within its own section; dragging never changes ownership.
 *  4. **`activeByScope` holds at most one id per scope**, and it is always
 *     either null or a tab visible in that scope — so switching chats and back
 *     restores what was selected there, including a workspace tab.
 *
 * Operations return the *same* state reference when they change nothing, which
 * is load-bearing: the state is served through `useSyncExternalStore`, which
 * re-renders on every new reference and would loop on a fresh object per call.
 *
 * Only descriptors live here. Document bodies, terminal output, canvas
 * revisions, and credentials stay with their existing services — a persisted
 * tab is a pointer to a resource, never a copy of it.
 */

/**
 * What a tab renders.
 *
 * `terminal` is one live PTY session, `explorer` the singleton file navigator,
 * and `notes` the singleton note navigator — all workspace-owned. `file`,
 * `note`, `canvas`, and `diff` are concrete opened resources; `note` is
 * workspace-owned (a note belongs to the workspace, not to the chat that linked
 * it), the rest follow the selected chat.
 */
export type UnifiedTabKind = 'terminal' | 'explorer' | 'notes' | 'file' | 'note' | 'canvas' | 'diff';

/** Which set a tab belongs to: the workspace's, or one chat's. */
export type UnifiedTabScope = 'workspace' | 'chat';

/** Every kind, in the order the "+" menu and default strip present them. */
export const ALL_UNIFIED_TAB_KINDS: readonly UnifiedTabKind[] = [
    'terminal', 'explorer', 'notes', 'file', 'note', 'canvas', 'diff',
];

/** Kinds that belong to the workspace and survive a chat switch. */
const WORKSPACE_KINDS: ReadonlySet<UnifiedTabKind> = new Set<UnifiedTabKind>(['terminal', 'explorer', 'notes', 'note']);

/**
 * The scope key used for the workspace's own selection — the active tab when no
 * chat is selected. Deliberately not a legal chat id.
 */
export const WORKSPACE_SCOPE_KEY = '@workspace';

/**
 * Ownership rule (AC-02). Terminals, Explorer, Notes, and note documents are
 * workspace-owned; specific files, canvases, and diffs follow the chat that
 * opened them. Files opened with no chat selected fall back to the workspace,
 * which `scopeKeyFor` handles.
 */
export function scopeForKind(kind: UnifiedTabKind): UnifiedTabScope {
    return WORKSPACE_KINDS.has(kind) ? 'workspace' : 'chat';
}

/**
 * The key a tab is filed under: `WORKSPACE_SCOPE_KEY` for workspace-owned
 * kinds and for chat-owned kinds opened with no chat selected, otherwise the
 * chat id. This is also the key `activeByScope` uses.
 */
export function scopeKeyFor(kind: UnifiedTabKind, chatId: string | null): string {
    if (scopeForKind(kind) === 'workspace') return WORKSPACE_SCOPE_KEY;
    return chatId ?? WORKSPACE_SCOPE_KEY;
}

/**
 * A persisted tab descriptor. Every field is either identity or presentation —
 * nothing here is content, and nothing here grants a capability the underlying
 * view would not already give the user.
 */
export interface UnifiedPanelTab {
    /**
     * Stable identity from kind + scope + owning clone + resource id, so that
     * "is this already open?" is a lookup and a persisted tab keeps its id
     * across reloads. See `unifiedTabId`.
     */
    id: string;
    kind: UnifiedTabKind;
    /**
     * The workspace/clone that actually owns the resource — a repo-group member
     * repo, or a remote clone. Independent of which scope the tab is filed
     * under: a chat-owned file tab still names the repo its bytes come from, so
     * requests route to the resource owner rather than the page origin.
     */
    ownerWorkspaceId: string;
    /** The chat this tab belongs to, or null for a workspace-owned tab. */
    chatId: string | null;
    /**
     * Canonical identity within the owner: a normalized repo-relative path, a
     * canvas id, a terminal session id, a note root + path, or a diff source
     * id. Combined with `ownerWorkspaceId` it is what deduplication compares.
     */
    resourceId: string;
    /** The label the strip shows; truncated in the UI, full text in the title. */
    label: string;
    /**
     * Repo attribution shown beside an ambiguous label — two repo-group members
     * with the same filename, or a resource from a remote clone.
     */
    repoLabel?: string;
    /**
     * True when this tab may never write. Set by read-only entry points (a chat
     * source link); restoring or reordering a tab must never clear it, which is
     * why it travels with the descriptor rather than being re-derived.
     */
    readOnly?: boolean;
    /** One-based line to reveal when the resource loads, for a deep link. */
    line?: number;
}

export interface UnifiedPanelState {
    /** Workspace-owned tabs, in strip order. Visible in every chat. */
    workspaceTabs: readonly UnifiedPanelTab[];
    /** Chat-owned tabs keyed by chat id, each list in strip order. */
    chatTabs: Readonly<Record<string, readonly UnifiedPanelTab[]>>;
    /**
     * The last active tab id per scope key, so returning to a chat restores its
     * selection. A value may name a workspace tab — that was a legal selection
     * in that chat.
     */
    activeByScope: Readonly<Record<string, string | null>>;
}

/** The state of a panel that has never opened anything. */
export const EMPTY_UNIFIED_PANEL: UnifiedPanelState = {
    workspaceTabs: [],
    chatTabs: {},
    activeByScope: {},
};

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Stable tab id. `|` separates the parts and each part is escaped, so a
 * resource id containing the separator cannot forge another tab's identity.
 *
 * The scope key is part of the id on purpose: the same file opened from two
 * chats is two tabs (each closes with its chat's set), while the same file
 * opened twice in one chat is one.
 */
export function unifiedTabId(input: {
    kind: UnifiedTabKind;
    ownerWorkspaceId: string;
    chatId: string | null;
    resourceId: string;
}): string {
    const scopeKey = scopeKeyFor(input.kind, input.chatId);
    return [input.kind, scopeKey, input.ownerWorkspaceId, input.resourceId].map(escapePart).join('|');
}

function escapePart(part: string): string {
    return part.replace(/\\/g, '\\\\').replace(/\|/g, '\\p');
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The tabs visible for a chat selection, in strip order: workspace tabs first,
 * then that chat's own tabs. Passing null (no chat selected) shows the
 * workspace tabs plus anything opened while no chat was selected.
 */
export function visibleTabs(state: UnifiedPanelState, chatId: string | null): readonly UnifiedPanelTab[] {
    const chatOwned = state.chatTabs[chatId ?? WORKSPACE_SCOPE_KEY] ?? [];
    if (chatOwned.length === 0) return state.workspaceTabs;
    return [...state.workspaceTabs, ...chatOwned];
}

/**
 * The active tab id for a chat selection: the remembered one when it is still
 * visible there, otherwise the first visible tab, otherwise null. Falling
 * forward rather than showing nothing is what keeps a chat switch from landing
 * on an empty panel while tabs are open.
 */
export function activeTabId(state: UnifiedPanelState, chatId: string | null): string | null {
    const visible = visibleTabs(state, chatId);
    if (visible.length === 0) return null;
    const remembered = state.activeByScope[chatId ?? WORKSPACE_SCOPE_KEY] ?? null;
    if (remembered !== null && visible.some(tab => tab.id === remembered)) return remembered;
    return visible[0].id;
}

/** The active tab object for a chat selection, or null when nothing is open. */
export function activeTab(state: UnifiedPanelState, chatId: string | null): UnifiedPanelTab | null {
    const id = activeTabId(state, chatId);
    if (id === null) return null;
    return visibleTabs(state, chatId).find(tab => tab.id === id) ?? null;
}

/** Look up a tab anywhere in the state, regardless of scope. */
export function findTab(state: UnifiedPanelState, id: string): UnifiedPanelTab | null {
    const inWorkspace = state.workspaceTabs.find(tab => tab.id === id);
    if (inWorkspace) return inWorkspace;
    for (const list of Object.values(state.chatTabs)) {
        const found = list.find(tab => tab.id === id);
        if (found) return found;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sameTab(a: UnifiedPanelTab, b: UnifiedPanelTab): boolean {
    return a.id === b.id
        && a.kind === b.kind
        && a.ownerWorkspaceId === b.ownerWorkspaceId
        && a.chatId === b.chatId
        && a.resourceId === b.resourceId
        && a.label === b.label
        && a.repoLabel === b.repoLabel
        && a.readOnly === b.readOnly
        && a.line === b.line;
}

function sameList(a: readonly UnifiedPanelTab[], b: readonly UnifiedPanelTab[]): boolean {
    return a.length === b.length && a.every((tab, index) => sameTab(tab, b[index]));
}

/** Replace one scope's tab list, returning `state` when nothing moved. */
function withList(
    state: UnifiedPanelState,
    scopeKey: string,
    scope: UnifiedTabScope,
    tabs: readonly UnifiedPanelTab[],
): UnifiedPanelState {
    if (scope === 'workspace') {
        if (sameList(state.workspaceTabs, tabs)) return state;
        return { ...state, workspaceTabs: tabs };
    }
    if (sameList(state.chatTabs[scopeKey] ?? [], tabs)) return state;
    const chatTabs = { ...state.chatTabs };
    if (tabs.length === 0) delete chatTabs[scopeKey];
    else chatTabs[scopeKey] = tabs;
    return { ...state, chatTabs };
}

/** Record a scope's active selection, returning `state` when unchanged. */
function withActive(state: UnifiedPanelState, scopeKey: string, id: string | null): UnifiedPanelState {
    const current = state.activeByScope[scopeKey] ?? null;
    if (current === id) return state;
    const activeByScope = { ...state.activeByScope };
    if (id === null) delete activeByScope[scopeKey];
    else activeByScope[scopeKey] = id;
    return { ...state, activeByScope };
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

/** What `openTab` needs to place and identify a resource. */
export interface OpenUnifiedTabInput {
    kind: UnifiedTabKind;
    /** The clone that owns the resource — a group member or remote clone. */
    ownerWorkspaceId: string;
    /**
     * The selected chat. Ignored for workspace-owned kinds; for chat-owned
     * kinds, null files the tab under the workspace instead.
     */
    chatId: string | null;
    resourceId: string;
    label: string;
    repoLabel?: string;
    readOnly?: boolean;
    line?: number;
}

/**
 * Open a resource, or focus its existing tab.
 *
 * Already open → activate it and refresh the presentation fields (a new reveal
 * line navigates the existing tab rather than stacking a second one). `readOnly`
 * is only ever tightened: an authorized editable entry point may open an
 * already-read-only tab for editing, but a read-only open can never widen an
 * editable tab's capability, and neither can a restore.
 *
 * Not open → append to the end of its own scope section.
 */
export function openTab(state: UnifiedPanelState, input: OpenUnifiedTabInput): UnifiedPanelState {
    const scope = scopeForKind(input.kind);
    const scopeKey = scopeKeyFor(input.kind, input.chatId);
    const chatId = scope === 'workspace' ? null : (input.chatId ?? null);
    const id = unifiedTabId({ kind: input.kind, ownerWorkspaceId: input.ownerWorkspaceId, chatId: input.chatId, resourceId: input.resourceId });
    const list = scope === 'workspace' ? state.workspaceTabs : (state.chatTabs[scopeKey] ?? []);
    const index = list.findIndex(tab => tab.id === id);

    const opened: UnifiedPanelTab = {
        id,
        kind: input.kind,
        ownerWorkspaceId: input.ownerWorkspaceId,
        chatId,
        resourceId: input.resourceId,
        label: input.label,
        ...(input.repoLabel === undefined ? {} : { repoLabel: input.repoLabel }),
        ...(input.readOnly ? { readOnly: true } : {}),
        ...(input.line === undefined ? {} : { line: input.line }),
    };

    let nextList: readonly UnifiedPanelTab[];
    if (index >= 0) {
        const existing = list[index];
        const merged: UnifiedPanelTab = {
            ...opened,
            // Keep the existing reveal line when this open supplied none, so
            // re-focusing a tab does not forget where it was pointed.
            ...(input.line === undefined && existing.line !== undefined ? { line: existing.line } : {}),
        };
        // `merged` takes `readOnly` from `opened`, i.e. from THIS open's entry
        // point: an authorized editable entry point unlocks a tab previously
        // opened read-only, and a read-only entry point re-locks it. Only an
        // open can move that bit — `moveTab`, `activateTab`, and the codec all
        // carry the descriptor through untouched, so restoring or dragging a
        // read-only source reference can never make it editable.
        const copy = [...list];
        copy[index] = sameTab(existing, merged) ? existing : merged;
        nextList = copy;
    } else {
        nextList = [...list, opened];
    }

    return withActive(withList(state, scopeKey, scope, nextList), input.chatId ?? WORKSPACE_SCOPE_KEY, id);
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Select a tab within a chat's view. A no-op when the id is not visible there,
 * so a stale activation from a background chat cannot point a scope at a tab it
 * does not own.
 */
export function activateTab(state: UnifiedPanelState, chatId: string | null, id: string): UnifiedPanelState {
    if (!visibleTabs(state, chatId).some(tab => tab.id === id)) return state;
    return withActive(state, chatId ?? WORKSPACE_SCOPE_KEY, id);
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

/**
 * Close a tab wherever it lives, and drop every scope selection that pointed at
 * it — leaving a dangling id would make `activeTabId` silently fall forward, but
 * the stored value would keep resurrecting on the next open.
 *
 * Closing a tab is a layout operation only. Confirming a terminal kill or
 * resolving unsaved edits happens in the caller before this runs (AC-05).
 */
export function closeTab(state: UnifiedPanelState, id: string): UnifiedPanelState {
    const tab = findTab(state, id);
    if (tab === null) return state;
    const scope = scopeForKind(tab.kind);
    const scopeKey = scopeKeyFor(tab.kind, tab.chatId);
    const list = scope === 'workspace' ? state.workspaceTabs : (state.chatTabs[scopeKey] ?? []);
    let next = withList(state, scopeKey, scope, list.filter(entry => entry.id !== id));

    for (const [key, activeId] of Object.entries(next.activeByScope)) {
        if (activeId === id) next = withActive(next, key, null);
    }
    return next;
}

/** Every visible tab id for a chat — the "close all" target set. */
export function visibleTabIds(state: UnifiedPanelState, chatId: string | null): string[] {
    return visibleTabs(state, chatId).map(tab => tab.id);
}

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

/**
 * Move `id` so it sits where `beforeId` currently is, within its own scope
 * section. Dragging a chat tab onto the workspace section (or vice versa) is
 * rejected rather than silently re-homed: ownership is not a drag gesture.
 * Passing `beforeId: null` moves the tab to the end of its section.
 */
export function moveTab(state: UnifiedPanelState, id: string, beforeId: string | null): UnifiedPanelState {
    const tab = findTab(state, id);
    if (tab === null) return state;
    const scope = scopeForKind(tab.kind);
    const scopeKey = scopeKeyFor(tab.kind, tab.chatId);
    const list = scope === 'workspace' ? state.workspaceTabs : (state.chatTabs[scopeKey] ?? []);
    const from = list.findIndex(entry => entry.id === id);
    if (from < 0) return state;

    const without = list.filter(entry => entry.id !== id);
    if (beforeId === null) {
        return withList(state, scopeKey, scope, [...without, tab]);
    }
    const to = without.findIndex(entry => entry.id === beforeId);
    // `beforeId` outside this section means a cross-section drag; ignore it.
    if (to < 0) return state;
    return withList(state, scopeKey, scope, [...without.slice(0, to), tab, ...without.slice(to)]);
}

// ---------------------------------------------------------------------------
// Persistence codec
// ---------------------------------------------------------------------------

/** Bump when the descriptor shape changes; older payloads are then discarded. */
export const UNIFIED_PANEL_STATE_VERSION = 1;

/** localStorage key for one workspace's unified panel layout. */
export function unifiedPanelStorageKey(workspaceId: string): string {
    return `unified-right-panel:${workspaceId}:tabs`;
}

interface SerializedUnifiedPanelState {
    version: number;
    workspaceTabs: UnifiedPanelTab[];
    chatTabs: Record<string, UnifiedPanelTab[]>;
    activeByScope: Record<string, string>;
}

/** Serialize descriptors only — never document bodies, output, or credentials. */
export function serializeUnifiedPanelState(state: UnifiedPanelState): string {
    const chatTabs: Record<string, UnifiedPanelTab[]> = {};
    for (const [key, list] of Object.entries(state.chatTabs)) {
        if (list.length > 0) chatTabs[key] = [...list];
    }
    const activeByScope: Record<string, string> = {};
    for (const [key, id] of Object.entries(state.activeByScope)) {
        if (id !== null) activeByScope[key] = id;
    }
    const payload: SerializedUnifiedPanelState = {
        version: UNIFIED_PANEL_STATE_VERSION,
        workspaceTabs: [...state.workspaceTabs],
        chatTabs,
        activeByScope,
    };
    return JSON.stringify(payload);
}

function isKind(value: unknown): value is UnifiedTabKind {
    return typeof value === 'string' && (ALL_UNIFIED_TAB_KINDS as readonly string[]).includes(value);
}

/**
 * Validate one persisted descriptor. A descriptor whose id does not match what
 * its own fields would produce is rejected: a hand-edited or stale entry must
 * not be able to alias a different resource's tab.
 */
function parseTab(raw: unknown, expectedScopeKey: string): UnifiedPanelTab | null {
    if (raw === null || typeof raw !== 'object') return null;
    const value = raw as Record<string, unknown>;
    const { kind, ownerWorkspaceId, resourceId, label, id } = value;
    if (!isKind(kind)) return null;
    if (typeof ownerWorkspaceId !== 'string' || ownerWorkspaceId === '') return null;
    if (typeof resourceId !== 'string' || resourceId === '') return null;
    if (typeof label !== 'string' || label === '') return null;
    if (typeof id !== 'string') return null;
    const chatId = value.chatId === null || value.chatId === undefined ? null : value.chatId;
    if (chatId !== null && typeof chatId !== 'string') return null;
    if (scopeKeyFor(kind, chatId) !== expectedScopeKey) return null;
    if (unifiedTabId({ kind, ownerWorkspaceId, chatId, resourceId }) !== id) return null;

    const tab: UnifiedPanelTab = {
        id, kind, ownerWorkspaceId, chatId, resourceId, label,
        ...(typeof value.repoLabel === 'string' ? { repoLabel: value.repoLabel } : {}),
        ...(value.readOnly === true ? { readOnly: true } : {}),
        ...(typeof value.line === 'number' && Number.isFinite(value.line) && value.line > 0 ? { line: value.line } : {}),
    };
    return tab;
}

function parseList(raw: unknown, expectedScopeKey: string): UnifiedPanelTab[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const tabs: UnifiedPanelTab[] = [];
    for (const entry of raw) {
        const tab = parseTab(entry, expectedScopeKey);
        // Drop duplicates rather than restoring two tabs onto one resource.
        if (tab === null || seen.has(tab.id)) continue;
        seen.add(tab.id);
        tabs.push(tab);
    }
    return tabs;
}

/**
 * Restore a persisted layout. Anything unreadable — bad JSON, a version this
 * build does not understand, a malformed descriptor — degrades to the entries
 * that *are* valid rather than to a blank panel, and a wholly unusable payload
 * returns the empty state. Selections pointing at rejected tabs are dropped.
 *
 * Restoring never creates anything: a terminal descriptor here means "attach to
 * this session id if it still exists", never "spawn a replacement".
 */
export function parseUnifiedPanelState(raw: string | null): UnifiedPanelState {
    if (!raw) return EMPTY_UNIFIED_PANEL;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return EMPTY_UNIFIED_PANEL;
    }
    if (parsed === null || typeof parsed !== 'object') return EMPTY_UNIFIED_PANEL;
    const payload = parsed as Record<string, unknown>;
    if (payload.version !== UNIFIED_PANEL_STATE_VERSION) return EMPTY_UNIFIED_PANEL;

    const workspaceTabs = parseList(payload.workspaceTabs, WORKSPACE_SCOPE_KEY);
    const chatTabs: Record<string, readonly UnifiedPanelTab[]> = {};
    const rawChatTabs = payload.chatTabs;
    if (rawChatTabs !== null && typeof rawChatTabs === 'object' && !Array.isArray(rawChatTabs)) {
        for (const [key, list] of Object.entries(rawChatTabs as Record<string, unknown>)) {
            const tabs = parseList(list, key);
            if (tabs.length > 0) chatTabs[key] = tabs;
        }
    }

    const known = new Set<string>([
        ...workspaceTabs.map(tab => tab.id),
        ...Object.values(chatTabs).flatMap(list => list.map(tab => tab.id)),
    ]);
    const activeByScope: Record<string, string> = {};
    const rawActive = payload.activeByScope;
    if (rawActive !== null && typeof rawActive === 'object' && !Array.isArray(rawActive)) {
        for (const [key, id] of Object.entries(rawActive as Record<string, unknown>)) {
            if (typeof id === 'string' && known.has(id)) activeByScope[key] = id;
        }
    }

    return { workspaceTabs, chatTabs, activeByScope };
}
