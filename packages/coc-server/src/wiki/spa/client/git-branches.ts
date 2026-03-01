/**
 * Git Branches page: branch list with tabs, search, pagination, and status banner.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { setCurrentComponentId, escapeHtml } from './core';
import { showGitBranchesPageContent } from './sidebar';

const config = (window as any).__WIKI_CONFIG__ as WikiConfig;
const PAGE_SIZE = 25;

let currentType: 'local' | 'remote' = 'local';
let currentOffset = 0;
let currentSearch = '';
let currentLimit = PAGE_SIZE;
let branchesInitialized = false;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function showGitBranches(skipHistory?: boolean): void {
    setCurrentComponentId(null);
    showGitBranchesPageContent();
    if (!skipHistory) {
        history.pushState({ type: 'git-branches' }, '', location.pathname + '#git-branches');
    }
    if (!branchesInitialized) {
        initGitBranchesEvents();
        branchesInitialized = true;
    }
    currentType = 'local';
    currentOffset = 0;
    currentSearch = '';
    resetTabUI();
    loadBranchStatus();
    loadBranches(currentType, currentLimit, currentOffset, currentSearch);
}

export function setupGitBranchesListeners(): void {
    const backBtn = document.getElementById('git-branches-back');
    if (backBtn) {
        backBtn.addEventListener('click', function () {
            (window as any).showHome(false);
        });
    }
}

function initGitBranchesEvents(): void {
    const tabLocal = document.getElementById('git-branches-tab-local');
    const tabRemote = document.getElementById('git-branches-tab-remote');
    const searchInput = document.getElementById('git-branches-search') as HTMLInputElement | null;

    if (tabLocal) {
        tabLocal.addEventListener('click', function () {
            currentType = 'local';
            currentOffset = 0;
            resetTabUI();
            loadBranches(currentType, currentLimit, currentOffset, currentSearch);
        });
    }
    if (tabRemote) {
        tabRemote.addEventListener('click', function () {
            currentType = 'remote';
            currentOffset = 0;
            resetTabUI();
            loadBranches(currentType, currentLimit, currentOffset, currentSearch);
        });
    }
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(function () {
                currentSearch = searchInput.value.trim();
                currentOffset = 0;
                loadBranches(currentType, currentLimit, currentOffset, currentSearch);
            }, 300);
        });
    }
}

function resetTabUI(): void {
    const tabLocal = document.getElementById('git-branches-tab-local');
    const tabRemote = document.getElementById('git-branches-tab-remote');
    if (tabLocal) tabLocal.classList.toggle('active', currentType === 'local');
    if (tabRemote) tabRemote.classList.toggle('active', currentType === 'remote');
    const searchInput = document.getElementById('git-branches-search') as HTMLInputElement | null;
    if (searchInput) searchInput.value = currentSearch;
}

async function loadBranches(type: string, limit: number, offset: number, search: string): Promise<void> {
    const workspaceId = config?.workspaceId;
    const container = document.getElementById('git-branches-table-container');
    if (!workspaceId) {
        if (container) container.innerHTML = '<p class="admin-page-desc">No workspace selected. Open this wiki from a workspace to manage branches.</p>';
        const pag = document.getElementById('git-branches-pagination');
        if (pag) pag.innerHTML = '';
        return;
    }
    if (container) container.innerHTML = '<div class="loading">Loading branches...</div>';
    try {
        const params = new URLSearchParams({ type, limit: String(limit), offset: String(offset) });
        if (search) params.set('search', search);
        const res = await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/git/branches?' + params.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load branches');
        const result = type === 'remote' ? data.remote : data.local;
        const branches = result?.branches ?? [];
        const totalCount = result?.totalCount ?? 0;
        const hasMore = result?.hasMore ?? false;
        renderBranchTable(branches, totalCount, hasMore);
        renderPagination(totalCount, limit, offset, hasMore);
    } catch (err: any) {
        if (container) container.innerHTML = '<p class="error">Error: ' + escapeHtml(err.message) + '</p>';
    }
}

async function loadBranchStatus(): Promise<void> {
    const workspaceId = config?.workspaceId;
    const banner = document.getElementById('git-branch-status-banner');
    if (!workspaceId || !banner) return;
    banner.innerHTML = '<span class="loading-inline">Loading status...</span>';
    try {
        const res = await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/git/branch-status');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load status');
        let html = '<span class="branch-status-current">&#x2387; ' + escapeHtml(data.name ?? 'unknown') + '</span>';
        if (data.trackingBranch) html += ' &rarr; <span class="branch-status-tracking">' + escapeHtml(data.trackingBranch) + '</span>';
        if (data.ahead || data.behind) {
            html += ' <span class="branch-status-sync">';
            if (data.ahead) html += '&uarr;' + data.ahead + ' ';
            if (data.behind) html += '&darr;' + data.behind;
            html += '</span>';
        }
        if (data.hasUncommittedChanges) html += ' <span class="branch-status-dirty">&#x25CF; dirty</span>';
        banner.innerHTML = html;
    } catch (_err) {
        banner.innerHTML = '';
    }
}

function renderBranchTable(branches: any[], _totalCount: number, _hasMore: boolean): void {
    const container = document.getElementById('git-branches-table-container');
    if (!container) return;
    if (branches.length === 0) {
        container.innerHTML = '<p class="admin-page-desc">No branches found.</p>';
        return;
    }
    let html = '<table class="git-branches-table"><thead><tr><th>Name</th><th>Last Commit</th><th>Updated</th></tr></thead><tbody>';
    branches.forEach(function (branch: any) {
        const rowClass = branch.isCurrent ? ' class="branch-row-current"' : '';
        const star = branch.isCurrent ? '&#9733; ' : '';
        let name = escapeHtml(branch.name ?? '');
        if (branch.isRemote && branch.remoteName) {
            name = '<span class="branch-remote-badge">' + escapeHtml(branch.remoteName) + '</span> ' + name;
        }
        const subject = escapeHtml(branch.lastCommitSubject ?? '');
        const date = branch.lastCommitDate ? formatRelativeDate(branch.lastCommitDate) : '';
        html += '<tr' + rowClass + '><td>' + star + name + '</td><td>' + subject + '</td><td>' + date + '</td></tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

function renderPagination(totalCount: number, limit: number, offset: number, hasMore: boolean): void {
    const container = document.getElementById('git-branches-pagination');
    if (!container) return;
    if (totalCount === 0) {
        container.innerHTML = '';
        return;
    }
    const start = offset + 1;
    const end = Math.min(offset + limit, totalCount);
    let html = '<span class="git-branches-pagination-info">Showing ' + start + '&ndash;' + end + ' of ' + totalCount + '</span> ';
    html += '<button class="admin-btn" id="git-branches-prev"' + (offset <= 0 ? ' disabled' : '') + '>&larr; Prev</button> ';
    html += '<button class="admin-btn" id="git-branches-next"' + (!hasMore ? ' disabled' : '') + '>Next &rarr;</button>';
    container.innerHTML = html;

    const prevBtn = document.getElementById('git-branches-prev');
    const nextBtn = document.getElementById('git-branches-next');
    if (prevBtn) {
        prevBtn.addEventListener('click', function () {
            currentOffset = Math.max(0, currentOffset - currentLimit);
            loadBranches(currentType, currentLimit, currentOffset, currentSearch);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function () {
            currentOffset += currentLimit;
            loadBranches(currentType, currentLimit, currentOffset, currentSearch);
        });
    }
}

function formatRelativeDate(dateStr: string): string {
    try {
        const date = new Date(dateStr);
        const now = Date.now();
        const diffMs = now - date.getTime();
        if (diffMs < 0) return 'just now';
        const seconds = Math.floor(diffMs / 1000);
        if (seconds < 60) return seconds + 's ago';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + 'm ago';
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ago';
        const days = Math.floor(hours / 24);
        if (days < 30) return days + 'd ago';
        const months = Math.floor(days / 30);
        if (months < 12) return months + 'mo ago';
        return Math.floor(months / 12) + 'y ago';
    } catch (_e) {
        return '';
    }
}
