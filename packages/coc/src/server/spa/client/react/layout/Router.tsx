/**
 * Router — hash-based routing for the SPA tabs.
 * Reads activeTab from AppContext, renders the appropriate view.
 */

import { useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { ProcessesView } from '../processes/ProcessesView';
import { QueueView } from '../queue/QueueView';
import type { DashboardTab } from '../types/dashboard';

function StubView({ id, label }: { id: string; label: string }) {
    return <div id={id}>{label}</div>;
}

function tabFromHash(hash: string): DashboardTab | null {
    const h = hash.replace(/^#/, '').split('/')[0];
    if (h === 'processes' || h === 'process' || h === 'session') return 'processes';
    if (h === 'repos' || h === 'tasks') return 'repos';
    if (h === 'wiki') return 'wiki';
    if (h === 'admin') return 'admin';
    if (h === 'reports') return 'reports';
    return null;
}

export function Router() {
    const { state, dispatch } = useApp();

    const switchTab = useCallback((tab: string) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: tab as DashboardTab });
    }, [dispatch]);

    // Register global switchTab for backward compat with legacy modules
    useEffect(() => {
        (window as any).switchTab = switchTab;
        return () => { delete (window as any).switchTab; };
    }, [switchTab]);

    // Handle hash changes
    useEffect(() => {
        const handleHash = () => {
            const tab = tabFromHash(location.hash);
            if (tab) dispatch({ type: 'SET_ACTIVE_TAB', tab });
        };
        // Initial hash parse
        handleHash();
        window.addEventListener('hashchange', handleHash);
        return () => window.removeEventListener('hashchange', handleHash);
    }, [dispatch]);

    switch (state.activeTab) {
        case 'processes':
            return (
                <>
                    <ProcessesView />
                    <QueueView />
                </>
            );
        case 'repos':
            return <StubView id="view-repos" label="Repos" />;
        case 'wiki':
            return <StubView id="view-wiki" label="Wiki" />;
        case 'admin':
            return <StubView id="view-admin" label="Admin" />;
        case 'reports':
            return <StubView id="view-reports" label="Reports" />;
        default:
            return <StubView id="view-repos" label="Repos" />;
    }
}
