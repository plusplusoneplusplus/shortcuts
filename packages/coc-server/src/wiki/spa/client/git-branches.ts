/**
 * Git Branches page: branch list with tabs, search, pagination, status banner,
 * and interactive operations (create, switch, delete, rename, push, pull, fetch,
 * merge, stash, pop stash).
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
let currentBranch = '';

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

    // Page-level action buttons
    document.getElementById('git-branch-btn-create')?.addEventListener('click', handleCreateBranch);
    document.getElementById('git-branch-btn-push')?.addEventListener('click', handlePush);
    document.getElementById('git-branch-btn-pull')?.addEventListener('click', handlePull);
    document.getElementById('git-branch-btn-fetch')?.addEventListener('click', handleFetch);
    document.getElementById('git-branch-btn-stash')?.addEventListener('click', handleStash);
    document.getElementById('git-branch-btn-pop')?.addEventListener('click', handlePopStash);
    document.getElementById('git-branch-btn-merge')?.addEventListener('click', handleMergeBranch);

    // Modal backdrop click to close
    const overlay = document.getElementById('git-branch-modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', function (e) {
            if (e.target === e.currentTarget) hideDialog();
        });
    }

    // Row action event delegation
    const tableContainer = document.getElementById('git-branches-table-container');
    if (tableContainer) {
        tableContainer.addEventListener('click', async function (e) {
            const target = e.target as HTMLElement;
            const btn = target.closest('button[data-branch]') as HTMLButtonElement | null;
            if (!btn) return;
            const branchName = btn.dataset.branch!;
            if (btn.classList.contains('branch-action-switch')) await handleSwitchBranch(branchName);
            if (btn.classList.contains('branch-action-rename')) await handleRenameBranch(branchName);
            if (btn.classList.contains('branch-action-delete')) await handleDeleteBranch(branchName);
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
        currentBranch = data.name ?? '';
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
    let html = '<table class="git-branches-table"><thead><tr><th>Name</th><th>Last Commit</th><th>Updated</th><th>Actions</th></tr></thead><tbody>';
    branches.forEach(function (branch: any) {
        const rowClass = branch.isCurrent ? ' class="branch-row-current"' : '';
        const star = branch.isCurrent ? '&#9733; ' : '';
        let name = escapeHtml(branch.name ?? '');
        if (branch.isRemote && branch.remoteName) {
            name = '<span class="branch-remote-badge">' + escapeHtml(branch.remoteName) + '</span> ' + name;
        }
        const subject = escapeHtml(branch.lastCommitSubject ?? '');
        const date = branch.lastCommitDate ? formatRelativeDate(branch.lastCommitDate) : '';
        const branchAttr = escapeHtml(branch.name ?? '');
        let actionsHtml = '<td class="branch-row-actions">';
        if (branch.isCurrent) {
            actionsHtml += '<span class="admin-file-status success" style="font-size:12px;">&#10003; Current</span>';
        } else {
            actionsHtml += '<button class="admin-btn admin-btn-save branch-action-switch" data-branch="' + branchAttr + '" title="Switch">Switch</button>';
        }
        if (!branch.isRemote) {
            actionsHtml += '<button class="admin-btn admin-btn-reset branch-action-rename" data-branch="' + branchAttr + '" title="Rename">Rename</button>';
            actionsHtml += '<button class="admin-btn admin-btn-danger branch-action-delete" data-branch="' + branchAttr + '" title="Delete"' + (branch.isCurrent ? ' disabled title="Cannot delete current branch"' : '') + '>Delete</button>';
        }
        actionsHtml += '</td>';
        html += '<tr' + rowClass + '><td>' + star + name + '</td><td>' + subject + '</td><td>' + date + '</td>' + actionsHtml + '</tr>';
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

/* ===== API base ===== */

function getApiBase(): string {
    const wid = config?.workspaceId;
    return wid ? '/api/workspaces/' + encodeURIComponent(wid) : '';
}

/* ===== Refresh helpers ===== */

function refreshBranchList(): Promise<void> {
    return loadBranches(currentType, currentLimit, currentOffset, currentSearch);
}

function refreshStatus(): Promise<void> {
    return loadBranchStatus();
}

async function refreshAll(): Promise<void> {
    await Promise.all([refreshBranchList(), refreshStatus()]);
}

/* ===== Modal lifecycle ===== */

function showDialog(dialogId: string): void {
    document.querySelectorAll('[id^="git-branch-dialog-"]').forEach(function (el) { el.classList.add('hidden'); });
    const dialog = document.getElementById(dialogId);
    if (dialog) dialog.classList.remove('hidden');
    const container = document.getElementById('git-branch-modal-container');
    if (container && dialog) container.appendChild(dialog);
    const overlay = document.getElementById('git-branch-modal-overlay');
    if (overlay) overlay.classList.remove('hidden');
}

