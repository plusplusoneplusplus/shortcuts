/**
 * Repos view: sidebar list + detail panel layout.
 * Mirrors the Processes view pattern with a sidebar listing repos
 * and a main detail panel showing repo information.
 */

import { appState, DashboardTab } from './state';
import { getApiBase } from './config';
import { fetchApi, setHashSilent } from './core';
import { escapeHtmlClient, formatRelativeTime } from './utils';

// ================================================================
// Tab switching
// ================================================================

export function switchTab(tab: DashboardTab): void {
    appState.activeTab = tab;

    // Update tab bar active state
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });

    // Show/hide views
    const viewIds = ['view-processes', 'view-repos', 'view-reports', 'view-tasks'];
    viewIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.toggle('hidden', id !== `view-${tab}`);
        }
    });

    // Refresh data when switching to repos
    if (tab === 'repos') {
        fetchReposData();
    }

    // Refresh data when switching to tasks
    if (tab === 'tasks') {
        (window as any).populateTasksWorkspaces?.(appState.workspaces || []);
        (window as any).fetchTasksData?.();
    }
}

// Tab bar click handler
const tabBar = document.getElementById('tab-bar');
if (tabBar) {
    tabBar.addEventListener('click', (e: Event) => {
        const btn = (e.target as HTMLElement).closest('.tab-btn') as HTMLButtonElement | null;
        if (btn && !btn.disabled) {
            const tab = btn.getAttribute('data-tab') as DashboardTab;
            if (tab) {
                // Update hash via normal navigation (triggers hashchange → handleHashChange)
                location.hash = '#' + tab;
            }
        }
    });
}

// ================================================================
// Repos data fetching
// ================================================================

interface RepoData {
    workspace: any;
    gitInfo?: { branch: string | null; dirty: boolean; isGitRepo: boolean };
    pipelines?: Array<{ name: string; path: string }>;
    stats?: { success: number; failed: number; running: number };
}

let reposData: RepoData[] = [];

export async function fetchReposData(): Promise<void> {
    const wsRes = await fetchApi('/workspaces');
    const workspaces = wsRes?.workspaces || wsRes || [];
    if (!Array.isArray(workspaces)) return;

    appState.workspaces = workspaces;

    // Fetch git info and pipelines for each workspace in parallel
    const enriched: RepoData[] = await Promise.all(
        workspaces.map(async (ws: any) => {
            const [gitInfo, pipelinesRes] = await Promise.all([
                fetchApi(`/workspaces/${encodeURIComponent(ws.id)}/git-info`),
                fetchApi(`/workspaces/${encodeURIComponent(ws.id)}/pipelines`),
            ]);

            // Count process stats for this workspace
            const processRes = await fetchApi(`/processes?workspace=${encodeURIComponent(ws.id)}&limit=200`);
            const processes = processRes?.processes || [];
            const stats = { success: 0, failed: 0, running: 0 };
            for (const p of processes) {
                if (p.status === 'completed') stats.success++;
                else if (p.status === 'failed') stats.failed++;
                else if (p.status === 'running') stats.running++;
            }

            return {
                workspace: ws,
                gitInfo: gitInfo || undefined,
                pipelines: pipelinesRes?.pipelines || [],
                stats,
            };
        })
    );

    reposData = enriched;
    renderReposList();

    // If a repo was selected, refresh its detail
    if (appState.selectedRepoId) {
        const stillExists = reposData.find(r => r.workspace.id === appState.selectedRepoId);
        if (stillExists) {
            renderRepoDetail(appState.selectedRepoId);
        } else {
            clearRepoDetail();
        }
    }
}

// ================================================================
// Repos sidebar list rendering
// ================================================================

