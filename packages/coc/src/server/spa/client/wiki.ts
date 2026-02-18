/**
 * Wiki tab: wiki list sidebar, component browser, Add Wiki dialog.
 *
 * Two-state sidebar:
 *   - List view: wiki cards with status badges
 *   - Detail view: back arrow + component tree
 */

import { appState } from './state';
import { getApiBase } from './config';
import { fetchApi, setHashSilent } from './core';
import { escapeHtmlClient } from './utils';
import { buildComponentTree } from './wiki-components';
import { setWikiGraph, clearWikiState, showWikiHome, loadWikiComponent } from './wiki-content';
import { showWikiGraph, hideWikiGraph, isGraphShowing } from './wiki-graph';
import { setupWikiAskListeners } from './wiki-ask';
import { showWikiAdmin, hideWikiAdmin, resetAdminState } from './wiki-admin';
import type { WikiData, ComponentGraph, WikiStatus } from './wiki-types';

// ================================================================
// Edit/Delete wiki helpers
// ================================================================

let editingWikiId: string | null = null;

export function showEditWikiDialog(wikiId: string): void {
    const wiki = (appState.wikis as WikiData[]).find(w => w.id === wikiId);
    if (!wiki) return;

    editingWikiId = wikiId;
    const overlay = document.getElementById('edit-wiki-overlay');
    if (!overlay) return;

    const nameInput = document.getElementById('edit-wiki-name') as HTMLInputElement | null;
    const colorSelect = document.getElementById('edit-wiki-color') as HTMLSelectElement | null;
    const validation = document.getElementById('edit-wiki-validation');

    if (nameInput) nameInput.value = wiki.name || wiki.title || wiki.id;
    if (colorSelect) colorSelect.value = wiki.color || '#848484';
    if (validation) { validation.innerHTML = ''; validation.className = 'repo-validation'; }

    overlay.classList.remove('hidden');
    if (nameInput) nameInput.focus();
}

export function hideEditWikiDialog(): void {
    const overlay = document.getElementById('edit-wiki-overlay');
    if (overlay) overlay.classList.add('hidden');
    editingWikiId = null;
}

async function submitEditWiki(e: Event): Promise<void> {
    e.preventDefault();
    if (!editingWikiId) return;

    const nameInput = document.getElementById('edit-wiki-name') as HTMLInputElement | null;
    const colorSelect = document.getElementById('edit-wiki-color') as HTMLSelectElement | null;

    const name = nameInput?.value.trim() || '';
    if (!name) {
        showEditWikiValidation('Name is required', false);
        return;
    }
    const color = colorSelect?.value || '#848484';

    try {
        const res = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(editingWikiId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: 'Failed' }));
            showEditWikiValidation(body.error || 'Failed to update wiki', false);
            return;
        }

        hideEditWikiDialog();
        await fetchWikisData();
    } catch {
        showEditWikiValidation('Network error', false);
    }
}

function showEditWikiValidation(msg: string, success: boolean): void {
    const el = document.getElementById('edit-wiki-validation');
    if (!el) return;
    el.className = 'repo-validation ' + (success ? 'success' : 'error');
    el.textContent = msg;
}

export async function deleteWiki(wikiId: string): Promise<void> {
    const wiki = (appState.wikis as WikiData[]).find(w => w.id === wikiId);
    const wikiName = wiki ? (wiki.name || wiki.title || wiki.id) : wikiId;

    const overlay = document.getElementById('delete-wiki-overlay');
    const nameEl = document.getElementById('delete-wiki-name');
    if (!overlay) return;

    if (nameEl) nameEl.textContent = wikiName;
    overlay.classList.remove('hidden');

    const confirmBtn = document.getElementById('delete-wiki-confirm');
    const cancelBtn = document.getElementById('delete-wiki-cancel-btn');

    const cleanup = () => {
        overlay.classList.add('hidden');
        confirmBtn?.removeEventListener('click', onConfirm);
        cancelBtn?.removeEventListener('click', onCancel);
    };

    const onConfirm = async () => {
        cleanup();
        try {
            const res = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId), {
                method: 'DELETE',
            });
            if (res.ok) {
                if (appState.selectedWikiId === wikiId) {
                    appState.selectedWikiId = null;
                    appState.wikiView = 'list';
                    setHashSilent('#wiki');
                }
                await fetchWikisData();
            }
        } catch {
            // Silently fail on network error
        }
    };

    const onCancel = () => { cleanup(); };

    confirmBtn?.addEventListener('click', onConfirm);
    cancelBtn?.addEventListener('click', onCancel);

    overlay.addEventListener('click', (e: Event) => {
        if (e.target === overlay) cleanup();
    }, { once: true });
}

