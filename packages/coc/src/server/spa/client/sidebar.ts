/**
 * Sidebar script: process list rendering, status grouping, live timers,
 * and Active/History view mode toggle.
 */

import { appState } from './state';
import type { ProcessViewMode } from './state';
import { getApiBase } from './config';
import {
    formatDuration, formatRelativeTime, statusIcon, statusLabel,
    typeLabel, escapeHtmlClient,
} from './utils';
import { getFilteredProcesses, fetchApi, navigateToProcess } from './core';
import { renderDetail } from './detail';

const STATUS_ORDER = ['running', 'queued', 'failed', 'completed', 'cancelled'];
const HISTORY_STATUSES = ['completed', 'failed', 'cancelled'];
const ACTIVE_STATUSES = ['running', 'queued'];

/** Maximum conversation cache entries. */
const MAX_CACHE_ENTRIES = 50;
/** Cache TTL: 1 hour. */
const CACHE_TTL_MS = 60 * 60 * 1000;

export function renderProcessList(): void {
    if (appState.viewMode === 'history') {
        renderHistoryList();
    } else {
        renderActiveList();
    }
}

function renderActiveList(): void {
    const container = document.getElementById('process-list');
    const emptyState = document.getElementById('empty-state');
    if (!container) return;

    const filtered = getFilteredProcesses();
    stopLiveTimers();

    clearProcessListContainer(container);

    if (filtered.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    // Group by status
    const groups: Record<string, any[]> = {};
    STATUS_ORDER.forEach(function(s) { groups[s] = []; });
    filtered.forEach(function(p: any) {
        const s = p.status || 'queued';
        if (!groups[s]) groups[s] = [];
        groups[s].push(p);
    });

    STATUS_ORDER.forEach(function(status) {
        const items = groups[status];
        if (!items || items.length === 0) return;

        // Group header
        const header = document.createElement('div');
        header.className = 'status-group-header';
        header.innerHTML = statusIcon(status) + ' ' +
            statusLabel(status) +
            ' <span class="status-group-count">' + items.length + '</span>';
        container.appendChild(header);

        // Items
        items.forEach(function(p: any) {
            renderProcessItem(p, container);
        });
    });

    startLiveTimers();
}

/** Clear all child elements from the process list except the empty-state element. */
function clearProcessListContainer(container: HTMLElement): void {
    const children = container.children;
    for (let i = children.length - 1; i >= 0; i--) {
        if (children[i].id !== 'empty-state') {
            container.removeChild(children[i]);
        }
    }
}

// ================================================================
// History List Rendering
// ================================================================

/** Group date label from a date string. */
function getDateGroup(dateStr: string): string {
    if (!dateStr) return 'Older';
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (itemDate.getTime() >= today.getTime()) return 'Today';
    if (itemDate.getTime() >= yesterday.getTime()) return 'Yesterday';
    if (itemDate.getTime() >= weekAgo.getTime()) return 'This Week';
    return 'Older';
}

/** Fetch history processes (lightweight, no conversation data). */
export async function fetchHistoryProcesses(): Promise<void> {
    const wsParam = appState.workspace !== '__all' ? '&workspace=' + encodeURIComponent(appState.workspace) : '';
    const data = await fetchApi('/processes?status=completed,failed,cancelled&exclude=conversation&limit=100' + wsParam);
    if (data && data.processes) {
        appState.historyProcesses = data.processes;
        appState.historyTotal = data.total || data.processes.length;
        appState.historyLoaded = true;
    }
}

/** Render the history view: compact list grouped by date. */
function renderHistoryList(): void {
    const container = document.getElementById('process-list');
    const emptyState = document.getElementById('empty-state');
    if (!container) return;

    stopLiveTimers();
    clearProcessListContainer(container);

    // Filter history by search query and type
    let filtered = appState.historyProcesses;
    if (appState.typeFilter !== '__all') {
        filtered = filtered.filter(function(p: any) { return p.type === appState.typeFilter; });
    }
    if (appState.searchQuery) {
        const q = appState.searchQuery.toLowerCase();
        filtered = filtered.filter(function(p: any) {
            return (p.promptPreview || p.id || '').toLowerCase().indexOf(q) !== -1;
        });
    }

    if (filtered.length === 0) {
        if (emptyState) {
            emptyState.classList.remove('hidden');
            const titleEl = emptyState.querySelector('.empty-state-title');
            const textEl = emptyState.querySelector('.empty-state-text');
            if (titleEl) titleEl.textContent = 'No history yet';
            if (textEl) textEl.textContent = 'Completed, failed, and cancelled processes will appear here.';
        }
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    // Group by date
    const dateGroups: Record<string, any[]> = {};
    const dateOrder = ['Today', 'Yesterday', 'This Week', 'Older'];
    dateOrder.forEach(function(g) { dateGroups[g] = []; });

    filtered.forEach(function(p: any) {
        const group = getDateGroup(p.endTime || p.startTime);
        if (!dateGroups[group]) dateGroups[group] = [];
        dateGroups[group].push(p);
    });

    dateOrder.forEach(function(dateLabel) {
        const items = dateGroups[dateLabel];
        if (!items || items.length === 0) return;

        const header = document.createElement('div');
        header.className = 'status-group-header history-date-header';
        header.innerHTML = '<span class="date-group-label">' + escapeHtmlClient(dateLabel) + '</span>' +
            ' <span class="status-group-count">' + items.length + '</span>';
        container.appendChild(header);

        items.forEach(function(p: any) {
            renderHistoryItem(p, container);
        });
    });

    // Show "Load More" button if there are more items
    if (appState.historyTotal > appState.historyProcesses.length) {
        const loadMoreDiv = document.createElement('div');
        loadMoreDiv.className = 'history-load-more';
        loadMoreDiv.innerHTML = '<button class="history-load-more-btn">Load More (' +
            (appState.historyTotal - appState.historyProcesses.length) + ' remaining)</button>';
        const btn = loadMoreDiv.querySelector('button');
        if (btn) {
            btn.addEventListener('click', function() {
                loadMoreHistory();
            });
        }
        container.appendChild(loadMoreDiv);
    }
}

/** Render a single compact history item. */
function renderHistoryItem(p: any, container: HTMLElement): void {
    let title = p.promptPreview || p.id || 'Untitled';
    if (title.length > 50) title = title.substring(0, 50) + '...';

    const wsId = p.workspaceId || (p.metadata && p.metadata.workspaceId) || '';
    const ws = wsId ? appState.workspaces.find(function(w: any) { return w.id === wsId; }) : null;
    const wsColor = ws && ws.color ? ws.color : '';
    const wsColorHtml = wsColor
        ? '<span class="repo-color-dot" style="background:' + escapeHtmlClient(wsColor) + ';width:6px;height:6px;display:inline-block;border-radius:50%;flex-shrink:0"></span>'
        : '';

    const div = document.createElement('div');
    div.className = 'process-item history-item' + (p.id === appState.selectedId ? ' active' : '');
    div.setAttribute('data-id', p.id);

    div.innerHTML =
        '<div class="process-item-row">' +
            '<span class="history-status-icon">' + statusIcon(p.status) + '</span>' +
            wsColorHtml +
            '<span class="title">' + escapeHtmlClient(title) + '</span>' +
        '</div>' +
        '<div class="meta">' +
            '<span class="type-badge">' + escapeHtmlClient(typeLabel(p.type)) + '</span>' +
            '<span class="time-label">' + formatRelativeTime(p.endTime || p.startTime) + '</span>' +
        '</div>';

    div.addEventListener('click', function() {
        navigateToProcess(p.id);
    });

    container.appendChild(div);
}

/** Load more history entries (pagination). */
async function loadMoreHistory(): Promise<void> {
    const offset = appState.historyProcesses.length;
    const wsParam = appState.workspace !== '__all' ? '&workspace=' + encodeURIComponent(appState.workspace) : '';
    const data = await fetchApi('/processes?status=completed,failed,cancelled&exclude=conversation&limit=100&offset=' + offset + wsParam);
    if (data && data.processes) {
        appState.historyProcesses = appState.historyProcesses.concat(data.processes);
        appState.historyTotal = data.total || appState.historyProcesses.length;
        renderHistoryList();
    }
}

/** Switch between active and history view modes. */
export function switchViewMode(mode: ProcessViewMode): void {
    if (appState.viewMode === mode) return;
    appState.viewMode = mode;

    // Update toggle buttons
    const activeBtn = document.getElementById('view-mode-active');
    const historyBtn = document.getElementById('view-mode-history');
    if (activeBtn) activeBtn.classList.toggle('active', mode === 'active');
    if (historyBtn) historyBtn.classList.toggle('active', mode === 'history');

    if (mode === 'history' && !appState.historyLoaded) {
        fetchHistoryProcesses().then(function() {
            renderProcessList();
        });
    } else {
        renderProcessList();
    }
}

/**
 * Cache conversation turns for a historical process.
 * Enforces max entries and TTL.
 */
export function cacheConversation(processId: string, turns: any[]): void {
    // Evict expired entries
    const now = Date.now();
    const keys = Object.keys(appState.conversationCache);
    for (let i = 0; i < keys.length; i++) {
        if (now - appState.conversationCache[keys[i]].cachedAt > CACHE_TTL_MS) {
            delete appState.conversationCache[keys[i]];
        }
    }

    // Evict oldest if over limit
    const cacheKeys = Object.keys(appState.conversationCache);
    if (cacheKeys.length >= MAX_CACHE_ENTRIES) {
        let oldestKey = cacheKeys[0];
        let oldestTime = appState.conversationCache[oldestKey].cachedAt;
        for (let i = 1; i < cacheKeys.length; i++) {
            if (appState.conversationCache[cacheKeys[i]].cachedAt < oldestTime) {
                oldestKey = cacheKeys[i];
                oldestTime = appState.conversationCache[cacheKeys[i]].cachedAt;
            }
        }
        delete appState.conversationCache[oldestKey];
    }

    appState.conversationCache[processId] = { turns: turns, cachedAt: now };
}

/** Get cached conversation turns, or null if not cached or expired. */
export function getCachedConversation(processId: string): any[] | null {
    const entry = appState.conversationCache[processId];
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        delete appState.conversationCache[processId];
        return null;
    }
    return entry.turns;
}

export function renderProcessItem(p: any, container: HTMLElement): void {
    const isGroup = p.type === 'code-review-group' || p.type === 'pipeline-execution';
    const isExpanded = appState.expandedGroups[p.id];
    let title = p.promptPreview || p.id || 'Untitled';
    if (title.length > 40) title = title.substring(0, 40) + '...';

    // Workspace color dot
    const wsId = p.workspaceId || (p.metadata && p.metadata.workspaceId) || '';
    const ws = wsId ? appState.workspaces.find(function(w: any) { return w.id === wsId; }) : null;
    const wsColor = ws && ws.color ? ws.color : '';
    const wsColorHtml = wsColor
        ? '<span class="repo-color-dot" style="background:' + escapeHtmlClient(wsColor) + ';width:6px;height:6px;display:inline-block;border-radius:50%;flex-shrink:0"></span>'
        : '';

    const div = document.createElement('div');
    div.className = 'process-item' + (p.id === appState.selectedId ? ' active' : '');
    div.setAttribute('data-id', p.id);
    div.innerHTML =
        '<div class="process-item-row">' +
            (isGroup ? '<span class="expand-chevron' + (isExpanded ? ' expanded' : '') + '" data-group-id="' + escapeHtmlClient(p.id) + '">&#9654;</span>' : '') +
            '<span class="status-dot ' + (p.status || 'queued') + '"></span>' +
            wsColorHtml +
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

    div.addEventListener('click', function(e: Event) {
        if ((e.target as HTMLElement).classList && (e.target as HTMLElement).classList.contains('expand-chevron')) return;
        navigateToProcess(p.id);
    });

    container.appendChild(div);

    // Expand chevron handler
    if (isGroup) {
        const chevron = div.querySelector('.expand-chevron');
        if (chevron) {
            chevron.addEventListener('click', function(e: Event) {
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

export function renderChildProcesses(parentId: string, container: HTMLElement): void {
    const children = appState.processes.filter(function(p: any) {
        return p.parentProcessId === parentId;
    });
    children.forEach(function(child: any) {
        let title = child.promptPreview || child.id || 'Untitled';
        if (title.length > 40) title = title.substring(0, 40) + '...';

        const div = document.createElement('div');
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

export function toggleGroup(id: string): void {
    appState.expandedGroups[id] = !appState.expandedGroups[id];
    renderProcessList();
}

export function startLiveTimers(): void {
    appState.processes.forEach(function(p: any) {
        if (p.status === 'running' && p.startTime) {
            appState.liveTimers[p.id] = setInterval(function() {
                const el = document.querySelector('[data-timer-id="' + p.id + '"]');
                if (el) {
                    el.textContent = formatDuration(Date.now() - new Date(p.startTime).getTime());
                }
            }, 1000);
        }
    });
}

export function stopLiveTimers(): void {
    Object.keys(appState.liveTimers).forEach(function(id) {
        clearInterval(appState.liveTimers[id]);
    });
    appState.liveTimers = {};
}

export function selectProcess(id: string): void {
    appState.selectedId = id;
    updateActiveItem();
    renderDetail(id);
}

export function updateActiveItem(): void {
    const items = document.querySelectorAll('.process-item');
    items.forEach(function(el) {
        if (el.getAttribute('data-id') === appState.selectedId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

// Clear completed button
const clearBtn = document.getElementById('clear-completed');
if (clearBtn) {
    clearBtn.addEventListener('click', function() {
        fetch(getApiBase() + '/processes/completed', { method: 'DELETE' })
            .then(function() {
                appState.processes = appState.processes.filter(function(p: any) {
                    return p.status !== 'completed';
                });
                if (appState.selectedId) {
                    const sel = appState.processes.find(function(p: any) { return p.id === appState.selectedId; });
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
const hamburgerBtn = document.getElementById('hamburger-btn');
if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', function() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.toggle('open');
    });
}

// View mode toggle buttons
const viewModeActive = document.getElementById('view-mode-active');
const viewModeHistory = document.getElementById('view-mode-history');
if (viewModeActive) {
    viewModeActive.addEventListener('click', function() {
        switchViewMode('active');
    });
}
if (viewModeHistory) {
    viewModeHistory.addEventListener('click', function() {
        switchViewMode('history');
    });
}

(window as any).switchViewMode = switchViewMode;