function hideDialog(): void {
    const overlay = document.getElementById('git-branch-modal-overlay');
    if (overlay) overlay.classList.add('hidden');
    document.querySelectorAll('[id$="-status"]').forEach(function (el) {
        (el as HTMLElement).textContent = '';
        el.className = 'admin-file-status';
    });
}

function setDialogStatus(statusId: string, message: string, isError: boolean): void {
    const el = document.getElementById(statusId);
    if (!el) return;
    el.textContent = message;
    el.className = 'admin-file-status ' + (isError ? 'error' : 'success');
}

/* ===== Toast system ===== */

function showToast(message: string, type: 'success' | 'error'): void {
    const container = document.getElementById('git-toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.style.cssText = 'padding:10px 16px;border-radius:4px;color:#fff;max-width:360px;word-break:break-word;cursor:pointer;' +
        (type === 'error' ? 'background:#c0392b;' : 'background:#27ae60;');
    toast.textContent = message;
    container.appendChild(toast);
    if (type === 'success') {
        setTimeout(function () { toast.remove(); }, 4000);
    }
    toast.addEventListener('click', function () { toast.remove(); });
}

/* ===== Loading state helpers ===== */

function setLoading(btn: HTMLButtonElement, loading: boolean): void {
    btn.disabled = loading;
    btn.dataset.originalText = btn.dataset.originalText ?? btn.textContent ?? '';
    btn.textContent = loading ? '\u2026' : btn.dataset.originalText;
}

function setPageActionsLoading(loading: boolean): void {
    document.querySelectorAll('#git-branch-actions button').forEach(function (el) {
        setLoading(el as HTMLButtonElement, loading);
    });
}

/* ===== Action handlers ===== */

async function handleCreateBranch(): Promise<void> {
    showDialog('git-branch-dialog-create');
    (document.getElementById('git-branch-create-name') as HTMLInputElement).value = '';

    const submitBtn = document.getElementById('git-branch-create-submit') as HTMLButtonElement;
    submitBtn.onclick = async function () {
        const name = (document.getElementById('git-branch-create-name') as HTMLInputElement).value.trim();
        const checkout = (document.getElementById('git-branch-create-checkout') as HTMLInputElement).checked;
        if (!name) return;
        setLoading(submitBtn, true);
        try {
            const res = await fetch(getApiBase() + '/git/branches', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, checkout }),
            });
            const data = await res.json();
            if (data.success) {
                hideDialog();
                showToast('Branch "' + name + '" created', 'success');
                await refreshAll();
            } else {
                setDialogStatus('git-branch-create-status', data.error || 'Failed to create branch', true);
            }
        } catch (err: any) {
            setDialogStatus('git-branch-create-status', 'Error: ' + err.message, true);
        } finally {
            setLoading(submitBtn, false);
        }
    };
    document.getElementById('git-branch-create-cancel')!.onclick = hideDialog;
}

async function handleSwitchBranch(name: string): Promise<void> {
    setPageActionsLoading(true);
    try {
        const res = await fetch(getApiBase() + '/git/branches/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (data.success) {
            showToast('Switched to "' + name + '"', 'success');
            await refreshAll();
        } else {
            showToast(data.error || 'Switch failed', 'error');
        }
    } catch (err: any) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        setPageActionsLoading(false);
    }
}

async function handleDeleteBranch(name: string): Promise<void> {
    (document.getElementById('git-branch-delete-name') as HTMLElement).textContent = name;
    (document.getElementById('git-branch-delete-force') as HTMLInputElement).checked = false;
    showDialog('git-branch-dialog-delete');

    const confirmBtn = document.getElementById('git-branch-delete-confirm') as HTMLButtonElement;
    confirmBtn.onclick = async function () {
        const force = (document.getElementById('git-branch-delete-force') as HTMLInputElement).checked;
        setLoading(confirmBtn, true);
        try {
            const url = getApiBase() + '/git/branches/' + encodeURIComponent(name) + (force ? '?force=true' : '');
            const res = await fetch(url, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                hideDialog();
                showToast('Branch "' + name + '" deleted', 'success');
                await refreshAll();
            } else {
                setDialogStatus('git-branch-delete-status', data.error || 'Delete failed', true);
            }
        } catch (err: any) {
            setDialogStatus('git-branch-delete-status', 'Error: ' + err.message, true);
        } finally {
            setLoading(confirmBtn, false);
        }
    };
    document.getElementById('git-branch-delete-cancel')!.onclick = hideDialog;
}