// ================================================================
// Wiki data fetching
// ================================================================

export async function fetchWikisData(): Promise<void> {
    try {
        const data = await fetchApi('/wikis');
        if (data && Array.isArray(data)) {
            appState.wikis = data;
        } else if (data && data.wikis && Array.isArray(data.wikis)) {
            appState.wikis = data.wikis;
        } else {
            appState.wikis = [];
        }
        renderWikiSidebar();
    } catch (err) {
        console.error('[wiki] fetchWikisData failed:', err);
        appState.wikis = [];
        renderWikiSidebar();
    }
}

// ================================================================
// Wiki status helpers
// ================================================================

function getWikiStatus(wiki: WikiData): WikiStatus {
    if (wiki.status) return wiki.status;
    if (wiki.loaded) return 'loaded';
    return 'pending';
}

function getStatusBadge(status: WikiStatus): string {
    switch (status) {
        case 'loaded':
            return '<span class="wiki-card-status wiki-card-status-ready">&#10003; Ready</span>';
        case 'generating':
            return '<span class="wiki-card-status wiki-card-status-generating">&#9203; Generating&hellip;</span>';
        case 'error':
            return '<span class="wiki-card-status wiki-card-status-error">&#9888; Error</span>';
        case 'pending':
        default:
            return '<span class="wiki-card-status wiki-card-status-pending">&#9675; No data</span>';
    }
}

// ================================================================
// Sidebar rendering — two states
// ================================================================

export function renderWikiSidebar(): void {
    if (appState.wikiView === 'detail' && appState.selectedWikiId) {
        renderWikiDetailSidebar();
    } else {
        renderWikiListSidebar();
    }
}

function renderWikiListSidebar(): void {
    const sidebar = document.getElementById('wiki-sidebar');
    if (!sidebar) return;

    const wikis = appState.wikis as WikiData[];

    let html = '<div class="wiki-sidebar-header wiki-sidebar-header-list">' +
        '<span class="wiki-sidebar-title">Wikis</span>' +
        '<button class="wiki-sidebar-add-btn" id="wiki-list-add-btn">+ Add</button>' +
        '</div>';

    html += '<div class="wiki-card-list" id="wiki-card-list">';

    if (wikis.length === 0) {
        html += '<div class="wiki-list-empty">' +
            '<p>No wikis registered.</p>' +
            '<p>Click &ldquo;+ Add&rdquo; to generate a wiki for a repository.</p>' +
            '<button class="wiki-sidebar-add-btn wiki-empty-add-btn" id="wiki-empty-add-btn">+ Add Wiki</button>' +
            '</div>';
    } else {
        for (const wiki of wikis) {
            const status = getWikiStatus(wiki);
            const color = wiki.color || '#848484';
            const name = wiki.name || wiki.title || wiki.id;
            const isActive = appState.selectedWikiId === wiki.id;
            const activeClass = isActive ? ' wiki-card-active' : '';
            const statusClass = ' wiki-card-' + status;

            html += '<div class="wiki-card' + activeClass + statusClass + '" data-wiki-id="' + escapeHtmlClient(wiki.id) + '">' +
                '<div class="wiki-card-row">' +
                '<span class="wiki-card-dot" style="background:' + escapeHtmlClient(color) + '"></span>' +
                '<span class="wiki-card-name">' + escapeHtmlClient(name) + '</span>' +
                '<span class="wiki-card-actions">' +
                '<button class="wiki-card-action-btn wiki-card-edit" data-wiki-id="' + escapeHtmlClient(wiki.id) + '" title="Edit wiki">&#9998;</button>' +
                '<button class="wiki-card-action-btn wiki-card-delete" data-wiki-id="' + escapeHtmlClient(wiki.id) + '" title="Remove wiki">&#128465;</button>' +
                '<button class="wiki-card-action-btn wiki-card-gear" data-wiki-id="' + escapeHtmlClient(wiki.id) + '" title="Wiki Admin">&#9881;</button>' +
                '</span>' +
                '</div>' +
                '<div class="wiki-card-meta">';

            if (status === 'loaded' && typeof wiki.componentCount === 'number') {
                html += '<span class="wiki-card-count">' + wiki.componentCount + ' components</span> &middot; ';
            }
            html += getStatusBadge(status);
            html += '</div></div>';
        }
    }

    html += '</div>';

    // Preserve component tree and content containers
    const treeContainer = document.getElementById('wiki-component-tree');
    const graphBtnContainer = document.getElementById('wiki-graph-btn-container');

    sidebar.innerHTML = html +
        '<div class="wiki-graph-btn-container hidden" id="wiki-graph-btn-container">' +
        '<button class="wiki-graph-btn" id="wiki-graph-btn">&#x1F4CA; Dependency Graph</button>' +
        '</div>' +
        '<div class="wiki-component-tree" id="wiki-component-tree"></div>';

    attachWikiListListeners();
}

