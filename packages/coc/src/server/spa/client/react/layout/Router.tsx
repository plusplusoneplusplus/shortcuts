/**
 * Router — hash-based routing for the SPA tabs.
 * Reads activeTab from AppContext, renders the appropriate view.
 */

import { useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { ProcessesView } from '../processes/ProcessesView';
import { QueueView } from '../queue/QueueView';
import { ReposView } from '../repos';
import { AdminPanel } from '../admin/AdminPanel';
import { lazy, Suspense } from 'react';

const MemoryView = lazy(() => import('../views/memory/MemoryView').then(m => ({ default: m.MemoryView })));
import type { DashboardTab, RepoSubTab, WikiProjectTab, WikiAdminTab, MemorySubTab } from '../types/dashboard';

function StubView({ id, label }: { id: string; label: string }) {
    return <div id={id}>{label}</div>;
}

export function tabFromHash(hash: string): DashboardTab | null {
    const h = hash.replace(/^#/, '').split('/')[0];
    if (h === 'processes' || h === 'process' || h === 'session') return 'processes';
    if (h === 'repos' || h === 'tasks') return 'repos';
    if (h === 'admin') return 'admin';
    if (h === 'reports') return 'reports';
    if (h === 'memory') return 'memory';
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

export function parsePipelineDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'pipelines' && parts[3]) {
        return decodeURIComponent(parts[3]);
    }
    return null;
}

export function parsePipelineRunDeepLink(hash: string): { pipelineName: string; processId: string } | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'pipelines' && parts[3] && parts[4] === 'run' && parts[5]) {
        return {
            pipelineName: decodeURIComponent(parts[3]),
            processId: decodeURIComponent(parts[5]),
        };
    }
    return null;
}

export function parseQueueDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'queue' && parts[3]) {
        return decodeURIComponent(parts[3]);
    }
    return null;
}

export function parseChatDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'chat' && parts[3]) {
        return decodeURIComponent(parts[3]);
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

export const VALID_REPO_SUB_TABS: Set<string> = new Set(['info', 'git', 'pipelines', 'tasks', 'queue', 'schedules', 'chat', 'wiki', 'copilot', 'workflow']);

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
                    if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
                        dispatch({ type: 'SET_REPO_SUB_TAB', tab: parts[2] as RepoSubTab });
                    }
                    // Pipeline deep-link handling
                    if (parts[2] === 'pipelines' && parts[3]) {
                        dispatch({ type: 'SET_SELECTED_PIPELINE', name: decodeURIComponent(parts[3]) });
                        // Pipeline run detail: #repos/:id/pipelines/:name/run/:processId
                        if (parts[4] === 'run' && parts[5]) {
                            dispatch({ type: 'SET_PIPELINE_RUN_PROCESS', processId: decodeURIComponent(parts[5]) });
                        } else {
                            dispatch({ type: 'SET_PIPELINE_RUN_PROCESS', processId: null });
                        }
                    } else if (parts[2] === 'pipelines') {
                        dispatch({ type: 'SET_SELECTED_PIPELINE', name: null });
                        dispatch({ type: 'SET_PIPELINE_RUN_PROCESS', processId: null });
                    } else if (parts[2] && parts[2] !== 'pipelines') {
                        dispatch({ type: 'SET_SELECTED_PIPELINE', name: null });
                        dispatch({ type: 'SET_PIPELINE_RUN_PROCESS', processId: null });
                    }
                    // Queue task deep-link handling
                    if (parts[2] === 'queue' && parts[3]) {
                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: decodeURIComponent(parts[3]) });
                    } else if (parts[2] === 'queue') {
                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
                    }
                    // Chat session deep-link handling
                    if (parts[2] === 'chat' && parts[3]) {
                        dispatch({ type: 'SET_SELECTED_CHAT_SESSION', id: decodeURIComponent(parts[3]) });
                    } else if (parts[2] === 'chat') {
                        dispatch({ type: 'SET_SELECTED_CHAT_SESSION', id: null });
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
                }
            }

            // Parse memory sub-tab deep links: #memory/:subTab
            if (tab === 'memory') {
                const parts = hash.split('/');
                if (parts.length >= 2 && (parts[1] === 'entries' || parts[1] === 'config')) {
                    dispatch({ type: 'SET_MEMORY_SUB_TAB', tab: parts[1] as MemorySubTab });
                }
            }
        };
        handleHash();
        window.addEventListener('hashchange', handleHash);
        return () => window.removeEventListener('hashchange', handleHash);
    }, [dispatch, queueDispatch]);

    // Keyboard shortcut: C → jump to Chat sub-tab (only when Repos tab is active + a repo is selected)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (state.activeTab !== 'repos' || !state.selectedRepoId) return;
            if (e.key === 'c' || e.key === 'C') {
                dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chat' });
                location.hash = '#repos/' + encodeURIComponent(state.selectedRepoId) + '/chat';
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [dispatch, state.activeTab, state.selectedRepoId]);

    // Keyboard shortcut: W → jump to Wiki sub-tab (only when Repos tab is active + a repo is selected)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (state.activeTab !== 'repos' || !state.selectedRepoId) return;
            if (e.key === 'w' || e.key === 'W') {
                dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
                location.hash = '#repos/' + encodeURIComponent(state.selectedRepoId) + '/wiki';
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [dispatch, state.activeTab, state.selectedRepoId]);

    switch (state.activeTab) {
        case 'processes':
            return (
                <>
                    <ProcessesView />
                    <QueueView />
                </>
            );
        case 'repos':
            return <ReposView />;
        case 'admin':
            return <AdminPanel />;
        case 'memory':
            return (
                <Suspense fallback={<div className="flex items-center justify-center h-full text-[#888]">Loading…</div>}>
                    <MemoryView />
                </Suspense>
            );
        case 'reports':
            return <StubView id="view-reports" label="Reports" />;
        default:
            return <ReposView />;
    }
}
