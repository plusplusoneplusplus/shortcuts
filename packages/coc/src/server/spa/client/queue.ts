/**
 * Queue panel script: queue task rendering, controls, enqueue dialog.
 */

import { getApiBase } from './config';
import { queueState } from './state';
import { fetchApi } from './core';
import { formatDuration, formatRelativeTime, escapeHtmlClient } from './utils';
import { showQueueTaskDetail } from './detail';

export async function fetchQueue(): Promise<void> {
    try {
        const prevCompleted = queueState.stats ? (queueState.stats.completed || 0) : 0;
        const prevFailed = queueState.stats ? (queueState.stats.failed || 0) : 0;

        const data = await fetchApi('/queue');
        if (data) {
            queueState.queued = data.queued || [];
            queueState.running = data.running || [];
            queueState.stats = data.stats || queueState.stats;
        }
        // Also fetch history
        const historyData = await fetchApi('/queue/history');
        if (historyData) {
            queueState.history = historyData.history || [];
        }

        // Auto-expand history when new tasks complete or fail
        const newCompleted = queueState.stats.completed || 0;
        const newFailed = queueState.stats.failed || 0;
        if (newCompleted > prevCompleted || newFailed > prevFailed) {
            queueState.showHistory = true;
        }

        renderQueuePanel();

        // Start/stop polling based on active tasks
        const hasActive = (queueState.stats.queued > 0 || queueState.stats.running > 0);
        if (hasActive) {
            startQueuePolling();
        } else {
            stopQueuePolling();
        }
    } catch(e) {}
}

