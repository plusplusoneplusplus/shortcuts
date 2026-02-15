/**
 * Interactive Dependency Graph Tests
 *
 * Tests for the D3.js force-directed graph in the SPA template.
 * Verifies graph rendering infrastructure, category filtering,
 * zoom/pan controls, tooltips, and navigation integration.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { generateSpaHtml } from '../../src/server/spa-template';
import { createServer, type WikiServer } from '../../src/server';
import type { ComponentGraph } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let server: WikiServer | null = null;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-graph-test-'));
});

afterEach(async () => {
    if (server) {
        await server.close();
        server = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function getGraphHtml(): string {
    return generateSpaHtml({
        theme: 'auto',
        title: 'Test',
        enableSearch: true,
        enableAI: false,
        enableGraph: true,
    });
}

function getNoGraphHtml(): string {
    return generateSpaHtml({
        theme: 'auto',
        title: 'Test',
        enableSearch: true,
        enableAI: false,
        enableGraph: false,
    });
}

function setupWikiDir(): string {
    const wikiDir = path.join(tempDir, 'wiki');
    const componentsDir = path.join(wikiDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });

    const graph: ComponentGraph = {
        project: {
            name: 'TestProject',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        components: [
            {
                id: 'auth',
                name: 'Auth Module',
                path: 'src/auth/',
                purpose: 'Handles authentication',
                keyFiles: ['src/auth/index.ts'],
                dependencies: ['database'],
                dependents: ['api'],
                complexity: 'high',
                category: 'core',
            },
            {
                id: 'database',
                name: 'Database Module',
                path: 'src/database/',
                purpose: 'Database access layer',
                keyFiles: ['src/database/index.ts'],
                dependencies: [],
                dependents: ['auth'],
                complexity: 'medium',
                category: 'core',
            },
            {
                id: 'utils',
                name: 'Utilities',
                path: 'src/utils/',
                purpose: 'Shared utility functions',
                keyFiles: ['src/utils/index.ts'],
                dependencies: [],
                dependents: [],
                complexity: 'low',
                category: 'utility',
            },
        ],
        categories: [
            { name: 'core', description: 'Core functionality' },
            { name: 'utility', description: 'Utility modules' },
        ],
        architectureNotes: 'Layered architecture.',
    };

    fs.writeFileSync(
        path.join(wikiDir, 'component-graph.json'),
        JSON.stringify(graph, null, 2),
        'utf-8'
    );
    fs.writeFileSync(path.join(componentsDir, 'auth.md'), '# Auth Module', 'utf-8');
    fs.writeFileSync(path.join(componentsDir, 'database.md'), '# Database Module', 'utf-8');
    fs.writeFileSync(path.join(componentsDir, 'utils.md'), '# Utilities', 'utf-8');

    return wikiDir;
}

function fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// ============================================================================
// D3.js CDN
// ============================================================================

describe('Dependency Graph — D3.js CDN', () => {
    it('should include D3.js CDN link when graph is enabled', () => {
        const html = getGraphHtml();
        expect(html).toContain('d3.min.js');
        expect(html).toContain('cdn.jsdelivr.net/npm/d3');
    });

    it('should NOT include D3.js CDN link when graph is disabled', () => {
        const html = getNoGraphHtml();
        expect(html).not.toContain('d3.min.js');
    });
});

// ============================================================================
// Graph Nav Item
// ============================================================================

describe('Dependency Graph — navigation', () => {
    it('should include Graph nav item in sidebar when enabled', () => {
        const html = getGraphHtml();
        expect(html).toContain('data-id="__graph"');
        expect(html).toContain('Dependency Graph');
    });

    it('should always include Graph nav item since bundle includes all code', () => {
        const html = getNoGraphHtml();
        expect(html).toContain('data-id="__graph"');
        expect(html).toContain('enableGraph: false');
    });

    it('should have onclick handler to showGraph', () => {
        const html = getGraphHtml();
        expect(html).toContain('onclick="showGraph()"');
    });
});

// ============================================================================
// showGraph Function
// ============================================================================

describe('Dependency Graph — showGraph function', () => {
    it('should define showGraph function', () => {
        const html = getGraphHtml();
        expect(html).toContain('function showGraph(');
    });

    it('should always include showGraph in bundle even when graph is disabled', () => {
        const html = getNoGraphHtml();
        expect(html).toContain('function showGraph(');
        // Config should have enableGraph: false
        expect(html).toContain('enableGraph: false');
    });

    it('should push graph state to history', () => {
        const html = getGraphHtml();
        expect(html).toContain('history.pushState({ type: "graph" }');
    });

    it('should reference Dependency Graph text', () => {
        const html = getGraphHtml();
        expect(html).toContain("Dependency Graph");
    });

    it('should create graph-container DOM element', () => {
        const html = getGraphHtml();
        expect(html).toContain('graph-container');
    });
});

// ============================================================================
// Graph Rendering
// ============================================================================

describe('Dependency Graph — rendering', () => {
    it('should define renderGraph function', () => {
        const html = getGraphHtml();
        expect(html).toContain('function renderGraph()');
    });

    it('should create SVG element via D3', () => {
        const html = getGraphHtml();
        expect(html).toContain('d3.select("#graph-container")');
        expect(html).toContain('.append("svg")');
    });

    it('should create force simulation', () => {
        const html = getGraphHtml();
        expect(html).toContain('d3.forceSimulation');
        expect(html).toContain("d3.forceLink(links)");
        expect(html).toContain('d3.forceManyBody');
        expect(html).toContain('d3.forceCenter');
        expect(html).toContain('d3.forceCollide');
    });

    it('should create arrow markers for directed edges', () => {
        const html = getGraphHtml();
        expect(html).toContain('"arrowhead"');
        expect(html).toContain('marker-end');
    });

    it('should size nodes by complexity', () => {
        const html = getGraphHtml();
        expect(html).toContain('COMPLEXITY_RADIUS');
        expect(html).toContain("low: 8");
        expect(html).toContain("medium: 12");
        expect(html).toContain("high: 18");
    });

    it('should color nodes by category', () => {
        const html = getGraphHtml();
        expect(html).toContain('CATEGORY_COLORS');
        expect(html).toContain('getCategoryColor');
    });
});

// ============================================================================
// Category Filter
// ============================================================================

describe('Dependency Graph — category filter', () => {
    it('should include graph-legend element', () => {
        const html = getGraphHtml();
        expect(html).toContain('graph-legend');
    });

    it('should build legend with category items', () => {
        const html = getGraphHtml();
        expect(html).toContain('graph-legend-item');
        expect(html).toContain('graph-legend-swatch');
    });

    it('should toggle category visibility on click', () => {
        const html = getGraphHtml();
        expect(html).toContain('disabledCategories');
        expect(html).toContain('updateGraphVisibility');
    });

    it('should define updateGraphVisibility function', () => {
        const html = getGraphHtml();
        expect(html).toContain('function updateGraphVisibility()');
    });

    it('should hide nodes of disabled categories', () => {
        const html = getGraphHtml();
        expect(html).toContain("disabledCategories.has(d.category)");
    });

    it('should hide links connected to disabled categories', () => {
        const html = getGraphHtml();
        expect(html).toContain("disabledCategories.has(src.category)");
        expect(html).toContain("disabledCategories.has(tgt.category)");
    });

    it('should add/remove disabled class on legend items', () => {
        const html = getGraphHtml();
        expect(html).toContain('item.classList.remove("disabled")');
        expect(html).toContain('item.classList.add("disabled")');
    });
});

// ============================================================================
// Zoom/Pan Controls
// ============================================================================

describe('Dependency Graph — zoom/pan', () => {
    it('should include zoom toolbar buttons', () => {
        const html = getGraphHtml();
        expect(html).toContain('graph-zoom-in');
        expect(html).toContain('graph-zoom-out');
        expect(html).toContain('graph-zoom-reset');
    });

    it('should set up D3 zoom behavior', () => {
        const html = getGraphHtml();
        expect(html).toContain('d3.zoom()');
        expect(html).toContain('scaleExtent');
    });

    it('should implement zoom in button', () => {
        const html = getGraphHtml();
        expect(html).toContain('zoom.scaleBy, 1.3');
    });

    it('should implement zoom out button', () => {
        const html = getGraphHtml();
        expect(html).toContain('zoom.scaleBy, 0.7');
    });

    it('should implement zoom reset button', () => {
        const html = getGraphHtml();
        expect(html).toContain('d3.zoomIdentity');
    });
});

// ============================================================================
// Tooltips
// ============================================================================

describe('Dependency Graph — tooltips', () => {
    it('should include tooltip element', () => {
        const html = getGraphHtml();
        expect(html).toContain('graph-tooltip');
    });

    it('should show tooltip on mouseover', () => {
        const html = getGraphHtml();
        expect(html).toContain('"mouseover"');
        expect(html).toContain('graph-tooltip-name');
        expect(html).toContain('graph-tooltip-purpose');
    });

    it('should move tooltip on mousemove', () => {
        const html = getGraphHtml();
        expect(html).toContain('"mousemove"');
        expect(html).toContain('event.pageX');
    });

    it('should hide tooltip on mouseout', () => {
        const html = getGraphHtml();
        expect(html).toContain('"mouseout"');
        expect(html).toContain('display = "none"');
    });

    it('should show module complexity in tooltip', () => {
        const html = getGraphHtml();
        expect(html).toContain('Complexity: ');
    });
});

// ============================================================================
// Node Click Navigation
// ============================================================================

describe('Dependency Graph — node click navigation', () => {
    it('should call loadModule on node click', () => {
        const html = getGraphHtml();
        expect(html).toContain('loadModule(d.id)');
    });

    it('should stop event propagation on click', () => {
        const html = getGraphHtml();
        expect(html).toContain('event.stopPropagation()');
    });
});

// ============================================================================
// Drag Support
// ============================================================================

describe('Dependency Graph — drag', () => {
    it('should set up D3 drag behavior', () => {
        const html = getGraphHtml();
        expect(html).toContain('d3.drag()');
    });

    it('should have dragstarted, dragged, dragended handlers', () => {
        const html = getGraphHtml();
        expect(html).toContain('function dragstarted');
        expect(html).toContain('function dragged');
        expect(html).toContain('function dragended');
    });

    it('should fix node position during drag', () => {
        const html = getGraphHtml();
        expect(html).toContain('d.fx = d.x');
        expect(html).toContain('d.fy = d.y');
    });

    it('should release node position after drag', () => {
        const html = getGraphHtml();
        expect(html).toContain('d.fx = null');
        expect(html).toContain('d.fy = null');
    });
});

// ============================================================================
// History Integration
// ============================================================================

describe('Dependency Graph — history', () => {
    it('should handle graph state in popstate', () => {
        const html = getGraphHtml();
        expect(html).toContain('state.type === "graph"');
    });

    it('should call showGraph on graph popstate', () => {
        const html = getGraphHtml();
        expect(html).toContain('showGraph(true)');
    });
});

// ============================================================================
// Content Style Restoration
// ============================================================================

describe('Dependency Graph — content style restoration', () => {
    it('should restore article styles when clicking graph node to navigate', () => {
        const html = getGraphHtml();
        // When navigating from graph to module, article styles are restored
        expect(html).toContain('articleEl.style.maxWidth = ""');
        expect(html).toContain("articleEl.style.padding");
    });

    it('should clear TOC on showGraph', () => {
        const html = getGraphHtml();
        expect(html).toContain('getElementById("toc-nav")');
        expect(html).toContain('innerHTML = ""');
    });
});

// ============================================================================
// Graph Styles
// ============================================================================

describe('Dependency Graph — CSS styles', () => {
    it('should include graph container styles', () => {
        const html = getGraphHtml();
        expect(html).toContain('.graph-container');
    });

    it('should include graph toolbar styles', () => {
        const html = getGraphHtml();
        expect(html).toContain('.graph-toolbar');
    });

    it('should include graph legend styles', () => {
        const html = getGraphHtml();
        expect(html).toContain('.graph-legend');
        expect(html).toContain('.graph-legend-item');
        expect(html).toContain('.graph-legend-swatch');
    });

    it('should include graph link styles', () => {
        const html = getGraphHtml();
        expect(html).toContain('.graph-link');
    });

    it('should include graph tooltip styles', () => {
        const html = getGraphHtml();
        expect(html).toContain('.graph-tooltip');
    });

    it('should include disabled legend item styles', () => {
        const html = getGraphHtml();
        expect(html).toContain('.graph-legend-item.disabled');
    });
});

// ============================================================================
// Cross-theme Consistency
// ============================================================================

describe('Dependency Graph — cross-theme', () => {
    it('graph features should be present across all themes', () => {
        const themes: Array<'auto' | 'dark' | 'light'> = ['auto', 'dark', 'light'];
        for (const theme of themes) {
            const html = generateSpaHtml({
                theme,
                title: 'Test',
                enableSearch: true,
                enableAI: false,
                enableGraph: true,
            });
            expect(html).toContain('showGraph');
            expect(html).toContain('renderGraph');
            expect(html).toContain('d3.min.js');
        }
    });
});

// ============================================================================
// Integration — Server serves graph-enabled HTML
// ============================================================================

describe('Dependency Graph — server integration', () => {
    it('should serve HTML with graph features', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({ wikiDir, port: 0, host: 'localhost' });

        const html = await fetchText(`${server.url}/`);
        expect(html).toContain('d3.min.js');
        expect(html).toContain('showGraph');
        expect(html).toContain('Dependency Graph');
    });
});
