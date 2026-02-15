/**
 * Wiki dependency graph visualization (D3.js, lazy-loaded).
 *
 * Ported from deep-wiki graph.ts. Renders an interactive force-directed
 * dependency graph inside the CoC Wiki tab content area.
 * D3 v7 is loaded from CDN on first use (not bundled).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { escapeHtmlClient } from './utils';
import { wikiState } from './wiki-content';

declare const d3: any;

let graphRendered = false;
let d3Loading = false;
let d3Loaded = false;
const disabledCategories = new Set<string>();

const D3_CDN_URL = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';

const CATEGORY_COLORS = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
];

const COMPLEXITY_RADIUS: Record<string, number> = { low: 8, medium: 12, high: 18 };

function getCategoryColor(category: string, allCategories: string[]): string {
    const idx = allCategories.indexOf(category);
    return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
}

// ================================================================
// D3 lazy-loading
// ================================================================

function loadD3(): Promise<void> {
    if (d3Loaded || typeof d3 !== 'undefined') {
        d3Loaded = true;
        return Promise.resolve();
    }
    if (d3Loading) {
        // Already loading — poll until ready
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (typeof d3 !== 'undefined') {
                    clearInterval(check);
                    d3Loaded = true;
                    resolve();
                }
            }, 50);
        });
    }

    d3Loading = true;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = D3_CDN_URL;
        script.onload = () => {
            d3Loaded = true;
            d3Loading = false;
            resolve();
        };
        script.onerror = () => {
            d3Loading = false;
            reject(new Error('Failed to load D3.js'));
        };
        document.head.appendChild(script);
    });
}

// ================================================================
// Show / hide graph
// ================================================================

let graphVisible = false;

export function isGraphShowing(): boolean {
    return graphVisible;
}

export async function showWikiGraph(): Promise<void> {
    if (!wikiState.graph) return;

    graphVisible = true;
    wikiState.currentComponentId = null;

    // Clear ToC
    const tocNav = document.getElementById('wiki-toc-nav');
    if (tocNav) tocNav.innerHTML = '';

    // Hide ToC sidebar for full-width graph
    const tocSidebar = document.getElementById('wiki-toc-sidebar');
    if (tocSidebar) tocSidebar.style.display = 'none';

    // Expand article to full width, no padding
    const article = document.querySelector('.wiki-article') as HTMLElement | null;
    if (article) {
        article.style.maxWidth = '100%';
        article.style.padding = '0';
    }

    // Insert graph container
    const contentEl = document.getElementById('wiki-article-content');
    if (!contentEl) return;
    contentEl.innerHTML =
        '<div class="wiki-graph-container" id="wiki-graph-container">' +
        '<div class="wiki-graph-toolbar">' +
        '<button id="wiki-graph-zoom-in" title="Zoom in">+</button>' +
        '<button id="wiki-graph-zoom-out" title="Zoom out">\u2212</button>' +
        '<button id="wiki-graph-zoom-reset" title="Reset view">Reset</button>' +
        '</div>' +
        '<div class="wiki-graph-legend" id="wiki-graph-legend"></div>' +
        '<div class="wiki-graph-tooltip" id="wiki-graph-tooltip" style="display:none;"></div>' +
        '</div>';

    // Size graph container to fill available height
    const scrollEl = document.getElementById('wiki-content-scroll');
    if (scrollEl) {
        const gc = document.getElementById('wiki-graph-container');
        if (gc) gc.style.height = scrollEl.clientHeight + 'px';
    }

    // Highlight sidebar entry
    document.querySelectorAll('.wiki-tree-component').forEach(el => el.classList.remove('active'));
    const graphBtn = document.getElementById('wiki-graph-btn');
    if (graphBtn) graphBtn.classList.add('active');

    // Load D3 and render
    try {
        await loadD3();
        renderWikiGraph();
    } catch (_err) {
        if (contentEl) {
            contentEl.innerHTML = '<div class="empty-state"><div class="empty-state-text">Failed to load graph library.</div></div>';
        }
    }
}

export function hideWikiGraph(): void {
    graphVisible = false;
    graphRendered = false;
    disabledCategories.clear();

    // Restore article styling
    const article = document.querySelector('.wiki-article') as HTMLElement | null;
    if (article) {
        article.style.maxWidth = '';
        article.style.padding = '';
    }

    // Restore ToC sidebar
    const tocSidebar = document.getElementById('wiki-toc-sidebar');
    if (tocSidebar) tocSidebar.style.display = '';

    // Remove active state from graph button
    const graphBtn = document.getElementById('wiki-graph-btn');
    if (graphBtn) graphBtn.classList.remove('active');
}

// ================================================================
// Render graph
// ================================================================

export function renderWikiGraph(): void {
    if (typeof d3 === 'undefined') return;
    if (!wikiState.graph) return;

    const container = document.getElementById('wiki-graph-container');
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Collect unique categories
    const allCategories: string[] = [];
    wikiState.graph.components.forEach(function (m: any) {
        if (allCategories.indexOf(m.category) === -1) allCategories.push(m.category);
    });
    allCategories.sort();

    // Build legend
    const legendEl = document.getElementById('wiki-graph-legend')!;
    legendEl.innerHTML = '<div class="wiki-graph-legend-title">Categories</div>';
    allCategories.forEach(function (cat) {
        const color = getCategoryColor(cat, allCategories);
        const item = document.createElement('div');
        item.className = 'wiki-graph-legend-item';
        item.setAttribute('data-category', cat);
        item.innerHTML = '<div class="wiki-graph-legend-swatch" style="background:' + color + '"></div>' +
            '<span>' + escapeHtmlClient(cat) + '</span>';
        item.onclick = function () {
            if (disabledCategories.has(cat)) {
                disabledCategories.delete(cat);
                item.classList.remove('disabled');
            } else {
                disabledCategories.add(cat);
                item.classList.add('disabled');
            }
            updateWikiGraphVisibility();
        };
        legendEl.appendChild(item);
    });

    // Build nodes and links from component graph
    const nodes = wikiState.graph.components.map(function (m: any) {
        return { id: m.id, name: m.name, category: m.category, complexity: m.complexity || 'medium', path: m.path, purpose: m.purpose };
    });

    const nodeIds = new Set(nodes.map(function (n: any) { return n.id; }));
    const links: any[] = [];
    wikiState.graph.components.forEach(function (m: any) {
        (m.dependencies || []).forEach(function (dep: string) {
            if (nodeIds.has(dep)) {
                links.push({ source: m.id, target: dep });
            }
        });
    });

    // Create SVG
    const svg = d3.select('#wiki-graph-container')
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    svg.append('defs').append('marker')
        .attr('id', 'wiki-arrowhead')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('class', 'wiki-graph-link-arrow');

    const g = svg.append('g');

    const link = g.selectAll('.wiki-graph-link')
        .data(links)
        .join('line')
        .attr('class', 'wiki-graph-link')
        .attr('marker-end', 'url(#wiki-arrowhead)');

    const node = g.selectAll('.wiki-graph-node')
        .data(nodes)
        .join('g')
        .attr('class', 'wiki-graph-node')
        .style('cursor', 'pointer')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));

    node.append('circle')
        .attr('r', function (d: any) { return COMPLEXITY_RADIUS[d.complexity] || 10; })
        .attr('fill', function (d: any) { return getCategoryColor(d.category, allCategories); })
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5);

    node.append('text')
        .attr('dx', function (d: any) { return (COMPLEXITY_RADIUS[d.complexity] || 10) + 4; })
        .attr('dy', 4)
        .text(function (d: any) { return d.name; });

    // Node click → navigate to component
    node.on('click', function (event: any, d: any) {
        event.stopPropagation();
        hideWikiGraph();
        if (wikiState.wikiId) {
            (window as any).showWikiComponent?.(wikiState.wikiId, d.id);
        }
    });

    // Tooltip
    const tooltip = document.getElementById('wiki-graph-tooltip')!;
    node.on('mouseover', function (_event: any, d: any) {
        tooltip.style.display = 'block';
        tooltip.innerHTML = '<div class="wiki-graph-tooltip-name">' + escapeHtmlClient(d.name) + '</div>' +
            '<div class="wiki-graph-tooltip-purpose">' + escapeHtmlClient(d.purpose) + '</div>' +
            '<div style="margin-top:4px;font-size:11px;color:var(--content-muted);">' +
            'Complexity: ' + d.complexity + '</div>';
    });
    node.on('mousemove', function (event: any) {
        tooltip.style.left = (event.pageX + 12) + 'px';
        tooltip.style.top = (event.pageY - 12) + 'px';
    });
    node.on('mouseout', function () { tooltip.style.display = 'none'; });

    // Force simulation
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(function (d: any) { return d.id; }).distance(100))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(function (d: any) { return (COMPLEXITY_RADIUS[d.complexity] || 10) + 8; }))
        .on('tick', function () {
            link.attr('x1', function (d: any) { return d.source.x; })
                .attr('y1', function (d: any) { return d.source.y; })
                .attr('x2', function (d: any) { return d.target.x; })
                .attr('y2', function (d: any) { return d.target.y; });
            node.attr('transform', function (d: any) { return 'translate(' + d.x + ',' + d.y + ')'; });
        });

    // Zoom & pan
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', function (event: any) { g.attr('transform', event.transform); });

    svg.call(zoom);

    // Zoom toolbar
    const zoomInBtn = document.getElementById('wiki-graph-zoom-in');
    if (zoomInBtn) zoomInBtn.onclick = function () { svg.transition().call(zoom.scaleBy, 1.3); };
    const zoomOutBtn = document.getElementById('wiki-graph-zoom-out');
    if (zoomOutBtn) zoomOutBtn.onclick = function () { svg.transition().call(zoom.scaleBy, 0.7); };
    const zoomResetBtn = document.getElementById('wiki-graph-zoom-reset');
    if (zoomResetBtn) zoomResetBtn.onclick = function () { svg.transition().call(zoom.transform, d3.zoomIdentity); };

    // Store references for visibility toggling
    (window as any)._wikiGraphNode = node;
    (window as any)._wikiGraphLink = link;

    function dragstarted(event: any, d: any) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
    }
    function dragged(event: any, d: any) { d.fx = event.x; d.fy = event.y; }
    function dragended(event: any, d: any) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
    }

    graphRendered = true;
}

// ================================================================
// Category visibility toggle
// ================================================================

export function updateWikiGraphVisibility(): void {
    if (!(window as any)._wikiGraphNode) return;
    (window as any)._wikiGraphNode.style('display', function (d: any) {
        return disabledCategories.has(d.category) ? 'none' : null;
    });
    (window as any)._wikiGraphLink.style('display', function (d: any) {
        const src = typeof d.source === 'object' ? d.source : { category: '' };
        const tgt = typeof d.target === 'object' ? d.target : { category: '' };
        return (disabledCategories.has(src.category) || disabledCategories.has(tgt.category)) ? 'none' : null;
    });
}

// ================================================================
// Expose for global access
// ================================================================

(window as any).showWikiGraph = showWikiGraph;
(window as any).hideWikiGraph = hideWikiGraph;
