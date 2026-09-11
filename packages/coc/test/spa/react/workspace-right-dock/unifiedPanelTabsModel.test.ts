import { describe, expect, it } from 'vitest';
import {
    EMPTY_UNIFIED_PANEL,
    UNIFIED_PANEL_STATE_VERSION,
    WORKSPACE_SCOPE_KEY,
    activateTab,
    activeTab,
    activeTabId,
    closeTab,
    findTab,
    moveTab,
    openPreviewTab,
    openTab,
    parseUnifiedPanelState,
    previewTab,
    restoreUnifiedPanelState,
    previewTabToReplace,
    promoteTab,
    scopeForKind,
    scopeKeyFor,
    serializeUnifiedPanelState,
    unifiedPanelStorageKey,
    unifiedTabId,
    visibleTabIds,
    visibleTabs,
    type OpenUnifiedPreviewTabInput,
    type OpenUnifiedTabInput,
    type UnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const WS = 'repo-a';
const CHAT_1 = 'chat-1';
const CHAT_2 = 'chat-2';

function open(state: UnifiedPanelState, input: Partial<OpenUnifiedTabInput> & Pick<OpenUnifiedTabInput, 'kind' | 'resourceId'>): UnifiedPanelState {
    return openTab(state, {
        ownerWorkspaceId: WS,
        chatId: null,
        label: input.resourceId,
        ...input,
    });
}

/** A workspace terminal + a notes tab + one chat-1 file, in that strip order. */
function baseState(): UnifiedPanelState {
    let state = open(EMPTY_UNIFIED_PANEL, { kind: 'terminal', resourceId: 'sess-1', label: 'bash' });
    state = open(state, { kind: 'notes', resourceId: 'notes', label: 'Notes' });
    state = open(state, { kind: 'file', resourceId: 'src/a.ts', label: 'a.ts', chatId: CHAT_1 });
    return state;
}

describe('unifiedPanelTabsModel — ownership', () => {
    it('files terminal, notes and note documents under the workspace', () => {
        for (const kind of ['terminal', 'notes', 'note'] as const) {
            expect(scopeForKind(kind)).toBe('workspace');
            expect(scopeKeyFor(kind, CHAT_1)).toBe(WORKSPACE_SCOPE_KEY);
        }
    });

    it('files opened files, canvases and diffs under the selected chat', () => {
        for (const kind of ['file', 'canvas', 'diff'] as const) {
            expect(scopeForKind(kind)).toBe('chat');
            expect(scopeKeyFor(kind, CHAT_1)).toBe(CHAT_1);
        }
    });

    it('falls back to the workspace for a chat-owned kind opened with no chat selected', () => {
        expect(scopeKeyFor('file', null)).toBe(WORKSPACE_SCOPE_KEY);
        const state = open(EMPTY_UNIFIED_PANEL, { kind: 'file', resourceId: 'src/a.ts' });
        expect(state.workspaceTabs).toHaveLength(0);
        expect(visibleTabs(state, null)).toHaveLength(1);
        // ...and it is not visible from inside a chat, which owns its own set.
        expect(visibleTabs(state, CHAT_1)).toHaveLength(0);
    });

    it('keeps a workspace tab visible in every chat while chat tabs stay isolated', () => {
        const state = baseState();
        expect(visibleTabs(state, CHAT_1).map(t => t.label)).toEqual(['bash', 'Notes', 'a.ts']);
        expect(visibleTabs(state, CHAT_2).map(t => t.label)).toEqual(['bash', 'Notes']);
    });

    it('orders workspace tabs before the selected chat tabs', () => {
        let state = baseState();
        state = open(state, { kind: 'note', resourceId: 'notes/plan.md', label: 'plan.md' });
        expect(visibleTabs(state, CHAT_1).map(t => t.kind)).toEqual(['terminal', 'notes', 'note', 'file']);
    });
});

describe('unifiedPanelTabsModel — identity and deduplication', () => {
    it('focuses the existing tab instead of opening a duplicate', () => {
        let state = baseState();
        const before = visibleTabs(state, CHAT_1).length;
        state = open(state, { kind: 'file', resourceId: 'src/a.ts', label: 'a.ts', chatId: CHAT_1 });
        expect(visibleTabs(state, CHAT_1)).toHaveLength(before);
        expect(activeTab(state, CHAT_1)?.resourceId).toBe('src/a.ts');
    });

    it('keeps the same relative path in two repo-group members as distinct tabs', () => {
        let state = open(EMPTY_UNIFIED_PANEL, { kind: 'file', resourceId: 'src/index.ts', label: 'index.ts', chatId: CHAT_1, ownerWorkspaceId: 'member-a', repoLabel: 'member-a' });
        state = open(state, { kind: 'file', resourceId: 'src/index.ts', label: 'index.ts', chatId: CHAT_1, ownerWorkspaceId: 'member-b', repoLabel: 'member-b' });
        const tabs = visibleTabs(state, CHAT_1);
        expect(tabs).toHaveLength(2);
        expect(tabs.map(t => t.ownerWorkspaceId)).toEqual(['member-a', 'member-b']);
        expect(tabs[0].id).not.toBe(tabs[1].id);
    });

    it('keeps same-id clones on different hosts as distinct tabs', () => {
        const ownerWorkspaceId = 'ws-shared';
        const routeA = 'remote:server-a:ws-shared';
        const routeB = 'remote:server-b:ws-shared';
        let state = open(EMPTY_UNIFIED_PANEL, {
            kind: 'file', resourceId: 'src/index.ts', label: 'server-a', chatId: CHAT_1,
            ownerWorkspaceId, ownerRoutingRef: routeA,
        });
        state = open(state, {
            kind: 'file', resourceId: 'src/index.ts', label: 'server-b', chatId: CHAT_1,
            ownerWorkspaceId, ownerRoutingRef: routeB,
        });

        const tabs = visibleTabs(state, CHAT_1);
        expect(tabs).toHaveLength(2);
        expect(tabs.map(tab => tab.ownerRoutingRef)).toEqual([routeA, routeB]);
        expect(tabs[0].id).not.toBe(tabs[1].id);

        const restored = parseUnifiedPanelState(serializeUnifiedPanelState(state));
        expect(visibleTabs(restored, CHAT_1).map(tab => tab.ownerRoutingRef)).toEqual([routeA, routeB]);
    });

    it('keeps the same file opened from two chats as distinct tabs', () => {
        let state = open(EMPTY_UNIFIED_PANEL, { kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_1 });
        state = open(state, { kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_2 });
        expect(visibleTabs(state, CHAT_1)).toHaveLength(1);
        expect(visibleTabs(state, CHAT_2)).toHaveLength(1);
        expect(visibleTabs(state, CHAT_1)[0].id).not.toBe(visibleTabs(state, CHAT_2)[0].id);
    });

    it('cannot forge another tab id through a resource id containing the separator', () => {
        const forged = unifiedTabId({ kind: 'file', ownerWorkspaceId: WS, chatId: CHAT_1, resourceId: `x|${WS}|src/a.ts` });
        const real = unifiedTabId({ kind: 'file', ownerWorkspaceId: WS, chatId: CHAT_1, resourceId: 'src/a.ts' });
        expect(forged).not.toBe(real);
    });

    it('navigates the existing tab when re-opened with a new line, and keeps the old line otherwise', () => {
        let state = open(EMPTY_UNIFIED_PANEL, { kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_1, line: 10 });
        state = open(state, { kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_1, line: 42 });
        expect(visibleTabs(state, CHAT_1)).toHaveLength(1);
        expect(activeTab(state, CHAT_1)?.line).toBe(42);
        state = open(state, { kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_1 });
        expect(activeTab(state, CHAT_1)?.line).toBe(42);
    });

    it('carries a reveal column, drops a stale one, and keeps a whole position', () => {
        // A language-server navigation is the only source of a column.
        let state = open(EMPTY_UNIFIED_PANEL, {
            kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_1, line: 10, column: 4,
        });
        expect(activeTab(state, CHAT_1)).toMatchObject({ line: 10, column: 4 });

        // A deep link into the same file names a line but no column; carrying
        // the old one over would land the cursor at an unrelated offset.
        state = open(state, { kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_1, line: 42 });
        expect(activeTab(state, CHAT_1)?.line).toBe(42);
        expect(activeTab(state, CHAT_1)?.column).toBeUndefined();

        // Re-focusing with no reveal at all keeps the whole pending position.
        state = open(state, {
            kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_1, line: 7, column: 21,
        });
        state = open(state, { kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_1 });
        expect(activeTab(state, CHAT_1)).toMatchObject({ line: 7, column: 21 });
    });

    it('lets an editable entry point unlock a read-only tab, and a read-only one re-lock it', () => {
        let state = open(EMPTY_UNIFIED_PANEL, { kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_1, readOnly: true });
        expect(activeTab(state, CHAT_1)?.readOnly).toBe(true);
        state = open(state, { kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_1 });
        expect(activeTab(state, CHAT_1)?.readOnly).toBeUndefined();
        state = open(state, { kind: 'file', resourceId: 'src/a.ts', chatId: CHAT_1, readOnly: true });
        expect(activeTab(state, CHAT_1)?.readOnly).toBe(true);
    });

    it('returns the same state reference when an open changes nothing', () => {
        const state = baseState();
        const again = open(state, { kind: 'file', resourceId: 'src/a.ts', label: 'a.ts', chatId: CHAT_1 });
        expect(again).toBe(state);
    });
});

describe('unifiedPanelTabsModel — activation', () => {
    it('restores each chat\'s own last selection, including a workspace tab', () => {
        let state = baseState();
        state = open(state, { kind: 'file', resourceId: 'src/b.ts', label: 'b.ts', chatId: CHAT_2 });
        // chat 2 selects the workspace terminal instead of its own file.
        const terminalId = state.workspaceTabs[0].id;
        state = activateTab(state, CHAT_2, terminalId);

        expect(activeTab(state, CHAT_1)?.label).toBe('a.ts');
        expect(activeTabId(state, CHAT_2)).toBe(terminalId);
    });

    it('falls forward to the first visible tab when nothing is remembered', () => {
        const state = baseState();
        expect(activeTabId(state, CHAT_2)).toBe(state.workspaceTabs[0].id);
    });

    it('reports null when a chat has no visible tabs at all', () => {
        expect(activeTabId(EMPTY_UNIFIED_PANEL, CHAT_1)).toBeNull();
        expect(activeTab(EMPTY_UNIFIED_PANEL, CHAT_1)).toBeNull();
    });

    it('ignores an activation for a tab not visible in that chat', () => {
        const state = baseState();
        const chat1File = visibleTabs(state, CHAT_1)[2].id;
        expect(activateTab(state, CHAT_2, chat1File)).toBe(state);
    });
});

describe('unifiedPanelTabsModel — closing', () => {
    it('removes the tab and clears every selection that pointed at it', () => {
        let state = baseState();
        const fileId = visibleTabs(state, CHAT_1)[2].id;
        state = closeTab(state, fileId);
        expect(findTab(state, fileId)).toBeNull();
        expect(Object.values(state.activeByScope)).not.toContain(fileId);
        // Selection falls forward to the first remaining visible tab.
        expect(activeTabId(state, CHAT_1)).toBe(state.workspaceTabs[0].id);
    });

    it('closing a workspace tab removes it from every chat', () => {
        let state = baseState();
        const notesId = state.workspaceTabs[1].id;
        state = closeTab(state, notesId);
        expect(visibleTabIds(state, CHAT_1)).not.toContain(notesId);
        expect(visibleTabIds(state, CHAT_2)).not.toContain(notesId);
    });

    it('drops a chat scope entirely once its last tab closes', () => {
        let state = baseState();
        state = closeTab(state, visibleTabs(state, CHAT_1)[2].id);
        expect(state.chatTabs[CHAT_1]).toBeUndefined();
    });

    it('is a no-op for an unknown id', () => {
        const state = baseState();
        expect(closeTab(state, 'nope')).toBe(state);
    });

    it('leaves an empty panel when everything is closed', () => {
        let state = baseState();
        for (const id of visibleTabIds(state, CHAT_1)) state = closeTab(state, id);
        expect(visibleTabs(state, CHAT_1)).toHaveLength(0);
        expect(activeTabId(state, CHAT_1)).toBeNull();
    });
});

describe('unifiedPanelTabsModel — reordering', () => {
    it('moves a tab within its own section', () => {
        let state = baseState();
        const [terminal, notes] = state.workspaceTabs;
        state = moveTab(state, notes.id, terminal.id);
        expect(state.workspaceTabs.map(t => t.id)).toEqual([notes.id, terminal.id]);
    });

    it('moves a tab to the end of its section with a null target', () => {
        let state = baseState();
        const [terminal, notes] = state.workspaceTabs;
        state = moveTab(state, terminal.id, null);
        expect(state.workspaceTabs.map(t => t.id)).toEqual([notes.id, terminal.id]);
    });

    it('refuses a cross-section drag rather than re-homing the tab', () => {
        const state = baseState();
        const fileId = visibleTabs(state, CHAT_1)[2].id;
        const terminalId = state.workspaceTabs[0].id;
        // Chat file dragged onto the workspace section, and the reverse.
        expect(moveTab(state, fileId, terminalId)).toBe(state);
        expect(moveTab(state, terminalId, fileId)).toBe(state);
    });

    it('leaves the active selection alone', () => {
        let state = baseState();
        const activeBefore = activeTabId(state, CHAT_1);
        state = moveTab(state, state.workspaceTabs[1].id, state.workspaceTabs[0].id);
        expect(activeTabId(state, CHAT_1)).toBe(activeBefore);
    });
});

describe('unifiedPanelTabsModel — persistence codec', () => {
    it('scopes the storage key per workspace', () => {
        expect(unifiedPanelStorageKey('repo-a')).not.toBe(unifiedPanelStorageKey('repo-b'));
    });

    it('round-trips tabs, order and per-chat selections', () => {
        let state = baseState();
        state = open(state, { kind: 'file', resourceId: 'src/b.ts', label: 'b.ts', chatId: CHAT_2, repoLabel: 'member-b', readOnly: true, line: 7, column: 3 });
        state = activateTab(state, CHAT_2, state.workspaceTabs[0].id);

        const restored = parseUnifiedPanelState(serializeUnifiedPanelState(state));
        expect(restored).toEqual(state);
        expect(activeTabId(restored, CHAT_1)).toBe(activeTabId(state, CHAT_1));
        expect(activeTabId(restored, CHAT_2)).toBe(activeTabId(state, CHAT_2));
    });

    it('never persists content — only descriptor fields', () => {
        const payload = JSON.parse(serializeUnifiedPanelState(baseState()));
        const fields = new Set(payload.workspaceTabs.flatMap((t: object) => Object.keys(t)));
        expect([...fields].sort()).toEqual(['chatId', 'id', 'kind', 'label', 'ownerWorkspaceId', 'resourceId']);
    });

    it('returns the empty state for absent, unparseable, or wrongly versioned payloads', () => {
        expect(parseUnifiedPanelState(null)).toEqual(EMPTY_UNIFIED_PANEL);
        expect(parseUnifiedPanelState('')).toEqual(EMPTY_UNIFIED_PANEL);
        expect(parseUnifiedPanelState('{oops')).toEqual(EMPTY_UNIFIED_PANEL);
        expect(parseUnifiedPanelState('[]')).toEqual(EMPTY_UNIFIED_PANEL);
        const stale = JSON.stringify({ ...JSON.parse(serializeUnifiedPanelState(baseState())), version: UNIFIED_PANEL_STATE_VERSION + 1 });
        expect(parseUnifiedPanelState(stale)).toEqual(EMPTY_UNIFIED_PANEL);
    });

    it('rejects malformed descriptors but keeps the valid ones', () => {
        const payload = JSON.parse(serializeUnifiedPanelState(baseState()));
        payload.workspaceTabs.push({ kind: 'nonsense', ownerWorkspaceId: WS, chatId: null, resourceId: 'x', label: 'x', id: 'x' });
        payload.workspaceTabs.push({ kind: 'terminal', ownerWorkspaceId: '', chatId: null, resourceId: 'x', label: 'x', id: 'x' });
        const restored = parseUnifiedPanelState(JSON.stringify(payload));
        expect(restored.workspaceTabs).toHaveLength(2);
        expect(restored.workspaceTabs.map(t => t.kind)).toEqual(['terminal', 'notes']);
    });

    it('rejects a descriptor whose id does not match its own fields', () => {
        const payload = JSON.parse(serializeUnifiedPanelState(baseState()));
        // Repoint a tab at another repo while keeping the original id — an
        // aliased descriptor must not restore.
        payload.workspaceTabs[0].ownerWorkspaceId = 'other-repo';
        const restored = parseUnifiedPanelState(JSON.stringify(payload));
        expect(restored.workspaceTabs.map(t => t.kind)).toEqual(['notes']);
    });

    it('rejects a descriptor filed under the wrong scope', () => {
        const payload = JSON.parse(serializeUnifiedPanelState(baseState()));
        // A chat-owned file smuggled into the workspace section.
        payload.workspaceTabs.push(payload.chatTabs[CHAT_1][0]);
        const restored = parseUnifiedPanelState(JSON.stringify(payload));
        expect(restored.workspaceTabs).toHaveLength(2);
    });

    it('drops duplicate descriptors rather than restoring two tabs on one resource', () => {
        const payload = JSON.parse(serializeUnifiedPanelState(baseState()));
        payload.workspaceTabs.push({ ...payload.workspaceTabs[0] });
        expect(parseUnifiedPanelState(JSON.stringify(payload)).workspaceTabs).toHaveLength(2);
    });

    it('drops a persisted selection that points at a rejected tab', () => {
        const payload = JSON.parse(serializeUnifiedPanelState(baseState()));
        payload.activeByScope[CHAT_2] = 'file|chat-2|repo-a|gone.ts';
        const restored = parseUnifiedPanelState(JSON.stringify(payload));
        expect(restored.activeByScope[CHAT_2]).toBeUndefined();
    });

    it('restores a terminal descriptor as a session reference, creating nothing', () => {
        const state = open(EMPTY_UNIFIED_PANEL, { kind: 'terminal', resourceId: 'sess-7', label: 'bash' });
        const restored = parseUnifiedPanelState(serializeUnifiedPanelState(state));
        expect(restored.workspaceTabs).toHaveLength(1);
        expect(restored.workspaceTabs[0].resourceId).toBe('sess-7');
    });
});

// ---------------------------------------------------------------------------
// Preview tabs (AC-03/AC-04)
// ---------------------------------------------------------------------------

/** A tree single click on `path`, in the section `chatId` selects. */
function preview(
    state: UnifiedPanelState,
    path: string,
    extra: Partial<OpenUnifiedPreviewTabInput> = {},
): UnifiedPanelState {
    return openPreviewTab(state, {
        ownerWorkspaceId: WS,
        chatId: null,
        resourceId: path,
        label: path,
        ...extra,
    });
}

/** Tab labels of the section a file opened with `chatId` lands in. */
function sectionLabels(state: UnifiedPanelState, chatId: string | null = null): string[] {
    return (state.chatTabs[scopeKeyFor('file', chatId)] ?? []).map(tab => tab.label);
}

describe('unifiedPanelTabsModel — preview tabs', () => {
    it('opens a single click as a preview tab at the end of its section', () => {
        const state = preview(EMPTY_UNIFIED_PANEL, 'src/a.ts');
        const tab = previewTab(state, null);
        expect(tab?.resourceId).toBe('src/a.ts');
        expect(tab?.kind).toBe('file');
        expect(tab?.preview).toBe(true);
        expect(activeTabId(state, null)).toBe(tab?.id);
        expect(sectionLabels(state)).toEqual(['src/a.ts']);
    });

    it('reuses the same slot for the next single click instead of stacking tabs', () => {
        let state = preview(EMPTY_UNIFIED_PANEL, 'src/a.ts');
        state = open(state, { kind: 'file', resourceId: 'src/keep.ts', label: 'keep.ts' });
        const before = sectionLabels(state);
        state = preview(state, 'src/b.ts');

        // One preview, in the position the previous one held, and the permanent
        // neighbour untouched.
        expect(before).toEqual(['keep.ts', 'src/a.ts']);
        expect(sectionLabels(state)).toEqual(['keep.ts', 'src/b.ts']);
        expect(previewTab(state, null)?.resourceId).toBe('src/b.ts');
        expect(activeTabId(state, null)).toBe(previewTab(state, null)?.id);
    });

    it('keeps at most one preview tab per scope section', () => {
        let state = preview(EMPTY_UNIFIED_PANEL, 'src/a.ts', { chatId: CHAT_1 });
        state = preview(state, 'src/b.ts', { chatId: CHAT_1 });
        state = preview(state, 'src/c.ts', { chatId: CHAT_2 });

        for (const chat of [CHAT_1, CHAT_2]) {
            expect((state.chatTabs[chat] ?? []).filter(tab => tab.preview).length).toBe(1);
        }
        expect(previewTab(state, CHAT_1)?.resourceId).toBe('src/b.ts');
        expect(previewTab(state, CHAT_2)?.resourceId).toBe('src/c.ts');
    });

    it('drops a selection that pointed at the replaced preview', () => {
        let state = preview(EMPTY_UNIFIED_PANEL, 'src/a.ts', { chatId: CHAT_1 });
        const replacedId = previewTab(state, CHAT_1)!.id;
        // A second scope also remembers it — a legal selection while viewing it.
        state = { ...state, activeByScope: { ...state.activeByScope, [CHAT_2]: replacedId } };
        state = preview(state, 'src/b.ts', { chatId: CHAT_1 });

        expect(Object.values(state.activeByScope)).not.toContain(replacedId);
        expect(findTab(state, replacedId)).toBeNull();
    });

    it('focuses an existing permanent tab instead of previewing it again', () => {
        let state = open(EMPTY_UNIFIED_PANEL, { kind: 'file', resourceId: 'src/a.ts', label: 'a.ts' });
        state = preview(state, 'src/z.ts');
        const withPreview = state;
        state = preview(state, 'src/a.ts');

        // The permanent tab is selected, keeps its position, and stays permanent;
        // the preview slot still holds z.ts.
        expect(activeTab(state, null)?.resourceId).toBe('src/a.ts');
        expect(activeTab(state, null)?.preview).toBeUndefined();
        expect(sectionLabels(state)).toEqual(sectionLabels(withPreview));
        expect(previewTab(state, null)?.resourceId).toBe('src/z.ts');
    });

    it('returns the same state when the current preview is clicked again', () => {
        const state = preview(EMPTY_UNIFIED_PANEL, 'src/a.ts');
        expect(preview(state, 'src/a.ts')).toBe(state);
    });

    it('reports which preview a click would replace, and when it would replace none', () => {
        let state = open(EMPTY_UNIFIED_PANEL, { kind: 'file', resourceId: 'src/perm.ts', label: 'perm.ts' });
        const input = (resourceId: string): OpenUnifiedPreviewTabInput => ({
            ownerWorkspaceId: WS, chatId: null, resourceId, label: resourceId,
        });

        expect(previewTabToReplace(state, null, input('src/a.ts'))).toBeNull();
        state = preview(state, 'src/a.ts');
        // The file already open permanently, and the current preview itself,
        // both evict nothing.
        expect(previewTabToReplace(state, null, input('src/perm.ts'))).toBeNull();
        expect(previewTabToReplace(state, null, input('src/a.ts'))).toBeNull();
        expect(previewTabToReplace(state, null, input('src/b.ts'))?.resourceId).toBe('src/a.ts');
    });

    it('opens permanent tabs before the preview so the slot stays last', () => {
        let state = preview(EMPTY_UNIFIED_PANEL, 'src/prev.ts');
        state = open(state, { kind: 'file', resourceId: 'src/one.ts', label: 'one.ts' });
        state = open(state, { kind: 'file', resourceId: 'src/two.ts', label: 'two.ts' });
        expect(sectionLabels(state)).toEqual(['one.ts', 'two.ts', 'src/prev.ts']);
    });

    it('keeps the preview last when a permanent tab is moved to the end', () => {
        let state = open(EMPTY_UNIFIED_PANEL, { kind: 'file', resourceId: 'src/one.ts', label: 'one.ts' });
        state = open(state, { kind: 'file', resourceId: 'src/two.ts', label: 'two.ts' });
        state = preview(state, 'src/prev.ts');
        const oneId = state.chatTabs[WORKSPACE_SCOPE_KEY]![0].id;

        state = moveTab(state, oneId, null);
        expect(sectionLabels(state)).toEqual(['two.ts', 'one.ts', 'src/prev.ts']);

        // The preview itself may still be dragged to the end of its section —
        // where the drag promotes it (AC-04), so the slot empties out.
        state = moveTab(state, state.chatTabs[WORKSPACE_SCOPE_KEY]![2].id, null);
        expect(sectionLabels(state)).toEqual(['two.ts', 'one.ts', 'src/prev.ts']);
        expect(previewTab(state, null)).toBeNull();
    });

    it('promotes a preview tab that is dragged to a new position', () => {
        let state = open(EMPTY_UNIFIED_PANEL, { kind: 'file', resourceId: 'src/one.ts', label: 'one.ts' });
        state = open(state, { kind: 'file', resourceId: 'src/two.ts', label: 'two.ts' });
        state = preview(state, 'src/prev.ts');
        const previewId = previewTab(state, null)!.id;
        const oneId = state.chatTabs[WORKSPACE_SCOPE_KEY]![0].id;

        state = moveTab(state, previewId, oneId);

        // Moved, permanent, and the section now has no preview slot at all — so
        // the next single click opens a new one rather than evicting this tab.
        expect(sectionLabels(state)).toEqual(['src/prev.ts', 'one.ts', 'two.ts']);
        expect(findTab(state, previewId)?.preview).toBeUndefined();
        expect(previewTab(state, null)).toBeNull();
        state = preview(state, 'src/next.ts');
        expect(sectionLabels(state)).toEqual(['src/prev.ts', 'one.ts', 'two.ts', 'src/next.ts']);
    });

    it('leaves a rejected cross-section drag of a preview unpromoted', () => {
        let state = open(EMPTY_UNIFIED_PANEL, { kind: 'terminal', resourceId: 'sess-1', label: 'bash' });
        state = preview(state, 'src/a.ts', { chatId: CHAT_1 });
        const previewId = previewTab(state, CHAT_1)!.id;

        expect(moveTab(state, previewId, state.workspaceTabs[0].id)).toBe(state);
        expect(previewTab(state, CHAT_1)?.id).toBe(previewId);
    });

    it('promotes a preview in place, keeping identity and position', () => {
        let state = preview(EMPTY_UNIFIED_PANEL, 'src/a.ts');
        state = open(state, { kind: 'file', resourceId: 'src/keep.ts', label: 'keep.ts' });
        const previewId = previewTab(state, null)!.id;

        const promoted = promoteTab(state, previewId);
        expect(findTab(promoted, previewId)?.preview).toBeUndefined();
        expect(previewTab(promoted, null)).toBeNull();
        expect(sectionLabels(promoted)).toEqual(sectionLabels(state));
        // One-way, and a no-op on an already-permanent tab returns the same ref.
        expect(promoteTab(promoted, previewId)).toBe(promoted);
    });

    it('frees the slot: the next single click opens beside a promoted tab', () => {
        let state = preview(EMPTY_UNIFIED_PANEL, 'src/a.ts');
        state = promoteTab(state, previewTab(state, null)!.id);
        state = preview(state, 'src/b.ts');

        expect(sectionLabels(state)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(previewTab(state, null)?.resourceId).toBe('src/b.ts');
    });

    it('promotes the preview when the same file is opened by a permanent entry point', () => {
        let state = preview(EMPTY_UNIFIED_PANEL, 'src/a.ts');
        state = open(state, { kind: 'file', resourceId: 'src/a.ts', label: 'a.ts' });

        expect(previewTab(state, null)).toBeNull();
        expect(sectionLabels(state)).toEqual(['a.ts']);
    });

    it('does not widen a read-only preview, and keeps the reveal line', () => {
        const state = preview(EMPTY_UNIFIED_PANEL, 'src/a.ts', { readOnly: true, line: 12 });
        const tab = previewTab(state, null)!;
        expect(tab.readOnly).toBe(true);
        expect(tab.line).toBe(12);
    });
});

describe('unifiedPanelTabsModel — codec v3: clone routes, preview repair, and migration', () => {
    /** A v1 payload: the previous version's shape, with an `explorer` tab. */
    function legacyPayload(): Record<string, unknown> {
        // The id v1 would have written for it: kind|scope|owner|resource.
        const explorerId = ['explorer', WORKSPACE_SCOPE_KEY, WS, 'explorer'].join('|');
        const payload = JSON.parse(serializeUnifiedPanelState(baseState()));
        payload.version = 1;
        // Between the terminal and the notes tab, so "order survives" is a real
        // assertion rather than a tail truncation.
        payload.workspaceTabs.splice(1, 0, {
            id: explorerId, kind: 'explorer', ownerWorkspaceId: WS, chatId: null,
            resourceId: 'explorer', label: 'Explorer',
        });
        return payload;
    }

    it('round-trips the preview bit, so a restored preview is still replaceable', () => {
        const state = openPreviewTab(EMPTY_UNIFIED_PANEL, {
            ownerWorkspaceId: WS, chatId: CHAT_1, resourceId: 'src/a.ts', label: 'a.ts',
        });
        const restored = parseUnifiedPanelState(serializeUnifiedPanelState(state));
        expect(restored).toEqual(state);
        expect(previewTab(restored, CHAT_1)?.resourceId).toBe('src/a.ts');
    });

    it('drops a preview bit smuggled onto a kind that cannot hold the slot', () => {
        const payload = JSON.parse(serializeUnifiedPanelState(baseState()));
        payload.workspaceTabs[0].preview = true;
        const restored = parseUnifiedPanelState(JSON.stringify(payload));
        expect(restored.workspaceTabs[0].preview).toBeUndefined();
    });

    it('repairs a two-preview section: the last one wins and the rest come back permanent', () => {
        let state = openTab(EMPTY_UNIFIED_PANEL, { kind: 'file', ownerWorkspaceId: WS, chatId: CHAT_1, resourceId: 'src/a.ts', label: 'a.ts' });
        state = openTab(state, { kind: 'file', ownerWorkspaceId: WS, chatId: CHAT_1, resourceId: 'src/b.ts', label: 'b.ts' });
        const payload = JSON.parse(serializeUnifiedPanelState(state));
        for (const tab of payload.chatTabs[CHAT_1]) tab.preview = true;

        const restored = parseUnifiedPanelState(JSON.stringify(payload));
        const list = restored.chatTabs[CHAT_1];
        // Nothing is dropped — a tab the user can see and close beats a buffer
        // that silently vanished.
        expect(list.map(t => t.resourceId)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(list.filter(t => t.preview === true)).toHaveLength(1);
        expect(list[list.length - 1].preview).toBe(true);
    });

    it('moves a restored preview back to the end of its section', () => {
        let state = openPreviewTab(EMPTY_UNIFIED_PANEL, { ownerWorkspaceId: WS, chatId: CHAT_1, resourceId: 'src/a.ts', label: 'a.ts' });
        state = openTab(state, { kind: 'file', ownerWorkspaceId: WS, chatId: CHAT_1, resourceId: 'src/b.ts', label: 'b.ts' });
        const payload = JSON.parse(serializeUnifiedPanelState(state));
        payload.chatTabs[CHAT_1].reverse();

        const list = parseUnifiedPanelState(JSON.stringify(payload)).chatTabs[CHAT_1];
        expect(list.map(t => t.resourceId)).toEqual(['src/b.ts', 'src/a.ts']);
        expect(list[1].preview).toBe(true);
    });

    it('migrates a v1 payload: the other tabs survive in order, the explorer tab does not', () => {
        const restored = restoreUnifiedPanelState(JSON.stringify(legacyPayload()));
        expect(restored.migrated).toBe(true);
        expect(restored.openTree).toBe(true);
        expect(restored.state.workspaceTabs.map(t => t.kind)).toEqual(['terminal', 'notes']);
        expect(restored.state.chatTabs[CHAT_1].map(t => t.label)).toEqual(['a.ts']);
    });

    it('migrates route-less v2 tabs without changing their stable ids', () => {
        const payload = JSON.parse(serializeUnifiedPanelState(baseState()));
        payload.version = 2;
        const originalId = payload.chatTabs[CHAT_1][0].id;

        const restored = restoreUnifiedPanelState(JSON.stringify(payload));
        expect(restored.migrated).toBe(true);
        expect(restored.openTree).toBe(false);
        expect(restored.state.chatTabs[CHAT_1][0]).toMatchObject({
            id: originalId,
            ownerWorkspaceId: WS,
        });
        expect(restored.state.chatTabs[CHAT_1][0].ownerRoutingRef).toBeUndefined();
    });

    it('reports no tree to open when the old payload had no explorer tab', () => {
        const payload = JSON.parse(serializeUnifiedPanelState(baseState()));
        payload.version = 1;
        const restored = restoreUnifiedPanelState(JSON.stringify(payload));
        expect(restored.migrated).toBe(true);
        expect(restored.openTree).toBe(false);
    });

    it('finds an explorer tab filed under a chat scope too', () => {
        const payload = legacyPayload();
        const [explorer] = (payload.workspaceTabs as Record<string, unknown>[]).splice(1, 1);
        (payload.chatTabs as Record<string, unknown[]>)[CHAT_1].push(explorer);
        expect(restoreUnifiedPanelState(JSON.stringify(payload)).openTree).toBe(true);
    });

    it('reports a current payload as needing no migration', () => {
        const restored = restoreUnifiedPanelState(serializeUnifiedPanelState(baseState()));
        expect(restored.migrated).toBe(false);
        expect(restored.openTree).toBe(false);
    });

    it('still discards a payload from a version this build does not know', () => {
        const payload = { ...JSON.parse(serializeUnifiedPanelState(baseState())), version: UNIFIED_PANEL_STATE_VERSION + 1 };
        const restored = restoreUnifiedPanelState(JSON.stringify(payload));
        expect(restored.state).toEqual(EMPTY_UNIFIED_PANEL);
        expect(restored.migrated).toBe(false);
    });
});
