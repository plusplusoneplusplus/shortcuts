import { describe, expect, it } from 'vitest';
import { groupStripTabs } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabGroups';
import {
    ALL_UNIFIED_TAB_KINDS, EMPTY_UNIFIED_PANEL, activateTab, activeTabId, closeTab, findTab, inheritDraftTabs,
    moveVisibleTab, openPreviewTab, openTab, parseUnifiedPanelState, serializeUnifiedPanelState,
    visibleTabIds, visibleTabs, type UnifiedPanelState, type UnifiedTabKind,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

function mixed(chatId: string | null = 'chat-a'): UnifiedPanelState {
    let state = EMPTY_UNIFIED_PANEL;
    for (const kind of ['terminal', 'file', 'browser', 'todo'] as const) {
        state = openTab(state, {
            kind, ownerWorkspaceId: 'workspace', ownerRoutingRef: 'remote:host-a:workspace',
            chatId, resourceId: kind === 'file' ? 'sample.md' : kind, label: 'Same label',
        });
    }
    return state;
}

function id(state: UnifiedPanelState, kind: UnifiedTabKind, chatId: string | null = 'chat-a'): string {
    return visibleTabs(state, chatId).find(tab => tab.kind === kind)!.id;
}

describe('mixed panel tab ordering', () => {
    it('partitions saved mixed order after group-local moves without rehoming tabs', () => {
        let state = mixed();
        state = openTab(state, {
            kind: 'file', ownerWorkspaceId: 'member', chatId: 'chat-a',
            resourceId: 'second.ts', label: 'second.ts',
        });
        const before = visibleTabs(state, 'chat-a');
        const files = before.filter(tab => tab.kind === 'file');
        const next = moveVisibleTab(state, 'chat-a', files[1].id, files[0].id);
        const groups = groupStripTabs(visibleTabs(next, 'chat-a'), { folded: new Set(), narrow: false });
        expect(groups.map(group => group.group)).toEqual(['tools', 'files', 'web']);
        expect(groups.find(group => group.group === 'files')?.tabs).toEqual([files[1], files[0]]);
        expect(next.workspaceTabs).toBe(state.workspaceTabs);
        expect(next.chatTabs).toBe(state.chatTabs);
        expect(next.activeByScope).toBe(state.activeByScope);
    });
    it.each(ALL_UNIFIED_TAB_KINDS)('reorders %s without rehoming its descriptor', kind => {
        let state = mixed();
        state = openTab(state, {
            kind, ownerWorkspaceId: 'member', chatId: 'chat-a', resourceId: 'extra', label: 'Extra',
        });
        const moved = visibleTabs(state, 'chat-a').find(tab => tab.resourceId === 'extra')!;
        const next = moveVisibleTab(state, 'chat-a', moved.id, id(state, 'terminal'));
        expect(visibleTabs(next, 'chat-a')[0]).toBe(moved);
        expect(findTab(next, moved.id)).toBe(moved);
        expect(next.activeByScope).toBe(state.activeByScope);
    });

    it('interleaves kinds without changing descriptors, owners, active selection or live resource ids', () => {
        const original = mixed();
        const file = id(original, 'file');
        const selected = activateTab(original, 'chat-a', file);
        const next = moveVisibleTab(selected, 'chat-a', file, id(original, 'browser'));
        expect(visibleTabs(next, 'chat-a').map(tab => tab.kind)).toEqual(['terminal', 'file', 'browser', 'todo']);
        expect(next.workspaceTabs).toBe(selected.workspaceTabs);
        expect(next.chatTabs).toBe(selected.chatTabs);
        expect(next.activeByScope).toBe(selected.activeByScope);
        expect(activeTabId(next, 'chat-a')).toBe(file);
        for (const tab of visibleTabs(original, 'chat-a')) expect(findTab(next, tab.id)).toBe(tab);
    });

    it('moves to the end and treats self, same position, stale and foreign-chat targets as no-ops', () => {
        let state = mixed();
        const file = id(state, 'file');
        expect(moveVisibleTab(state, 'chat-a', file, null)).toBe(state);
        expect(moveVisibleTab(state, 'chat-a', file, file)).toBe(state);
        expect(moveVisibleTab(state, 'chat-a', 'missing', file)).toBe(state);
        expect(moveVisibleTab(state, 'chat-a', file, 'missing')).toBe(state);
        expect(moveVisibleTab(state, 'chat-b', file, null)).toBe(state);
        state = moveVisibleTab(state, 'chat-a', id(state, 'terminal'), null);
        expect(visibleTabs(state, 'chat-a').at(-1)?.kind).toBe('terminal');
        expect(moveVisibleTab(state, 'chat-a', id(state, 'terminal'), null)).toBe(state);
    });

    it('keeps chat orders isolated and restores only the kinds already allowed by the codec', () => {
        const original = mixed();
        const state = moveVisibleTab(original, 'chat-a', id(original, 'file'), id(original, 'terminal'));
        expect(visibleTabs(state, 'chat-b').map(tab => tab.kind)).toEqual(['terminal', 'browser']);
        expect(visibleTabs(state, 'chat-a', false)).toEqual(visibleTabs(original, 'chat-a'));
        const restored = parseUnifiedPanelState(serializeUnifiedPanelState(state));
        expect(visibleTabs(restored, 'chat-a').map(tab => tab.kind)).toEqual(['file', 'terminal', 'todo']);
        expect(visibleTabs(restored, 'chat-b').map(tab => tab.kind)).toEqual(['terminal']);
        expect(serializeUnifiedPanelState(state)).not.toContain(id(state, 'browser'));
    });

    it('prunes closed ids, appends reopened tabs and replaces the preview in its ordered slot', () => {
        let state = mixed();
        const file = id(state, 'file');
        state = moveVisibleTab(state, 'chat-a', file, id(state, 'terminal'));
        state = closeTab(state, file);
        expect(state.orderByScope?.['chat-a']).not.toContain(file);
        state = openTab(state, {
            kind: 'file', ownerWorkspaceId: 'workspace', ownerRoutingRef: 'remote:host-a:workspace',
            chatId: 'chat-a', resourceId: 'sample.md', label: 'Same label',
        });
        expect(visibleTabIds(state, 'chat-a').at(-1)).toBe(file);
        state = openPreviewTab(state, { ownerWorkspaceId: 'workspace', chatId: 'chat-a', resourceId: 'one.md', label: 'one' });
        const preview = visibleTabs(state, 'chat-a').find(tab => tab.preview)!;
        const order = visibleTabIds(state, 'chat-a');
        state = { ...state, orderByScope: { 'chat-a': [preview.id, ...order.filter(entry => entry !== preview.id)] } };
        state = openPreviewTab(state, { ownerWorkspaceId: 'workspace', chatId: 'chat-a', resourceId: 'two.md', label: 'two' });
        expect(visibleTabs(state, 'chat-a')[0].label).toBe('two');
        expect(state.orderByScope?.['chat-a']).not.toContain(preview.id);
        const moved = moveVisibleTab(state, 'chat-a', visibleTabs(state, 'chat-a')[0].id, null);
        expect(visibleTabs(moved, 'chat-a').at(-1)?.preview).toBeUndefined();
        expect(activeTabId(moved, 'chat-a')).toBe(activeTabId(state, 'chat-a'));
    });

    it('sanitizes missing, duplicate, invalid and wrong-chat ids when restoring order', () => {
        const state = mixed();
        const file = id(state, 'file');
        const raw = JSON.parse(serializeUnifiedPanelState(state));
        raw.orderByScope = { 'chat-a': [file, file, 'stale', 17], 'chat-b': [file], broken: 'bad' };
        const restored = parseUnifiedPanelState(JSON.stringify(raw));
        expect(restored.orderByScope).toEqual({ 'chat-a': [file], 'chat-b': [] });
        expect(visibleTabIds(restored, 'chat-a')).toHaveLength(3);
    });

    it('inherits draft order with rebuilt chat identities while retaining the draft', () => {
        const draft = mixed(null);
        const ordered = moveVisibleTab(draft, null, id(draft, 'file', null), id(draft, 'terminal', null));
        const next = inheritDraftTabs(ordered, 'new-chat');
        expect(visibleTabs(next, 'new-chat').map(tab => tab.kind)).toEqual(visibleTabs(ordered, null).map(tab => tab.kind));
        expect(visibleTabIds(next, null)).toEqual(visibleTabIds(ordered, null));
        expect(id(next, 'file', 'new-chat')).not.toBe(id(draft, 'file', null));
    });

    it('keeps identical paths and labels on separate owner routes distinct', () => {
        let state = mixed();
        state = openTab(state, {
            kind: 'file', ownerWorkspaceId: 'workspace', ownerRoutingRef: 'remote:host-b:workspace',
            chatId: 'chat-a', resourceId: 'sample.md', label: 'Same label',
        });
        const files = visibleTabs(state, 'chat-a').filter(tab => tab.kind === 'file');
        const next = moveVisibleTab(state, 'chat-a', files[1].id, files[0].id);
        expect(visibleTabs(next, 'chat-a').filter(tab => tab.kind === 'file')).toEqual([files[1], files[0]]);
    });
});
