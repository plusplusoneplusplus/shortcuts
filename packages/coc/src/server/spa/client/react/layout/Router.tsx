/**
 * Router — hash-based routing for the SPA tabs.
 * Reads activeTab from AppContext, renders the appropriate view.
 *
 * Route parsing, canonicalization, and hash building live in `dashboardRoutes`;
 * this component reads `location.hash`, resolves it into typed effects via
 * `resolveDashboardRoute`, and applies them. Those helpers are re-exported here
 * so existing importers keep working.
 */

import { buildWorkResourceHash } from './workResourceRoute';
import { useEffect, useLayoutEffect, useCallback, useRef, useState } from 'react';
import { DashboardChatReferenceRoute } from './DashboardChatReferenceRoute';
import { useApp } from '../contexts/AppContext';
import { useVisibleDashboardTab } from './useVisibleDashboardTab';
import { useQueue } from '../contexts/QueueContext';
import { ReposView } from '../repos';
import { isTerminalEnabled, isDreamsEnabled, isSchedulesInScheduledSlideEnabled } from '../utils/config';
import { splitWorkspaceLeftCollapsedStorageKey, toggleLeftCollapsed } from '../features/repo-detail/WorkspaceLeftCollapse';
import { toggleWorkspaceDockOpen } from '../features/repo-detail/WorkspaceDockToggle';
import type { DashboardTab, RepoSubTab } from '../types/dashboard';
import { getWorkspaceIdFromSelectionId } from '../repos/cloneIdentity';
import { isVirtualWorkspaceId } from '../repos/virtualWorkspaceIds';
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

export const REPO_TAB_SHORTCUTS: Record<string, RepoSubTab> = {
    g: 'git',
    e: 'explorer',
    t: 'tasks',
    a: 'chats',
    w: 'workflows',
    s: 'schedules',
    d: 'dreams',
};

/** My Work / My Life keep page-level Notes and Settings; repos and groups open them in the right panel. */
export const VIRTUAL_WORKSPACE_TAB_SHORTCUTS: Record<string, RepoSubTab> = {
    n: 'notes',
    c: 'settings',
};

export function Router() {
    const [referenceHash, setReferenceHash] = useState<string | null>(() =>
        location.hash === '#chat-references' || location.hash.startsWith('#chat-references/') ? location.hash : null);
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

                isSchedulesInSlide: isSchedulesInScheduledSlideEnabled,
            };
            const resolution = resolveDashboardRoute(location.hash, ctx);
            setReferenceHash(resolution.chatReference !== undefined ? location.hash : null);
            applyRouteEffects(resolution.effects, { dispatch, queueDispatch });
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
            if (referenceHash !== null) return;
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
            if (state.activeTab !== 'repos' || !state.selectedRepoId) return;

            // Cmd/Ctrl+B → collapse/expand the whole left workspace sidebar in the
            // split layout. Input-guarded + repo-scoped (both above); only wired
            // when the split panel is on screen (AC-04).
            if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {

                e.preventDefault();
                const wsId = getWorkspaceIdFromSelectionId(state.selectedRepoId);
                toggleLeftCollapsed(splitWorkspaceLeftCollapsedStorageKey(wsId));
                return;
            }

            // Cmd/Ctrl+\ → show/hide the workspace right panel. Matches the physical
            // key so layouts without a direct backslash (e.g. German) still work.
            if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'Backslash') {
                e.preventDefault();
                toggleWorkspaceDockOpen(getWorkspaceIdFromSelectionId(state.selectedRepoId));
                return;
            }

            if (e.altKey && !e.ctrlKey && !e.metaKey) {
                const letter = e.code.replace('Key', '').toLowerCase();
                if (!isVirtualWorkspaceId(state.selectedRepoId) && (letter === 'i' || letter === 'r')) {
                    e.preventDefault();
                    location.hash = buildWorkResourceHash(state.selectedRepoId, letter === 'i' ? 'work-items' : 'pull-requests');
                    return;
                }
                if (letter === 'q') {
                    e.preventDefault();
                    queueDispatch({ type: 'OPEN_DIALOG', workspaceId: getWorkspaceIdFromSelectionId(state.selectedRepoId) });
                    return;
                }
                const rawTab = (isVirtualWorkspaceId(state.selectedRepoId) ? VIRTUAL_WORKSPACE_TAB_SHORTCUTS[letter] : undefined)
                    ?? REPO_TAB_SHORTCUTS[letter];
                if (rawTab) {
                    if (rawTab === 'terminal' && !isTerminalEnabled()) return;
                    if (rawTab === 'dreams' && !isDreamsEnabled()) return;
                    // The 'chats' shortcut maps to the chat surface, whose canonical
                    // sub-tab key differs by layout mode (`'activity'` in classic).
                    const tab: RepoSubTab = rawTab === 'chats' ? resolveChatSubTab() : rawTab;
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
        referenceHash,
        dispatch,
        queueDispatch,
        queueState.selectedTaskId,
        queueState.selectedTaskIdByRepo,
        state.activeTab,
        // The Git suffix a group writes depends on its scope + remembered member,
        // not just the selection fields.
        state.gitRouteScope,
        state.repoGroupGitMemberState,
        state.selectedGitCommitHash,
        state.selectedGitFilePath,
        state.selectedNotePath,
        state.selectedRepoId,
        state.settingsSection,
    ]);

    if (referenceHash !== null) return <DashboardChatReferenceRoute key={referenceHash} hash={referenceHash} />;

    // `renderedTab` (above) is the last non-admin view, so it stays mounted —
    // and keeps its scroll position — behind the admin dialog, and is simply
    // revealed again on close.
    switch (renderedTab) {
        case 'repos':
            return <ReposView />;
        case 'reports':
            return <StubView id="view-reports" label="Reports" />;
        default:
            return <ReposView />;
    }
}