async function handleRenameBranch(name: string): Promise<void> {
    (document.getElementById('git-branch-rename-old') as HTMLElement).textContent = name;
    (document.getElementById('git-branch-rename-new') as HTMLInputElement).value = name;
    showDialog('git-branch-dialog-rename');

    const submitBtn = document.getElementById('git-branch-rename-submit') as HTMLButtonElement;
    submitBtn.onclick = async function () {
        const newName = (document.getElementById('git-branch-rename-new') as HTMLInputElement).value.trim();
        if (!newName || newName === name) return;
        setLoading(submitBtn, true);
        try {
            const res = await fetch(getApiBase() + '/git/branches/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldName: name, newName }),
            });
            const data = await res.json();
            if (data.success) {
                hideDialog();
                showToast('Renamed to "' + newName + '"', 'success');
                await refreshAll();
            } else {
                setDialogStatus('git-branch-rename-status', data.error || 'Rename failed', true);
            }
        } catch (err: any) {
            setDialogStatus('git-branch-rename-status', 'Error: ' + err.message, true);
        } finally {
            setLoading(submitBtn, false);
        }
    };
    document.getElementById('git-branch-rename-cancel')!.onclick = hideDialog;
}

async function handleMergeBranch(): Promise<void> {
    (document.getElementById('git-branch-merge-source') as HTMLInputElement).value = '';
    showDialog('git-branch-dialog-merge');

    const submitBtn = document.getElementById('git-branch-merge-submit') as HTMLButtonElement;
    submitBtn.onclick = async function () {
        const source = (document.getElementById('git-branch-merge-source') as HTMLInputElement).value.trim();
        if (!source) return;
        setLoading(submitBtn, true);
        try {
            const res = await fetch(getApiBase() + '/git/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branch: source }),
            });
            const data = await res.json();
            if (data.success) {
                hideDialog();
                showToast('Merged "' + source + '" into current branch', 'success');
                await refreshAll();
            } else {
                setDialogStatus('git-branch-merge-status', data.error || 'Merge failed', true);
                await refreshAll();
            }
        } catch (err: any) {
            setDialogStatus('git-branch-merge-status', 'Error: ' + err.message, true);
        } finally {
            setLoading(submitBtn, false);
        }
    };
    document.getElementById('git-branch-merge-cancel')!.onclick = hideDialog;
}

async function handlePush(): Promise<void> {
    const btn = document.getElementById('git-branch-btn-push') as HTMLButtonElement;
    setLoading(btn, true);
    try {
        const res = await fetch(getApiBase() + '/git/push', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Push successful', 'success');
        } else {
            showToast(data.error || 'Push failed', 'error');
        }
    } catch (err: any) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        setLoading(btn, false);
    }
}

async function handlePull(): Promise<void> {
    const btn = document.getElementById('git-branch-btn-pull') as HTMLButtonElement;
    setLoading(btn, true);
    try {
        const res = await fetch(getApiBase() + '/git/pull', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Pull successful', 'success');
            await refreshAll();
        } else {
            showToast(data.error || 'Pull failed', 'error');
        }
    } catch (err: any) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        setLoading(btn, false);
    }
}

async function handleFetch(): Promise<void> {
    const btn = document.getElementById('git-branch-btn-fetch') as HTMLButtonElement;
    setLoading(btn, true);
    try {
        const res = await fetch(getApiBase() + '/git/fetch', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Fetch successful', 'success');
            await refreshBranchList();
        } else {
            showToast(data.error || 'Fetch failed', 'error');
        }
    } catch (err: any) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        setLoading(btn, false);
    }
}

async function handleStash(): Promise<void> {
    const btn = document.getElementById('git-branch-btn-stash') as HTMLButtonElement;
    setLoading(btn, true);
    try {
        const res = await fetch(getApiBase() + '/git/stash', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Changes stashed', 'success');
            await refreshStatus();
        } else {
            showToast(data.error || 'Stash failed', 'error');
        }
    } catch (err: any) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        setLoading(btn, false);
    }
}

async function handlePopStash(): Promise<void> {
    const btn = document.getElementById('git-branch-btn-pop') as HTMLButtonElement;
    setLoading(btn, true);
    try {
        const res = await fetch(getApiBase() + '/git/stash/pop', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Stash popped', 'success');
            await refreshStatus();
        } else {
            showToast(data.error || 'Pop stash failed', 'error');
        }
    } catch (err: any) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        setLoading(btn, false);
    }
}
