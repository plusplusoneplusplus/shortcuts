/**
 * Router — hash-based routing for the SPA tabs.
 * Reads activeTab from AppContext, renders the appropriate view.
 */

import { useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { ProcessesView } from '../processes/ProcessesView';
import { ReposView } from '../repos';
import { WikiView } from '../wiki/WikiView';
import { lazy, Suspense } from 'react';

const MemoryView = lazy(() => import('../views/memory/MemoryView').then(m => ({ default: m.MemoryView })));
const SkillsView = lazy(() => import('../views/skills/SkillsView').then(m => ({ default: m.SkillsView })));
const AdminPanel = lazy(() => import('../admin/AdminPanel').then(m => ({ default: m.AdminPanel })));
const LogsView = lazy(() => import('../views/logs/LogsView').then(m => ({ default: m.LogsView })));
import type { DashboardTab, RepoSubTab, WikiProjectTab, WikiAdminTab, MemorySubTab, SkillsSubTab } from '../types/dashboard';

function StubView({ id, label }: { id: string; label: string }) {
    return <div id={id}>{label}</div>;
}

export function tabFromHash(hash: string): DashboardTab | null {
    const h = hash.replace(/^#/, '').split('/')[0];
    if (h === 'processes' || h === 'process' || h === 'session') return 'processes';
    if (h === 'repos' || h === 'tasks') return 'repos';
    if (h === 'wiki') return 'wiki';
    if (h === 'reports') return 'reports';
    if (h === 'memory') return 'memory';
    if (h === 'skills') return 'skills';
    if (h === 'logs') return 'logs';
    if (h === 'admin') return 'admin';
    return null;
}

export const VALID_WIKI_PROJECT_TABS: Set<string> = new Set(['browse', 'ask', 'graph', 'admin']);
export const VALID_WIKI_ADMIN_TABS: Set<string> = new Set(['generate', 'seeds', 'config', 'delete']);

export interface WikiDeepLink {
    wikiId: string | null;
    tab: WikiProjectTab | null;
    componentId: string | null;
    adminTab: WikiAdminTab | null;
}

export function parseWikiDeepLink(hash: string): WikiDeepLink {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] !== 'wiki' || !parts[1]) return { wikiId: null, tab: null, componentId: null, adminTab: null };

    const wikiId = decodeURIComponent(parts[1]);

    if (parts.length >= 4 && parts[2] === 'component' && parts[3]) {
        return { wikiId, tab: 'browse', componentId: decodeURIComponent(parts[3]), adminTab: null };
    }

    if (parts.length >= 3 && VALID_WIKI_PROJECT_TABS.has(parts[2])) {
        const tab = parts[2] as WikiProjectTab;
        let adminTab: WikiAdminTab | null = null;
        if (tab === 'admin' && parts.length >= 4 && VALID_WIKI_ADMIN_TABS.has(parts[3])) {
            adminTab = parts[3] as WikiAdminTab;
        }
        return { wikiId, tab, componentId: null, adminTab };
    }

    return { wikiId, tab: null, componentId: null, adminTab: null };
}

export function parseProcessDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    const root = parts[0];

    if ((root === 'process' || root === 'session') && parts[1]) {
        return decodeURIComponent(parts[1]);
    }
    if (root === 'processes' && parts[1]) {
        return decodeURIComponent(parts[1]);
    }

    return null;
}

export function parseWorkflowsDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'workflows' && parts[3]) {
        return decodeURIComponent(parts[3]);
    }
    return null;
}

export function parseWorkflowsRunDeepLink(hash: string): { workflowName: string; processId: string } | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'workflows' && parts[3] && parts[4] === 'run' && parts[5]) {
        return {
            workflowName: decodeURIComponent(parts[3]),
            processId: decodeURIComponent(parts[5]),
        };
    }
    return null;
}

export function parseGitCommitDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'git' && parts[3]) {
        return decodeURIComponent(parts[3]);
    }
    return null;
}

