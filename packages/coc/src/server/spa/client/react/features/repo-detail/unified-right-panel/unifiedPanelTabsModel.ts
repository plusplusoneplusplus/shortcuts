/**
 * unifiedPanelTabsModel — the pure, React-free model behind the unified right
 * panel's Cursor-style resource tab strip.
 *
 * Everything here is a plain function over an immutable `UnifiedPanelState`:
 * the descriptor shape, the identity rule that makes "open this again" focus an
 * existing tab, the workspace/chat ownership split, reorder, close, and the
 * versioned codec that round-trips the whole thing through localStorage.
 * Keeping it apart from the UI means the ownership and identity rules — the
 * fiddly part — are testable without a DOM.
 *
 * Four invariants hold for every value this module returns:
 *  1. **Ownership follows the kind.** Terminal and Notes tabs belong
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
 *  5. **At most one preview tab per scope section, and it sits last.** The file
 *     tree's single click opens into that one replaceable slot (`openPreviewTab`)
 *     and every other entry point opens a permanent tab; promotion
 *     (`promoteTab`) is one-way and frees the slot for the next single click.
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
 * `terminal` is one live PTY session and `notes` the singleton note navigator —
 * both workspace-owned. `file`, `note`, `canvas`, and `diff` are concrete
 * opened resources; `note` is workspace-owned (a note belongs to the workspace,
 * not to the chat that linked it), the rest follow the selected chat.
 *
 * There is deliberately no `explorer` kind: the file tree is a panel-level
 * column (`unifiedPanelTree`), not a tab, so it cannot be closed by accident,
 * duplicated per chat, or ordered among resources.
 */
export type UnifiedTabKind = 'terminal' | 'notes' | 'file' | 'note' | 'canvas' | 'diff';

/** Which set a tab belongs to: the workspace's, or one chat's. */
export type UnifiedTabScope = 'workspace' | 'chat';

/** Every kind, in the order the "+" menu and default strip present them. */
export const ALL_UNIFIED_TAB_KINDS: readonly UnifiedTabKind[] = [
    'terminal', 'notes', 'file', 'note', 'canvas', 'diff',
];

/** Kinds that belong to the workspace and survive a chat switch. */
const WORKSPACE_KINDS: ReadonlySet<UnifiedTabKind> = new Set<UnifiedTabKind>(['terminal', 'notes', 'note']);

/**
 * The scope key used for the workspace's own selection — the active tab when no
 * chat is selected. Deliberately not a legal chat id.
 */
export const WORKSPACE_SCOPE_KEY = '@workspace';

/**
 * Ownership rule (AC-02). Terminals, Notes, and note documents are
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
    /**
     * One-based column within `line` for the cursor. Only a language-server
     * navigation supplies one; a deep link lands at the start of the line.
     */
    column?: number;
    /**
     * True on the section's single *preview* tab — VS Code's italic slot. A
     * preview tab is a normal tab in every respect except that the next
     * single click in the file tree reuses its slot instead of opening a
     * second tab, and any of the promotion gestures clears the bit for good.
     *
     * Only ever `true`: an absent bit and `false` would otherwise be two
     * spellings of "permanent", and the codec, `sameTab`, and the
     * at-most-one-per-section repair all compare on presence.
     */
    preview?: true;
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

/**
 * The preview tab of the section a file opened from `chatId` would land in, or
 * null when that section has none. At most one exists per section, which is
 * what makes "the preview slot" a thing the UI can point at (AC-03).
 */
