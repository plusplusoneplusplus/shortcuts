/**
 * Filter script: search, status/type filter, workspace dropdown handlers.
 */

import { appState } from './state';
import { fetchApi } from './core';
import { renderProcessList } from './sidebar';
import { clearDetail } from './detail';

export function debounce(fn: Function, ms: number): (...args: any[]) => void {
    let timer: ReturnType<typeof setTimeout>;
    return function(this: any, ...args: any[]) {
        const ctx = this;
        clearTimeout(timer);
        timer = setTimeout(function() { fn.apply(ctx, args); }, ms);
    };
}

export function populateWorkspaces(workspaces: any[]): void {
    const select = document.getElementById('workspace-select') as HTMLSelectElement | null;
    if (!select) return;
    // Keep first "All Workspaces" option, remove the rest
    while (select.options.length > 1) {
        select.remove(1);
    }
    workspaces.forEach(function(ws: any) {
        const opt = document.createElement('option');
        opt.value = ws.id;
        opt.textContent = ws.name || ws.path || ws.id;
        select.appendChild(opt);
    });
}

// Search
const searchInput = document.getElementById('search-input');
if (searchInput) {
    searchInput.addEventListener('input', debounce(function(e: Event) {
        appState.searchQuery = (e.target as HTMLInputElement).value;
        renderProcessList();
    }, 200));
}

// Status filter
const statusFilterEl = document.getElementById('status-filter');
if (statusFilterEl) {
    statusFilterEl.addEventListener('change', function(e: Event) {
        appState.statusFilter = (e.target as HTMLSelectElement).value;
        renderProcessList();
    });
}

// Type filter
const typeFilterEl = document.getElementById('type-filter');
if (typeFilterEl) {
    typeFilterEl.addEventListener('change', function(e: Event) {
        appState.typeFilter = (e.target as HTMLSelectElement).value;
        renderProcessList();
    });
}

// Workspace filter
const wsSelect = document.getElementById('workspace-select');
if (wsSelect) {
    wsSelect.addEventListener('change', function(e: Event) {
        appState.workspace = (e.target as HTMLSelectElement).value;
        const path = appState.workspace === '__all' ? '/processes' : '/processes?workspace=' + encodeURIComponent(appState.workspace);
        fetchApi(path).then(function(data: any) {
            if (data && Array.isArray(data)) {
                appState.processes = data;
            }
            appState.selectedId = null;
            clearDetail();
            renderProcessList();
        });
    });
}