export function renderQueuePanel(): void {
    const panel = document.getElementById('queue-panel');
    if (!panel) return;

    const stats = queueState.stats;
    const totalActive = stats.queued + stats.running;

    // Queue header with count and controls
    let html = '<div class="queue-header">' +
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
        queueState.running.forEach(function(task: any) {
            html += renderQueueTask(task, false);
        });
    }

    // Queued tasks
    if (queueState.queued.length > 0) {
        html += '<div class="queue-section-label">Waiting <span class="queue-section-count">' + queueState.queued.length + '</span></div>';
        queueState.queued.forEach(function(task: any, index: number) {
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
        const historyCount = queueState.history.length;
        html += '<div class="queue-section-label queue-history-toggle" onclick="toggleQueueHistory()">' +
            (queueState.showHistory ? '&#9660;' : '&#9654;') +
            ' History <span class="queue-section-count">' + historyCount + '</span>' +
            '<button class="queue-action-btn queue-action-danger queue-history-clear" onclick="event.stopPropagation(); queueClearHistory()" title="Clear history">&#128465;</button>' +
        '</div>';
        if (queueState.showHistory) {
            queueState.history.forEach(function(task: any) {
                html += renderQueueHistoryTask(task);
            });
        }
    }

    panel.innerHTML = html;
}

export function renderQueueTask(task: any, isQueued: boolean, index?: number): string {
    let name = task.displayName || task.type || 'Task';
    if (name.length > 35) name = name.substring(0, 35) + '...';

    const priorityIcon: Record<string, string> = { high: '\u{1F525}', normal: '', low: '\u{1F53D}' };
    const statusIcn = task.status === 'running' ? '\u{1F504}' : '\u23F3';
    let elapsed = '';
    if (task.status === 'running' && task.startedAt) {
        elapsed = formatDuration(Date.now() - task.startedAt);
    } else if (task.createdAt) {
        elapsed = formatRelativeTime(new Date(task.createdAt).toISOString());
    }

    // Running tasks are clickable to view conversation
    const clickAttr = task.status === 'running'
        ? ' onclick="showQueueTaskDetail(\'' + escapeHtmlClient(task.id) + '\')" style="cursor:pointer"'
        : '';

    let html = '<div class="queue-task ' + task.status + '" data-task-id="' + escapeHtmlClient(task.id) + '"' + clickAttr + '>' +
        '<div class="queue-task-row">' +
            '<span class="queue-task-status">' + statusIcn + '</span>' +
            (priorityIcon[task.priority] ? '<span class="queue-task-priority">' + priorityIcon[task.priority] + '</span>' : '') +
            '<span class="queue-task-name">' + escapeHtmlClient(name) + '</span>' +
            '<span class="queue-task-time">' + elapsed + '</span>' +
        '</div>';

    // Action buttons for queued tasks
    if (isQueued) {
        html += '<div class="queue-task-actions">' +
            (index !== undefined && index > 0 ? '<button class="queue-action-btn" onclick="event.stopPropagation(); queueMoveUp(\'' + escapeHtmlClient(task.id) + '\')" title="Move up">&#9650;</button>' : '') +
            '<button class="queue-action-btn" onclick="event.stopPropagation(); queueMoveToTop(\'' + escapeHtmlClient(task.id) + '\')" title="Move to top">&#9196;</button>' +
            '<button class="queue-action-btn queue-action-danger" onclick="event.stopPropagation(); queueCancelTask(\'' + escapeHtmlClient(task.id) + '\')" title="Cancel">&#10005;</button>' +
        '</div>';
    } else {
        // Running task — show cancel only
        html += '<div class="queue-task-actions">' +
            '<button class="queue-action-btn queue-action-danger" onclick="event.stopPropagation(); queueCancelTask(\'' + escapeHtmlClient(task.id) + '\')" title="Cancel">&#10005;</button>' +
        '</div>';
    }

    html += '</div>';
    return html;
}

export function renderQueueHistoryTask(task: any): string {
    let name = task.displayName || task.type || 'Task';
    if (name.length > 35) name = name.substring(0, 35) + '...';

    const statusIcn = task.status === 'completed' ? '\u2705'
        : task.status === 'failed' ? '\u274C'
        : '\u{1F6AB}'; // cancelled
    let elapsed = '';
    if (task.completedAt) {
        elapsed = formatRelativeTime(new Date(task.completedAt).toISOString());
    }
    let duration = '';
    if (task.startedAt && task.completedAt) {
        duration = ' (' + formatDuration(task.completedAt - task.startedAt) + ')';
    }

    let html = '<div class="queue-task queue-history-task ' + task.status + '" data-task-id="' + escapeHtmlClient(task.id) + '"' +
        ' onclick="showQueueTaskDetail(\'' + escapeHtmlClient(task.id) + '\')" style="cursor:pointer">' +
        '<div class="queue-task-row">' +
            '<span class="queue-task-status">' + statusIcn + '</span>' +
            '<span class="queue-task-name">' + escapeHtmlClient(name) + '</span>' +
            '<span class="queue-task-time">' + elapsed + duration + '</span>' +
        '</div>';

    if (task.error) {
        html += '<div class="queue-task-error">' + escapeHtmlClient(task.error.length > 80 ? task.error.substring(0, 77) + '...' : task.error) + '</div>';
    }

    html += '</div>';
    return html;
}

export function toggleQueueHistory(): void {
    queueState.showHistory = !queueState.showHistory;
    renderQueuePanel();
}

// ================================================================
// Queue — API Actions
// ================================================================

export async function queuePause(): Promise<void> {
    await fetch(getApiBase() + '/queue/pause', { method: 'POST' });
    fetchQueue();
}

export async function queueResume(): Promise<void> {
    await fetch(getApiBase() + '/queue/resume', { method: 'POST' });
    fetchQueue();
}

export async function queueClear(): Promise<void> {
    if (!confirm('Clear all queued tasks?')) return;
    await fetch(getApiBase() + '/queue', { method: 'DELETE' });
    fetchQueue();
}

export async function queueClearHistory(): Promise<void> {
    if (!confirm('Clear queue history?')) return;
    await fetch(getApiBase() + '/queue/history', { method: 'DELETE' });
    fetchQueue();
}

export async function queueCancelTask(taskId: string): Promise<void> {
    await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId), { method: 'DELETE' });
    fetchQueue();
}

export async function queueMoveToTop(taskId: string): Promise<void> {
    await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/move-to-top', { method: 'POST' });
    fetchQueue();
}

export async function queueMoveUp(taskId: string): Promise<void> {
    await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/move-up', { method: 'POST' });
    fetchQueue();
}

export async function queueMoveDown(taskId: string): Promise<void> {
    await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/move-down', { method: 'POST' });
    fetchQueue();
}

// ================================================================
// Queue — Enqueue Dialog
// ================================================================

export function showEnqueueDialog(): void {
    const overlay = document.getElementById('enqueue-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        const nameInput = document.getElementById('enqueue-name');
        if (nameInput) nameInput.focus();
    }
}