export function parseGitFileDeepLink(hash: string): { commitHash: string; filePath: string } | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'git' && parts[3] && parts[4]) {
        return {
            commitHash: decodeURIComponent(parts[3]),
            filePath: decodeURIComponent(parts[4]),
        };
    }
    return null;
}

export function parseWorkflowDeepLink(hash: string): { repoId: string; processId: string } | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'workflow' && parts[3]) {
        return {
            repoId: decodeURIComponent(parts[1]),
            processId: decodeURIComponent(parts[3]),
        };
    }
    return null;
}

export function parseActivityDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'activity' && parts[3]) {
        return decodeURIComponent(parts[3]);
    }
    return null;
}

export const VALID_REPO_SUB_TABS: Set<string> = new Set(['info', 'git', 'workflows', 'tasks', 'schedules', 'wiki', 'copilot', 'workflow', 'explorer', 'activity', 'pull-requests']);

/** Maps Alt+<letter> to a repo sub-tab key. Used by the keyboard handler and tooltip hints. */
export const REPO_TAB_SHORTCUTS: Record<string, RepoSubTab> = {
    i: 'info',
    g: 'git',
    e: 'explorer',
    p: 'tasks',
    r: 'pull-requests',
    a: 'activity',
    w: 'workflows',
    s: 'schedules',
    c: 'copilot',
};

