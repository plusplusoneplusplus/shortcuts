/**
 * SPA Dashboard Tests — Wiki dependency graph (D3.js lazy-loading, rendering, interactions)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

function readClientFile(name: string): string {
    return fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8');
}

// ============================================================================
// Source file existence
// ============================================================================

describe('wiki-graph source file', () => {
    it('should have client/wiki-graph.ts', () => {
        expect(fs.existsSync(path.join(CLIENT_DIR, 'wiki-graph.ts'))).toBe(true);
    });

    it('should not contain var declarations', () => {
        const content = readClientFile('wiki-graph.ts');
        const varMatches = content.match(/^\s*var\s+/gm);
        expect(varMatches).toBeNull();
    });
});

// ============================================================================
// Module structure — wiki-graph.ts
// ============================================================================

describe('wiki-graph.ts — module structure', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-graph.ts'); });

    it('exports showWikiGraph function', () => {
        expect(content).toContain('export async function showWikiGraph');
    });

    it('exports hideWikiGraph function', () => {
        expect(content).toContain('export function hideWikiGraph');
    });

    it('exports isGraphShowing function', () => {
        expect(content).toContain('export function isGraphShowing');
    });

    it('exports renderWikiGraph function', () => {
        expect(content).toContain('export function renderWikiGraph');
    });

    it('exports updateWikiGraphVisibility function', () => {
        expect(content).toContain('export function updateWikiGraphVisibility');
    });

    it('imports wikiState from wiki-content', () => {
        expect(content).toContain("import { wikiState }");
        expect(content).toContain("from './wiki-content'");
    });

    it('imports escapeHtmlClient from utils', () => {
        expect(content).toContain("import { escapeHtmlClient }");
        expect(content).toContain("from './utils'");
    });

    it('exposes showWikiGraph on window', () => {
        expect(content).toContain('window as any).showWikiGraph');
    });

    it('exposes hideWikiGraph on window', () => {
        expect(content).toContain('window as any).hideWikiGraph');
    });
});

// ============================================================================
// D3 lazy-loading
// ============================================================================

describe('wiki-graph.ts — D3 lazy-loading', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-graph.ts'); });

    it('defines D3 CDN URL constant', () => {
        expect(content).toContain('https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js');
    });

    it('has loadD3 function for dynamic script injection', () => {
        expect(content).toContain('function loadD3');
    });

    it('creates script element for D3', () => {
        expect(content).toContain("document.createElement('script')");
    });

    it('appends script to document head', () => {
        expect(content).toContain('document.head.appendChild(script)');
    });

    it('guards renderWikiGraph with d3 undefined check', () => {
        expect(content).toContain("if (typeof d3 === 'undefined') return");
    });

    it('tracks d3Loading state to prevent duplicate loads', () => {
        expect(content).toContain('d3Loading');
        expect(content).toContain('d3Loaded');
    });

    it('listens for script onload event', () => {
        expect(content).toContain('script.onload');
    });

    it('handles script load error', () => {
        expect(content).toContain('script.onerror');
    });

    it('declares d3 as global type', () => {
        expect(content).toContain('declare const d3: any');
    });
});

// ============================================================================
// Graph rendering
// ============================================================================

describe('wiki-graph.ts — graph rendering', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-graph.ts'); });

    it('uses D3 force simulation', () => {
        expect(content).toContain('d3.forceSimulation');
    });

    it('uses D3 forceLink with 100px distance', () => {
        expect(content).toContain('d3.forceLink');
        expect(content).toContain('.distance(100)');
    });

    it('uses D3 forceManyBody with -300 strength', () => {
        expect(content).toContain('d3.forceManyBody().strength(-300)');
    });

    it('uses D3 forceCenter', () => {
        expect(content).toContain('d3.forceCenter');
    });

    it('uses D3 forceCollide', () => {
        expect(content).toContain('d3.forceCollide');
    });

    it('creates SVG element in graph container', () => {
        expect(content).toContain("d3.select('#wiki-graph-container')");
        expect(content).toContain(".append('svg')");
    });

    it('defines arrowhead marker for directed edges', () => {
        expect(content).toContain("'wiki-arrowhead'");
        expect(content).toContain('wiki-graph-link-arrow');
    });

    it('creates graph links (edges)', () => {
        expect(content).toContain('.wiki-graph-link');
    });

    it('creates graph nodes', () => {
        expect(content).toContain('.wiki-graph-node');
    });
});

// ============================================================================
// Node complexity and category
// ============================================================================

describe('wiki-graph.ts — node sizing and coloring', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-graph.ts'); });

    it('defines COMPLEXITY_RADIUS with low=8, medium=12, high=18', () => {
        expect(content).toContain('low: 8');
        expect(content).toContain('medium: 12');
        expect(content).toContain('high: 18');
    });

    it('defines 10-color CATEGORY_COLORS palette', () => {
        expect(content).toContain('CATEGORY_COLORS');
        expect(content).toContain('#3b82f6');
        expect(content).toContain('#6366f1');
    });

    it('maps category index to color', () => {
        expect(content).toContain('function getCategoryColor');
    });

    it('sets circle radius based on complexity', () => {
        expect(content).toContain('COMPLEXITY_RADIUS[d.complexity]');
    });

    it('sets circle fill based on category color', () => {
        expect(content).toContain('getCategoryColor(d.category, allCategories)');
    });
});

// ============================================================================
// Interactive behaviors — node click
// ============================================================================

describe('wiki-graph.ts — node click navigation', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-graph.ts'); });

    it('handles node click events', () => {
        expect(content).toContain("node.on('click'");
    });

    it('calls showWikiComponent on node click', () => {
        expect(content).toContain('showWikiComponent');
    });

    it('calls hideWikiGraph before navigating', () => {
        expect(content).toContain('hideWikiGraph()');
    });

    it('stops event propagation on click', () => {
        expect(content).toContain('event.stopPropagation()');
    });
});

// ============================================================================
// Interactive behaviors — tooltip
// ============================================================================

describe('wiki-graph.ts — tooltip', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-graph.ts'); });

    it('creates tooltip element reference', () => {
        expect(content).toContain("getElementById('wiki-graph-tooltip')");
    });

    it('shows tooltip on mouseover', () => {
        expect(content).toContain("node.on('mouseover'");
    });

    it('positions tooltip on mousemove', () => {
        expect(content).toContain("node.on('mousemove'");
        expect(content).toContain('event.pageX');
        expect(content).toContain('event.pageY');
    });

    it('hides tooltip on mouseout', () => {
        expect(content).toContain("node.on('mouseout'");
        expect(content).toContain("tooltip.style.display = 'none'");
    });

    it('tooltip shows component name', () => {
        expect(content).toContain('wiki-graph-tooltip-name');
    });

    it('tooltip shows component purpose', () => {
        expect(content).toContain('wiki-graph-tooltip-purpose');
    });

    it('tooltip shows complexity', () => {
        expect(content).toContain('Complexity:');
    });
});

// ============================================================================
// Interactive behaviors — zoom & pan
// ============================================================================

describe('wiki-graph.ts — zoom and pan', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-graph.ts'); });

    it('uses D3 zoom with scaleExtent [0.1, 4]', () => {
        expect(content).toContain('d3.zoom()');
        expect(content).toContain('.scaleExtent([0.1, 4])');
    });

    it('zoom-in button scales by 1.3', () => {
        expect(content).toContain("getElementById('wiki-graph-zoom-in')");
        expect(content).toContain('zoom.scaleBy, 1.3');
    });

    it('zoom-out button scales by 0.7', () => {
        expect(content).toContain("getElementById('wiki-graph-zoom-out')");
        expect(content).toContain('zoom.scaleBy, 0.7');
    });

    it('zoom-reset button resets to identity', () => {
        expect(content).toContain("getElementById('wiki-graph-zoom-reset')");
        expect(content).toContain('d3.zoomIdentity');
    });

    it('applies zoom transform to group element', () => {
        expect(content).toContain("g.attr('transform', event.transform)");
    });
});

// ============================================================================
// Interactive behaviors — drag
// ============================================================================

describe('wiki-graph.ts — drag behavior', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-graph.ts'); });

    it('uses D3 drag', () => {
        expect(content).toContain('d3.drag()');
    });

    it('pins node on dragstarted (fx/fy)', () => {
        expect(content).toContain('function dragstarted');
        expect(content).toContain('d.fx = d.x');
        expect(content).toContain('d.fy = d.y');
    });

    it('reheats simulation on drag (alphaTarget 0.3)', () => {
        expect(content).toContain('simulation.alphaTarget(0.3).restart()');
    });

    it('moves node on dragged', () => {
        expect(content).toContain('function dragged');
        expect(content).toContain('d.fx = event.x');
    });

    it('unpins node on dragended', () => {
        expect(content).toContain('function dragended');
        expect(content).toContain('d.fx = null');
        expect(content).toContain('d.fy = null');
    });

    it('cools simulation on drag end (alphaTarget 0)', () => {
        expect(content).toContain('simulation.alphaTarget(0)');
    });
});

// ============================================================================
// Category legend toggle
// ============================================================================

describe('wiki-graph.ts — category legend toggle', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-graph.ts'); });

    it('tracks disabled categories in a Set', () => {
        expect(content).toContain('disabledCategories');
        expect(content).toContain('new Set<string>()');
    });

    it('builds legend items with category swatches', () => {
        expect(content).toContain('wiki-graph-legend-item');
        expect(content).toContain('wiki-graph-legend-swatch');
    });

    it('toggles disabled class on legend click', () => {
        expect(content).toContain("item.classList.remove('disabled')");
        expect(content).toContain("item.classList.add('disabled')");
    });

    it('calls updateWikiGraphVisibility on toggle', () => {
        expect(content).toContain('updateWikiGraphVisibility()');
    });

    it('hides nodes of disabled categories', () => {
        expect(content).toContain("disabledCategories.has(d.category) ? 'none' : null");
    });

    it('hides links where either endpoint is disabled', () => {
        expect(content).toContain('disabledCategories.has(src.category)');
        expect(content).toContain('disabledCategories.has(tgt.category)');
    });
});

// ============================================================================
// Graph show / hide lifecycle
// ============================================================================

describe('wiki-graph.ts — show/hide lifecycle', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-graph.ts'); });

    it('showWikiGraph hides ToC sidebar', () => {
        expect(content).toContain("tocSidebar.style.display = 'none'");
    });

    it('showWikiGraph sets article to full width with no padding', () => {
        expect(content).toContain("article.style.maxWidth = '100%'");
        expect(content).toContain("article.style.padding = '0'");
    });

    it('showWikiGraph inserts graph container HTML', () => {
        expect(content).toContain('wiki-graph-container');
        expect(content).toContain('wiki-graph-toolbar');
        expect(content).toContain('wiki-graph-legend');
        expect(content).toContain('wiki-graph-tooltip');
    });

    it('showWikiGraph sizes container to fit available height', () => {
        expect(content).toContain('scrollEl.clientHeight');
    });

    it('hideWikiGraph restores article styling', () => {
        expect(content).toContain("article.style.maxWidth = ''");
        expect(content).toContain("article.style.padding = ''");
    });

    it('hideWikiGraph restores ToC sidebar', () => {
        expect(content).toContain("tocSidebar.style.display = ''");
    });

    it('hideWikiGraph clears disabled categories', () => {
        expect(content).toContain('disabledCategories.clear()');
    });
});

// ============================================================================
// Graph updates when wiki changes
// ============================================================================

describe('wiki-graph.ts — wiki change handling', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-graph.ts'); });

    it('reads components from wikiState.graph', () => {
        expect(content).toContain('wikiState.graph.components');
    });

    it('extracts nodes from component graph', () => {
        expect(content).toContain('wikiState.graph.components.map');
    });

    it('extracts links from component dependencies', () => {
        expect(content).toContain('m.dependencies');
    });

    it('guards against missing graph', () => {
        expect(content).toContain('if (!wikiState.graph) return');
    });
});

// ============================================================================
// wiki-content.ts — graph restoration
// ============================================================================

describe('wiki-content.ts — graph cleanup on navigation', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-content.ts'); });

    it('showWikiHome calls hideWikiGraph', () => {
        expect(content).toContain('hideWikiGraph');
    });

    it('loadWikiComponent calls hideWikiGraph', () => {
        // Both showWikiHome and loadWikiComponent call hideWikiGraph
        const matches = content.match(/hideWikiGraph/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
});

// ============================================================================
// Client bundle — wiki-graph in bundle
// ============================================================================

describe('client bundle — wiki-graph module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('bundle contains showWikiGraph', () => {
        expect(script).toContain('showWikiGraph');
    });

    it('bundle contains hideWikiGraph', () => {
        expect(script).toContain('hideWikiGraph');
    });

    it('bundle contains renderWikiGraph', () => {
        expect(script).toContain('renderWikiGraph');
    });

    it('bundle contains D3 CDN URL for lazy-loading', () => {
        expect(script).toContain('d3@7/dist/d3.min.js');
    });

    it('bundle contains graph force simulation setup', () => {
        expect(script).toContain('forceSimulation');
    });

    it('bundle contains graph zoom setup', () => {
        expect(script).toContain('scaleExtent');
    });
});

// ============================================================================
// HTML template — graph button
// ============================================================================

describe('HTML template — wiki graph button', () => {
    const html = generateDashboardHtml();

    it('contains graph button container', () => {
        expect(html).toContain('id="wiki-graph-btn-container"');
    });

    it('graph button container is hidden by default', () => {
        expect(html).toMatch(/class="[^"]*hidden[^"]*"\s+id="wiki-graph-btn-container"/);
    });

    it('contains graph button', () => {
        expect(html).toContain('id="wiki-graph-btn"');
    });

    it('graph button text says Dependency Graph', () => {
        expect(html).toContain('Dependency Graph');
    });

    it('graph button is before component tree', () => {
        const btnIdx = html.indexOf('id="wiki-graph-btn-container"');
        const treeIdx = html.indexOf('id="wiki-component-tree"');
        expect(btnIdx).toBeGreaterThan(-1);
        expect(treeIdx).toBeGreaterThan(btnIdx);
    });
});

// ============================================================================
// CSS — graph styles
// ============================================================================

describe('CSS — wiki graph styles', () => {
    const css = fs.readFileSync(path.join(CLIENT_DIR, 'styles.css'), 'utf8') + fs.readFileSync(path.join(CLIENT_DIR, 'wiki-styles.css'), 'utf8');

    it('defines wiki-graph-container', () => {
        expect(css).toContain('.wiki-graph-container');
    });

    it('defines wiki-graph-toolbar', () => {
        expect(css).toContain('.wiki-graph-toolbar');
    });

    it('defines wiki-graph-legend', () => {
        expect(css).toContain('.wiki-graph-legend');
    });

    it('defines wiki-graph-tooltip', () => {
        expect(css).toContain('.wiki-graph-tooltip');
    });

    it('defines wiki-graph-node text', () => {
        expect(css).toContain('.wiki-graph-node text');
    });

    it('defines wiki-graph-link', () => {
        expect(css).toContain('.wiki-graph-link');
    });

    it('defines wiki-graph-link-arrow', () => {
        expect(css).toContain('.wiki-graph-link-arrow');
    });

    it('defines wiki-graph-btn styles', () => {
        expect(css).toContain('.wiki-graph-btn');
    });

    it('defines wiki-graph-btn active state', () => {
        expect(css).toContain('.wiki-graph-btn.active');
    });

    it('defines wiki-graph-legend-item', () => {
        expect(css).toContain('.wiki-graph-legend-item');
    });

    it('defines wiki-graph-legend-item disabled state', () => {
        expect(css).toContain('.wiki-graph-legend-item.disabled');
    });

    it('defines wiki-graph-tooltip-name', () => {
        expect(css).toContain('.wiki-graph-tooltip-name');
    });

    it('defines wiki-graph-tooltip-purpose', () => {
        expect(css).toContain('.wiki-graph-tooltip-purpose');
    });

    it('uses var(--text-primary) instead of --content-text for node text', () => {
        expect(css).toContain('.wiki-graph-node text');
        // Extract the wiki-graph-node text rule
        const nodeTextMatch = css.match(/\.wiki-graph-node text\s*\{[^}]+\}/);
        expect(nodeTextMatch).not.toBeNull();
        expect(nodeTextMatch![0]).toContain('--text-primary');
    });

    it('uses theme-compatible CSS variables', () => {
        expect(css).toContain('var(--card-bg)');
        expect(css).toContain('var(--content-border)');
        expect(css).toContain('var(--content-muted)');
    });
});

// ============================================================================
// wiki.ts — graph button wiring
// ============================================================================

describe('wiki.ts — graph button integration', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('imports showWikiGraph from wiki-graph', () => {
        expect(content).toContain("import { showWikiGraph");
        expect(content).toContain("from './wiki-graph'");
    });

    it('shows graph button container when wiki is selected', () => {
        expect(content).toContain("wiki-graph-btn-container");
        expect(content).toContain("graphBtnContainer.classList.remove('hidden')");
    });

    it('hides graph button container when no wiki is selected', () => {
        expect(content).toContain("graphBtnContainer.classList.add('hidden')");
    });

    it('wires click listener on graph button', () => {
        expect(content).toContain("getElementById('wiki-graph-btn')");
        expect(content).toContain('showWikiGraph()');
    });
});

// ============================================================================
// index.ts — wiki-graph import
// ============================================================================

describe('index.ts — wiki-graph import', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('index.ts'); });

    it('imports wiki-graph module', () => {
        expect(content).toContain("import './wiki-graph'");
    });

    it('wiki-graph import is with other wiki imports', () => {
        const wikiIdx = content.indexOf("import './wiki'");
        const graphIdx = content.indexOf("import './wiki-graph'");
        const wsIdx = content.indexOf("import './websocket'");
        expect(graphIdx).toBeGreaterThan(wikiIdx);
        expect(graphIdx).toBeLessThan(wsIdx);
    });
});