export function hideEnqueueDialog(): void {
    const overlay = document.getElementById('enqueue-overlay');
    if (overlay) overlay.classList.add('hidden');
}

export async function submitEnqueueForm(e: Event): Promise<void> {
    if (e) e.preventDefault();

    const nameInput = document.getElementById('enqueue-name') as HTMLInputElement | null;
    const typeSelect = document.getElementById('enqueue-type') as HTMLSelectElement | null;
    const prioritySelect = document.getElementById('enqueue-priority') as HTMLSelectElement | null;
    const promptInput = document.getElementById('enqueue-prompt') as HTMLTextAreaElement | null;
    const modelSelect = document.getElementById('enqueue-model') as HTMLSelectElement | null;
    const cwdInput = document.getElementById('enqueue-cwd') as HTMLInputElement | null;

    const displayName = nameInput ? nameInput.value.trim() : '';
    const type = typeSelect ? typeSelect.value : 'custom';
    const priority = prioritySelect ? prioritySelect.value : 'normal';
    const prompt = promptInput ? promptInput.value.trim() : '';
    const model = modelSelect ? modelSelect.value : '';
    const cwd = cwdInput ? cwdInput.value.trim() : '';

    let payload: any = type === 'ai-clarification'
        ? { prompt: prompt || displayName || 'AI clarification task' }
        : type === 'follow-prompt'
            ? { promptFilePath: prompt || '' }
            : { data: { prompt: prompt || displayName || '' } };

    // Add workingDirectory to payload if provided
    if (cwd && (type === 'ai-clarification' || type === 'follow-prompt')) {
        payload.workingDirectory = cwd;
    } else if (cwd && type === 'custom') {
        payload.data = payload.data || {};
        payload.data.workingDirectory = cwd;
    }

    const config: any = {};
    if (model) {
        config.model = model;
    }

    const body: any = {
        type: type,
        priority: priority,
        payload: payload,
        config: config
    };
    // Only include displayName if user provided one; server auto-generates otherwise
    if (displayName) {
        body.displayName = displayName;
    }

    try {
        await fetch(getApiBase() + '/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        hideEnqueueDialog();
        // Clear form
        if (nameInput) nameInput.value = '';
        if (promptInput) promptInput.value = '';
        if (modelSelect) modelSelect.value = '';
        if (cwdInput) cwdInput.value = '';
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
let queuePollInterval: ReturnType<typeof setInterval> | null = null;

export function startQueuePolling(): void {
    if (queuePollInterval) return;
    queuePollInterval = setInterval(function() {
        const hasActive = (queueState.stats.queued > 0 || queueState.stats.running > 0);
        if (hasActive) {
            fetchQueue();
        } else {
            // No active tasks — stop polling
            stopQueuePolling();
        }
    }, 3000);
}

export function stopQueuePolling(): void {
    if (queuePollInterval) {
        clearInterval(queuePollInterval);
        queuePollInterval = null;
    }
}

// Enqueue dialog event listeners
const enqueueForm = document.getElementById('enqueue-form');
if (enqueueForm) {
    enqueueForm.addEventListener('submit', submitEnqueueForm);
}
const enqueueCancelBtn = document.getElementById('enqueue-cancel');
if (enqueueCancelBtn) {
    enqueueCancelBtn.addEventListener('click', hideEnqueueDialog);
}
const enqueueOverlay = document.getElementById('enqueue-overlay');
if (enqueueOverlay) {
    enqueueOverlay.addEventListener('click', function(e: Event) {
        if (e.target === enqueueOverlay) hideEnqueueDialog();
    });
}

(window as any).showEnqueueDialog = showEnqueueDialog;
(window as any).hideEnqueueDialog = hideEnqueueDialog;
(window as any).queuePause = queuePause;
(window as any).queueResume = queueResume;
(window as any).queueClear = queueClear;
(window as any).queueClearHistory = queueClearHistory;
(window as any).queueCancelTask = queueCancelTask;
(window as any).queueMoveUp = queueMoveUp;
(window as any).queueMoveToTop = queueMoveToTop;
(window as any).toggleQueueHistory = toggleQueueHistory;
(window as any).showQueueTaskDetail = showQueueTaskDetail;
