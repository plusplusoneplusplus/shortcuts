import { afterEach, describe, expect, it } from 'vitest';
import {
    CLOSED_BROWSER_TAB_LIMIT,
    clearClosedBrowserTabs,
    closedBrowserTabScopeKey,
    popClosedBrowserTab,
    recordClosedBrowserTab,
    reopenBrowserTabInput,
    reopenClosedTabShortcut,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedClosedBrowserTabs';
import type { UnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

function browserTab(id: string, overrides: Partial<UnifiedPanelTab> = {}): UnifiedPanelTab {
    return {
        id, kind: 'browser', ownerWorkspaceId: 'ws-1', chatId: null, resourceId: `view-${id}`,
        label: `Title ${id}`, browserUrl: `https://${id}.test/page`, ...overrides,
    };
}

const SCOPE = closedBrowserTabScopeKey('ws-1', null);

describe('unifiedClosedBrowserTabs', () => {
    afterEach(() => clearClosedBrowserTabs());

    it('matches Ctrl/Cmd+Shift+T only', () => {
        expect(reopenClosedTabShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'T' })).toBe('reopen');
        expect(reopenClosedTabShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: true, key: 't' })).toBe('reopen');
        for (const event of [
            { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 't' },
            { ctrlKey: true, metaKey: false, altKey: true, shiftKey: true, key: 'T' },
            { ctrlKey: false, metaKey: false, altKey: false, shiftKey: true, key: 'T' },
            { ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'W' },
        ]) expect(reopenClosedTabShortcut(event)).toBeNull();
    });

    it('pops newest-first, keeps duplicate URLs and returns null when empty', () => {
        recordClosedBrowserTab(SCOPE, browserTab('a'));
        recordClosedBrowserTab(SCOPE, browserTab('b'));
        recordClosedBrowserTab(SCOPE, browserTab('a2', { browserUrl: 'https://a.test/page', label: 'Title a' }));
        expect(popClosedBrowserTab(SCOPE)?.url).toBe('https://a.test/page');
        expect(popClosedBrowserTab(SCOPE)?.url).toBe('https://b.test/page');
        expect(popClosedBrowserTab(SCOPE)?.url).toBe('https://a.test/page');
        expect(popClosedBrowserTab(SCOPE)).toBeNull();
    });

    it('ignores HTML previews and every non-browser kind', () => {
        recordClosedBrowserTab(SCOPE, browserTab('h', { kind: 'html-page', htmlPageId: 'page-1' }));
        recordClosedBrowserTab(SCOPE, browserTab('f', { kind: 'file' }));
        recordClosedBrowserTab(SCOPE, browserTab('t', { kind: 'terminal' }));
        expect(popClosedBrowserTab(SCOPE)).toBeNull();
    });

    it('keeps only the newest entries up to the limit', () => {
        for (let i = 0; i < CLOSED_BROWSER_TAB_LIMIT + 5; i++) recordClosedBrowserTab(SCOPE, browserTab(`t${i}`));
        const popped: string[] = [];
        for (let entry = popClosedBrowserTab(SCOPE); entry; entry = popClosedBrowserTab(SCOPE)) popped.push(entry.label);
        expect(popped).toHaveLength(CLOSED_BROWSER_TAB_LIMIT);
        expect(popped[0]).toBe(`Title t${CLOSED_BROWSER_TAB_LIMIT + 4}`);
        expect(popped.at(-1)).toBe('Title t5');
    });

    it('isolates exact workspace, chat and server scopes', () => {
        const chat = closedBrowserTabScopeKey('ws-1', 'chat-1');
        const other = closedBrowserTabScopeKey('ws-2', null);
        const remote = closedBrowserTabScopeKey('remote:server-1:ws-1', null);
        recordClosedBrowserTab(chat, browserTab('c', { chatId: 'chat-1' }));
        expect(popClosedBrowserTab(SCOPE)).toBeNull();
        expect(popClosedBrowserTab(other)).toBeNull();
        expect(popClosedBrowserTab(remote)).toBeNull();
        expect(popClosedBrowserTab(closedBrowserTabScopeKey('ws-1', 'chat-2'))).toBeNull();
        expect(popClosedBrowserTab(chat)?.chatId).toBe('chat-1');
    });

    it('snapshots owner, URL and title without the view identity', () => {
        recordClosedBrowserTab(SCOPE, browserTab('r', {
            ownerWorkspaceId: 'ws-member', ownerRoutingRef: 'remote:server-1:ws-member', repoLabel: 'api',
        }));
        const entry = popClosedBrowserTab(SCOPE)!;
        expect(entry).toEqual({
            ownerWorkspaceId: 'ws-member', ownerRoutingRef: 'remote:server-1:ws-member', chatId: null,
            repoLabel: 'api', url: 'https://r.test/page', label: 'Title r',
        });
        const input = reopenBrowserTabInput(entry);
        expect(input).toMatchObject({
            kind: 'browser', ownerWorkspaceId: 'ws-member', ownerRoutingRef: 'remote:server-1:ws-member',
            chatId: null, repoLabel: 'api', browserUrl: 'https://r.test/page', label: 'Title r',
        });
        expect(input.resourceId).not.toBe('view-r');
        expect(reopenBrowserTabInput(entry).resourceId).not.toBe(input.resourceId);
    });

    it('restores a blank tab as blank', () => {
        recordClosedBrowserTab(SCOPE, browserTab('blank', { browserUrl: undefined, label: 'New Tab' }));
        const input = reopenBrowserTabInput(popClosedBrowserTab(SCOPE)!);
        expect(input.browserUrl).toBeUndefined();
        expect(input.label).toBe('New Tab');
    });
});
