/**
 * Core initialization script: global state, init(), routing, fetchApi.
 */

import { getApiBase } from './config';
import { appState } from './state';
import { initTheme } from './theme';
import { populateWorkspaces } from './filters';
import { renderProcessList, selectProcess, updateActiveItem } from './sidebar';
import { clearDetail } from './detail';

export async function init(): Promise<void> {
    try {
        initTheme();
        const wsRes = await fetchApi('/workspaces');
        if (wsRes && Array.isArray(wsRes)) {
            populateWorkspaces(wsRes);
        }
        const pRes = await fetchApi('/processes');
        if (pRes && Array.isArray(pRes)) {
            appState.processes = pRes;
        }
        renderProcessList();

        // Deep link support
        const pathMatch = location.pathname.match(/^\/process\/(.+)$/);
        if (pathMatch) {
            selectProcess(decodeURIComponent(pathMatch[1]));
        }
    } catch(err) {
        // silently fail init
    }
}

export function getFilteredProcesses(): any[] {
    let filtered = appState.processes.filter(function(p: any) {
        if (p.parentProcessId) return false;
        if (appState.workspace !== '__all' && p.workspaceId !== appState.workspace) return false;
        if (appState.statusFilter !== '__all' && p.status !== appState.statusFilter) return false;
        if (appState.typeFilter !== '__all' && p.type !== appState.typeFilter) return false;
        if (appState.searchQuery) {
            const q = appState.searchQuery.toLowerCase();
            const title = (p.promptPreview || p.id || '').toLowerCase();
            if (title.indexOf(q) === -1) return false;
        }
        return true;
    });

    const statusOrder: Record<string, number> = { running: 0, queued: 1, failed: 2, completed: 3, cancelled: 4 };
    filtered.sort(function(a: any, b: any) {
        const sa = statusOrder[a.status] != null ? statusOrder[a.status] : 5;
        const sb = statusOrder[b.status] != null ? statusOrder[b.status] : 5;
        if (sa !== sb) return sa - sb;
        return new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime();
    });

    return filtered;
}

export async function fetchApi(path: string): Promise<any> {
    try {
        const res = await fetch(getApiBase() + path);
        if (!res.ok) return null;
        return await res.json();
    } catch(e) {
        return null;
    }
}

// ================================================================
// Routing
// ================================================================

window.addEventListener('popstate', function(e: PopStateEvent) {
    const state = e.state;
    if (!state || !state.processId) {
        appState.selectedId = null;
        clearDetail();
        updateActiveItem();
    } else {
        selectProcess(state.processId);
    }
});

export function navigateToProcess(id: string): void {
    history.pushState({ processId: id }, '', '/process/' + encodeURIComponent(id));
    selectProcess(id);
}

export function navigateToHome(): void {
    history.pushState({}, '', '/');
    appState.selectedId = null;
    clearDetail();
    updateActiveItem();
}

(window as any).navigateToProcess = navigateToProcess;
(window as any).appState = appState;