export function Router() {
    const { state, dispatch } = useApp();
    const { dispatch: queueDispatch } = useQueue();

    const switchTab = useCallback((tab: string) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: tab as DashboardTab });
    }, [dispatch]);

    // Register global switchTab for backward compat with legacy modules
    useEffect(() => {
        (window as any).switchTab = switchTab;
        return () => { delete (window as any).switchTab; };
    }, [switchTab]);

    // Handle hash changes — parse #repos/:id/:subTab
    useEffect(() => {
        const handleHash = () => {
            const hash = location.hash.replace(/^#/, '');
            const tab = tabFromHash('#' + hash);
            if (tab) {
                dispatch({ type: 'SET_ACTIVE_TAB', tab });
            } else if (!hash) {
                location.hash = '#repos';
                return;
            }

            // Parse process deep links: #process/:id, #session/:id, #processes/:id
            if (tab === 'processes') {
                const processId = parseProcessDeepLink('#' + hash);
                if (processId) {
                    if (processId.startsWith('queue_')) {
                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: processId.substring('queue_'.length) });
                        dispatch({ type: 'SELECT_PROCESS', id: null });
                    } else {
                        dispatch({ type: 'SELECT_PROCESS', id: processId });
                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
                    }
                } else {
                    // Plain #processes means no detail selection.
                    dispatch({ type: 'SELECT_PROCESS', id: null });
                    queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
                }
            }

            // Parse repo deep links: #repos/:id or #repos/:id/:subTab
            if (tab === 'repos') {
                const parts = hash.split('/');
                if (parts.length >= 2 && parts[0] === 'repos' && parts[1]) {
                    const repoId = decodeURIComponent(parts[1]);
                    dispatch({ type: 'SET_SELECTED_REPO', id: repoId });
                    // Redirect legacy #repos/:id/templates deep-links to workflows tab
                    if (parts[2] === 'templates') {
                        dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'workflows' as RepoSubTab });
                        location.replace('#repos/' + parts[1] + '/workflows');
                        return;
                    }
                    if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
                        dispatch({ type: 'SET_REPO_SUB_TAB', tab: parts[2] as RepoSubTab });
                    }
                    // Workflow deep-link handling
                    if (parts[2] === 'workflows' && parts[3]) {
                        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: decodeURIComponent(parts[3]) });
                        // Workflow run detail: #repos/:id/workflows/:name/run/:processId
                        if (parts[4] === 'run' && parts[5]) {
                            dispatch({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: decodeURIComponent(parts[5]) });
                        } else {
                            dispatch({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
                        }
                    } else if (parts[2] === 'workflows') {
                        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
                        dispatch({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
                    } else if (parts[2] && parts[2] !== 'workflows') {
                        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
                        dispatch({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
                    }
                    // Schedule deep-link handling: #repos/{id}/schedules/{scheduleId}
                    if (parts[2] === 'schedules' && parts[3]) {
                        dispatch({ type: 'SET_SELECTED_SCHEDULE', id: decodeURIComponent(parts[3]) });
                    } else if (parts[2] === 'schedules') {
                        dispatch({ type: 'SET_SELECTED_SCHEDULE', id: null });
                    }
                    // Activity deep-link handling — select queue task when task ID present
                    if (parts[2] === 'activity' && parts[3]) {
                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: decodeURIComponent(parts[3]), repoId });
                    } else if (parts[2] === 'activity') {
                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId });
                    }
                    // Git commit deep-link handling
                    if (parts[2] === 'git' && parts[3]) {
                        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: decodeURIComponent(parts[3]) });
                        if (parts[4]) {
                            dispatch({ type: 'SET_GIT_FILE_PATH', filePath: decodeURIComponent(parts[4]) });
                        } else {
                            dispatch({ type: 'CLEAR_GIT_FILE_PATH' });
                        }
                    } else if (parts[2] === 'git') {
                        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: null });
                        dispatch({ type: 'CLEAR_GIT_FILE_PATH' });
                    }
                    // Wiki deep-link: #repos/{id}/wiki/{wikiId} and deeper paths
                    if (parts[2] === 'wiki' && parts[3]) {
                        const wikiId = decodeURIComponent(parts[3]);
                        if (parts[4] === 'component' && parts[5]) {
                            dispatch({
                                type: 'SET_REPO_WIKI_DEEP_LINK',
                                wikiId,
                                tab: 'browse',
                                componentId: decodeURIComponent(parts[5]),
                            });
                        } else if (parts[4] && VALID_WIKI_PROJECT_TABS.has(parts[4])) {
                            const tab = parts[4] as WikiProjectTab;
                            let adminTab: WikiAdminTab | null = null;
                            if (tab === 'admin' && parts[5] && VALID_WIKI_ADMIN_TABS.has(parts[5])) {
                                adminTab = parts[5] as WikiAdminTab;
                            }
                            dispatch({ type: 'SET_REPO_WIKI_DEEP_LINK', wikiId, tab, adminTab });
                        } else {
                            dispatch({ type: 'SET_REPO_WIKI_ID', wikiId });
                        }
                    } else if (parts[2] === 'wiki') {
                        dispatch({ type: 'SET_REPO_WIKI_ID', wikiId: null });
                    }
                    // Workflow detail deep-link: #repos/{id}/workflow/{processId}
                    if (parts[2] === 'workflow' && parts[3]) {
                        dispatch({ type: 'SET_WORKFLOW_PROCESS', processId: decodeURIComponent(parts[3]) });
                    } else if (parts[2] === 'workflow') {
                        dispatch({ type: 'SET_WORKFLOW_PROCESS', processId: null });
                    }
                    // Explorer deep-link: #repos/{id}/explorer/{path}
                    if (parts[2] === 'explorer' && parts[3]) {
                        dispatch({ type: 'SET_EXPLORER_PATH', path: decodeURIComponent(parts.slice(3).join('/')) });
                    } else if (parts[2] === 'explorer') {
                        dispatch({ type: 'SET_EXPLORER_PATH', path: null });
                    }
                    // Pull-requests deep-link: #repos/{id}/pull-requests and #repos/{id}/pull-requests/{prNumber}
                    if (parts[2] === 'pull-requests' && parts[3]) {
                        dispatch({ type: 'SET_SELECTED_PR', prId: decodeURIComponent(parts[3]) });
                    } else if (parts[2] === 'pull-requests') {
                        dispatch({ type: 'CLEAR_SELECTED_PR' });
                    }
                }
            }

            // Parse wiki deep links: #wiki/:id, #wiki/:id/:tab, #wiki/:id/component/:compId
            if (tab === 'wiki') {
                const wikiLink = parseWikiDeepLink('#' + hash);
                if (wikiLink.wikiId) {
                    if (wikiLink.tab) {
                        dispatch({ type: 'SELECT_WIKI_WITH_TAB', wikiId: wikiLink.wikiId, tab: wikiLink.tab, adminTab: wikiLink.adminTab, componentId: wikiLink.componentId });
                    } else {
                        dispatch({ type: 'SELECT_WIKI', wikiId: wikiLink.wikiId });
                    }
                } else {
                    dispatch({ type: 'SELECT_WIKI', wikiId: null });
                }
            }

            // Parse memory sub-tab deep links: #memory/:subTab
            if (tab === 'memory') {
                const parts = hash.split('/');
                if (parts.length >= 2 && (parts[1] === 'entries' || parts[1] === 'config')) {
                    dispatch({ type: 'SET_MEMORY_SUB_TAB', tab: parts[1] as MemorySubTab });
                }
            }

            // Parse skills sub-tab deep links: #skills/:subTab
            if (tab === 'skills') {
                const parts = hash.split('/');
                if (parts.length >= 2 && (parts[1] === 'installed' || parts[1] === 'bundled' || parts[1] === 'config')) {
                    dispatch({ type: 'SET_SKILLS_SUB_TAB', tab: parts[1] as SkillsSubTab });
                }
            }
        };
        handleHash();
        window.addEventListener('hashchange', handleHash);
        return () => window.removeEventListener('hashchange', handleHash);
    }, [dispatch, queueDispatch]);

    // Keyboard shortcuts for repo sub-tabs:
    //   Alt+<letter> → switches to the corresponding sub-tab (see REPO_TAB_SHORTCUTS)
    //   bare W       → switches to the wiki sub-tab (legacy shortcut, preserved)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
            if (state.activeTab !== 'repos' || !state.selectedRepoId) return;

            if (e.altKey && !e.ctrlKey && !e.metaKey) {
                const tab = REPO_TAB_SHORTCUTS[e.key.toLowerCase()];
                if (tab) {
                    e.preventDefault();
                    dispatch({ type: 'SET_REPO_SUB_TAB', tab });
                    const suffix = tab !== 'info' ? '/' + tab : '';
                    location.hash = '#repos/' + encodeURIComponent(state.selectedRepoId) + suffix;
                }
                return;
            }

            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                if (e.key === 'w' || e.key === 'W') {
                    dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
                    location.hash = '#repos/' + encodeURIComponent(state.selectedRepoId) + '/wiki';
                }
                if (e.key === 'a' || e.key === 'A') {
                    dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
                    location.hash = '#repos/' + encodeURIComponent(state.selectedRepoId) + '/activity';
                }
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [dispatch, state.activeTab, state.selectedRepoId]);

    switch (state.activeTab) {
        case 'processes':
            return <ProcessesView />;
        case 'repos':
            return <ReposView />;
        case 'wiki':
            return <WikiView />;
        case 'memory':
            return (
                <Suspense fallback={<div className="flex items-center justify-center h-full text-[#888]">Loading…</div>}>
                    <MemoryView />
                </Suspense>
            );
        case 'skills':
            return (
                <Suspense fallback={<div className="flex items-center justify-center h-full text-[#888]">Loading…</div>}>
                    <SkillsView />
                </Suspense>
            );
        case 'admin':
            return (
                <Suspense fallback={<div className="flex items-center justify-center h-full text-[#888]">Loading…</div>}>
                    <AdminPanel />
                </Suspense>
            );
        case 'logs':
            return (
                <Suspense fallback={<div className="flex items-center justify-center h-full text-[#888]">Loading…</div>}>
                    <LogsView />
                </Suspense>
            );
        case 'reports':
            return <StubView id="view-reports" label="Reports" />;
        default:
            return <ReposView />;
    }
}