export function previewTab(state: UnifiedPanelState, chatId: string | null): UnifiedPanelTab | null {
    const list = state.chatTabs[scopeKeyFor('file', chatId)] ?? [];
    return list.find(tab => tab.preview === true) ?? null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Where a newly opened permanent tab goes: the end of its section, or just
 * before the preview tab when there is one. The preview slot is always the
 * section's last tab, so it stays the rightmost thing the next tree click
 * replaces rather than drifting into the middle of the strip.
 */
function insertPermanent(list: readonly UnifiedPanelTab[], tab: UnifiedPanelTab): readonly UnifiedPanelTab[] {
    const previewIndex = list.findIndex(entry => entry.preview === true);
    if (previewIndex < 0) return [...list, tab];
    return [...list.slice(0, previewIndex), tab, ...list.slice(previewIndex)];
}

function sameTab(a: UnifiedPanelTab, b: UnifiedPanelTab): boolean {
    return a.id === b.id
        && a.kind === b.kind
        && a.ownerWorkspaceId === b.ownerWorkspaceId
        && a.chatId === b.chatId
        && a.resourceId === b.resourceId
        && a.label === b.label
        && a.repoLabel === b.repoLabel
        && a.readOnly === b.readOnly
        && a.line === b.line
        && a.column === b.column
        && a.preview === b.preview;
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
    column?: number;
}

/**
 * The reveal fields an open contributes. A column only ever travels with a
 * line, so a source that names neither contributes nothing.
 */
function revealFields(input: { line?: number; column?: number }): { line?: number; column?: number } {
    if (input.line === undefined) return {};
    return input.column === undefined
        ? { line: input.line }
        : { line: input.line, column: input.column };
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
 * Not open → append to the end of its own scope section, or just before the
 * preview tab when that section has one, so the preview slot stays last.
 *
 * This is the *permanent* open — `+`, a chat source link, a note link, a canvas
 * embed, a diff action. `opened` carries no `preview` bit, so opening the file
 * that currently sits in the preview slot promotes that tab in place rather
 * than leaving a permanent entry point rendering italics. Only
 * `openPreviewTab` ever sets the bit.
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
        ...revealFields(input),
    };

    let nextList: readonly UnifiedPanelTab[];
    if (index >= 0) {
        const existing = list[index];
        const merged: UnifiedPanelTab = {
            ...opened,
            // Keep the existing reveal position when this open supplied none, so
            // re-focusing a tab does not forget where it was pointed. The column
            // travels with its line and is never kept without one.
            ...(input.line === undefined ? revealFields(existing) : {}),
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
        nextList = insertPermanent(list, opened);
    }

    return withActive(withList(state, scopeKey, scope, nextList), input.chatId ?? WORKSPACE_SCOPE_KEY, id);
}

/** What `openPreviewTab` needs. Preview is a file-tab notion, so no `kind`. */
export type OpenUnifiedPreviewTabInput = Omit<OpenUnifiedTabInput, 'kind'>;

/**
 * Open a file in the section's single preview slot — the file tree's single
 * click, and nothing else (AC-03).
 *
 * Three cases, in the order they are checked:
 *
 *  1. **The file already has a tab visible here.** Focus it and change nothing
 *     else. That covers both a permanent tab — which must not be demoted, nor
 *     duplicated into the preview slot — and the file that is already the
 *     current preview, where re-clicking must not churn the buffer. Both return
 *     the same state reference when that tab is already active, so the view
 *     does not even re-render.
 *  2. **The section already has a preview.** Reuse the slot: the outgoing
 *     descriptor is replaced *at its own index* by the new one, so the strip
 *     shows one italic tab that changed its resource rather than a tab closing
 *     and another appearing.
 *  3. **Otherwise** append a new preview at the end of the section.
 *
 * Dirty state is not this function's business: the caller runs the unsaved-edits
 * guard before replacing a dirty preview, exactly as it does for a close.
 */
export function openPreviewTab(state: UnifiedPanelState, input: OpenUnifiedPreviewTabInput): UnifiedPanelState {
    const kind: UnifiedTabKind = 'file';
    const scope = scopeForKind(kind);
    const scopeKey = scopeKeyFor(kind, input.chatId);
    const viewKey = input.chatId ?? WORKSPACE_SCOPE_KEY;
    const id = unifiedTabId({ kind, ownerWorkspaceId: input.ownerWorkspaceId, chatId: input.chatId, resourceId: input.resourceId });

    // Visible, not just same-section: a file opened permanently with no chat
    // selected still shows in the strip once a chat is, and clicking it in the
    // tree should focus that tab rather than preview a second copy of it.
    if (visibleTabs(state, input.chatId).some(tab => tab.id === id)) {
        return withActive(state, viewKey, id);
    }

    const opened: UnifiedPanelTab = {
        id,
        kind,
        ownerWorkspaceId: input.ownerWorkspaceId,
        chatId: input.chatId ?? null,
        resourceId: input.resourceId,
        label: input.label,
        ...(input.repoLabel === undefined ? {} : { repoLabel: input.repoLabel }),
        ...(input.readOnly ? { readOnly: true } : {}),
        ...revealFields(input),
        preview: true,
    };

    const list = state.chatTabs[scopeKey] ?? [];
    const previewIndex = list.findIndex(tab => tab.preview === true);
    const outgoingId = previewIndex < 0 ? null : list[previewIndex].id;
    const nextList = previewIndex < 0
        ? [...list, opened]
        : [...list.slice(0, previewIndex), opened, ...list.slice(previewIndex + 1)];

    let next = withList(state, scopeKey, scope, nextList);
    // The replaced tab is gone; a scope still pointing at it would resurrect a
    // dangling id the way a close does, so clear those selections first.
    if (outgoingId !== null) {
        for (const [key, activeId] of Object.entries(next.activeByScope)) {
            if (activeId === outgoingId) next = withActive(next, key, null);
        }
    }
    return withActive(next, viewKey, id);
}

/**
 * The preview tab that `openPreviewTab` would evict for `input`, or null when
 * it would evict nothing — the file already has a visible tab, or the section
 * has no preview yet.
 *
 * The shell asks this before opening so it can run the unsaved-edits guard on
 * the outgoing buffer first. Keeping the question here rather than in the shell
 * means the guard and the open agree on what "replaced" means by construction.
 */
export function previewTabToReplace(
    state: UnifiedPanelState,
    chatId: string | null,
    input: OpenUnifiedPreviewTabInput,
): UnifiedPanelTab | null {
    const id = unifiedTabId({ kind: 'file', ownerWorkspaceId: input.ownerWorkspaceId, chatId: input.chatId, resourceId: input.resourceId });
    if (visibleTabs(state, chatId).some(tab => tab.id === id)) return null;
    const current = previewTab(state, input.chatId);
    return current === null || current.id === id ? null : current;
}

/**
 * Clear the preview bit, keeping everything else — identity, position, buffer,
 * scroll, dirty state (AC-04). One-way: nothing puts the bit back, and
 * promoting a tab that is already permanent returns the same state reference.
 */
export function promoteTab(state: UnifiedPanelState, id: string): UnifiedPanelState {
    const tab = findTab(state, id);
    if (tab === null || tab.preview !== true) return state;
    const scope = scopeForKind(tab.kind);
    const scopeKey = scopeKeyFor(tab.kind, tab.chatId);
    const list = scope === 'workspace' ? state.workspaceTabs : (state.chatTabs[scopeKey] ?? []);
    const { preview: _preview, ...promoted } = tab;
    return withList(state, scopeKey, scope, list.map(entry => (entry.id === id ? promoted : entry)));
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
 * Passing `beforeId: null` moves the tab to the end of its section — or to
 * just before the preview tab, which keeps the preview slot last.
 *
 * Reordering a preview tab **promotes it** (AC-04): arranging a tab is a
 * statement that you mean to keep it, and a preview that stayed a preview after
 * being dragged would be evicted by the next single click, throwing away the
 * arrangement. Promotion happens here rather than in the strip so drag and
 * Alt+Arrow agree by construction, and it also releases the "preview is last"
 * rule for this move — the tab is permanent by the time it is re-inserted.
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
    // The moved tab is permanent once it lands, whatever it was before.
    const { preview: _preview, ...moved } = tab;
    if (beforeId === null) {
        // "To the end" means *before* the preview slot, not after it: the
        // preview is always its section's last tab, so a drag or an Alt+Arrow to
        // the far right stops one place short of it (AC-03). A promoted tab
        // reads that rule against the *other* tabs, since it is no longer the
        // slot itself.
        return withList(state, scopeKey, scope, insertPermanent(without, moved));
    }
    const to = without.findIndex(entry => entry.id === beforeId);
    // `beforeId` outside this section means a cross-section drag; ignore it.
    if (to < 0) return state;
    return withList(state, scopeKey, scope, [...without.slice(0, to), moved, ...without.slice(to)]);
}

// ---------------------------------------------------------------------------
// Persistence codec
// ---------------------------------------------------------------------------

/**
 * Bump when the descriptor shape changes. A payload whose version is neither
 * this one nor a listed legacy version is discarded wholesale.
 *
 * v2 added the `preview` bit and removed the `explorer` kind.
 */
export const UNIFIED_PANEL_STATE_VERSION = 2;

/**
 * Versions this build can still read. A v1 payload restores field-for-field —
 * its descriptors are a subset of v2's — except for its `explorer` tabs, which
 * name a kind that no longer exists and are dropped by the kind check like any
 * other unknown descriptor. `restoreUnifiedPanelState` reports that drop so the
 * caller can open the tree column instead, which is where the Explorer went.
 */
const UNIFIED_PANEL_LEGACY_VERSIONS: readonly number[] = [1];

/** The `kind` a pre-v2 payload used for the Explorer tab this build dropped. */
const LEGACY_EXPLORER_KIND = 'explorer';

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
        ...(typeof value.line === 'number' && Number.isFinite(value.line) && value.line > 0
            ? {
                line: value.line,
                ...(typeof value.column === 'number' && Number.isFinite(value.column) && value.column > 0
                    ? { column: value.column }
                    : {}),
            }
            : {}),
        // Only `file` tabs can hold the preview slot: the tree's single click is
        // the one entry point that creates one, and it only ever opens files.
        ...(value.preview === true && kind === 'file' ? { preview: true } : {}),
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
    return repairPreviewSlot(tabs);
}