function renderWikiDetailSidebar(): void {
    const sidebar = document.getElementById('wiki-sidebar');
    if (!sidebar) return;

    const wiki = (appState.wikis as WikiData[]).find(w => w.id === appState.selectedWikiId);
    const wikiName = wiki ? (wiki.name || wiki.title || wiki.id) : (appState.selectedWikiId || '');

    let html = '<div class="wiki-sidebar-header wiki-sidebar-header-detail">' +
        '<button class="wiki-sidebar-back-btn" id="wiki-back-btn">&larr;</button>' +
        '<span class="wiki-sidebar-detail-name">' + escapeHtmlClient(wikiName) + '</span>' +
        '<button class="wiki-card-gear wiki-detail-gear" id="wiki-detail-gear" title="Wiki Admin">&#9881;</button>' +
        '</div>' +
        '<div class="wiki-graph-btn-container hidden" id="wiki-graph-btn-container">' +
        '<button class="wiki-graph-btn" id="wiki-graph-btn">&#x1F4CA; Dependency Graph</button>' +
        '</div>' +
        '<div class="wiki-component-tree" id="wiki-component-tree"></div>';

    sidebar.innerHTML = html;
    attachWikiDetailListeners();
}

// ================================================================
// Event listener attachment
// ================================================================

function attachWikiListListeners(): void {
    // Card clicks
    document.querySelectorAll('.wiki-card').forEach(card => {
        card.addEventListener('click', (e: Event) => {
            const target = e.target as HTMLElement;
            if (target.closest('.wiki-card-actions')) return;
            const wikiId = card.getAttribute('data-wiki-id');
            if (wikiId) onWikiCardClicked(wikiId);
        });
    });

    // Edit button clicks
    document.querySelectorAll('.wiki-card-edit').forEach(btn => {
        btn.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            const wikiId = btn.getAttribute('data-wiki-id');
            if (wikiId) showEditWikiDialog(wikiId);
        });
    });

    // Delete button clicks
    document.querySelectorAll('.wiki-card-delete').forEach(btn => {
        btn.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            const wikiId = btn.getAttribute('data-wiki-id');
            if (wikiId) deleteWiki(wikiId);
        });
    });

    // Gear icon clicks (stop propagation)
    document.querySelectorAll('.wiki-card-gear').forEach(btn => {
        btn.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            const wikiId = btn.getAttribute('data-wiki-id');
            if (wikiId) showWikiAdmin(wikiId);
        });
    });

    // Add buttons
    const addBtn = document.getElementById('wiki-list-add-btn');
    if (addBtn) addBtn.addEventListener('click', showAddWikiDialog);

    const emptyAddBtn = document.getElementById('wiki-empty-add-btn');
    if (emptyAddBtn) emptyAddBtn.addEventListener('click', showAddWikiDialog);

    // Graph button
    const graphBtn = document.getElementById('wiki-graph-btn');
    if (graphBtn) graphBtn.addEventListener('click', () => showWikiGraph());
}

