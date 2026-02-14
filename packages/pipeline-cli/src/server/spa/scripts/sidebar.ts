/**
 * Sidebar script: process list rendering, status grouping, live timers.
 */
export function getSidebarScript(): string {
    return `
        // ================================================================
        // Sidebar — Process List
        // ================================================================

        var STATUS_ORDER = ['running', 'queued', 'failed', 'completed', 'cancelled'];

        function renderProcessList() {
            var container = document.getElementById('process-list');
            var emptyState = document.getElementById('empty-state');
            if (!container) return;

            var filtered = getFilteredProcesses();
            stopLiveTimers();

            // Clear existing items but keep empty state element
            var children = container.children;
            for (var i = children.length - 1; i >= 0; i--) {
                if (children[i].id !== 'empty-state') {
                    container.removeChild(children[i]);
                }
            }

            if (filtered.length === 0) {
                if (emptyState) emptyState.classList.remove('hidden');
                return;
            }

            if (emptyState) emptyState.classList.add('hidden');

            // Group by status
            var groups = {};
            STATUS_ORDER.forEach(function(s) { groups[s] = []; });
            filtered.forEach(function(p) {
                var s = p.status || 'queued';
                if (!groups[s]) groups[s] = [];
                groups[s].push(p);
            });

            STATUS_ORDER.forEach(function(status) {
                var items = groups[status];
                if (!items || items.length === 0) return;

                // Group header
                var header = document.createElement('div');
                header.className = 'status-group-header';
                header.innerHTML = statusIcon(status) + ' ' +
                    statusLabel(status) +
                    ' <span class="status-group-count">' + items.length + '</span>';
                container.appendChild(header);

                // Items
                items.forEach(function(p) {
                    renderProcessItem(p, container);
                });
            });

            startLiveTimers();
        }

        function renderProcessItem(p, container) {
            var isGroup = p.type === 'code-review-group' || p.type === 'pipeline-execution';
            var isExpanded = appState.expandedGroups[p.id];
            var title = p.promptPreview || p.id || 'Untitled';
            if (title.length > 40) title = title.substring(0, 40) + '...';

            var div = document.createElement('div');
            div.className = 'process-item' + (p.id === appState.selectedId ? ' active' : '');
            div.setAttribute('data-id', p.id);
            div.innerHTML =
                '<div class="process-item-row">' +
                    (isGroup ? '<span class="expand-chevron' + (isExpanded ? ' expanded' : '') + '" data-group-id="' + escapeHtmlClient(p.id) + '">&#9654;</span>' : '') +
                    '<span class="status-dot ' + (p.status || 'queued') + '"></span>' +
                    '<span class="title">' + escapeHtmlClient(title) + '</span>' +
                '</div>' +
                '<div class="meta">' +
                    '<span class="type-badge">' + escapeHtmlClient(typeLabel(p.type)) + '</span>' +
                    '<span class="time-label" data-timer-id="' + escapeHtmlClient(p.id) + '">' +
                        (p.status === 'running'
                            ? formatDuration(Date.now() - new Date(p.startTime).getTime())
                            : formatRelativeTime(p.startTime)) +
                    '</span>' +
                '</div>';

            div.addEventListener('click', function(e) {
                if (e.target.classList && e.target.classList.contains('expand-chevron')) return;
                navigateToProcess(p.id);
            });

            container.appendChild(div);

            // Expand chevron handler
            if (isGroup) {
                var chevron = div.querySelector('.expand-chevron');
                if (chevron) {
                    chevron.addEventListener('click', function(e) {
                        e.stopPropagation();
                        toggleGroup(p.id);
                    });
                }
            }

            // Render children if expanded
            if (isGroup && isExpanded) {
                renderChildProcesses(p.id, container);
            }
        }

        function renderChildProcesses(parentId, container) {
            var children = appState.processes.filter(function(p) {
                return p.parentProcessId === parentId;
            });
            children.forEach(function(child) {
                var title = child.promptPreview || child.id || 'Untitled';
                if (title.length > 40) title = title.substring(0, 40) + '...';

                var div = document.createElement('div');
                div.className = 'process-item child-item' + (child.id === appState.selectedId ? ' active' : '');
                div.setAttribute('data-id', child.id);
                div.innerHTML =
                    '<div class="process-item-row">' +
                        '<span class="status-dot ' + (child.status || 'queued') + '"></span>' +
                        '<span class="title">' + escapeHtmlClient(title) + '</span>' +
                    '</div>' +
                    '<div class="meta">' +
                        '<span class="type-badge">' + escapeHtmlClient(typeLabel(child.type)) + '</span>' +
                        '<span class="time-label">' + formatRelativeTime(child.startTime) + '</span>' +
                    '</div>';

                div.addEventListener('click', function() {
                    navigateToProcess(child.id);
                });

                container.appendChild(div);
            });
        }

        function toggleGroup(id) {
            appState.expandedGroups[id] = !appState.expandedGroups[id];
            renderProcessList();
        }

        function startLiveTimers() {
            appState.processes.forEach(function(p) {
                if (p.status === 'running' && p.startTime) {
                    appState.liveTimers[p.id] = setInterval(function() {
                        var el = document.querySelector('[data-timer-id="' + p.id + '"]');
                        if (el) {
                            el.textContent = formatDuration(Date.now() - new Date(p.startTime).getTime());
                        }
                    }, 1000);
                }
            });
        }

        function stopLiveTimers() {
            Object.keys(appState.liveTimers).forEach(function(id) {
                clearInterval(appState.liveTimers[id]);
            });
            appState.liveTimers = {};
        }

        function selectProcess(id) {
            appState.selectedId = id;
            updateActiveItem();
            renderDetail(id);
        }

        function updateActiveItem() {
            var items = document.querySelectorAll('.process-item');
            items.forEach(function(el) {
                if (el.getAttribute('data-id') === appState.selectedId) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            });
        }

        // Clear completed button
        var clearBtn = document.getElementById('clear-completed');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                fetch(API_BASE + '/processes/completed', { method: 'DELETE' })
                    .then(function() {
                        appState.processes = appState.processes.filter(function(p) {
                            return p.status !== 'completed';
                        });
                        if (appState.selectedId) {
                            var sel = appState.processes.find(function(p) { return p.id === appState.selectedId; });
                            if (!sel) {
                                appState.selectedId = null;
                                clearDetail();
                            }
                        }
                        renderProcessList();
                    });
            });
        }

        // Hamburger toggle for mobile
        var hamburgerBtn = document.getElementById('hamburger-btn');
        if (hamburgerBtn) {
            hamburgerBtn.addEventListener('click', function() {
                var sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.toggle('open');
            });
        }
`;
}
