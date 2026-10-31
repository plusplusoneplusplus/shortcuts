/**
 * Conversation-owned browser tabs (`features.chatScopedBrowserTabs`, default off):
 * the pure model and open-input rules. Panel and webview-layer behaviour is
 * covered in `UnifiedPanelChatScopedBrowserTabs.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    activateTab, activeTabId, closeTab, EMPTY_UNIFIED_PANEL, findTab, openTab, releaseBrowserChatOwners,
    serializeUnifiedPanelState, updateBrowserTab, visibleTabIds, visibleTabs,
    type UnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import {
    browserOpenInput, duplicateBrowserTabInput,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import {
    clearClosedBrowserTabs, popClosedBrowserTab, recordClosedBrowserTab, reopenBrowserTabInput,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedClosedBrowserTabs';
import { clearUnifiedPanelState, readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { openUnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

const WS = 'ws-1';
const SENTINEL = 'sentinel-chat';

function page(state: UnifiedPanelState, chatId: string | null, label: string, owner = WS, routingRef?: string | null) {
    const input = { ...browserOpenInput({ ownerWorkspaceId: owner, ...(routingRef === undefined ? {} : { ownerRoutingRef: routingRef }), chatId }, `https://${label}.test/`), label };
    return { state: openTab(state, input), id: openTab(state, input).workspaceTabs.at(-1)!.id };
}

function labels(state: UnifiedPanelState, chatId: string | null) {
    return visibleTabs(state, chatId).map(tab => tab.label);
}

beforeEach(() => { _resetRuntimeConfig(); clearClosedBrowserTabs(); clearUnifiedPanelState(); });
afterEach(() => { _resetRuntimeConfig(); clearClosedBrowserTabs(); clearUnifiedPanelState(); });

describe('browser tab conversation ownership', () => {
    it('leaves every page workspace-global with the flag off (default)', () => {
        const input = browserOpenInput({ ownerWorkspaceId: WS, chatId: 'chat-a' }, 'https://a.test/');
        expect(input).not.toHaveProperty('browserChatId');
        const state = openTab(EMPTY_UNIFIED_PANEL, input);
        expect(labels(state, 'chat-b')).toEqual(['a.test']);
        expect(labels(state, null)).toEqual(['a.test']);
    });

    it('A -> Sentinel -> B -> A shows only the selected chat\'s pages and restores each chat\'s selection', () => {
        applyRuntimeConfigPatch({ chatScopedBrowserTabsEnabled: true });
        let state = EMPTY_UNIFIED_PANEL;
        state = openTab(state, { kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'term', label: 'Terminal' });
        const docs = page(state, 'chat-a', 'Docs'); state = docs.state;
        const report = page(state, 'chat-a', 'Report'); state = report.state;
        const results = page(state, 'chat-b', 'Results'); state = results.state;
        const shared = page(state, null, 'Shared'); state = shared.state;
        state = activateTab(state, 'chat-a', report.id);
        state = activateTab(state, 'chat-b', results.id);

        expect(labels(state, 'chat-a')).toEqual(['Terminal', 'Docs', 'Report', 'Shared']);
        expect(activeTabId(state, 'chat-a')).toBe(report.id);
        // Sentinel sees neither child's pages and falls back to an existing non-page tab.
        expect(labels(state, SENTINEL)).toEqual(['Terminal', 'Shared']);
        expect(activeTabId(state, SENTINEL)).toBe(state.workspaceTabs[0].id);
        expect(labels(state, 'chat-b')).toEqual(['Terminal', 'Results', 'Shared']);
        expect(activeTabId(state, 'chat-b')).toBe(results.id);
        // Back to A: hidden is retained, not deleted, and its selection comes back.
        expect(labels(state, 'chat-a')).toEqual(['Terminal', 'Docs', 'Report', 'Shared']);
        expect(activeTabId(state, 'chat-a')).toBe(report.id);
        expect(findTab(state, docs.id)?.browserChatId).toBe('chat-a');
        // No conversation selected (draft): only workspace-global pages.
        expect(labels(state, null)).toEqual(['Terminal', 'Shared']);
    });

    it('cannot activate, bulk-close or order a page from another conversation', () => {
        applyRuntimeConfigPatch({ chatScopedBrowserTabsEnabled: true });
        const a = page(EMPTY_UNIFIED_PANEL, 'chat-a', 'A');
        const b = page(a.state, 'chat-b', 'B');
        expect(activateTab(b.state, 'chat-b', a.id)).toBe(b.state);
        expect(visibleTabIds(b.state, 'chat-b')).toEqual([b.id]);
        const closed = closeTab(b.state, b.id);
        expect(visibleTabIds(closed, 'chat-a')).toEqual([a.id]);
    });

    it('keeps the owner when a tab is re-opened from another chat or follows its page', () => {
        applyRuntimeConfigPatch({ chatScopedBrowserTabsEnabled: true });
        const a = page(EMPTY_UNIFIED_PANEL, 'chat-a', 'A');
        const tab = findTab(a.state, a.id)!;
        const reopened = openTab(a.state, { ...tab, chatId: 'chat-b', browserChatId: 'chat-b' });
        expect(findTab(reopened, a.id)?.browserChatId).toBe('chat-a');
        expect(labels(reopened, 'chat-b')).toEqual([]);
        const followed = updateBrowserTab(a.state, a.id, { url: 'https://a.test/next', label: 'Next' });
        expect(findTab(followed, a.id)).toMatchObject({ browserChatId: 'chat-a', label: 'Next' });
    });

    it('never persists pages or owners', () => {
        applyRuntimeConfigPatch({ chatScopedBrowserTabsEnabled: true });
        const a = page(EMPTY_UNIFIED_PANEL, 'chat-a', 'A');
        expect(serializeUnifiedPanelState(a.state)).not.toContain('chat-a');
    });

    it('releases every owner when the flag turns off, keeping the reference when there is none', () => {
        applyRuntimeConfigPatch({ chatScopedBrowserTabsEnabled: true });
        const a = page(EMPTY_UNIFIED_PANEL, 'chat-a', 'A');
        const released = releaseBrowserChatOwners(a.state);
        expect(findTab(released, a.id)).not.toHaveProperty('browserChatId');
        expect(labels(released, 'chat-b')).toEqual(['A']);
        expect(releaseBrowserChatOwners(released)).toBe(released);
        expect(releaseBrowserChatOwners(EMPTY_UNIFIED_PANEL)).toBe(EMPTY_UNIFIED_PANEL);
    });

    it('duplicates and reopens with the source page\'s owner, global staying global', () => {
        applyRuntimeConfigPatch({ chatScopedBrowserTabsEnabled: true });
        const a = page(EMPTY_UNIFIED_PANEL, 'chat-a', 'A');
        const g = page(a.state, null, 'G');
        const owned = findTab(g.state, a.id)!;
        const global = findTab(g.state, g.id)!;
        expect(duplicateBrowserTabInput(owned, 'chat-a')?.browserChatId).toBe('chat-a');
        expect(duplicateBrowserTabInput(global, 'chat-b')).not.toHaveProperty('browserChatId');

        recordClosedBrowserTab('scope-a', owned);
        recordClosedBrowserTab('scope-b', global);
        const reopenedOwned = reopenBrowserTabInput(popClosedBrowserTab('scope-a')!);
        expect(reopenedOwned).toMatchObject({ browserChatId: 'chat-a', chatId: 'chat-a', browserUrl: 'https://A.test/' });
        expect(reopenedOwned.resourceId).not.toBe(owned.resourceId);
        expect(reopenBrowserTabInput(popClosedBrowserTab('scope-b')!)).not.toHaveProperty('browserChatId');
    });

    it('keeps equal chat ids and labels in different workspaces and servers apart', () => {
        applyRuntimeConfigPatch({ chatScopedBrowserTabsEnabled: true });
        const remote = 'remote:srv-2:ws-1';
        openUnifiedPanelTab(WS, { ...browserOpenInput({ ownerWorkspaceId: WS, ownerRoutingRef: null, chatId: 'chat-a' }, 'https://same.test/'), label: 'Same' });
        openUnifiedPanelTab(remote, { ...browserOpenInput({ ownerWorkspaceId: WS, ownerRoutingRef: remote, chatId: 'chat-a' }, 'https://same.test/'), label: 'Same' });
        openUnifiedPanelTab('ws-2', { ...browserOpenInput({ ownerWorkspaceId: 'ws-2', chatId: 'chat-b' }, 'https://same.test/'), label: 'Same' });
        const local = readUnifiedPanelState(WS);
        const cloned = readUnifiedPanelState(remote);
        expect(visibleTabs(local, 'chat-a')).toHaveLength(1);
        expect(visibleTabs(cloned, 'chat-a')).toHaveLength(1);
        expect(visibleTabs(local, 'chat-a')[0].id).not.toBe(visibleTabs(cloned, 'chat-a')[0].id);
        expect(visibleTabs(cloned, 'chat-a')[0].ownerRoutingRef).toBe(remote);
        expect(visibleTabs(readUnifiedPanelState('ws-2'), 'chat-a')).toHaveLength(0);
        expect(visibleTabs(readUnifiedPanelState('ws-2'), 'chat-b')).toHaveLength(1);
    });
});