function attachWikiDetailListeners(): void {
    // Back button
    const backBtn = document.getElementById('wiki-back-btn');
    if (backBtn) backBtn.addEventListener('click', navigateToWikiList);

    // Gear icon
    const gearBtn = document.getElementById('wiki-detail-gear');
    if (gearBtn) {
        gearBtn.addEventListener('click', () => {
            if (appState.selectedWikiId) showWikiAdmin(appState.selectedWikiId);
        });
    }

    // Graph button
    const graphBtn = document.getElementById('wiki-graph-btn');
    if (graphBtn) graphBtn.addEventListener('click', () => showWikiGraph());
}

// ================================================================
// Navigation
// ================================================================

async function onWikiCardClicked(wikiId: string): Promise<void> {
    const wiki = (appState.wikis as WikiData[]).find(w => w.id === wikiId);
    if (!wiki) return;

    appState.selectedWikiId = wikiId;
    appState.wikiView = 'detail';
    setHashSilent(`#wiki/${encodeURIComponent(wikiId)}`);

    hideWikiAdmin();
    resetAdminState();

    // Transition sidebar to detail view
    renderWikiDetailSidebar();

    const status = getWikiStatus(wiki);

    if (status === 'loaded') {
        await loadWikiGraph(wikiId);
    } else if (status === 'generating') {
        showWikiGeneratingState();
    } else if (status === 'error') {
        showWikiErrorState(wiki.errorMessage);
    } else {
        showWikiPendingState();
    }
}

async function loadWikiGraph(wikiId: string): Promise<void> {
    const graph = await fetchApi(`/wikis/${encodeURIComponent(wikiId)}/graph`) as ComponentGraph | null;
    const treeContainer = document.getElementById('wiki-component-tree');
    const graphBtnContainer = document.getElementById('wiki-graph-btn-container');

    if (graph && treeContainer) {
        setWikiGraph(wikiId, graph);
        buildComponentTree(graph, treeContainer);
        if (graphBtnContainer) graphBtnContainer.classList.remove('hidden');

        const detail = document.getElementById('wiki-component-detail');
        const empty = document.getElementById('wiki-empty');
        if (detail) detail.classList.remove('hidden');
        if (empty) empty.classList.add('hidden');
        showWikiHome();
    } else if (treeContainer) {
        clearWikiState();
        treeContainer.innerHTML = '<div class="wiki-tree-empty">No component data available</div>';
        if (graphBtnContainer) graphBtnContainer.classList.add('hidden');
        showWikiEmptyState();
    }
}

export function navigateToWikiList(): void {
    appState.wikiView = 'list';
    setHashSilent('#wiki');

    hideWikiAdmin();
    resetAdminState();

    renderWikiListSidebar();
    showWikiEmptyState();
}

export async function showWikiDetail(wikiId: string): Promise<void> {
    if (appState.wikis.length === 0) {
        await fetchWikisData();
    }
    await onWikiCardClicked(wikiId);
}

export async function showWikiComponent(wikiId: string, compId: string): Promise<void> {
    if (appState.selectedWikiId !== wikiId) {
        await showWikiDetail(wikiId);
    }
    setHashSilent(`#wiki/${encodeURIComponent(wikiId)}/component/${encodeURIComponent(compId)}`);
    await loadWikiComponent(wikiId, compId);
}

// ================================================================
// Main content states
// ================================================================

