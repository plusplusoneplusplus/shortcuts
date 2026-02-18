/**
 * Wiki content — Miller column navigation.
 *
 * Three-column layout: Domains/Categories → Components → Article Preview.
 * Ported from deep-wiki content.ts, redesigned with Miller columns for
 * a Finder-like browsing experience.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { fetchApi, setHashSilent } from './core';
import { escapeHtmlClient } from './utils';
import { renderMarkdownContent, processMarkdownContent } from './wiki-markdown';
import { buildToc } from './wiki-toc';
import type { ComponentGraph, ComponentInfo, DomainInfo, CategoryInfo } from './wiki-types';

// ================================================================
// Wiki state — scoped to the selected wiki
// ================================================================

export interface WikiState {
    wikiId: string | null;
    graph: ComponentGraph | null;
    components: ComponentInfo[];
    currentComponentId: string | null;
    markdownCache: Record<string, string>;
    selectedDomainOrCategory: string | null;
}

export const wikiState: WikiState = {
    wikiId: null,
    graph: null,
    components: [],
    currentComponentId: null,
    markdownCache: {},
    selectedDomainOrCategory: null,
};

export function setWikiGraph(wikiId: string, graph: ComponentGraph): void {
    wikiState.wikiId = wikiId;
    wikiState.graph = graph;
    wikiState.components = graph.components || [];
    wikiState.currentComponentId = null;
    wikiState.markdownCache = {};
    wikiState.selectedDomainOrCategory = null;
}

export function clearWikiState(): void {
    wikiState.wikiId = null;
    wikiState.graph = null;
    wikiState.components = [];
    wikiState.currentComponentId = null;
    wikiState.markdownCache = {};
    wikiState.selectedDomainOrCategory = null;
}

// ================================================================
// Miller column group helpers
// ================================================================

interface MillerGroup {
    id: string;
    name: string;
    description?: string;
    components: ComponentInfo[];
}

function getGroups(graph: ComponentGraph): MillerGroup[] {
    const hasDomains = graph.domains && graph.domains.length > 0;
    if (hasDomains) {
        return getDomainGroups(graph);
    }
    return getCategoryGroups(graph);
}

function getDomainGroups(graph: ComponentGraph): MillerGroup[] {
    const groups: MillerGroup[] = [];
    const assignedIds = new Set<string>();
    const componentMap = new Map<string, ComponentInfo>();
    for (const comp of graph.components) componentMap.set(comp.id, comp);

    for (const domain of graph.domains!) {
        const domainComponents = (domain.components || [])
            .map(id => componentMap.get(id))
            .filter((c): c is ComponentInfo => !!c);
        if (domainComponents.length === 0) continue;
        for (const c of domainComponents) assignedIds.add(c.id);
        groups.push({
            id: domain.id,
            name: domain.name,
            description: domain.description,
            components: domainComponents,
        });
    }

    const unassigned = graph.components.filter(c => !assignedIds.has(c.id));
    if (unassigned.length > 0) {
        groups.push({ id: '__other', name: 'Other', components: unassigned });
    }
    return groups;
}

function getCategoryGroups(graph: ComponentGraph): MillerGroup[] {
    const categoryMap = new Map<string, ComponentInfo[]>();
    for (const comp of graph.components) {
        const cat = comp.category || 'other';
        if (!categoryMap.has(cat)) categoryMap.set(cat, []);
        categoryMap.get(cat)!.push(comp);
    }
    const groups: MillerGroup[] = [];
    const catInfo = new Map<string, CategoryInfo>();
    if (graph.categories) {
        for (const c of graph.categories) catInfo.set(c.id, c);
    }
    for (const [cat, comps] of Array.from(categoryMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        const info = catInfo.get(cat);
        groups.push({
            id: cat,
            name: info?.name || cat,
            description: info?.description,
            components: comps,
        });
    }
    return groups;
}

// ================================================================
// Home view — renders the Miller columns
// ================================================================

export function showWikiHome(): void {
    const graph = wikiState.graph;
    if (!graph) return;

    if ((window as any).hideWikiGraph) (window as any).hideWikiGraph();

    wikiState.currentComponentId = null;
    wikiState.selectedDomainOrCategory = null;

    renderMillerColumns();
}

export function renderMillerColumns(): void {
    const container = document.getElementById('wiki-miller-columns');
    if (!container) return;

    const graph = wikiState.graph;
    if (!graph) return;

    const groups = getGroups(graph);
    const hasDomains = graph.domains && graph.domains.length > 0;
    const groupLabel = hasDomains ? 'Domains' : 'Categories';

    let html = '';

    // Column 1: Project overview + groups
    html += '<div class="wiki-miller-col wiki-miller-col-groups" data-col="groups">';
    html += '<div class="wiki-miller-col-header">' + escapeHtmlClient(groupLabel) +
        ' <span class="wiki-miller-col-count">(' + groups.length + ')</span></div>';
    html += '<div class="wiki-miller-col-body">';

    // Project info row
    html += '<div class="wiki-miller-row wiki-miller-row-project' +
        (!wikiState.selectedDomainOrCategory && !wikiState.currentComponentId ? ' wiki-miller-row-selected' : '') +
        '" data-action="home">';
    html += '<span class="wiki-miller-row-icon">&#127968;</span>';
    html += '<span class="wiki-miller-row-name">' + escapeHtmlClient(graph.project.name) + '</span>';
    html += '<span class="wiki-miller-chevron">&#9654;</span>';
    html += '</div>';

    for (const group of groups) {
        const isSelected = wikiState.selectedDomainOrCategory === group.id;
        html += '<div class="wiki-miller-row' + (isSelected ? ' wiki-miller-row-selected' : '') +
            '" data-group-id="' + escapeHtmlClient(group.id) + '">';
        html += '<span class="wiki-miller-row-icon">&#128193;</span>';
        html += '<span class="wiki-miller-row-name">' + escapeHtmlClient(group.name) + '</span>';
        html += '<span class="wiki-miller-row-count">' + group.components.length + '</span>';
        html += '<span class="wiki-miller-chevron">&#9654;</span>';
        html += '</div>';
    }

    html += '</div></div>';

    // Column 2: Components (shown when a group is selected, or all components for home)
    const selectedGroup = groups.find(g => g.id === wikiState.selectedDomainOrCategory);
    const showingHome = !wikiState.selectedDomainOrCategory && !wikiState.currentComponentId;
    const componentsToShow = selectedGroup ? selectedGroup.components :
        (showingHome ? graph.components : graph.components);
    const colLabel = selectedGroup ? selectedGroup.name : 'All Components';

    html += '<div class="wiki-miller-col wiki-miller-col-components" data-col="components">';
    html += '<div class="wiki-miller-col-header">' + escapeHtmlClient(colLabel) +
        ' <span class="wiki-miller-col-count">(' + componentsToShow.length + ')</span></div>';
    html += '<div class="wiki-miller-col-body">';

    if (componentsToShow.length === 0) {
        html += '<div class="wiki-miller-empty">No components</div>';
    } else {
        for (const comp of componentsToShow) {
            const isActive = wikiState.currentComponentId === comp.id;
            html += '<div class="wiki-miller-row' + (isActive ? ' wiki-miller-row-selected' : '') +
                '" data-component-id="' + escapeHtmlClient(comp.id) + '">';
            html += '<span class="wiki-miller-row-icon">&#128196;</span>';
            html += '<span class="wiki-miller-row-name">' + escapeHtmlClient(comp.name) + '</span>';
            if (comp.complexity) {
                html += '<span class="wiki-miller-badge wiki-miller-badge-' + comp.complexity + '">' +
                    comp.complexity + '</span>';
            }
            html += '<span class="wiki-miller-chevron">&#9654;</span>';
            html += '</div>';
        }
    }

    html += '</div></div>';

    // Column 3: Preview (article content or project overview)
    html += '<div class="wiki-miller-col wiki-miller-col-preview" data-col="preview">';
    html += '<div class="wiki-miller-col-header" id="wiki-miller-preview-header">Preview</div>';
    html += '<div class="wiki-miller-col-body wiki-miller-preview-body" id="wiki-miller-preview-body">';
    html += '<div id="wiki-content-scroll" class="wiki-content-scroll">';
    html += '<div class="wiki-content-layout">';
    html += '<article class="wiki-article"><div id="wiki-article-content"></div></article>';
    html += '<aside class="wiki-toc-sidebar" id="wiki-toc-sidebar">';
    html += '<div class="toc-container"><h4 class="toc-title">On this page</h4>';
    html += '<nav id="wiki-toc-nav" class="toc-nav"></nav></div></aside>';
    html += '</div></div>';
    html += '</div></div>';

    container.innerHTML = html;

    // Render initial preview content
    if (wikiState.currentComponentId) {
        const comp = wikiState.components.find(c => c.id === wikiState.currentComponentId);
        if (comp) {
            updatePreviewHeader(comp.name);
            if (wikiState.markdownCache[comp.id]) {
                renderComponentPage(comp, wikiState.markdownCache[comp.id]);
            } else {
                renderProjectOverview(graph);
            }
        }
    } else if (selectedGroup) {
        updatePreviewHeader(selectedGroup.name);
        renderGroupOverview(selectedGroup, graph);
    } else {
        updatePreviewHeader(graph.project.name);
        renderProjectOverview(graph);
    }

    attachMillerListeners(container);

    requestAnimationFrame(() => {
        if (wikiState.currentComponentId) {
            container.scrollLeft = container.scrollWidth;
        }
    });
}

function updatePreviewHeader(title: string): void {
    const header = document.getElementById('wiki-miller-preview-header');
    if (header) header.textContent = title;
}

function attachMillerListeners(container: HTMLElement): void {
    container.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        const row = target.closest('.wiki-miller-row') as HTMLElement | null;
        if (!row) return;

        const groupId = row.getAttribute('data-group-id');
        const componentId = row.getAttribute('data-component-id');
        const action = row.getAttribute('data-action');

        if (action === 'home') {
            wikiState.selectedDomainOrCategory = null;
            wikiState.currentComponentId = null;
            if (wikiState.wikiId) {
                setHashSilent('#wiki/' + encodeURIComponent(wikiState.wikiId));
            }
            renderMillerColumns();
            return;
        }

        if (groupId) {
            wikiState.selectedDomainOrCategory = groupId;
            wikiState.currentComponentId = null;
            renderMillerColumns();
            return;
        }

        if (componentId && wikiState.wikiId) {
            setHashSilent('#wiki/' + encodeURIComponent(wikiState.wikiId) +
                '/component/' + encodeURIComponent(componentId));
            loadWikiComponent(wikiState.wikiId, componentId);
        }
    });
}

// ================================================================
// Project overview (shown in preview column)
// ================================================================

function renderProjectOverview(graph: ComponentGraph): void {
    const stats = {
        components: graph.components.length,
        categories: (graph.categories || []).length,
        language: graph.project.mainLanguage || 'N/A',
    };

    let html = '<div class="home-view">' +
        '<h1>' + escapeHtmlClient(graph.project.name) + '</h1>' +
        '<p style="font-size: 15px; color: var(--text-secondary); margin-bottom: 24px;">' +
        escapeHtmlClient(graph.project.description) + '</p>' +
        '<div class="project-stats">' +
        '<div class="stat-card"><h3>Components</h3><div class="value">' + stats.components + '</div></div>' +
        '<div class="stat-card"><h3>Categories</h3><div class="value">' + stats.categories + '</div></div>' +
        '<div class="stat-card"><h3>Language</h3><div class="value small">' + escapeHtmlClient(stats.language) + '</div></div>' +
        '</div>';

    const hasDomains = graph.domains && graph.domains.length > 0;
    if (hasDomains) {
        html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">Domains</h3>';
        html += '<div class="component-grid">';
        for (const domain of graph.domains!) {
            const count = (domain.components || []).length;
            if (count === 0) continue;
            html += '<div class="component-card wiki-miller-domain-card" data-domain-id="' +
                escapeHtmlClient(domain.id) + '">' +
                '<h4>' + escapeHtmlClient(domain.name) + ' <span style="font-weight:400;color:var(--text-secondary)">(' + count + ')</span></h4>' +
                '<p>' + escapeHtmlClient(domain.description || '') + '</p></div>';
        }
        html += '</div>';
    } else {
        html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">All Components</h3>';
        html += '<div class="component-grid">';
        graph.components.forEach(function (mod) {
            html += buildComponentCard(mod);
        });
        html += '</div>';
    }

    html += '</div>';

    const contentEl = document.getElementById('wiki-article-content');
    if (contentEl) contentEl.innerHTML = html;
    const scrollEl = document.getElementById('wiki-content-scroll');
    if (scrollEl) scrollEl.scrollTop = 0;

    document.querySelectorAll('.wiki-miller-domain-card').forEach(card => {
        card.addEventListener('click', () => {
            const domainId = card.getAttribute('data-domain-id');
            if (domainId) {
                wikiState.selectedDomainOrCategory = domainId;
                wikiState.currentComponentId = null;
                renderMillerColumns();
            }
        });
    });

    document.querySelectorAll('.wiki-component-card').forEach(card => {
        card.addEventListener('click', () => {
            const compId = card.getAttribute('data-component-id');
            if (compId && wikiState.wikiId) {
                (window as any).showWikiComponent?.(wikiState.wikiId, compId);
            }
        });
    });
}

function renderGroupOverview(group: MillerGroup, graph: ComponentGraph): void {
    let html = '<div class="home-view">';
    html += '<h1>' + escapeHtmlClient(group.name) + '</h1>';
    if (group.description) {
        html += '<p style="font-size: 15px; color: var(--text-secondary); margin-bottom: 24px;">' +
            escapeHtmlClient(group.description) + '</p>';
    }
    html += '<div class="project-stats">' +
        '<div class="stat-card"><h3>Components</h3><div class="value">' + group.components.length + '</div></div>' +
        '</div>';
    html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">Components</h3>';
    html += '<div class="component-grid">';
    for (const comp of group.components) {
        html += buildComponentCard(comp);
    }
    html += '</div></div>';

    const contentEl = document.getElementById('wiki-article-content');
    if (contentEl) contentEl.innerHTML = html;
    const scrollEl = document.getElementById('wiki-content-scroll');
    if (scrollEl) scrollEl.scrollTop = 0;

    document.querySelectorAll('.wiki-component-card').forEach(card => {
        card.addEventListener('click', () => {
            const compId = card.getAttribute('data-component-id');
            if (compId && wikiState.wikiId) {
                (window as any).showWikiComponent?.(wikiState.wikiId, compId);
            }
        });
    });
}

function buildComponentCard(mod: ComponentInfo): string {
    return '<div class="component-card wiki-component-card" data-component-id="' +
        escapeHtmlClient(mod.id) + '">' +
        '<h4>' + escapeHtmlClient(mod.name) +
        (mod.complexity ? ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
            mod.complexity + '</span>' : '') +
        '</h4>' +
        '<p>' + escapeHtmlClient(mod.purpose) + '</p></div>';
}

// ================================================================
// Component loading
// ================================================================

export async function loadWikiComponent(wikiId: string, componentId: string): Promise<void> {
    const mod = wikiState.components.find(function (m) { return m.id === componentId; });
    if (!mod) return;

    if ((window as any).hideWikiGraph) (window as any).hideWikiGraph();

    wikiState.currentComponentId = componentId;

    const detail = document.getElementById('wiki-component-detail');
    const empty = document.getElementById('wiki-empty');
    if (detail) detail.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');

    // Highlight active component in tree
    document.querySelectorAll('.wiki-tree-component').forEach(function (el) {
        el.classList.toggle('active', el.getAttribute('data-id') === componentId);
    });

    // Infer group from component
    if (!wikiState.selectedDomainOrCategory && wikiState.graph) {
        const groups = getGroups(wikiState.graph);
        const owningGroup = groups.find(g => g.components.some(c => c.id === componentId));
        if (owningGroup) {
            wikiState.selectedDomainOrCategory = owningGroup.id;
        }
    }

    renderMillerColumns();

    updatePreviewHeader(mod.name);

    if (wikiState.markdownCache[componentId]) {
        renderComponentPage(mod, wikiState.markdownCache[componentId]);
        const scrollEl = document.getElementById('wiki-content-scroll');
        if (scrollEl) scrollEl.scrollTop = 0;
        return;
    }

    const contentEl = document.getElementById('wiki-article-content');
    if (contentEl) contentEl.innerHTML = '<div class="loading">Loading component...</div>';

    try {
        const data = await fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/components/' + encodeURIComponent(componentId));
        if (data && data.markdown) {
            wikiState.markdownCache[componentId] = data.markdown;
            renderComponentPage(mod, data.markdown);
        } else {
            if (contentEl) {
                contentEl.innerHTML =
                    '<div class="markdown-body"><h2>' + escapeHtmlClient(mod.name) + '</h2>' +
                    '<p>' + escapeHtmlClient(mod.purpose) + '</p></div>';
            }
        }
    } catch (err: any) {
        if (contentEl) {
            contentEl.innerHTML =
                '<p style="color: var(--status-failed);">Error loading component: ' + escapeHtmlClient(err.message) + '</p>';
        }
    }

    const scrollEl = document.getElementById('wiki-content-scroll');
    if (scrollEl) scrollEl.scrollTop = 0;
}

export function renderComponentPage(mod: ComponentInfo, markdown: string): void {
    let html = '';

    if (mod.keyFiles && mod.keyFiles.length > 0) {
        html += '<div class="source-files-section" id="wiki-source-files">' +
            '<button class="source-files-toggle" id="wiki-source-toggle">' +
            '<span class="source-files-arrow">&#x25B6;</span> Relevant source files' +
            '</button>' +
            '<div class="source-files-list">';
        mod.keyFiles.forEach(function (f: string) {
            html += '<span class="source-pill"><span class="source-pill-icon">&#9671;</span> ' +
                escapeHtmlClient(f) + '</span>';
        });
        html += '</div></div>';
    }

    if (typeof (window as any).marked !== 'undefined') {
        html += '<div class="markdown-body">' + (window as any).marked.parse(markdown) + '</div>';
    } else {
        html += '<div class="markdown-body"><pre>' + escapeHtmlClient(markdown) + '</pre></div>';
    }

    const contentEl = document.getElementById('wiki-article-content');
    if (contentEl) contentEl.innerHTML = html;

    const toggleBtn = document.getElementById('wiki-source-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleSourceFiles);
    }

    processMarkdownContent();
    buildToc();
}

// ================================================================
// Special pages & theme articles
// ================================================================

export async function loadSpecialPage(wikiId: string, key: string, title: string): Promise<void> {
    wikiState.currentComponentId = null;
    clearToc();
    setHashSilent('#wiki/' + encodeURIComponent(wikiId) + '/page/' + encodeURIComponent(key));

    const cacheKey = '__page_' + key;
    if (wikiState.markdownCache[cacheKey]) {
        renderMarkdownContent(wikiState.markdownCache[cacheKey]);
        buildToc();
        scrollContentTop();
        return;
    }

    const contentEl = document.getElementById('wiki-article-content');
    if (contentEl) contentEl.innerHTML = '<div class="loading">Loading ' + escapeHtmlClient(title) + '...</div>';

    try {
        const data = await fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/pages/' + encodeURIComponent(key));
        if (data && data.markdown) {
            wikiState.markdownCache[cacheKey] = data.markdown;
            renderMarkdownContent(data.markdown);
            buildToc();
        } else {
            if (contentEl) contentEl.innerHTML = '<p>Content not available.</p>';
        }
    } catch (_err) {
        if (contentEl) contentEl.innerHTML = '<p>Content not available.</p>';
    }
    scrollContentTop();
}

export async function loadThemeArticle(wikiId: string, themeId: string, slug: string): Promise<void> {
    wikiState.currentComponentId = null;
    clearToc();
    setHashSilent('#wiki/' + encodeURIComponent(wikiId) + '/theme/' + encodeURIComponent(themeId) + '/' + encodeURIComponent(slug));

    const cacheKey = '__theme_' + themeId + '_' + slug;
    if (wikiState.markdownCache[cacheKey]) {
        renderMarkdownContent(wikiState.markdownCache[cacheKey]);
        buildToc();
        scrollContentTop();
        return;
    }

    const contentEl = document.getElementById('wiki-article-content');
    if (contentEl) contentEl.innerHTML = '<div class="loading">Loading article...</div>';

    try {
        const data = await fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/themes/' + encodeURIComponent(themeId) + '/' + encodeURIComponent(slug));
        if (data && (data.markdown || data.content)) {
            const md = data.markdown || data.content;
            wikiState.markdownCache[cacheKey] = md;
            renderMarkdownContent(md);
            buildToc();
        } else {
            if (contentEl) contentEl.innerHTML = '<p>Content not available.</p>';
        }
    } catch (err: any) {
        if (contentEl) {
            contentEl.innerHTML = '<p style="color: var(--status-failed);">Error loading article: ' + escapeHtmlClient(err.message) + '</p>';
        }
    }
    scrollContentTop();
}

// ================================================================
// Source files toggle
// ================================================================

export function toggleSourceFiles(): void {
    const section = document.getElementById('wiki-source-files');
    if (section) section.classList.toggle('expanded');
}

// ================================================================
// Helpers
// ================================================================

function clearToc(): void {
    const tocNav = document.getElementById('wiki-toc-nav');
    if (tocNav) tocNav.innerHTML = '';
}

function scrollContentTop(): void {
    const scrollEl = document.getElementById('wiki-content-scroll');
    if (scrollEl) scrollEl.scrollTop = 0;
}

(window as any).showWikiHome = showWikiHome;
(window as any).loadWikiComponent = loadWikiComponent;
(window as any).loadSpecialPage = loadSpecialPage;
(window as any).loadThemeArticle = loadThemeArticle;
(window as any).toggleSourceFiles = toggleSourceFiles;
(window as any).renderMillerColumns = renderMillerColumns;
