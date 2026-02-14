/**
 * Filter script: search, status/type filter, workspace dropdown handlers.
 */
export function getFiltersScript(): string {
    return `
        // ================================================================
        // Filters
        // ================================================================

        function debounce(fn, ms) {
            var timer;
            return function() {
                var args = arguments;
                var ctx = this;
                clearTimeout(timer);
                timer = setTimeout(function() { fn.apply(ctx, args); }, ms);
            };
        }

        function populateWorkspaces(workspaces) {
            var select = document.getElementById('workspace-select');
            if (!select) return;
            // Keep first "All Workspaces" option, remove the rest
            while (select.options.length > 1) {
                select.remove(1);
            }
            workspaces.forEach(function(ws) {
                var opt = document.createElement('option');
                opt.value = ws.id;
                opt.textContent = ws.name || ws.path || ws.id;
                select.appendChild(opt);
            });
        }

        // Search
        var searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', debounce(function(e) {
                appState.searchQuery = e.target.value;
                renderProcessList();
            }, 200));
        }

        // Status filter
        var statusFilter = document.getElementById('status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', function(e) {
                appState.statusFilter = e.target.value;
                renderProcessList();
            });
        }

        // Type filter
        var typeFilter = document.getElementById('type-filter');
        if (typeFilter) {
            typeFilter.addEventListener('change', function(e) {
                appState.typeFilter = e.target.value;
                renderProcessList();
            });
        }

        // Workspace filter
        var wsSelect = document.getElementById('workspace-select');
        if (wsSelect) {
            wsSelect.addEventListener('change', function(e) {
                appState.workspace = e.target.value;
                var path = appState.workspace === '__all' ? '/processes' : '/processes?workspace=' + encodeURIComponent(appState.workspace);
                fetchApi(path).then(function(data) {
                    if (data && Array.isArray(data)) {
                        appState.processes = data;
                    }
                    appState.selectedId = null;
                    clearDetail();
                    renderProcessList();
                });
            });
        }
`;
}
