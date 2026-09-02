/**
 * Router — hash-based routing for the SPA tabs.
 * Reads activeTab from AppContext, renders the appropriate view.
 *
 * Route parsing, canonicalization, and hash building live in `dashboardRoutes`;
 * this component reads `location.hash`, resolves it into typed effects via
 * `resolveDashboardRoute`, and applies them. Those helpers are re-exported here
 * so existing importers keep working.
 */

import { useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { useVisibleDashboardTab } from './useVisibleDashboardTab';
import { useQueue } from '../contexts/QueueContext';
import { ReposView } from '../repos';
import { WikiView } from '../wiki/WikiView';
import { SHOW_WIKI_TAB } from './TopBar';
import { isTerminalEnabled, isNotesEnabled, isDreamsEnabled, isSchedulesInScheduledSlideEnabled, isSplitWorkspacePanelEnabled } from '../utils/config';
import { splitWorkspaceLeftCollapsedStorageKey, toggleLeftCollapsed } from '../features/repo-detail/WorkspaceLeftCollapse';
import { getUiLayoutMode } from '../hooks/preferences/useUiLayoutMode';
import type { DashboardTab, RepoSubTab } from '../types/dashboard';
import { getWorkspaceIdFromSelectionId } from '../repos/cloneIdentity';
import {
    resolveDashboardRoute,
    applyRouteEffects,
    buildWorkspaceSubTabSuffix,
    resolveChatSubTab,
    type RouteContext,
} from './dashboardRoutes';

// Re-export the route registry (parsers, builders, canonicalizers) so existing
// importers that reach for them via `layout/Router` keep working unchanged.
export * from './dashboardRoutes';

// Admin (and the tool routes it embeds — memory/skills/logs/stats/servers/
// dreams-admin) no longer render as top-level views. `App` mounts them in the
// admin overlay dialog instead, and this router keeps showing whatever view the
// user was on so it stays mounted (and scrolled) behind the dialog.

function StubView({ id, label }: { id: string; label: string }) {
    return <div id={id}>{label}</div>;
}

const ALL_REPO_TAB_SHORTCUTS: Record<string, RepoSubTab> = {
    g: 'git',
    e: 'explorer',
    t: 'tasks',
    r: 'pull-requests',
    a: 'chats',
    w: 'workflows',
    s: 'schedules',
    c: 'settings',
    i: 'work-items',
    n: 'notes',
    d: 'dreams',
};

export const REPO_TAB_SHORTCUTS: Record<string, RepoSubTab> = SHOW_WIKI_TAB
    ? ALL_REPO_TAB_SHORTCUTS
    : Object.fromEntries(Object.entries(ALL_REPO_TAB_SHORTCUTS).filter(([, v]) => v !== 'wiki'));

export function Router() {
    const { state, dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const processDeepLinkContextRef = useRef({
        queueState,
        selectedRepoId: state.selectedRepoId,
    });
    const repoRouteStateRef = useRef(state.repoRouteState);
    const repoTabStateRef = useRef(state.repoTabState);
    // Admin hashes open the overlay dialog without replacing the page, so the
    // view to render is the last non-admin tab, not `state.activeTab`.
    const renderedTab = useVisibleDashboardTab();
    processDeepLinkContextRef.current = {
        queueState,
        selectedRepoId: state.selectedRepoId,
    };
    repoRouteStateRef.current = state.repoRouteState;
    repoTabStateRef.current = state.repoTabState;

    const switchTab = useCallback((tab: string) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: tab as DashboardTab });
    }, [dispatch]);

    // Register global switchTab for backward compat with legacy modules
    useEffect(() => {
        (window as any).switchTab = switchTab;
        return () => { delete (window as any).switchTab; };
    }, [switchTab]);

    // Handle hash changes — resolve the current hash into typed route effects and
    // apply them. useLayoutEffect fires synchronously before browser paint so the
    // correct repo/section is already set on the first visible render, preventing
    // a blank-page flash when navigating directly to a deep-link (e.g. on refresh).
    useLayoutEffect(() => {
        const handleHash = () => {
            const deepLinkContext = processDeepLinkContextRef.current;
            const ctx: RouteContext = {
                queueState: deepLinkContext.queueState,
                selectedRepoId: deepLinkContext.selectedRepoId,
                repoRouteState: repoRouteStateRef.current,
                repoTabState: repoTabStateRef.current,
                getUiLayoutMode,
                isSchedulesInSlide: isSchedulesInScheduledSlideEnabled,
            };
            const { effects } = resolveDashboardRoute(location.hash, ctx);
            applyRouteEffects(effects, { dispatch, queueDispatch });
        };
        handleHash();
        window.addEventListener('hashchange', handleHash);
        return () => window.removeEventListener('hashchange', handleHash);
    }, [dispatch, queueDispatch]);

    // Keyboard shortcuts for repo sub-tabs:
    //   Alt+<letter> → switches to the corresponding sub-tab (see REPO_TAB_SHORTCUTS)
    //   Alt+Q → opens the Queue Task dialog for the selected repo
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
            if (state.activeTab !== 'repos' || !state.selectedRepoId) return;

            // Cmd/Ctrl+B → collapse/expand the whole left workspace sidebar in the
            // split layout. Input-guarded + repo-scoped (both above); only wired
            // when the split panel is on screen (AC-04).
            if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
                if (!isSplitWorkspacePanelEnabled()) return;
                e.preventDefault();
                const wsId = getWorkspaceIdFromSelectionId(state.selectedRepoId);
                toggleLeftCollapsed(splitWorkspaceLeftCollapsedStorageKey(wsId));
                return;
            }

            if (e.altKey && !e.ctrlKey && !e.metaKey) {
                const letter = e.code.replace('Key', '').toLowerCase();
                if (letter === 'q') {
                    e.preventDefault();
                    queueDispatch({ type: 'OPEN_DIALOG', workspaceId: getWorkspaceIdFromSelectionId(state.selectedRepoId) });
                    return;
                }
                const rawTab = REPO_TAB_SHORTCUTS[letter];
                if (rawTab) {
                    if (rawTab === 'terminal' && !isTerminalEnabled()) return;
                    if (rawTab === 'notes' && !isNotesEnabled()) return;
                    if (rawTab === 'dreams' && !isDreamsEnabled()) return;
                    // The 'chats' shortcut maps to the chat surface, whose canonical
                    // sub-tab key differs by layout mode (`'activity'` in classic).
                    const tab: RepoSubTab = rawTab === 'chats' ? resolveChatSubTab(getUiLayoutMode()) : rawTab;
                    e.preventDefault();
                    dispatch({ type: 'SET_REPO_SUB_TAB', tab });
                    const selectedTaskId = queueState.selectedTaskIdByRepo?.[state.selectedRepoId] ?? queueState.selectedTaskId;
                    location.hash = '#repos/' + encodeURIComponent(state.selectedRepoId) + buildWorkspaceSubTabSuffix(state.selectedRepoId, tab, state, selectedTaskId);
                }
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [
        dispatch,
        queueDispatch,
        queueState.selectedTaskId,
        queueState.selectedTaskIdByRepo,
        state.activeTab,
        state.selectedGitCommitHash,
        state.selectedGitFilePath,
        state.selectedNotePath,
        state.selectedRepoId,
        state.settingsSection,
    ]);

    // `renderedTab` (above) is the last non-admin view, so it stays mounted —
    // and keeps its scroll position — behind the admin dialog, and is simply
    // revealed again on close.
    switch (renderedTab) {
        case 'repos':
            return <ReposView />;
        case 'wiki':
            return <WikiView />;
        case 'reports':
            return <StubView id="view-reports" label="Reports" />;
        default:
            return <ReposView />;
    }
}
