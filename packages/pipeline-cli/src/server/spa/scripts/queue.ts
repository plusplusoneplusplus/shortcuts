/**
 * Queue panel script: queue task rendering, controls, enqueue dialog.
 */

import type { ScriptOptions } from '../types';

export function getQueueScript(opts: ScriptOptions): string {
    return `
        // ================================================================
        // Queue — State & Rendering
        // ================================================================

        var queueState = {
            queued: [],
            running: [],
            history: [],
            stats: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false },
            showDialog: false,
            showHistory: false
        };

        async function fetchQueue() {
            try {
                var prevCompleted = queueState.stats ? (queueState.stats.completed || 0) : 0;
                var prevFailed = queueState.stats ? (queueState.stats.failed || 0) : 0;

                var data = await fetchApi('/queue');
                if (data) {
                    queueState.queued = data.queued || [];
                    queueState.running = data.running || [];
                    queueState.stats = data.stats || queueState.stats;
                }
                // Also fetch history
                var historyData = await fetchApi('/queue/history');
                if (historyData) {
                    queueState.history = historyData.history || [];
                }

                // Auto-expand history when new tasks complete or fail
                var newCompleted = queueState.stats.completed || 0;
                var newFailed = queueState.stats.failed || 0;
                if (newCompleted > prevCompleted || newFailed > prevFailed) {
                    queueState.showHistory = true;
                }

                renderQueuePanel();

                // Start/stop polling based on active tasks
                var hasActive = (queueState.stats.queued > 0 || queueState.stats.running > 0);
                if (hasActive) {
                    startQueuePolling();
                } else {
                    stopQueuePolling();
                }
            } catch(e) {}
        }

        function renderQueuePanel() {
            var panel = document.getElementById('queue-panel');
            if (!panel) return;

            var stats = queueState.stats;
            var totalActive = stats.queued + stats.running;

            // Queue header with count and controls
            var html = '<div class="queue-header">' +
                '<div class="queue-header-left">' +
                    '<span class="queue-title">Queue</span>' +
                    (totalActive > 0 ? ' <span class="queue-count">' + totalActive + '</span>' : '') +
                    (stats.isPaused ? ' <span class="queue-paused-badge">Paused</span>' : '') +
                '</div>' +
                '<div class="queue-header-right">' +
                    '<button class="queue-ctrl-btn" onclick="showEnqueueDialog()" title="Add task">+</button>' +
                    (stats.isPaused
                        ? '<button class="queue-ctrl-btn" onclick="queueResume()" title="Resume">&#9654;</button>'
                        : '<button class="queue-ctrl-btn" onclick="queuePause()" title="Pause">&#9646;&#9646;</button>') +
                    (stats.queued > 0 ? '<button class="queue-ctrl-btn queue-ctrl-danger" onclick="queueClear()" title="Clear queue">&#128465;</button>' : '') +
                '</div>' +
            '</div>';

            // Running tasks
            if (queueState.running.length > 0) {
                html += '<div class="queue-section-label">Running <span class="queue-section-count">' + queueState.running.length + '</span></div>';
                queueState.running.forEach(function(task) {
                    html += renderQueueTask(task, false);
                });
            }

            // Queued tasks
            if (queueState.queued.length > 0) {
                html += '<div class="queue-section-label">Waiting <span class="queue-section-count">' + queueState.queued.length + '</span></div>';
                queueState.queued.forEach(function(task, index) {
                    html += renderQueueTask(task, true, index);
                });
            }

            // Empty state
            if (totalActive === 0) {
                html += '<div class="queue-empty">' +
                    '<div class="queue-empty-text">No tasks in queue</div>' +
                    '<button class="queue-add-btn" onclick="showEnqueueDialog()">+ Add Task</button>' +
                '</div>';
            }

            // History section (completed/failed/cancelled)
            if (queueState.history.length > 0) {
                var historyCount = queueState.history.length;
                html += '<div class="queue-section-label queue-history-toggle" onclick="toggleQueueHistory()">' +
                    (queueState.showHistory ? '&#9660;' : '&#9654;') +
                    ' History <span class="queue-section-count">' + historyCount + '</span>' +
                    '<button class="queue-action-btn queue-action-danger queue-history-clear" onclick="event.stopPropagation(); queueClearHistory()" title="Clear history">&#128465;</button>' +
                '</div>';
                if (queueState.showHistory) {
                    queueState.history.forEach(function(task) {
                        html += renderQueueHistoryTask(task);
                    });
                }
            }

            panel.innerHTML = html;
        }

        function renderQueueTask(task, isQueued, index) {
            var name = task.displayName || task.type || 'Task';
            if (name.length > 35) name = name.substring(0, 35) + '...';

            var priorityIcon = { high: '\\u{1F525}', normal: '', low: '\\u{1F53D}' };
            var statusIcon = task.status === 'running' ? '\\u{1F504}' : '\\u23F3';
            var elapsed = '';
            if (task.status === 'running' && task.startedAt) {
                elapsed = formatDuration(Date.now() - task.startedAt);
            } else if (task.createdAt) {
                elapsed = formatRelativeTime(new Date(task.createdAt).toISOString());
            }

            var html = '<div class="queue-task ' + task.status + '" data-task-id="' + escapeHtmlClient(task.id) + '">' +
                '<div class="queue-task-row">' +
                    '<span class="queue-task-status">' + statusIcon + '</span>' +
                    (priorityIcon[task.priority] ? '<span class="queue-task-priority">' + priorityIcon[task.priority] + '</span>' : '') +
                    '<span class="queue-task-name">' + escapeHtmlClient(name) + '</span>' +
                    '<span class="queue-task-time">' + elapsed + '</span>' +
                '</div>';

            // Action buttons for queued tasks
            if (isQueued) {
                html += '<div class="queue-task-actions">' +
                    (index > 0 ? '<button class="queue-action-btn" onclick="queueMoveUp(\\'' + escapeHtmlClient(task.id) + '\\')" title="Move up">&#9650;</button>' : '') +
                    '<button class="queue-action-btn" onclick="queueMoveToTop(\\'' + escapeHtmlClient(task.id) + '\\')" title="Move to top">&#9196;</button>' +
                    '<button class="queue-action-btn queue-action-danger" onclick="queueCancelTask(\\'' + escapeHtmlClient(task.id) + '\\')" title="Cancel">&#10005;</button>' +
                '</div>';
            } else {
                // Running task — show cancel only
                html += '<div class="queue-task-actions">' +
                    '<button class="queue-action-btn queue-action-danger" onclick="queueCancelTask(\\'' + escapeHtmlClient(task.id) + '\\')" title="Cancel">&#10005;</button>' +
                '</div>';
            }

            html += '</div>';
            return html;
        }

        function renderQueueHistoryTask(task) {
            var name = task.displayName || task.type || 'Task';
            if (name.length > 35) name = name.substring(0, 35) + '...';

            var statusIcon = task.status === 'completed' ? '\\u2705'
                : task.status === 'failed' ? '\\u274C'
                : '\\u{1F6AB}'; // cancelled
            var elapsed = '';
            if (task.completedAt) {
                elapsed = formatRelativeTime(new Date(task.completedAt).toISOString());
            }
            var duration = '';
            if (task.startedAt && task.completedAt) {
                duration = ' (' + formatDuration(task.completedAt - task.startedAt) + ')';
            }

            var html = '<div class="queue-task queue-history-task ' + task.status + '" data-task-id="' + escapeHtmlClient(task.id) + '">' +
                '<div class="queue-task-row">' +
                    '<span class="queue-task-status">' + statusIcon + '</span>' +
                    '<span class="queue-task-name">' + escapeHtmlClient(name) + '</span>' +
                    '<span class="queue-task-time">' + elapsed + duration + '</span>' +
                '</div>';

            if (task.error) {
                html += '<div class="queue-task-error">' + escapeHtmlClient(task.error.length > 80 ? task.error.substring(0, 77) + '...' : task.error) + '</div>';
            }

            html += '</div>';
            return html;
        }

        function toggleQueueHistory() {
            queueState.showHistory = !queueState.showHistory;
            renderQueuePanel();
        }

        // ================================================================
        // Queue — API Actions
        // ================================================================

        async function queuePause() {
            await fetch(API_BASE + '/queue/pause', { method: 'POST' });
            fetchQueue();
        }

        async function queueResume() {
            await fetch(API_BASE + '/queue/resume', { method: 'POST' });
            fetchQueue();
        }

        async function queueClear() {
            if (!confirm('Clear all queued tasks?')) return;
            await fetch(API_BASE + '/queue', { method: 'DELETE' });
            fetchQueue();
        }

        async function queueClearHistory() {
            if (!confirm('Clear queue history?')) return;
            await fetch(API_BASE + '/queue/history', { method: 'DELETE' });
            fetchQueue();
        }

        async function queueCancelTask(taskId) {
            await fetch(API_BASE + '/queue/' + encodeURIComponent(taskId), { method: 'DELETE' });
            fetchQueue();
        }

        async function queueMoveToTop(taskId) {
            await fetch(API_BASE + '/queue/' + encodeURIComponent(taskId) + '/move-to-top', { method: 'POST' });
            fetchQueue();
        }

        async function queueMoveUp(taskId) {
            await fetch(API_BASE + '/queue/' + encodeURIComponent(taskId) + '/move-up', { method: 'POST' });
            fetchQueue();
        }

        async function queueMoveDown(taskId) {
            await fetch(API_BASE + '/queue/' + encodeURIComponent(taskId) + '/move-down', { method: 'POST' });
            fetchQueue();
        }

        // ================================================================
        // Queue — Enqueue Dialog
        // ================================================================

        function showEnqueueDialog() {
            var overlay = document.getElementById('enqueue-overlay');
            if (overlay) {
                overlay.classList.remove('hidden');
                var nameInput = document.getElementById('enqueue-name');
                if (nameInput) nameInput.focus();
            }
        }

        function hideEnqueueDialog() {
            var overlay = document.getElementById('enqueue-overlay');
            if (overlay) overlay.classList.add('hidden');
        }

        async function submitEnqueueForm(e) {
            if (e) e.preventDefault();

            var nameInput = document.getElementById('enqueue-name');
            var typeSelect = document.getElementById('enqueue-type');
            var prioritySelect = document.getElementById('enqueue-priority');
            var promptInput = document.getElementById('enqueue-prompt');

            var displayName = nameInput ? nameInput.value.trim() : '';
            var type = typeSelect ? typeSelect.value : 'custom';
            var priority = prioritySelect ? prioritySelect.value : 'normal';
            var prompt = promptInput ? promptInput.value.trim() : '';

            var payload = type === 'ai-clarification'
                ? { prompt: prompt || displayName || 'AI clarification task' }
                : type === 'follow-prompt'
                    ? { promptFilePath: prompt || '', workingDirectory: '' }
                    : { data: { prompt: prompt || displayName || '' } };

            var body = {
                type: type,
                priority: priority,
                payload: payload,
                config: {}
            };
            // Only include displayName if user provided one; server auto-generates otherwise
            if (displayName) {
                body.displayName = displayName;
            }

            try {
                await fetch(API_BASE + '/queue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                hideEnqueueDialog();
                // Clear form
                if (nameInput) nameInput.value = '';
                if (promptInput) promptInput.value = '';
                fetchQueue();
                // Start polling to track task progress
                startQueuePolling();
            } catch(err) {
                alert('Failed to enqueue task');
            }
        }

        // Initialize queue on load
        fetchQueue();

        // Periodic queue polling fallback (in case WebSocket messages are missed)
        var queuePollInterval = null;

        function startQueuePolling() {
            if (queuePollInterval) return;
            queuePollInterval = setInterval(function() {
                var hasActive = (queueState.stats.queued > 0 || queueState.stats.running > 0);
                if (hasActive) {
                    fetchQueue();
                } else {
                    // No active tasks — stop polling
                    stopQueuePolling();
                }
            }, 3000);
        }

        function stopQueuePolling() {
            if (queuePollInterval) {
                clearInterval(queuePollInterval);
                queuePollInterval = null;
            }
        }

        // Enqueue dialog event listeners
        var enqueueForm = document.getElementById('enqueue-form');
        if (enqueueForm) {
            enqueueForm.addEventListener('submit', submitEnqueueForm);
        }
        var enqueueCancelBtn = document.getElementById('enqueue-cancel');
        if (enqueueCancelBtn) {
            enqueueCancelBtn.addEventListener('click', hideEnqueueDialog);
        }
        var enqueueOverlay = document.getElementById('enqueue-overlay');
        if (enqueueOverlay) {
            enqueueOverlay.addEventListener('click', function(e) {
                if (e.target === enqueueOverlay) hideEnqueueDialog();
            });
        }
`;
}
