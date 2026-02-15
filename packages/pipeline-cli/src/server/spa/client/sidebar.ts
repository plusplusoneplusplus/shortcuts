/**
 * Sidebar script: process list rendering, status grouping, live timers.
 */

import { appState } from './state';
import { getApiBase } from './config';
import {
    formatDuration, formatRelativeTime, statusIcon, statusLabel,
    typeLabel, escapeHtmlClient,
} from './utils';
import { getFilteredProcesses, fetchApi, navigateToProcess } from './core';
import { renderDetail } from './detail';

const STATUS_ORDER = ['running', 'queued', 'failed', 'completed', 'cancelled'];

export function renderProcessList(): void {
    const container = document.getElementById('process-list');
    const emptyState = document.getElementById('empty-state');
    if (!container) return;

    const filtered = getFilteredProcesses();
    stopLiveTimers();

    // Clear existing items but keep empty state element
    const children = container.children;
    for (let i = children.length - 1; i >= 0; i--) {
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

export function renderProcessItem(p: any, container: HTMLElement): void {
    const isGroup = p.type === 'code-review-group' || p.type === 'pipeline-execution';
    const isExpanded = appState.expandedGroups[p.id];
    let title = p.promptPreview || p.id || 'Untitled';
    if (title.length > 40) title = title.substring(0, 40) + '...';

    const div = document.createElement('div');
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
