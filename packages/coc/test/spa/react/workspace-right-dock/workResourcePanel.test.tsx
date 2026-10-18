/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { buildWorkResourceHash, parseWorkResourceRoute } from '../../../../src/server/spa/client/react/layout/workResourceRoute';
import { openWorkResourceRoute, WorkResourceNavigationContext, useWorkResourceNavigation } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/workResourceNavigation';
import { panelOwnerForSelection, panelWorkspaceResourceInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelWorkspaceResources';
import { openTab, unifiedTabId, serializeUnifiedPanelState, parseUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { clearUnifiedPanelState, readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { openMenuActions, buildOpenMenuItems, nextOpenMenuIndex } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpenMenuModel';
import { resolveDashboardRoute } from '../../../../src/server/spa/client/react/layout/dashboardRoutes';
import { UnifiedPanelHostProvider } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
import { workspaceDockOpenStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';
import { getInitialRepoRouteState, getInitialRepoTabState, REPO_ROUTE_STATE_KEY, REPO_TAB_STATE_KEY } from '../../../../src/server/spa/client/react/contexts/AppContext';

beforeEach(() => { localStorage.clear(); clearUnifiedPanelState(); });
afterEach(cleanup);
const context = { queueState: { selectedTaskIdByRepo: { 'remote:host:group-a': 'chat-a' } } as any, selectedRepoId: 'remote:host:group-a', repoRouteState: {}, repoTabState: {}, isSchedulesInSlide: () => false };

describe('WI/PR panel destinations', () => {
    it.each(['work-items', 'pull-requests'] as const)('menu and deep link focus one concrete-owner %s tab, preserving selected chat', kind => {
        const scopeId = 'remote:host:group-a';
        const ownerId = 'remote:host:repo-a';
        const route = parseWorkResourceRoute(buildWorkResourceHash(scopeId, kind, ownerId, '42'))!;
        openWorkResourceRoute(route, 'chat-a');
        const input = panelWorkspaceResourceInput(kind, panelOwnerForSelection(ownerId, 'chat-a'));
        const state = openTab(readUnifiedPanelState('group-a'), input);
        expect(state.workspaceTabs).toHaveLength(1);
        expect(state.workspaceTabs[0]).toMatchObject({ ownerWorkspaceId: 'repo-a', ownerRoutingRef: ownerId, workPath: '42', chatId: null });
        expect(state.activeByScope['chat-a']).toBe(unifiedTabId(input));
        expect(localStorage.getItem(workspaceDockOpenStorageKey('group-a'))).toBe('1');
        expect(parseUnifiedPanelState(serializeUnifiedPanelState(state)).workspaceTabs[0].workPath).toBe('42');
    });
    it('keeps same-id clones and local owners separate', () => {
        for (const ownerId of ['repo-a', 'remote:one:repo-a', 'remote:two:repo-a']) {
            openWorkResourceRoute({ scopeId: ownerId, ownerId, kind: 'work-items', path: '7' });
        }
        expect(readUnifiedPanelState('repo-a').workspaceTabs).toHaveLength(3);
    });
    it('restores panel routes without selecting a page tab or clearing the chat', () => {
        const result = resolveDashboardRoute('#repos/remote%3Ahost%3Agroup-a/panel/pull-requests/remote%3Ahost%3Arepo-a/31/checks', context);
        expect(result.effects).toContainEqual({ kind: 'panel', route: { scopeId: 'remote:host:group-a', ownerId: 'remote:host:repo-a', kind: 'pull-requests', path: '31/checks' }, chatId: 'chat-a' });
        expect(result.effects.filter(effect => effect.kind === 'queue')).toEqual([]);
        expect(result.effects).toContainEqual({ kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: 'activity' } });
    });
    it.each(['work-items/42', 'pull-requests/7/files', 'panel/unknown/repo-a', 'panel/work-items', 'panel/work-items/remote%3Aother%3Arepo-a'])('rejects removed/invalid %s routes into a usable workspace', suffix => {
        const result = resolveDashboardRoute('#repos/repo-a/' + suffix, context);
        expect(result.effects).toContainEqual({ kind: 'navigate', hash: '#repos/repo-a/activity', mode: 'replace' });
        expect(result.effects.some(effect => effect.kind === 'panel')).toBe(false);
    });
    it('drops removed saved page taxonomy and retains canonical panel restoration', () => {
        localStorage.setItem(REPO_TAB_STATE_KEY, JSON.stringify({ a: 'work-items', b: 'pull-requests', c: 'activity' }));
        localStorage.setItem(REPO_ROUTE_STATE_KEY, JSON.stringify({ a: '/work-items/4', b: '/pull-requests/7', c: '/panel/work-items/c/4' }));
        expect(getInitialRepoTabState()).toEqual({ c: 'activity' });
        expect(getInitialRepoRouteState()).toEqual({ c: '/panel/work-items/c/4' });
    });
    it('keeps group/member scope through links inside the screen', () => {
        const scopeId = 'remote:host:group-a';
        const ownerId = 'remote:host:repo-a';
        openWorkResourceRoute({ scopeId, ownerId, kind: 'work-items', path: '1' }, 'chat-a');
        const tab = readUnifiedPanelState('group-a').workspaceTabs[0];
        const { result } = renderHook(() => useWorkResourceNavigation('work-items', ownerId), { wrapper: ({ children }) =>
            <UnifiedPanelHostProvider host={{ workspaceId: 'group-a', routingRef: scopeId, chatId: 'chat-a' }}>
                <WorkResourceNavigationContext.Provider value={{ scopeId, tab }}>{children}</WorkResourceNavigationContext.Provider>
            </UnifiedPanelHostProvider> });
        act(() => result.current.navigate(buildWorkResourceHash(ownerId, 'work-items', ownerId, '2/commit/abc/a%20b.ts')));
        expect(parseWorkResourceRoute(location.hash)).toMatchObject({ scopeId, ownerId, path: '2/commit/abc/a%20b.ts' });
        expect(readUnifiedPanelState('group-a').workspaceTabs[0].workPath).toBe('2/commit/abc/a%20b.ts');
    });
    it('offers searchable, keyboard-reachable tools without a chat, including group roots', () => {
        const actions = openMenuActions({ targetWorkspaceId: 'group-a', chatId: null, settingsAvailable: true });
        for (const label of ['Work Items', 'Pull Requests']) {
            const items = buildOpenMenuItems({ actions, query: label, files: [], canvases: [] });
            expect(items).toHaveLength(1);
            expect(nextOpenMenuIndex(items, -1, 1)).toBe(0);
        }
    });
});