function showWikiEmptyState(): void {
    const detail = document.getElementById('wiki-component-detail');
    const empty = document.getElementById('wiki-empty');
    if (detail) detail.classList.add('hidden');
    if (empty) {
        empty.classList.remove('hidden');
        const wikis = appState.wikis as WikiData[];
        if (wikis.length === 0) {
            empty.innerHTML = '<div class="empty-state">' +
                '<div class="empty-state-icon">&#128214;</div>' +
                '<div class="empty-state-title">No wikis yet</div>' +
                '<div class="empty-state-text">Add a wiki to start browsing AI-generated documentation.</div>' +
                '<button class="wiki-sidebar-add-btn wiki-main-add-btn" id="wiki-main-add-btn">+ Add Wiki</button>' +
                '</div>';
            const mainAddBtn = document.getElementById('wiki-main-add-btn');
            if (mainAddBtn) mainAddBtn.addEventListener('click', showAddWikiDialog);
        } else {
            empty.innerHTML = '<div class="empty-state">' +
                '<div class="empty-state-icon">&#128214;</div>' +
                '<div class="empty-state-title">Select a wiki</div>' +
                '<div class="empty-state-text">Choose a wiki from the sidebar to browse its documentation.</div>' +
                '</div>';
        }
    }
}

function showWikiGeneratingState(): void {
    const detail = document.getElementById('wiki-component-detail');
    const empty = document.getElementById('wiki-empty');
    if (detail) detail.classList.add('hidden');
    if (empty) {
        empty.classList.remove('hidden');
        empty.innerHTML = '<div class="empty-state">' +
            '<div class="empty-state-icon wiki-generating-icon">&#9203;</div>' +
            '<div class="empty-state-title">Generating wiki&hellip;</div>' +
            '<div class="empty-state-text">This wiki is currently being generated. It will appear here when ready.</div>' +
            '</div>';
    }
}

function showWikiErrorState(errorMessage?: string): void {
    const detail = document.getElementById('wiki-component-detail');
    const empty = document.getElementById('wiki-empty');
    if (detail) detail.classList.add('hidden');
    if (empty) {
        empty.classList.remove('hidden');
        const msg = errorMessage ? escapeHtmlClient(errorMessage) : 'An error occurred while generating this wiki.';
        empty.innerHTML = '<div class="empty-state">' +
            '<div class="empty-state-icon wiki-error-icon">&#9888;</div>' +
            '<div class="empty-state-title">Error</div>' +
            '<div class="empty-state-text">' + msg + '</div>' +
            '</div>';
    }
}

function showWikiPendingState(): void {
    const detail = document.getElementById('wiki-component-detail');
    const empty = document.getElementById('wiki-empty');
    if (detail) detail.classList.add('hidden');
    if (empty) {
        empty.classList.remove('hidden');
        empty.innerHTML = '<div class="empty-state">' +
            '<div class="empty-state-icon">&#9675;</div>' +
            '<div class="empty-state-title">No data yet</div>' +
            '<div class="empty-state-text">This wiki has been registered but not yet generated. Use the admin panel to start generation.</div>' +
            '</div>';
    }
}

export function showWikiNotFound(): void {
    const detail = document.getElementById('wiki-component-detail');
    const empty = document.getElementById('wiki-empty');
    if (detail) detail.classList.add('hidden');
    if (empty) {
        empty.classList.remove('hidden');
        empty.innerHTML = '<div class="empty-state">' +
            '<div class="empty-state-icon">&#128214;</div>' +
            '<div class="empty-state-title">Wiki not found</div>' +
            '<div class="empty-state-text">It may have been removed.</div>' +
            '</div>';
    }
}

// ================================================================
// WebSocket event handlers
// ================================================================

export function handleWikiReload(wikiId: string): void {
    const wiki = (appState.wikis as WikiData[]).find(w => w.id === wikiId);
    if (wiki) {
        wiki.loaded = true;
        wiki.status = 'loaded';
    }
    renderWikiSidebar();

    if (appState.selectedWikiId === wikiId && appState.wikiView === 'detail') {
        loadWikiGraph(wikiId);
    }
}

export function handleWikiRebuilding(wikiId: string): void {
    const wiki = (appState.wikis as WikiData[]).find(w => w.id === wikiId);
    if (wiki) {
        wiki.status = 'generating';
    }
    renderWikiSidebar();

    if (appState.selectedWikiId === wikiId && appState.wikiView === 'detail') {
        showWikiGeneratingState();
    }
}

