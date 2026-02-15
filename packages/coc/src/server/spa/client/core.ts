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
        if (wsRes && wsRes.workspaces) {
            appState.workspaces = wsRes.workspaces;
            populateWorkspaces(wsRes.workspaces);
        } else if (wsRes && Array.isArray(wsRes)) {
            appState.workspaces = wsRes;
            populateWorkspaces(wsRes);
        }
        const pRes = await fetchApi('/processes');
        if (pRes && Array.isArray(pRes)) {
            appState.processes = pRes;
        }
        renderProcessList();

        // Backward compat: redirect old /process/:id paths to hash route
        const pathMatch = location.pathname.match(/^\/process\/(.+)$/);
        if (pathMatch) {
            location.replace('#process/' + pathMatch[1]);
            return;
        }

        // Handle initial hash route (or default to #processes)
        handleHashChange();
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
// Hash-based routing
// ================================================================

let _hashChangeGuard = false;

export function setHashSilent(hash: string): void {
    _hashChangeGuard = true;
    location.hash = hash;
    // Guard is reset asynchronously after the hashchange event fires
    setTimeout(() => { _hashChangeGuard = false; }, 0);
}

export function handleHashChange(): void {
    if (_hashChangeGuard) return;

    const hash = location.hash.replace(/^#/, '');

    // #process/{id}
    const processMatch = hash.match(/^process\/(.+)$/);
    if (processMatch) {
        (window as any).switchTab?.('processes');
        selectProcess(decodeURIComponent(processMatch[1]));
        return;
    }

    // #session/{sdkSessionId} — resolve session ID to process, then navigate
    const sessionMatch = hash.match(/^session\/(.+)$/);
    if (sessionMatch) {
        (window as any).switchTab?.('processes');
        resolveSession(decodeURIComponent(sessionMatch[1]));
        return;
    }

    // #repos/{id}/tasks or #repos/{id}/pipelines
    const repoSubTabMatch = hash.match(/^repos\/([^/]+)\/(tasks|pipelines|info)$/);
    if (repoSubTabMatch) {
        (window as any).switchTab?.('repos');
        (window as any).showRepoDetail?.(decodeURIComponent(repoSubTabMatch[1]), repoSubTabMatch[2]);
        return;
    }

    // #repos/{id}
    const repoMatch = hash.match(/^repos\/([^/]+)$/);
    if (repoMatch) {
        (window as any).switchTab?.('repos');
        (window as any).showRepoDetail?.(decodeURIComponent(repoMatch[1]));
        return;
    }

    // #tasks — backward compat: redirect to #repos
    if (hash === 'tasks') {
        setHashSilent('#repos');
        (window as any).switchTab?.('repos');
        return;
    }

    // #repos
    if (hash === 'repos') {
        (window as any).switchTab?.('repos');
        return;
    }

    // #reports
    if (hash === 'reports') {
        (window as any).switchTab?.('reports');
        return;
    }

    // #processes or default
    if (hash !== 'processes') {
        setHashSilent('#processes');
    }
    (window as any).switchTab?.('processes');
    appState.selectedId = null;
    clearDetail();
    updateActiveItem();
}

window.addEventListener('hashchange', function() {
    handleHashChange();
});

export function navigateToProcess(id: string): void {
    location.hash = '#process/' + encodeURIComponent(id);
}

export function navigateToSession(sdkSessionId: string): void {
    location.hash = '#session/' + encodeURIComponent(sdkSessionId);
}

async function resolveSession(sdkSessionId: string): Promise<void> {
    // First try local lookup
    const local = appState.processes.find(function(p: any) { return p.sdkSessionId === sdkSessionId; });
    if (local) {
        selectProcess(local.id);
        return;
    }
    // Fallback: fetch from API
    const data = await fetchApi('/processes?sdkSessionId=' + encodeURIComponent(sdkSessionId));
    if (data && data.process) {
        selectProcess(data.process.id);
    } else {
        clearDetail();
    }
}

export function navigateToHome(): void {
    location.hash = '#processes';
}

(window as any).navigateToProcess = navigateToProcess;
(window as any).navigateToSession = navigateToSession;
(window as any).navigateToHome = navigateToHome;
(window as any).appState = appState;
