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
import { WikiView } from '../wiki/WikiView';
import { AdminPanel } from '../admin/AdminPanel';
import type { DashboardTab, RepoSubTab } from '../types/dashboard';

function StubView({ id, label }: { id: string; label: string }) {
    return <div id={id}>{label}</div>;
}

export function tabFromHash(hash: string): DashboardTab | null {
    const h = hash.replace(/^#/, '').split('/')[0];
    if (h === 'processes' || h === 'process' || h === 'session') return 'processes';
    if (h === 'repos' || h === 'tasks') return 'repos';
    if (h === 'wiki') return 'wiki';
    if (h === 'admin') return 'admin';
    if (h === 'reports') return 'reports';
    return null;
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

export const VALID_REPO_SUB_TABS: Set<string> = new Set(['info', 'pipelines', 'tasks', 'queue', 'schedules', 'chat']);

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
            if (tab) dispatch({ type: 'SET_ACTIVE_TAB', tab });

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
                }
            }

            // Parse wiki deep links: #wiki/:id or #wiki/:id/component/:compId
            if (tab === 'wiki') {
                const parts = hash.split('/');
                if (parts.length >= 2 && parts[0] === 'wiki' && parts[1]) {
                    const wikiId = decodeURIComponent(parts[1]);
                    dispatch({ type: 'SELECT_WIKI', wikiId });
                    if (parts.length >= 4 && parts[2] === 'component' && parts[3]) {
                        const compId = decodeURIComponent(parts[3]);
                        dispatch({ type: 'SELECT_WIKI_COMPONENT', componentId: compId });
                    }
                }
            }
        };
        handleHash();
        window.addEventListener('hashchange', handleHash);
        return () => window.removeEventListener('hashchange', handleHash);
    }, [dispatch, queueDispatch]);

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
        case 'wiki':
            return <WikiView />;
        case 'admin':
            return <AdminPanel />;
        case 'reports':
            return <StubView id="view-reports" label="Reports" />;
        default:
            return <ReposView />;
    }
}
