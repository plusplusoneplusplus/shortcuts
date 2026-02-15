/**
 * Wiki tab: wiki list selector, component browser, Add Wiki dialog.
 *
 * Handles fetching wikis, populating the sidebar selector,
 * loading component graphs, and rendering component content.
 */

import { appState } from './state';
import { getApiBase } from './config';
import { fetchApi, setHashSilent } from './core';
import { escapeHtmlClient } from './utils';
import { buildComponentTree } from './wiki-components';
import type { WikiData, ComponentGraph } from './wiki-types';

// ================================================================
// Wiki data fetching
// ================================================================

let wikisData: WikiData[] = [];

export async function fetchWikisData(): Promise<void> {
    const data = await fetchApi('/wikis');
    if (data && Array.isArray(data)) {
        wikisData = data;
    } else if (data && data.wikis && Array.isArray(data.wikis)) {
        wikisData = data.wikis;
    } else {
        wikisData = [];
    }
    populateWikiSelect();
}

function populateWikiSelect(): void {
    const select = document.getElementById('wiki-select') as HTMLSelectElement | null;
    if (!select) return;

    // Preserve current selection
    const currentValue = select.value;

    select.innerHTML = '<option value="">Select wiki...</option>';
    for (const wiki of wikisData) {
        const opt = document.createElement('option');
        opt.value = wiki.id;
        opt.textContent = wiki.name || wiki.id;
        select.appendChild(opt);
    }

    // Restore selection if still valid
    if (currentValue && wikisData.some(w => w.id === currentValue)) {
        select.value = currentValue;
    }
}

// ================================================================
// Wiki selection & component graph
// ================================================================

async function onWikiSelected(wikiId: string): Promise<void> {
    if (!wikiId) {
        appState.selectedWikiId = null;
        clearWikiContent();
        clearComponentTree();
        return;
    }

    appState.selectedWikiId = wikiId;
    setHashSilent(`#wiki/${encodeURIComponent(wikiId)}`);

    // Fetch component graph
    const graph = await fetchApi(`/wikis/${encodeURIComponent(wikiId)}/graph`) as ComponentGraph | null;
    const treeContainer = document.getElementById('wiki-component-tree');
    if (graph && treeContainer) {
        buildComponentTree(graph, treeContainer);
    } else if (treeContainer) {
        treeContainer.innerHTML = '<div class="wiki-tree-empty">No component data available</div>';
    }

    // Show empty state for content until a component is selected
    showWikiEmptyState();
}

export async function showWikiDetail(wikiId: string): Promise<void> {
    const select = document.getElementById('wiki-select') as HTMLSelectElement | null;

    // Ensure wikis are loaded
    if (wikisData.length === 0) {
        await fetchWikisData();
    }

    if (select) select.value = wikiId;
    await onWikiSelected(wikiId);
}

export async function showWikiComponent(wikiId: string, compId: string): Promise<void> {
    // Ensure wiki is selected
    if (appState.selectedWikiId !== wikiId) {
        await showWikiDetail(wikiId);
    }

    const detail = document.getElementById('wiki-component-detail');
    const empty = document.getElementById('wiki-empty');
    if (!detail) return;

    // Fetch component content
    const data = await fetchApi(`/wikis/${encodeURIComponent(wikiId)}/components/${encodeURIComponent(compId)}`);
    if (data && data.markdown) {
        detail.innerHTML = `<div class="markdown-body">${data.markdown}</div>`;
        detail.classList.remove('hidden');
        if (empty) empty.classList.add('hidden');
    } else if (data && data.content) {
        detail.innerHTML = `<div class="markdown-body">${escapeHtmlClient(data.content)}</div>`;
        detail.classList.remove('hidden');
        if (empty) empty.classList.add('hidden');
    } else {
        detail.innerHTML = '<div class="empty-state"><div class="empty-state-text">Component content not available</div></div>';
        detail.classList.remove('hidden');
        if (empty) empty.classList.add('hidden');
    }

    // Highlight active component in tree
    document.querySelectorAll('.wiki-tree-component').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-id') === compId);
    });
}

function showWikiEmptyState(): void {
    const detail = document.getElementById('wiki-component-detail');
    const empty = document.getElementById('wiki-empty');
    if (detail) detail.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
}

function clearWikiContent(): void {
    const detail = document.getElementById('wiki-component-detail');
    if (detail) {
        detail.innerHTML = '';
        detail.classList.add('hidden');
    }
    showWikiEmptyState();
}

function clearComponentTree(): void {
    const tree = document.getElementById('wiki-component-tree');
    if (tree) tree.innerHTML = '';
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

    // Generate a deterministic ID from the path
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
// Event listeners
// ================================================================

// Wiki selector
const wikiSelect = document.getElementById('wiki-select');
if (wikiSelect) {
    wikiSelect.addEventListener('change', (e: Event) => {
        const value = (e.target as HTMLSelectElement).value;
        onWikiSelected(value);
    });
}

// Add wiki button
const addWikiBtn = document.getElementById('add-wiki-btn');
if (addWikiBtn) addWikiBtn.addEventListener('click', showAddWikiDialog);

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

// Expose for global access
(window as any).fetchWikisData = fetchWikisData;
(window as any).showWikiDetail = showWikiDetail;
(window as any).showWikiComponent = showWikiComponent;
(window as any).showAddWikiDialog = showAddWikiDialog;
(window as any).hideAddWikiDialog = hideAddWikiDialog;