/**
 * Enforce "at most one preview per scope section, and it sits last" on a
 * restored list. A hand-edited entry or two writes racing on one key could
 * otherwise produce two replaceable slots, which the open path would then
 * disagree with itself about. The *last* flagged tab wins — it is the one the
 * writer meant, since every op that creates a preview appends it — and the rest
 * come back permanent rather than being dropped: a tab the user can still see
 * and close beats a buffer that silently vanished.
 */
function repairPreviewSlot(tabs: readonly UnifiedPanelTab[]): UnifiedPanelTab[] {
    let lastPreview = -1;
    let count = 0;
    for (let i = 0; i < tabs.length; i += 1) {
        if (tabs[i].preview === true) {
            lastPreview = i;
            count += 1;
        }
    }
    if (count === 0) return [...tabs];
    if (count === 1 && lastPreview === tabs.length - 1) return [...tabs];
    const kept = tabs[lastPreview];
    const permanent = tabs.filter((_, i) => i !== lastPreview).map(stripPreview);
    return [...permanent, kept];
}

/** The same tab, permanent. Returns the input unchanged when it already is. */
function stripPreview(tab: UnifiedPanelTab): UnifiedPanelTab {
    if (tab.preview !== true) return tab;
    const { preview: _preview, ...permanent } = tab;
    return permanent;
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
    return restoreUnifiedPanelState(raw).state;
}