export function renderReposList(): void {
    const container = document.getElementById('repos-list');
    const emptyState = document.getElementById('repos-empty');
    const footer = document.getElementById('repos-footer');
    if (!container) return;

    // Clear existing items but keep empty state element
    const children = container.children;
    for (let i = children.length - 1; i >= 0; i--) {
        if (children[i].id !== 'repos-empty') {
            container.removeChild(children[i]);
        }
    }

    if (reposData.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        if (footer) footer.textContent = '';
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    for (const repo of reposData) {
        renderRepoItem(repo, container);
    }

    // Footer stats
    if (footer) {
        const totalRunning = reposData.reduce((s, r) => s + (r.stats?.running || 0), 0);
        const totalCompleted = reposData.reduce((s, r) => s + (r.stats?.success || 0), 0);
        footer.textContent = `${reposData.length} repo${reposData.length !== 1 ? 's' : ''} | ${totalRunning} running | ${totalCompleted} completed`;
    }
}

function renderRepoItem(repo: RepoData, container: HTMLElement): void {
    const ws = repo.workspace;
    const color = ws.color || '#848484';
    const branch = repo.gitInfo?.branch || 'n/a';
    const pipelineCount = repo.pipelines?.length || 0;
    const stats = repo.stats || { success: 0, failed: 0, running: 0 };
    const truncPath = truncatePath(ws.rootPath || '', 30);

    const div = document.createElement('div');
    div.className = 'repo-item' + (ws.id === appState.selectedRepoId ? ' active' : '');
    div.setAttribute('data-repo-id', ws.id);

    div.innerHTML =
        '<div class="repo-item-row">' +
            '<span class="repo-color-dot" style="background:' + escapeHtmlClient(color) + '"></span>' +
            '<span class="repo-item-name">' + escapeHtmlClient(ws.name) + '</span>' +
        '</div>' +
        '<div class="repo-item-meta">' +
            '<span class="repo-item-path" title="' + escapeHtmlClient(ws.rootPath || '') + '">' + escapeHtmlClient(truncPath) + '</span>' +
        '</div>' +
        '<div class="repo-item-stats">' +
            '<span>branch: ' + escapeHtmlClient(branch) + '</span>' +
            '<span>Pipelines: ' + pipelineCount + '</span>' +
            '<span class="repo-stat-counts">' +
                '&#10003; ' + stats.success +
                ' &nbsp;&#10007; ' + stats.failed +
                ' &nbsp;&#9719; ' + stats.running +
            '</span>' +
        '</div>';

    div.addEventListener('click', () => {
        showRepoDetail(ws.id);
    });

    container.appendChild(div);
}

function truncatePath(p: string, max: number): string {
    if (p.length <= max) return p;
    return '...' + p.slice(p.length - max + 3);
}

// ================================================================
// Repo detail view
// ================================================================

export function showRepoDetail(wsId: string): void {
    appState.selectedRepoId = wsId;

    // Update hash silently
    setHashSilent('#repos/' + encodeURIComponent(wsId));

    // Update active state in sidebar
    updateActiveRepoItem();

    // Render detail
    renderRepoDetail(wsId);
}

function updateActiveRepoItem(): void {
    const items = document.querySelectorAll('.repo-item');
    items.forEach(el => {
        if (el.getAttribute('data-repo-id') === appState.selectedRepoId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

function renderRepoDetail(wsId: string): void {
    const repo = reposData.find(r => r.workspace.id === wsId);
    if (!repo) return;

    const emptyEl = document.getElementById('repo-detail-empty');
    const contentEl = document.getElementById('repo-detail-content');
    if (!emptyEl || !contentEl) return;

    emptyEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    const ws = repo.workspace;
    const color = ws.color || '#848484';
    const branch = repo.gitInfo?.branch || 'n/a';
    const dirty = repo.gitInfo?.dirty ? ' (dirty)' : '';
    const stats = repo.stats || { success: 0, failed: 0, running: 0 };

    let html = '<div class="repo-detail-header">' +
        '<span class="repo-color-dot" style="background:' + escapeHtmlClient(color) + ';width:14px;height:14px"></span>' +
        '<h1>' + escapeHtmlClient(ws.name) + '</h1>' +
        '<button class="action-btn" id="repo-edit-btn">Edit</button>' +
        '<button class="action-btn repo-remove-action" id="repo-remove-btn">Remove</button>' +
    '</div>';

    // Metadata grid
    html += '<div class="meta-grid">' +
        '<div class="meta-item"><label>Path</label><span class="meta-path">' + escapeHtmlClient(ws.rootPath || '') + '</span></div>' +
        '<div class="meta-item"><label>Branch</label><span>' + escapeHtmlClient(branch + dirty) + '</span></div>' +
        '<div class="meta-item"><label>Color</label><span><span class="repo-color-dot" style="background:' + escapeHtmlClient(color) + ';display:inline-block;vertical-align:middle"></span> ' + escapeHtmlClient(color) + '</span></div>' +
        '<div class="meta-item"><label>Pipelines</label><span>' + (repo.pipelines?.length || 0) + '</span></div>' +
        '<div class="meta-item"><label>Completed</label><span>' + stats.success + '</span></div>' +
        '<div class="meta-item"><label>Failed</label><span>' + stats.failed + '</span></div>' +
        '<div class="meta-item"><label>Running</label><span>' + stats.running + '</span></div>' +
    '</div>';

    // Pipelines list
    html += '<div class="result-section">';
    html += '<h2>Pipelines</h2>';
    if (repo.pipelines && repo.pipelines.length > 0) {
        html += '<ul class="repo-pipeline-list">';
        for (const p of repo.pipelines) {
            html += '<li class="repo-pipeline-item">' +
                '<span class="pipeline-name">&#128203; ' + escapeHtmlClient(p.name) + '</span>' +
                '<div class="repo-pipeline-actions">' +
                    '<button class="action-btn">View</button>' +
                '</div>' +
            '</li>';
        }
        html += '</ul>';
    } else {
        html += '<div style="color:var(--text-secondary);font-size:13px">No pipelines found in this repository.</div>';
    }
    html += '</div>';

    // Recent processes
    html += '<div class="result-section">';
    html += '<h2>Recent Processes</h2>';
    html += '<div id="repo-processes-list" style="font-size:13px;color:var(--text-secondary)">Loading...</div>';
    html += '</div>';

    contentEl.innerHTML = html;

    // Wire remove button
    const removeBtn = document.getElementById('repo-remove-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => confirmRemoveRepo(wsId));
    }

    // Wire edit button
    const editBtn = document.getElementById('repo-edit-btn');
    if (editBtn) {
        editBtn.addEventListener('click', () => showEditRepoDialog(wsId));
    }

    // Fetch recent processes
    fetchRepoProcesses(wsId);
}

async function fetchRepoProcesses(wsId: string): Promise<void> {
    const res = await fetchApi(`/processes?workspace=${encodeURIComponent(wsId)}&limit=10`);
    const el = document.getElementById('repo-processes-list');
    if (!el) return;

    const processes = res?.processes || [];
    if (processes.length === 0) {
        el.textContent = 'No processes yet';
        return;
    }

    const statusIcon: Record<string, string> = {
        running: '&#9203;', completed: '&#10003;', failed: '&#10007;', cancelled: '&#128683;', queued: '&#9203;'
    };

    let html = '';
    for (const p of processes) {
        const icon = statusIcon[p.status] || '&#8226;';
        const title = p.promptPreview || p.id || 'Untitled';
        const time = p.startTime ? formatRelativeTime(p.startTime) : '';
        html += '<div style="padding:4px 0;display:flex;gap:8px;align-items:center">' +
            '<span>' + icon + '</span>' +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtmlClient(title.length > 50 ? title.substring(0, 50) + '...' : title) + '</span>' +
            '<span style="color:var(--text-secondary);font-size:11px;flex-shrink:0">' + time + '</span>' +
        '</div>';
    }
    el.innerHTML = html;
}

function clearRepoDetail(): void {
    appState.selectedRepoId = null;
    setHashSilent('#repos');
    const emptyEl = document.getElementById('repo-detail-empty');
    const contentEl = document.getElementById('repo-detail-content');
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (contentEl) contentEl.classList.add('hidden');
    updateActiveRepoItem();
}

// ================================================================
// Repo context menu (simple)
// ================================================================

async function confirmRemoveRepo(wsId: string): Promise<void> {
    if (!confirm('Remove this repo from the dashboard? Processes will be preserved.')) return;
    await removeRepo(wsId);
}

async function removeRepo(wsId: string): Promise<void> {
    await fetch(getApiBase() + '/workspaces/' + encodeURIComponent(wsId), { method: 'DELETE' });
    clearRepoDetail();
    fetchReposData();
}

// ================================================================
// Directory browser
// ================================================================

let browserCurrentPath = '';

async function openPathBrowser(): Promise<void> {
    const panel = document.getElementById('path-browser');
    if (!panel) return;

    const pathInput = document.getElementById('repo-path') as HTMLInputElement | null;
    const startPath = pathInput?.value.trim() || '~';

    panel.classList.remove('hidden');
    await navigateToDir(startPath);
}

async function navigateToDir(dirPath: string): Promise<void> {
    const list = document.getElementById('path-browser-list');
    const breadcrumb = document.getElementById('path-breadcrumb');
    if (!list) return;

    list.innerHTML = '<div class="path-browser-loading">Loading...</div>';

    try {
        const data = await fetchApi(`/fs/browse?path=${encodeURIComponent(dirPath)}`);
        if (!data || data.error) {
            list.innerHTML = '<div class="path-browser-error">' + escapeHtmlClient(data?.error || 'Failed to browse') + '</div>';
            return;
        }

        browserCurrentPath = data.path;

        // Render breadcrumb
        if (breadcrumb) {
            renderBreadcrumb(breadcrumb, data.path);
        }

        // Render entries
        let html = '';
        if (data.parent) {
            html += '<div class="path-browser-entry path-browser-parent" data-path="' + escapeHtmlClient(data.parent) + '">' +
                '<span class="entry-icon">&#128193;</span>' +
                '<span class="entry-name">..</span>' +
            '</div>';
        }

        if (data.entries.length === 0) {
            html += '<div class="path-browser-empty">No subdirectories</div>';
        } else {
            for (const entry of data.entries) {
                const entryPath = data.path + (data.path.endsWith('/') ? '' : '/') + entry.name;
                html += '<div class="path-browser-entry" data-path="' + escapeHtmlClient(entryPath) + '">' +
                    '<span class="entry-icon">&#128193;</span>' +
                    '<span class="entry-name">' + escapeHtmlClient(entry.name) + '</span>' +
                    (entry.isGitRepo ? '<span class="git-badge">git</span>' : '') +
                '</div>';
            }
        }

        list.innerHTML = html;

        // Attach click handlers
        list.querySelectorAll('.path-browser-entry').forEach(el => {
            el.addEventListener('click', () => {
                const p = el.getAttribute('data-path');
                if (p) navigateToDir(p);
            });
        });
    } catch {
        list.innerHTML = '<div class="path-browser-error">Failed to load directory</div>';
    }
}

function renderBreadcrumb(container: HTMLElement, fullPath: string): void {
    const parts = fullPath.split('/').filter(Boolean);
    let html = '<span class="breadcrumb-segment" data-path="/">/</span>';
    let accumulated = '';
    for (const part of parts) {
        accumulated += '/' + part;
        html += '<span class="breadcrumb-sep">/</span>' +
            '<span class="breadcrumb-segment" data-path="' + escapeHtmlClient(accumulated) + '">' +
            escapeHtmlClient(part) + '</span>';
    }
    container.innerHTML = html;

    container.querySelectorAll('.breadcrumb-segment').forEach(el => {
        el.addEventListener('click', () => {
            const p = el.getAttribute('data-path');
            if (p) navigateToDir(p);
        });
    });
}

function closePathBrowser(): void {
    const panel = document.getElementById('path-browser');
    if (panel) panel.classList.add('hidden');
}

function selectBrowserPath(): void {
    if (!browserCurrentPath) return;
    const pathInput = document.getElementById('repo-path') as HTMLInputElement | null;
    if (pathInput) {
        pathInput.value = browserCurrentPath;
        // Trigger alias auto-detection
        const aliasInput = document.getElementById('repo-alias') as HTMLInputElement | null;
        if (aliasInput && !aliasInput.value.trim()) {
            aliasInput.value = browserCurrentPath.split('/').filter(Boolean).pop() || '';
        }
    }
    closePathBrowser();
}

// Browser button
const browseBtn = document.getElementById('browse-btn');
if (browseBtn) browseBtn.addEventListener('click', openPathBrowser);

// Browser cancel
const browserCancelBtn = document.getElementById('path-browser-cancel');
if (browserCancelBtn) browserCancelBtn.addEventListener('click', closePathBrowser);

// Browser select
const browserSelectBtn = document.getElementById('path-browser-select');
if (browserSelectBtn) browserSelectBtn.addEventListener('click', selectBrowserPath);

// ================================================================
// Add Repo dialog
// ================================================================

export function showAddRepoDialog(): void {
    const overlay = document.getElementById('add-repo-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        const pathInput = document.getElementById('repo-path') as HTMLInputElement | null;
        if (pathInput) { pathInput.value = ''; pathInput.focus(); }
        const aliasInput = document.getElementById('repo-alias') as HTMLInputElement | null;
        if (aliasInput) aliasInput.value = '';
        const validation = document.getElementById('repo-validation');
        if (validation) { validation.innerHTML = ''; validation.className = 'repo-validation'; }
        closePathBrowser();
    }
}

export function hideAddRepoDialog(): void {
    const overlay = document.getElementById('add-repo-overlay');
    if (overlay) overlay.classList.add('hidden');
}

async function submitAddRepo(e: Event): Promise<void> {
    e.preventDefault();

    const pathInput = document.getElementById('repo-path') as HTMLInputElement | null;
    const aliasInput = document.getElementById('repo-alias') as HTMLInputElement | null;
    const colorSelect = document.getElementById('repo-color') as HTMLSelectElement | null;

    const rootPath = pathInput?.value.trim() || '';
    if (!rootPath) return;

    const name = aliasInput?.value.trim() || rootPath.split('/').filter(Boolean).pop() || 'repo';
    const color = colorSelect?.value || '#0078d4';

    // Generate a deterministic ID from the path
    const id = 'ws-' + hashString(rootPath);

    try {
        const res = await fetch(getApiBase() + '/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name, rootPath, color }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: 'Failed' }));
            showValidation(body.error || 'Failed to add repo', false);
            return;
        }

        hideAddRepoDialog();
        fetchReposData();
    } catch (err) {
        showValidation('Network error', false);
    }
}

function showValidation(msg: string, success: boolean): void {
    const el = document.getElementById('repo-validation');
    if (!el) return;
    el.className = 'repo-validation ' + (success ? 'success' : 'error');
    el.textContent = msg;
}

function hashString(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

// ================================================================
// Edit Repo dialog (reuses add repo dialog)
// ================================================================

function showEditRepoDialog(wsId: string): void {
    const repo = reposData.find(r => r.workspace.id === wsId);
    if (!repo) return;

    const overlay = document.getElementById('add-repo-overlay');
    if (!overlay) return;

    // Pre-fill form
    const pathInput = document.getElementById('repo-path') as HTMLInputElement | null;
    const aliasInput = document.getElementById('repo-alias') as HTMLInputElement | null;
    const colorSelect = document.getElementById('repo-color') as HTMLSelectElement | null;
    const submitBtn = document.getElementById('add-repo-submit') as HTMLButtonElement | null;
    const title = overlay.querySelector('.enqueue-dialog-header h2');

    if (pathInput) { pathInput.value = repo.workspace.rootPath || ''; pathInput.readOnly = true; }
    if (aliasInput) aliasInput.value = repo.workspace.name || '';
    if (colorSelect) colorSelect.value = repo.workspace.color || '#0078d4';
    if (submitBtn) submitBtn.textContent = 'Save Changes';
    if (title) title.textContent = 'Edit Repository';

    // Store edit mode state
    overlay.setAttribute('data-edit-id', wsId);
    overlay.classList.remove('hidden');
    if (aliasInput) aliasInput.focus();
}

// ================================================================
// Event listeners
// ================================================================

// Add repo button
const addRepoBtn = document.getElementById('add-repo-btn');
if (addRepoBtn) addRepoBtn.addEventListener('click', showAddRepoDialog);

// Add repo form
const addRepoForm = document.getElementById('add-repo-form');
if (addRepoForm) {
    addRepoForm.addEventListener('submit', async (e: Event) => {
        e.preventDefault();
        const overlay = document.getElementById('add-repo-overlay');
        const editId = overlay?.getAttribute('data-edit-id');

        if (editId) {
            // Edit mode
            const aliasInput = document.getElementById('repo-alias') as HTMLInputElement | null;
            const colorSelect = document.getElementById('repo-color') as HTMLSelectElement | null;
            const name = aliasInput?.value.trim() || '';
            const color = colorSelect?.value || '#0078d4';

            try {
                await fetch(getApiBase() + '/workspaces/' + encodeURIComponent(editId), {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, color }),
                });
                hideAddRepoDialog();
                // Reset edit mode
                overlay?.removeAttribute('data-edit-id');
                const submitBtn = document.getElementById('add-repo-submit') as HTMLButtonElement | null;
                if (submitBtn) submitBtn.textContent = 'Add Repo';
                const title = overlay?.querySelector('.enqueue-dialog-header h2');
                if (title) title.textContent = 'Add Repository';
                const pathInput = document.getElementById('repo-path') as HTMLInputElement | null;
                if (pathInput) pathInput.readOnly = false;
                fetchReposData();
                showRepoDetail(editId);
            } catch {
                showValidation('Failed to update', false);
            }
        } else {
            await submitAddRepo(e);
        }
    });
}

// Cancel buttons
const addRepoCancelBtn = document.getElementById('add-repo-cancel');
if (addRepoCancelBtn) addRepoCancelBtn.addEventListener('click', hideAddRepoDialog);
const addRepoCancelBtn2 = document.getElementById('add-repo-cancel-btn');
if (addRepoCancelBtn2) addRepoCancelBtn2.addEventListener('click', hideAddRepoDialog);

// Overlay click to close
const addRepoOverlay = document.getElementById('add-repo-overlay');
if (addRepoOverlay) {
    addRepoOverlay.addEventListener('click', (e: Event) => {
        if (e.target === addRepoOverlay) hideAddRepoDialog();
    });
}

// Expose for global access
(window as any).switchTab = switchTab;
(window as any).showAddRepoDialog = showAddRepoDialog;
(window as any).hideAddRepoDialog = hideAddRepoDialog;
(window as any).showRepoDetail = showRepoDetail;
