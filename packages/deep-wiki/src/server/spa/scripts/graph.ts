/**
 * Interactive dependency graph script (D3.js).
 *
 * Contains: getCategoryColor, showGraph, renderGraph, updateGraphVisibility,
 * and drag handlers.  Depends on D3.js being loaded via CDN in the HTML head.
 */
export function getGraphScript(): string {
    return `
        // ================================================================
        // Interactive Dependency Graph (D3.js)
        // ================================================================

        var graphRendered = false;
        var disabledCategories = new Set();

        var CATEGORY_COLORS = [
            '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
            '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
        ];

        var COMPLEXITY_RADIUS = { low: 8, medium: 12, high: 18 };

        function getCategoryColor(category, allCategories) {
            var idx = allCategories.indexOf(category);
            return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
        }

        function showGraph(skipHistory) {
            currentModuleId = null;
            setActive('__graph');
            document.getElementById('toc-nav').innerHTML = '';
            if (!skipHistory) {
                history.pushState({ type: 'graph' }, '', location.pathname + '#graph');
            }

            var article = document.getElementById('article');
            article.style.maxWidth = '100%';
            article.style.padding = '0';

            var container = document.getElementById('content');
            container.innerHTML = '<div class="graph-container" id="graph-container">' +
                '<div class="graph-toolbar">' +
                '<button id="graph-zoom-in" title="Zoom in">+</button>' +
                '<button id="graph-zoom-out" title="Zoom out">\\u2212</button>' +
                '<button id="graph-zoom-reset" title="Reset view">Reset</button>' +
                '</div>' +
                '<div class="graph-legend" id="graph-legend"></div>' +
                '<div class="graph-tooltip" id="graph-tooltip" style="display:none;"></div>' +
                '</div>';

            // Make graph fill the available space
            var gc = document.getElementById('graph-container');
            gc.style.height = (article.parentElement.parentElement.clientHeight - 48) + 'px';

            renderGraph();
        }

        function renderGraph() {
            if (typeof d3 === 'undefined') return;

            var container = document.getElementById('graph-container');
            if (!container) return;

            var width = container.clientWidth || 800;
            var height = container.clientHeight || 600;

            var allCategories = [];
            moduleGraph.modules.forEach(function(m) {
                if (allCategories.indexOf(m.category) === -1) allCategories.push(m.category);
            });
            allCategories.sort();

            var legendEl = document.getElementById('graph-legend');
            legendEl.innerHTML = '<div class="graph-legend-title">Categories</div>';
            allCategories.forEach(function(cat) {
                var color = getCategoryColor(cat, allCategories);
                var item = document.createElement('div');
                item.className = 'graph-legend-item';
                item.setAttribute('data-category', cat);
                item.innerHTML = '<div class="graph-legend-swatch" style="background:' + color + '"></div>' +
                    '<span>' + escapeHtml(cat) + '</span>';
                item.onclick = function() {
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

            var nodes = moduleGraph.modules.map(function(m) {
                return { id: m.id, name: m.name, category: m.category, complexity: m.complexity, path: m.path, purpose: m.purpose };
            });

            var nodeIds = new Set(nodes.map(function(n) { return n.id; }));
            var links = [];
            moduleGraph.modules.forEach(function(m) {
                (m.dependencies || []).forEach(function(dep) {
                    if (nodeIds.has(dep)) {
                        links.push({ source: m.id, target: dep });
                    }
                });
            });

            var svg = d3.select('#graph-container')
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

            var g = svg.append('g');

            var link = g.selectAll('.graph-link')
                .data(links)
                .join('line')
                .attr('class', 'graph-link')
                .attr('marker-end', 'url(#arrowhead)');

            var node = g.selectAll('.graph-node')
                .data(nodes)
                .join('g')
                .attr('class', 'graph-node')
                .style('cursor', 'pointer')
                .call(d3.drag()
                    .on('start', dragstarted)
                    .on('drag', dragged)
                    .on('end', dragended));

            node.append('circle')
                .attr('r', function(d) { return COMPLEXITY_RADIUS[d.complexity] || 10; })
                .attr('fill', function(d) { return getCategoryColor(d.category, allCategories); })
                .attr('stroke', '#fff')
                .attr('stroke-width', 1.5);

            node.append('text')
                .attr('dx', function(d) { return (COMPLEXITY_RADIUS[d.complexity] || 10) + 4; })
                .attr('dy', 4)
                .text(function(d) { return d.name; });

            node.on('click', function(event, d) {
                event.stopPropagation();
                // Restore article styles before loading module
                var article = document.getElementById('article');
                article.style.maxWidth = '';
                article.style.padding = '';
                loadModule(d.id);
            });

            var tooltip = document.getElementById('graph-tooltip');
            node.on('mouseover', function(event, d) {
                tooltip.style.display = 'block';
                tooltip.innerHTML = '<div class="graph-tooltip-name">' + escapeHtml(d.name) + '</div>' +
                    '<div class="graph-tooltip-purpose">' + escapeHtml(d.purpose) + '</div>' +
                    '<div style="margin-top:4px;font-size:11px;color:var(--content-muted);">' +
                    'Complexity: ' + d.complexity + '</div>';
            });
            node.on('mousemove', function(event) {
                tooltip.style.left = (event.pageX + 12) + 'px';
                tooltip.style.top = (event.pageY - 12) + 'px';
            });
            node.on('mouseout', function() { tooltip.style.display = 'none'; });

            var simulation = d3.forceSimulation(nodes)
                .force('link', d3.forceLink(links).id(function(d) { return d.id; }).distance(100))
                .force('charge', d3.forceManyBody().strength(-300))
                .force('center', d3.forceCenter(width / 2, height / 2))
                .force('collision', d3.forceCollide().radius(function(d) { return (COMPLEXITY_RADIUS[d.complexity] || 10) + 8; }))
                .on('tick', function() {
                    link.attr('x1', function(d) { return d.source.x; })
                        .attr('y1', function(d) { return d.source.y; })
                        .attr('x2', function(d) { return d.target.x; })
                        .attr('y2', function(d) { return d.target.y; });
                    node.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
                });

            var zoom = d3.zoom()
                .scaleExtent([0.1, 4])
                .on('zoom', function(event) { g.attr('transform', event.transform); });

            svg.call(zoom);

            document.getElementById('graph-zoom-in').onclick = function() { svg.transition().call(zoom.scaleBy, 1.3); };
            document.getElementById('graph-zoom-out').onclick = function() { svg.transition().call(zoom.scaleBy, 0.7); };
            document.getElementById('graph-zoom-reset').onclick = function() { svg.transition().call(zoom.transform, d3.zoomIdentity); };

            window._graphNode = node;
            window._graphLink = link;

            function dragstarted(event, d) {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
            }
            function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
            function dragended(event, d) {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null; d.fy = null;
            }

            graphRendered = true;
        }

        function updateGraphVisibility() {
            if (!window._graphNode) return;
            window._graphNode.style('display', function(d) {
                return disabledCategories.has(d.category) ? 'none' : null;
            });
            window._graphLink.style('display', function(d) {
                var src = typeof d.source === 'object' ? d.source : { category: '' };
                var tgt = typeof d.target === 'object' ? d.target : { category: '' };
                return (disabledCategories.has(src.category) || disabledCategories.has(tgt.category)) ? 'none' : null;
            });
        }`;
}