/** What a restore produced, plus what the caller still has to act on. */
export interface UnifiedPanelRestore {
    state: UnifiedPanelState;
    /** The payload came from an older version and should be rewritten. */
    migrated: boolean;
    /**
     * The old payload held an `explorer` tab. The Explorer is a column now, so
     * the caller opens the tree rather than restoring a tab — a user who had it
     * open still lands with a file tree visible, and nothing is lost, because
     * an Explorer tab carried no state of its own.
     */
    openTree: boolean;
}

function noRestore(state: UnifiedPanelState): UnifiedPanelRestore {
    return { state, migrated: false, openTree: false };
}

/**
 * `parseUnifiedPanelState` plus the migration facts the pure state cannot
 * carry: whether the payload needs rewriting, and whether it held an `explorer`
 * tab whose replacement is the tree column.
 */
export function restoreUnifiedPanelState(raw: string | null): UnifiedPanelRestore {
    if (!raw) return noRestore(EMPTY_UNIFIED_PANEL);
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return noRestore(EMPTY_UNIFIED_PANEL);
    }
    if (parsed === null || typeof parsed !== 'object') return noRestore(EMPTY_UNIFIED_PANEL);
    const payload = parsed as Record<string, unknown>;
    const version = payload.version;
    const migrated = typeof version === 'number' && UNIFIED_PANEL_LEGACY_VERSIONS.includes(version);
    if (version !== UNIFIED_PANEL_STATE_VERSION && !migrated) return noRestore(EMPTY_UNIFIED_PANEL);

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

    return {
        state: { workspaceTabs, chatTabs, activeByScope },
        migrated,
        openTree: migrated && hasLegacyExplorerTab(payload),
    };
}

/** Whether a pre-v2 payload listed an Explorer tab anywhere in it. */
function hasLegacyExplorerTab(payload: Record<string, unknown>): boolean {
    const lists: unknown[] = [payload.workspaceTabs];
    const rawChatTabs = payload.chatTabs;
    if (rawChatTabs !== null && typeof rawChatTabs === 'object' && !Array.isArray(rawChatTabs)) {
        lists.push(...Object.values(rawChatTabs as Record<string, unknown>));
    }
    return lists.some(list => Array.isArray(list) && list.some(entry => (
        entry !== null && typeof entry === 'object'
        && (entry as Record<string, unknown>).kind === LEGACY_EXPLORER_KIND
    )));
}
