/**
 * Wiki content loading: showWikiHome, loadWikiComponent, renderComponentPage,
 * loadSpecialPage, loadThemeArticle, toggleSourceFiles.
 *
 * Ported from deep-wiki content.ts.
 * Adapted for CoC: uses hash-based routing, wiki-scoped API endpoints,
 * and CoC-specific element IDs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { fetchApi, setHashSilent } from './core';
import { escapeHtmlClient } from './utils';
import { renderMarkdownContent, processMarkdownContent } from './wiki-markdown';
import { buildToc } from './wiki-toc';
import type { ComponentGraph, ComponentInfo } from './wiki-types';

// ================================================================
// Wiki state — scoped to the selected wiki
// ================================================================

export interface WikiState {
    wikiId: string | null;
    graph: ComponentGraph | null;
    components: ComponentInfo[];
    currentComponentId: string | null;
    markdownCache: Record<string, string>;
}

export const wikiState: WikiState = {
    wikiId: null,
    graph: null,
    components: [],
    currentComponentId: null,
    markdownCache: {},
};

export function setWikiGraph(wikiId: string, graph: ComponentGraph): void {
    wikiState.wikiId = wikiId;
    wikiState.graph = graph;
    wikiState.components = graph.components || [];
    wikiState.currentComponentId = null;
    wikiState.markdownCache = {};
}

export function clearWikiState(): void {
    wikiState.wikiId = null;
    wikiState.graph = null;
    wikiState.components = [];
    wikiState.currentComponentId = null;
    wikiState.markdownCache = {};
}

// ================================================================
// Home view
// ================================================================

export function showWikiHome(): void {
    const graph = wikiState.graph;
    if (!graph) return;

    // Restore article layout if graph was showing
    if ((window as any).hideWikiGraph) (window as any).hideWikiGraph();

    wikiState.currentComponentId = null;
    clearToc();

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
        const assignedIds = new Set<string>();
        graph.domains!.forEach(function (domain) {
            const domainComponents = graph.components.filter(function (mod) {
                if (mod.domain === domain.id) return true;
                return domain.components && domain.components.indexOf(mod.id) !== -1;
            });
            if (domainComponents.length === 0) return;

            for (const c of domainComponents) assignedIds.add(c.id);

            html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">' + escapeHtmlClient(domain.name) + '</h3>';
            if (domain.description) {
                html += '<p style="color: var(--text-secondary); margin-bottom: 12px; font-size: 14px;">' +
                    escapeHtmlClient(domain.description) + '</p>';
            }
            html += '<div class="component-grid">';
            domainComponents.forEach(function (mod) {
                html += buildComponentCard(mod);
            });
            html += '</div>';
        });

        const unassigned = graph.components.filter(function (mod) { return !assignedIds.has(mod.id); });
        if (unassigned.length > 0) {
            html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">Other</h3><div class="component-grid">';
            unassigned.forEach(function (mod) {
                html += buildComponentCard(mod);
            });
            html += '</div>';
        }
    } else {
        html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">All Components</h3><div class="component-grid">';
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

    // Attach click handlers to component cards
    document.querySelectorAll('.wiki-component-card').forEach(function (card) {
        card.addEventListener('click', function () {
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

    // Restore article layout if graph was showing
    if ((window as any).hideWikiGraph) (window as any).hideWikiGraph();

    wikiState.currentComponentId = componentId;

    // Show content area, hide empty state
    const detail = document.getElementById('wiki-component-detail');
    const empty = document.getElementById('wiki-empty');
    if (detail) detail.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');

    // Highlight active component in tree
    document.querySelectorAll('.wiki-tree-component').forEach(function (el) {
        el.classList.toggle('active', el.getAttribute('data-id') === componentId);
    });

    // Check cache
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

    // Source files section
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

    // Markdown content
    if (typeof (window as any).marked !== 'undefined') {
        html += '<div class="markdown-body">' + (window as any).marked.parse(markdown) + '</div>';
    } else {
        html += '<div class="markdown-body"><pre>' + escapeHtmlClient(markdown) + '</pre></div>';
    }

    const contentEl = document.getElementById('wiki-article-content');
    if (contentEl) contentEl.innerHTML = html;

    // Wire up source files toggle
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
