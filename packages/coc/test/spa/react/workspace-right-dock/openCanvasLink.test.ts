/**
 * A clicked `canvas://<id>` link (markdown viewer, Notes) opens the same tab
 * the inline embed's "Open in panel" files, and declines without a chat.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CANVAS_LINK_NO_CHAT_MESSAGE, openCanvasLink } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/openCanvasLink';
import { canvasEmbedTabInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedCanvasEmbeds';
import { readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { visibleTabs } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const tabsOf = (ws: string) => visibleTabs(readUnifiedPanelState(ws), 'chat-A');

const WORKSPACES = [{ id: 'member-1', name: 'member-repo' }];

beforeEach(() => localStorage.clear());

describe('openCanvasLink', () => {
    it('opens the same tab as the inline embed', () => {
        const host = { workspaceId: 'ws-1', chatId: 'chat-A' };
        expect(openCanvasLink({ canvasId: 'c1', ownerWorkspaceId: 'ws-1', host })).toEqual({ ok: true });
        const tabs = tabsOf('ws-1');
        expect(tabs).toHaveLength(1);
        const expected = canvasEmbedTabInput({ canvasId: 'c1', ownerWorkspaceId: 'ws-1', scopeWorkspaceId: 'ws-1', chatId: 'chat-A' })!;
        expect(tabs[0]).toMatchObject({ resourceId: expected.resourceId, browserUrl: 'coc://canvas/c1', ownerWorkspaceId: 'ws-1' });
    });

    it('keeps the member clone as owner inside a group scope', () => {
        const host = { workspaceId: 'group-1', chatId: 'chat-A' };
        openCanvasLink({ canvasId: 'c1', ownerWorkspaceId: 'member-1', host, workspaces: WORKSPACES });
        expect(tabsOf('group-1')[0]).toMatchObject({
            ownerWorkspaceId: 'member-1', repoLabel: 'member-repo',
        });
    });

    it('declines with no panel host', () => {
        expect(openCanvasLink({ canvasId: 'c1', ownerWorkspaceId: 'ws-1', host: null }))
            .toEqual({ ok: false, reason: CANVAS_LINK_NO_CHAT_MESSAGE });
    });

    it('declines when the panel shows no chat', () => {
        const host = { workspaceId: 'ws-1', chatId: null };
        expect(openCanvasLink({ canvasId: 'c1', ownerWorkspaceId: 'ws-1', host }).ok).toBe(false);
        expect(tabsOf('ws-1')).toHaveLength(0);
    });
});
