/**
 * Core initialization script: global state, init(), routing, fetchApi.
 */

import type { ScriptOptions } from '../types';

export function getCoreScript(opts: ScriptOptions): string {
    return `
        // ================================================================
        // Core — State & Initialization
        // ================================================================

        var API_BASE = '${opts.apiBasePath}';
        var WS_PATH = '${opts.wsPath}';

        var appState = {
            processes: [],
            selectedId: null,
            workspace: '__all',
            statusFilter: '__all',
            typeFilter: '__all',
            searchQuery: '',
            expandedGroups: {},
            liveTimers: {}
        };

        init();

        async function init() {
            try {
                initTheme();
                var wsRes = await fetchApi('/workspaces');
                if (wsRes && Array.isArray(wsRes)) {
                    populateWorkspaces(wsRes);
                }
                var pRes = await fetchApi('/processes');
                if (pRes && Array.isArray(pRes)) {
                    appState.processes = pRes;
                }
                renderProcessList();

                // Deep link support
                var pathMatch = location.pathname.match(/^\\/process\\/(.+)$/);
                if (pathMatch) {
                    selectProcess(decodeURIComponent(pathMatch[1]));
                }
            } catch(err) {
                // silently fail init
            }
        }

        function getFilteredProcesses() {
            var filtered = appState.processes.filter(function(p) {
                if (p.parentProcessId) return false;
                if (appState.workspace !== '__all' && p.workspaceId !== appState.workspace) return false;
                if (appState.statusFilter !== '__all' && p.status !== appState.statusFilter) return false;
                if (appState.typeFilter !== '__all' && p.type !== appState.typeFilter) return false;
                if (appState.searchQuery) {
                    var q = appState.searchQuery.toLowerCase();
                    var title = (p.promptPreview || p.id || '').toLowerCase();
                    if (title.indexOf(q) === -1) return false;
                }
                return true;
            });

            var statusOrder = { running: 0, queued: 1, failed: 2, completed: 3, cancelled: 4 };
            filtered.sort(function(a, b) {
                var sa = statusOrder[a.status] != null ? statusOrder[a.status] : 5;
                var sb = statusOrder[b.status] != null ? statusOrder[b.status] : 5;
                if (sa !== sb) return sa - sb;
                return new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime();
            });

            return filtered;
        }

        async function fetchApi(path) {
            try {
                var res = await fetch(API_BASE + path);
                if (!res.ok) return null;
                return await res.json();
            } catch(e) {
                return null;
            }
        }

        // ================================================================
        // Routing
        // ================================================================

        window.addEventListener('popstate', function(e) {
            var state = e.state;
            if (!state || !state.processId) {
                appState.selectedId = null;
                clearDetail();
                updateActiveItem();
            } else {
                selectProcess(state.processId);
            }
        });

        function navigateToProcess(id) {
            history.pushState({ processId: id }, '', '/process/' + encodeURIComponent(id));
            selectProcess(id);
        }

        function navigateToHome() {
            history.pushState({}, '', '/');
            appState.selectedId = null;
            clearDetail();
            updateActiveItem();
        }
`;
}
