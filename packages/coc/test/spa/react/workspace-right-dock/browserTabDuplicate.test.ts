/**
 * Browser tab "Duplicate": the copy descriptor, the menu entry, and placement
 * directly beside the source in both ordering modes.
 */
import { describe, expect, it } from 'vitest';
import {
    browserOpenInput,
    canDuplicateBrowserTab,
    duplicateBrowserTabInput,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import {
    EMPTY_UNIFIED_PANEL,
    activeTabId,
    openTab,
    openTabBeside,
    updateBrowserTab,
    visibleTabs,
    type UnifiedPanelState,
    type UnifiedPanelTab,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { unifiedPanelTabMenuItems } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabMenuModel';

const CHAT = 'chat-1';
const CONTEXT = { ownerWorkspaceId: 'member', ownerRoutingRef: 'remote:host-a:member', chatId: CHAT, repoLabel: 'member' };

function browserTab(overrides: Partial<UnifiedPanelTab> = {}): UnifiedPanelTab {
    return {
        id: 'browser:source', kind: 'browser', ownerWorkspaceId: 'member', ownerRoutingRef: 'remote:host-a:member',
        chatId: null, resourceId: 'view-source', label: 'Docs', repoLabel: 'member',
        browserUrl: 'https://example.com/docs?page=2#intro', ...overrides,
    };
}

/** Three browser tabs plus a terminal, opened in order. */
function threeBrowsers(): { state: UnifiedPanelState; ids: string[] } {
    let state = openTab(EMPTY_UNIFIED_PANEL, {
        kind: 'terminal', ownerWorkspaceId: 'member', chatId: CHAT, resourceId: 'term', label: 'Terminal',
    });
    const ids: string[] = [];
    for (const url of ['https://a.test/', 'https://b.test/', 'https://c.test/']) {
        const input = browserOpenInput(CONTEXT, url);
        state = openTab(state, input);
        ids.push(visibleTabs(state, CHAT).at(-1)!.id);
    }
    return { state, ids };
}

describe('duplicateBrowserTabInput', () => {
    it('copies owner scope, label, engine and the committed URL with a fresh view id', () => {
        const source = browserTab({ browserEngine: 'webview2' });
        const input = duplicateBrowserTabInput(source, CHAT)!;
        expect(input).toMatchObject({
            kind: 'browser', ownerWorkspaceId: 'member', ownerRoutingRef: 'remote:host-a:member', chatId: CHAT,
            repoLabel: 'member', label: 'Docs', browserUrl: 'https://example.com/docs?page=2#intro', browserEngine: 'webview2',
        });
        expect(input.resourceId).not.toBe(source.resourceId);
        expect(duplicateBrowserTabInput(source, CHAT)!.resourceId).not.toBe(input.resourceId);
    });

    it('follows the URL after navigation and leaves the engine to policy when unpinned', () => {
        let state = openTab(EMPTY_UNIFIED_PANEL, browserOpenInput(CONTEXT, 'https://a.test/'));
        const id = visibleTabs(state, CHAT)[0].id;
        state = updateBrowserTab(state, id, { url: 'https://a.test/next', label: 'Next' });
        const input = duplicateBrowserTabInput(visibleTabs(state, CHAT)[0], CHAT)!;
        expect(input.browserUrl).toBe('https://a.test/next');
        expect(input.label).toBe('Next');
        expect('browserEngine' in input).toBe(false);
    });

    it('duplicates a blank tab as a blank tab', () => {
        const input = duplicateBrowserTabInput(browserTab({ browserUrl: undefined, label: 'New Tab' }), CHAT)!;
        expect('browserUrl' in input).toBe(false);
        expect(input.label).toBe('New Tab');
    });

    it('rejects non-browser tabs and non-http(s) pages', () => {
        for (const kind of ['html-page', 'file', 'terminal', 'canvas'] as const) {
            const tab = browserTab({ kind, htmlPageId: 'page-1' });
            expect(canDuplicateBrowserTab(tab)).toBe(false);
            expect(duplicateBrowserTabInput(tab, CHAT)).toBeNull();
        }
        for (const url of ['chrome-error://chromewebdata/', 'about:blank', 'file:///etc/passwd', 'data:text/html,x']) {
            expect(canDuplicateBrowserTab(browserTab({ browserUrl: url }))).toBe(false);
            expect(duplicateBrowserTabInput(browserTab({ browserUrl: url }), CHAT)).toBeNull();
        }
    });
});

describe('Duplicate menu item', () => {
    it('is offered for browser tabs only', () => {
        const source = browserTab();
        expect(unifiedPanelTabMenuItems(source, [source], new Set())
            .find(item => item.action === 'duplicate')).toEqual({ action: 'duplicate', label: 'Duplicate', group: 'browser', disabled: false });
        for (const kind of ['html-page', 'file', 'terminal', 'notes', 'canvas'] as const) {
            const other = browserTab({ kind });
            expect(unifiedPanelTabMenuItems(other, [other], new Set()).some(item => item.action === 'duplicate')).toBe(false);
        }
    });

    it('is disabled on a page that cannot open again', () => {
        const source = browserTab({ browserUrl: 'chrome-error://chromewebdata/' });
        expect(unifiedPanelTabMenuItems(source, [source], new Set()).find(item => item.action === 'duplicate')?.disabled).toBe(true);
    });

    it('keeps the move and close actions', () => {
        const source = browserTab();
        const actions = unifiedPanelTabMenuItems(source, [source], new Set(), undefined, [source.id]).map(item => item.action);
        expect(actions).toEqual(['move-left', 'move-right', 'duplicate', 'close', 'close-others', 'close-right', 'close-saved', 'close-all']);
    });
});

describe('openTabBeside', () => {
    it.each([false, true])('places the copy right after the source and selects it (mixed order %s)', mixedOrder => {
        const { state, ids } = threeBrowsers();
        const source = visibleTabs(state, CHAT).find(tab => tab.id === ids[0])!;
        const input = duplicateBrowserTabInput(source, CHAT)!;
        const next = openTabBeside(state, CHAT, input, source.id, mixedOrder);
        const order = visibleTabs(next, CHAT).map(tab => tab.id);
        const copyId = order[order.indexOf(source.id) + 1];
        expect(order).toEqual([visibleTabs(state, CHAT)[0].id, ids[0], copyId, ids[1], ids[2]]);
        expect(activeTabId(next, CHAT)).toBe(copyId);
        expect(visibleTabs(next, CHAT).find(tab => tab.id === source.id)).toBe(source);
    });

    it.each([false, true])('appends when the source is last (mixed order %s)', mixedOrder => {
        const { state, ids } = threeBrowsers();
        const source = visibleTabs(state, CHAT).find(tab => tab.id === ids[2])!;
        const next = openTabBeside(state, CHAT, duplicateBrowserTabInput(source, CHAT)!, source.id, mixedOrder);
        const order = visibleTabs(next, CHAT).map(tab => tab.id);
        expect(order.slice(0, 4)).toEqual(visibleTabs(state, CHAT).map(tab => tab.id));
        expect(order).toHaveLength(5);
    });

    it('follows a saved mixed order rather than the descriptor list', () => {
        const { state, ids } = threeBrowsers();
        // Saved order puts c before a; duplicating c lands between c and a.
        const reordered: UnifiedPanelState = {
            ...state,
            orderByScope: { [CHAT]: [visibleTabs(state, CHAT)[0].id, ids[2], ids[0], ids[1]] },
        };
        const source = visibleTabs(reordered, CHAT).find(tab => tab.id === ids[2])!;
        const next = openTabBeside(reordered, CHAT, duplicateBrowserTabInput(source, CHAT)!, source.id, true);
        const order = visibleTabs(next, CHAT).map(tab => tab.id);
        expect(order.indexOf(ids[0])).toBe(order.indexOf(ids[2]) + 2);
    });
});