export function handleWikiError(wikiId: string, message?: string): void {
    const wiki = (appState.wikis as WikiData[]).find(w => w.id === wikiId);
    if (wiki) {
        wiki.status = 'error';
        wiki.errorMessage = message;
    }
    renderWikiSidebar();

    if (appState.selectedWikiId === wikiId && appState.wikiView === 'detail') {
        showWikiErrorState(message);
    }
}

// ================================================================
// Add Wiki dialog
// ================================================================

export function showAddWikiDialog(): void {
    const overlay = document.getElementById('add-wiki-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        const pathInput = document.getElementById('wiki-path') as HTMLInputElement | null;
        if (pathInput) { pathInput.value = ''; pathInput.focus(); }
        const nameInput = document.getElementById('wiki-name') as HTMLInputElement | null;
        if (nameInput) nameInput.value = '';
        const validation = document.getElementById('wiki-validation');
        if (validation) { validation.innerHTML = ''; validation.className = 'repo-validation'; }
        closeWikiPathBrowser();
    }
}

export function hideAddWikiDialog(): void {
    const overlay = document.getElementById('add-wiki-overlay');
    if (overlay) overlay.classList.add('hidden');
}

async function submitAddWiki(e: Event): Promise<void> {
    e.preventDefault();

    const pathInput = document.getElementById('wiki-path') as HTMLInputElement | null;
    const nameInput = document.getElementById('wiki-name') as HTMLInputElement | null;
    const colorSelect = document.getElementById('wiki-color') as HTMLSelectElement | null;
    const generateAI = document.getElementById('wiki-generate-ai') as HTMLInputElement | null;

    const repoPath = pathInput?.value.trim() || '';
    if (!repoPath) return;

    const name = nameInput?.value.trim() || repoPath.split('/').filter(Boolean).pop() || 'wiki';
    const color = colorSelect?.value || '#0078d4';
    const generateWithAI = generateAI?.checked ?? true;

    const id = 'wiki-' + hashString(repoPath);

    try {
        const res = await fetch(getApiBase() + '/wikis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name, repoPath, color, generateWithAI }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: 'Failed' }));
            showWikiValidation(body.error || 'Failed to add wiki', false);
            return;
        }

        hideAddWikiDialog();
        await fetchWikisData();
    } catch (err) {
        showWikiValidation('Network error', false);
    }
}

function showWikiValidation(msg: string, success: boolean): void {
    const el = document.getElementById('wiki-validation');
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
// Wiki path browser (mirrors repo path browser)
// ================================================================

let wikiBrowserCurrentPath = '';

async function openWikiPathBrowser(): Promise<void> {
    const panel = document.getElementById('wiki-path-browser');
    if (!panel) return;

    const pathInput = document.getElementById('wiki-path') as HTMLInputElement | null;
    const startPath = pathInput?.value.trim() || '~';

    panel.classList.remove('hidden');
    await navigateWikiBrowserDir(startPath);
}

async function navigateWikiBrowserDir(dirPath: string): Promise<void> {
    const list = document.getElementById('wiki-path-browser-list');
    const breadcrumb = document.getElementById('wiki-path-breadcrumb');
    if (!list) return;

    list.innerHTML = '<div class="path-browser-loading">Loading...</div>';

    try {
        const data = await fetchApi(`/fs/browse?path=${encodeURIComponent(dirPath)}`);
        if (!data || data.error) {
            list.innerHTML = '<div class="path-browser-error">' + escapeHtmlClient(data?.error || 'Failed to browse') + '</div>';
            return;
        }

        wikiBrowserCurrentPath = data.path;

        if (breadcrumb) {
            renderWikiBreadcrumb(breadcrumb, data.path);
        }

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

        list.querySelectorAll('.path-browser-entry').forEach(el => {
            el.addEventListener('click', () => {
                const p = el.getAttribute('data-path');
                if (p) navigateWikiBrowserDir(p);
            });
        });
    } catch {
        list.innerHTML = '<div class="path-browser-error">Failed to load directory</div>';
    }
}

function renderWikiBreadcrumb(container: HTMLElement, fullPath: string): void {
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
            if (p) navigateWikiBrowserDir(p);
        });
    });
}

