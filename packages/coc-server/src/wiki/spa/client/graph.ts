/**
 * Interactive dependency graph (D3.js).
 *
 * Contains: getCategoryColor, showGraph, renderGraph, updateGraphVisibility,
 * and drag handlers. Depends on D3.js being loaded via CDN.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { componentGraph, currentComponentId, setCurrentComponentId, escapeHtml } from './core';
import { setActive } from './sidebar';

let graphRendered = false;
const disabledCategories = new Set<string>();

const CATEGORY_COLORS = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
];

const COMPLEXITY_RADIUS: Record<string, number> = { low: 8, medium: 12, high: 18 };

function getCategoryColor(category: string, allCategories: string[]): string {
    const idx = allCategories.indexOf(category);
    return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
}

export function showGraph(skipHistory?: boolean): void {
    setCurrentComponentId(null);
    setActive('__graph');
    const tocNav = document.getElementById('toc-nav');
    if (tocNav) tocNav.innerHTML = '';
    if (!skipHistory) {
        history.pushState({ type: 'graph' }, '', location.pathname + '#graph');
    }

    const article = document.getElementById('article') as HTMLElement;
    article.style.maxWidth = '100%';
    article.style.padding = '0';

    const container = document.getElementById('content')!;
    container.innerHTML = '<div class="graph-container" id="graph-container">' +
        '<div class="graph-toolbar">' +
        '<button id="graph-zoom-in" title="Zoom in">+</button>' +
        '<button id="graph-zoom-out" title="Zoom out">\u2212</button>' +
        '<button id="graph-zoom-reset" title="Reset view">Reset</button>' +
        '</div>' +
        '<div class="graph-legend" id="graph-legend"></div>' +
        '<div class="graph-tooltip" id="graph-tooltip" style="display:none;"></div>' +
        '</div>';

    const gc = document.getElementById('graph-container')!;
    gc.style.height = (article.parentElement!.parentElement!.clientHeight - 48) + 'px';

    renderGraph();
}

export function renderGraph(): void {
    if (typeof d3 === 'undefined') return;

    const container = document.getElementById('graph-container');
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const allCategories: string[] = [];
    componentGraph.components.forEach(function (m: any) {
        if (allCategories.indexOf(m.category) === -1) allCategories.push(m.category);
    });
    allCategories.sort();

    const legendEl = document.getElementById('graph-legend')!;
    legendEl.innerHTML = '<div class="graph-legend-title">Categories</div>';
    allCategories.forEach(function (cat) {
        const color = getCategoryColor(cat, allCategories);
        const item = document.createElement('div');
        item.className = 'graph-legend-item';
        item.setAttribute('data-category', cat);
        item.innerHTML = '<div class="graph-legend-swatch" style="background:' + color + '"></div>' +
            '<span>' + escapeHtml(cat) + '</span>';
        item.onclick = function () {
            if (disabledCategories.has(cat)) {
                disabledCategories.delete(cat);
                item.classList.remove('disabled');
            } else {
                disabledCategories.add(cat);
                item.classList.add('disabled');
            }
            updateGraphVisibility();
        };
        legendEl.appendChild(item);
    });

    const nodes = componentGraph.components.map(function (m: any) {
        return { id: m.id, name: m.name, category: m.category, complexity: m.complexity, path: m.path, purpose: m.purpose };
    });

    const nodeIds = new Set(nodes.map(function (n: any) { return n.id; }));
    const links: any[] = [];
    componentGraph.components.forEach(function (m: any) {
        (m.dependencies || []).forEach(function (dep: string) {
            if (nodeIds.has(dep)) {
                links.push({ source: m.id, target: dep });
            }
        });
    });

    const svg = d3.select('#graph-container')
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    svg.append('defs').append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('class', 'graph-link-arrow');

    const g = svg.append('g');

    const link = g.selectAll('.graph-link')
        .data(links)
        .join('line')
        .attr('class', 'graph-link')
        .attr('marker-end', 'url(#arrowhead)');

    const node = g.selectAll('.graph-node')
        .data(nodes)
        .join('g')
        .attr('class', 'graph-node')
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

    node.on('click', function (event: any, d: any) {
        event.stopPropagation();
        const articleEl = document.getElementById('article');
        if (articleEl) {
            articleEl.style.maxWidth = '';
            articleEl.style.padding = '';
        }
        (window as any).loadComponent(d.id);
    });

    const tooltip = document.getElementById('graph-tooltip')!;
    node.on('mouseover', function (_event: any, d: any) {
        tooltip.style.display = 'block';
        tooltip.innerHTML = '<div class="graph-tooltip-name">' + escapeHtml(d.name) + '</div>' +
            '<div class="graph-tooltip-purpose">' + escapeHtml(d.purpose) + '</div>' +
            '<div style="margin-top:4px;font-size:11px;color:var(--content-muted);">' +
            'Complexity: ' + d.complexity + '</div>';
    });
    node.on('mousemove', function (event: any) {
        tooltip.style.left = (event.pageX + 12) + 'px';
        tooltip.style.top = (event.pageY - 12) + 'px';
    });
    node.on('mouseout', function () { tooltip.style.display = 'none'; });

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

    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', function (event: any) { g.attr('transform', event.transform); });

    svg.call(zoom);

    const zoomInBtn = document.getElementById('graph-zoom-in');
    if (zoomInBtn) zoomInBtn.onclick = function () { svg.transition().call(zoom.scaleBy, 1.3); };
    const zoomOutBtn = document.getElementById('graph-zoom-out');
    if (zoomOutBtn) zoomOutBtn.onclick = function () { svg.transition().call(zoom.scaleBy, 0.7); };
    const zoomResetBtn = document.getElementById('graph-zoom-reset');
    if (zoomResetBtn) zoomResetBtn.onclick = function () { svg.transition().call(zoom.transform, d3.zoomIdentity); };

    (window as any)._graphNode = node;
    (window as any)._graphLink = link;

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

export function updateGraphVisibility(): void {
    if (!(window as any)._graphNode) return;
    (window as any)._graphNode.style('display', function (d: any) {
        return disabledCategories.has(d.category) ? 'none' : null;
    });
    (window as any)._graphLink.style('display', function (d: any) {
        const src = typeof d.source === 'object' ? d.source : { category: '' };
        const tgt = typeof d.target === 'object' ? d.target : { category: '' };
        return (disabledCategories.has(src.category) || disabledCategories.has(tgt.category)) ? 'none' : null;
    });
}