function closeWikiPathBrowser(): void {
    const panel = document.getElementById('wiki-path-browser');
    if (panel) panel.classList.add('hidden');
}

function selectWikiBrowserPath(): void {
    if (!wikiBrowserCurrentPath) return;
    const pathInput = document.getElementById('wiki-path') as HTMLInputElement | null;
    if (pathInput) {
        pathInput.value = wikiBrowserCurrentPath;
        const nameInput = document.getElementById('wiki-name') as HTMLInputElement | null;
        if (nameInput && !nameInput.value.trim()) {
            nameInput.value = wikiBrowserCurrentPath.split('/').filter(Boolean).pop() || '';
        }
    }
    closeWikiPathBrowser();
}

// ================================================================
// Event listeners (dialog-level — always present in DOM)
// ================================================================

// Add wiki form
const addWikiForm = document.getElementById('add-wiki-form');
if (addWikiForm) {
    addWikiForm.addEventListener('submit', submitAddWiki);
}

// Cancel buttons
const addWikiCancelBtn = document.getElementById('add-wiki-cancel');
if (addWikiCancelBtn) addWikiCancelBtn.addEventListener('click', hideAddWikiDialog);
const addWikiCancelBtn2 = document.getElementById('add-wiki-cancel-btn');
if (addWikiCancelBtn2) addWikiCancelBtn2.addEventListener('click', hideAddWikiDialog);

// Overlay click to close
const addWikiOverlay = document.getElementById('add-wiki-overlay');
if (addWikiOverlay) {
    addWikiOverlay.addEventListener('click', (e: Event) => {
        if (e.target === addWikiOverlay) hideAddWikiDialog();
    });
}

// Wiki path browser buttons
const wikiBrowseBtn = document.getElementById('wiki-browse-btn');
if (wikiBrowseBtn) wikiBrowseBtn.addEventListener('click', openWikiPathBrowser);

const wikiPathBrowserCancel = document.getElementById('wiki-path-browser-cancel');
if (wikiPathBrowserCancel) wikiPathBrowserCancel.addEventListener('click', closeWikiPathBrowser);

const wikiPathBrowserSelect = document.getElementById('wiki-path-browser-select');
if (wikiPathBrowserSelect) wikiPathBrowserSelect.addEventListener('click', selectWikiBrowserPath);

// Edit wiki form
const editWikiForm = document.getElementById('edit-wiki-form');
if (editWikiForm) editWikiForm.addEventListener('submit', submitEditWiki);

const editWikiCancelBtn = document.getElementById('edit-wiki-cancel');
if (editWikiCancelBtn) editWikiCancelBtn.addEventListener('click', hideEditWikiDialog);
const editWikiCancelBtn2 = document.getElementById('edit-wiki-cancel-btn');
if (editWikiCancelBtn2) editWikiCancelBtn2.addEventListener('click', hideEditWikiDialog);

const editWikiOverlay = document.getElementById('edit-wiki-overlay');
if (editWikiOverlay) {
    editWikiOverlay.addEventListener('click', (e: Event) => {
        if (e.target === editWikiOverlay) hideEditWikiDialog();
    });
}

// Expose for global access
(window as any).fetchWikisData = fetchWikisData;
(window as any).showWikiDetail = showWikiDetail;
(window as any).showWikiComponent = showWikiComponent;
(window as any).showAddWikiDialog = showAddWikiDialog;
(window as any).hideAddWikiDialog = hideAddWikiDialog;
(window as any).showEditWikiDialog = showEditWikiDialog;
(window as any).hideEditWikiDialog = hideEditWikiDialog;
(window as any).deleteWiki = deleteWiki;
(window as any).navigateToWikiList = navigateToWikiList;
(window as any).renderWikiSidebar = renderWikiSidebar;
(window as any).handleWikiReload = handleWikiReload;
(window as any).handleWikiRebuilding = handleWikiRebuilding;
(window as any).handleWikiError = handleWikiError;
(window as any).showWikiNotFound = showWikiNotFound;

// Initialize Ask AI listeners
setupWikiAskListeners();
