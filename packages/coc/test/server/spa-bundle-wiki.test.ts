/**
 * SPA Dashboard Tests — Wiki tab scaffold (HTML, bundle, CSS, routing)
 *
 * Covers the redesigned wiki page with sidebar list/detail views,
 * wiki cards with status badges, and WebSocket event handling.
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
// Wiki source files exist
// ============================================================================

describe('wiki client source files', () => {
    const wikiFiles = ['wiki.ts', 'wiki-components.ts', 'wiki-types.ts'];

    for (const file of wikiFiles) {
        it(`should have client/${file}`, () => {
            expect(fs.existsSync(path.join(CLIENT_DIR, file))).toBe(true);
        });
    }

    it('wiki-types.ts exports WikiData interface', () => {
        const content = readClientFile('wiki-types.ts');
        expect(content).toContain('export interface WikiData');
    });

    it('wiki-types.ts exports ComponentGraph interface', () => {
        const content = readClientFile('wiki-types.ts');
        expect(content).toContain('export interface ComponentGraph');
    });

    it('wiki-types.ts exports DomainInfo interface', () => {
        const content = readClientFile('wiki-types.ts');
        expect(content).toContain('export interface DomainInfo');
    });

    it('wiki-types.ts exports ComponentInfo interface', () => {
        const content = readClientFile('wiki-types.ts');
        expect(content).toContain('export interface ComponentInfo');
    });

    it('wiki-types.ts exports WikiStatus type', () => {
        const content = readClientFile('wiki-types.ts');
        expect(content).toContain('export type WikiStatus');
    });

    it('WikiData includes status fields', () => {
        const content = readClientFile('wiki-types.ts');
        expect(content).toContain('loaded?: boolean');
        expect(content).toContain('componentCount?: number');
        expect(content).toContain('status?: WikiStatus');
    });
});

// ============================================================================
// State module — wiki additions
// ============================================================================

describe('state.ts — wiki additions', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('state.ts'); });

    it('DashboardTab includes wiki', () => {
        expect(content).toContain("'wiki'");
    });

    it('AppState has selectedWikiId field', () => {
        expect(content).toContain('selectedWikiId');
    });

    it('appState initializes selectedWikiId to null', () => {
        expect(content).toMatch(/selectedWikiId:\s*null/);
    });

    it('AppState has wikiView field', () => {
        expect(content).toContain('wikiView');
    });

    it('appState initializes wikiView to list', () => {
        expect(content).toMatch(/wikiView:\s*'list'/);
    });

    it('AppState has wikis cache array', () => {
        expect(content).toContain('wikis: any[]');
    });

    it('appState initializes wikis to empty array', () => {
        expect(content).toMatch(/wikis:\s*\[\]/);
    });

    it('exports WikiViewMode type', () => {
        expect(content).toContain("export type WikiViewMode = 'list' | 'detail'");
    });
});

// ============================================================================
// Client bundle — wiki module functions
// ============================================================================

describe('client bundle — wiki module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines fetchWikisData function', () => {
        expect(script).toContain('fetchWikisData');
    });

    it('defines showWikiDetail function', () => {
        expect(script).toContain('showWikiDetail');
    });

    it('defines showWikiComponent function', () => {
        expect(script).toContain('showWikiComponent');
    });

    it('defines showAddWikiDialog function', () => {
        expect(script).toContain('showAddWikiDialog');
    });

    it('defines hideAddWikiDialog function', () => {
        expect(script).toContain('hideAddWikiDialog');
    });

    it('defines buildComponentTree function', () => {
        expect(script).toContain('buildComponentTree');
    });

    it('defines navigateToWikiList function', () => {
        expect(script).toContain('navigateToWikiList');
    });

    it('defines renderWikiSidebar function', () => {
        expect(script).toContain('renderWikiSidebar');
    });

    it('posts to /wikis endpoint on add wiki', () => {
        expect(script).toContain('/wikis');
    });

    it('fetches component graph from /wikis/ API', () => {
        expect(script).toContain('/graph');
    });

    it('fetches component content from /components/ API', () => {
        expect(script).toContain('/components/');
    });

    it('exposes fetchWikisData on window', () => {
        expect(script).toContain('fetchWikisData');
    });

    it('exposes showWikiDetail on window', () => {
        expect(script).toContain('showWikiDetail');
    });

    it('exposes showWikiComponent on window', () => {
        expect(script).toContain('showWikiComponent');
    });

    it('exposes navigateToWikiList on window', () => {
        expect(script).toContain('navigateToWikiList');
    });

    it('exposes handleWikiReload on window', () => {
        expect(script).toContain('handleWikiReload');
    });

    it('exposes handleWikiRebuilding on window', () => {
        expect(script).toContain('handleWikiRebuilding');
    });

    it('exposes handleWikiError on window', () => {
        expect(script).toContain('handleWikiError');
    });
});

// ============================================================================
// Client bundle — wiki-components module
// ============================================================================

describe('client bundle — wiki-components module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('builds domain-based tree groups', () => {
        expect(script).toContain('wiki-tree-group');
    });

    it('creates tree item elements', () => {
        expect(script).toContain('wiki-tree-item');
    });

    it('creates component elements', () => {
        expect(script).toContain('wiki-tree-component');
    });

    it('creates children containers', () => {
        expect(script).toContain('wiki-tree-children');
    });

    it('supports collapsible groups with expanded class', () => {
        expect(script).toContain('expanded');
    });

    it('supports category-based tree building', () => {
        expect(script).toContain('category');
    });
});

// ============================================================================
// HTML template — wiki tab button
// ============================================================================

describe('HTML template — wiki tab', () => {
    const html = generateDashboardHtml();

    it('contains wiki tab button in tab bar', () => {
        expect(html).toContain('data-tab="wiki"');
        expect(html).toContain('>Wiki<');
    });

    it('wiki tab button is after repos and processes', () => {
        const reposIdx = html.indexOf('data-tab="repos"');
        const processesIdx = html.indexOf('data-tab="processes"');
        const wikiIdx = html.indexOf('data-tab="wiki"');
        expect(processesIdx).toBeGreaterThan(reposIdx);
        expect(wikiIdx).toBeGreaterThan(processesIdx);
    });
});

// ============================================================================
// HTML template — wiki view structure (redesigned sidebar)
// ============================================================================

describe('HTML template — wiki view structure', () => {
    const html = generateDashboardHtml();

    it('contains wiki view container', () => {
        expect(html).toContain('id="view-wiki"');
    });

    it('wiki view has hidden class by default', () => {
        expect(html).toMatch(/class="[^"]*hidden[^"]*"\s+id="view-wiki"/);
    });

    it('contains wiki layout with sidebar and content', () => {
        expect(html).toContain('class="wiki-layout"');
        expect(html).toContain('id="wiki-sidebar"');
        expect(html).toContain('id="wiki-content"');
    });

    it('contains sidebar header with title and add button', () => {
        expect(html).toContain('wiki-sidebar-header');
        expect(html).toContain('wiki-sidebar-title');
        expect(html).toContain('wiki-sidebar-add-btn');
        expect(html).toContain('+ Add');
    });

    it('contains wiki card list container', () => {
        expect(html).toContain('id="wiki-card-list"');
    });

    it('contains wiki component tree container', () => {
        expect(html).toContain('id="wiki-component-tree"');
    });

    it('contains wiki empty state', () => {
        expect(html).toContain('id="wiki-empty"');
        expect(html).toContain('Select a wiki');
    });

    it('contains wiki component detail container', () => {
        expect(html).toContain('id="wiki-component-detail"');
    });

    it('does not contain old dropdown selector', () => {
        expect(html).not.toContain('id="wiki-select"');
    });
});

// ============================================================================
// HTML template — Add Wiki dialog
// ============================================================================

describe('HTML template — Add Wiki dialog', () => {
    const html = generateDashboardHtml();

    it('contains add wiki overlay', () => {
        expect(html).toContain('id="add-wiki-overlay"');
    });

    it('add wiki dialog is hidden by default', () => {
        expect(html).toMatch(/id="add-wiki-overlay"\s+class="enqueue-overlay hidden"/);
    });

    it('contains wiki path input', () => {
        expect(html).toContain('id="wiki-path"');
    });

    it('contains wiki name input', () => {
        expect(html).toContain('id="wiki-name"');
    });

    it('contains wiki color select', () => {
        expect(html).toContain('id="wiki-color"');
    });

    it('contains Generate with AI checkbox', () => {
        expect(html).toContain('id="wiki-generate-ai"');
        expect(html).toContain('Generate with AI');
    });

    it('contains wiki path browser', () => {
        expect(html).toContain('id="wiki-path-browser"');
        expect(html).toContain('id="wiki-browse-btn"');
    });

    it('contains cancel and submit buttons', () => {
        expect(html).toContain('id="add-wiki-cancel-btn"');
        expect(html).toContain('id="add-wiki-submit"');
        expect(html).toContain('Add Wiki');
    });

    it('contains wiki validation area', () => {
        expect(html).toContain('id="wiki-validation"');
    });

    it('dialog header says Add Wiki', () => {
        expect(html).toContain('>Add Wiki<');
    });
});

// ============================================================================
// Hash routing — wiki routes in core.ts
// ============================================================================

describe('core.ts — wiki hash routing', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('core.ts'); });

    it('handles #wiki route', () => {
        expect(content).toContain("hash === 'wiki'");
    });

    it('handles #wiki/{id} route with regex', () => {
        expect(content).toContain('wikiDetailMatch');
        expect(content).toContain("hash.match(/^wiki");
    });

    it('handles #wiki/{id}/component/{compId} route with regex', () => {
        expect(content).toContain('wikiComponentMatch');
        expect(content).toContain('/component/');
    });

    it('calls switchTab wiki for wiki routes', () => {
        expect(content).toContain("switchTab?.('wiki')");
    });

    it('calls showWikiDetail for wiki detail route', () => {
        expect(content).toContain('showWikiDetail');
    });

    it('calls showWikiComponent for component route', () => {
        expect(content).toContain('showWikiComponent');
    });

    it('calls navigateToWikiList for bare #wiki route', () => {
        expect(content).toContain('navigateToWikiList');
    });
});

// ============================================================================
// repos.ts — wiki support in switchTab
// ============================================================================

describe('repos.ts — wiki in switchTab', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('repos.ts'); });

    it('viewIds includes view-wiki', () => {
        expect(content).toContain('view-wiki');
    });

    it('triggers fetchWikisData when switching to wiki tab', () => {
        expect(content).toContain("tab === 'wiki'");
        expect(content).toContain('fetchWikisData');
    });
});

// ============================================================================
// index.ts — wiki imports
// ============================================================================

describe('index.ts — wiki imports', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('index.ts'); });

    it('imports wiki module', () => {
        expect(content).toContain("import './wiki'");
    });

    it('imports wiki-components module', () => {
        expect(content).toContain("import './wiki-components'");
    });

    it('wiki imports are after tasks and before websocket', () => {
        const wikiIdx = content.indexOf("import './wiki'");
        const tasksIdx = content.indexOf("import './tasks'");
        const wsIdx = content.indexOf("import './websocket'");
        expect(wikiIdx).toBeGreaterThan(tasksIdx);
        expect(wikiIdx).toBeLessThan(wsIdx);
    });
});

// ============================================================================
// Server index.ts — enableWiki should be true
// ============================================================================

describe('server/index.ts — enableWiki set to true', () => {
    let content: string;
    beforeAll(() => {
        content = fs.readFileSync(
            path.resolve(__dirname, '..', '..', 'src', 'server', 'index.ts'),
            'utf8'
        );
    });

    it('passes enableWiki: true to generateDashboardHtml', () => {
        expect(content).toContain('enableWiki: true');
    });

    it('generateDashboardHtml is called with options object', () => {
        expect(content).toContain('generateDashboardHtml({');
    });
});

// ============================================================================
// HTML template — enableWiki true generates mermaid/marked CDN scripts
// ============================================================================

describe('HTML template — enableWiki true CDN scripts', () => {
    const html = generateDashboardHtml({ enableWiki: true });

    it('includes mermaid CDN script when enableWiki is true', () => {
        expect(html).toContain('mermaid');
    });

    it('includes marked CDN script when enableWiki is true', () => {
        expect(html).toContain('marked.min.js');
    });

    it('still includes highlight.js regardless of enableWiki', () => {
        expect(html).toContain('highlight.min.js');
    });
});

// ============================================================================
// Client bundle — wiki list fetch robustness
// ============================================================================

describe('client bundle — wiki list fetch robustness', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('fetchWikisData handles array response', () => {
        expect(script).toContain('Array.isArray(data)');
    });

    it('fetchWikisData handles object with wikis property', () => {
        expect(script).toContain('data.wikis');
    });

    it('fetchWikisData has error handling with try-catch', () => {
        expect(script).toContain('fetchWikisData failed');
    });

    it('renders wiki cards with status badges', () => {
        expect(script).toContain('wiki-card-status');
    });

    it('renders wiki card color dots', () => {
        expect(script).toContain('wiki-card-dot');
    });

    it('renders wiki card names', () => {
        expect(script).toContain('wiki-card-name');
    });

    it('renders wiki card gear icons for admin', () => {
        expect(script).toContain('wiki-card-gear');
    });
});

// ============================================================================
// wiki.ts source — fetchWikisData error handling
// ============================================================================

describe('wiki.ts — fetchWikisData error handling', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('wraps fetch in try-catch block', () => {
        expect(content).toContain('try {');
        expect(content).toContain('} catch (err) {');
    });

    it('logs errors to console', () => {
        expect(content).toContain('console.error');
        expect(content).toContain('fetchWikisData failed');
    });

    it('resets wikis to empty array on error', () => {
        expect(content).toContain('appState.wikis = [];');
    });

    it('calls renderWikiSidebar after fetch', () => {
        expect(content).toContain('renderWikiSidebar()');
    });
});

// ============================================================================
// wiki.ts source — sidebar list/detail views
// ============================================================================

describe('wiki.ts — sidebar list/detail views', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('has renderWikiSidebar function', () => {
        expect(content).toContain('function renderWikiSidebar');
    });

    it('has renderWikiListSidebar function', () => {
        expect(content).toContain('function renderWikiListSidebar');
    });

    it('has renderWikiDetailSidebar function', () => {
        expect(content).toContain('function renderWikiDetailSidebar');
    });

    it('renders back button in detail view', () => {
        expect(content).toContain('wiki-sidebar-back-btn');
        expect(content).toContain('wiki-back-btn');
    });

    it('renders wiki card list in list view', () => {
        expect(content).toContain('wiki-card-list');
    });

    it('has navigateToWikiList function', () => {
        expect(content).toContain('function navigateToWikiList');
    });

    it('sets wikiView to list on back navigation', () => {
        expect(content).toContain("appState.wikiView = 'list'");
    });

    it('sets wikiView to detail on card click', () => {
        expect(content).toContain("appState.wikiView = 'detail'");
    });
});

// ============================================================================
// wiki.ts source — wiki status handling
// ============================================================================

describe('wiki.ts — wiki status handling', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('has getWikiStatus helper', () => {
        expect(content).toContain('function getWikiStatus');
    });

    it('has getStatusBadge helper', () => {
        expect(content).toContain('function getStatusBadge');
    });

    it('handles loaded status', () => {
        expect(content).toContain('wiki-card-status-ready');
    });

    it('handles generating status', () => {
        expect(content).toContain('wiki-card-status-generating');
    });

    it('handles error status', () => {
        expect(content).toContain('wiki-card-status-error');
    });

    it('handles pending status', () => {
        expect(content).toContain('wiki-card-status-pending');
    });
});

// ============================================================================
// wiki.ts source — empty states
// ============================================================================

describe('wiki.ts — empty and special states', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('has showWikiNotFound function', () => {
        expect(content).toContain('function showWikiNotFound');
        expect(content).toContain('Wiki not found');
    });

    it('shows empty state with add CTA when no wikis', () => {
        expect(content).toContain('No wikis yet');
        expect(content).toContain('wiki-main-add-btn');
    });

    it('shows generating state', () => {
        expect(content).toContain('Generating wiki');
    });

    it('shows error state with message', () => {
        expect(content).toContain('function showWikiErrorState');
    });

    it('shows pending state', () => {
        expect(content).toContain('function showWikiPendingState');
        expect(content).toContain('No data yet');
    });
});

// ============================================================================
// wiki.ts source — WebSocket event handlers
// ============================================================================

describe('wiki.ts — WebSocket event handlers', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('has handleWikiReload function', () => {
        expect(content).toContain('function handleWikiReload');
    });

    it('handleWikiReload updates wiki status to loaded', () => {
        expect(content).toContain("wiki.status = 'loaded'");
    });

    it('has handleWikiRebuilding function', () => {
        expect(content).toContain('function handleWikiRebuilding');
    });

    it('handleWikiRebuilding updates wiki status to generating', () => {
        expect(content).toContain("wiki.status = 'generating'");
    });

    it('has handleWikiError function', () => {
        expect(content).toContain('function handleWikiError');
    });

    it('handleWikiError updates wiki status to error', () => {
        expect(content).toContain("wiki.status = 'error'");
    });

    it('re-renders sidebar after WebSocket events', () => {
        const reloadIdx = content.indexOf('function handleWikiReload');
        const rebuildIdx = content.indexOf('function handleWikiRebuilding');
        const errorIdx = content.indexOf('function handleWikiError');
        const afterReload = content.slice(reloadIdx, rebuildIdx);
        const afterRebuild = content.slice(rebuildIdx, errorIdx);
        const afterError = content.slice(errorIdx, errorIdx + 500);
        expect(afterReload).toContain('renderWikiSidebar()');
        expect(afterRebuild).toContain('renderWikiSidebar()');
        expect(afterError).toContain('renderWikiSidebar()');
    });
});

// ============================================================================
// websocket.ts — wiki event handling
// ============================================================================

describe('websocket.ts — wiki event handling', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('websocket.ts'); });

    it('handles wiki-reload WebSocket event', () => {
        expect(content).toContain("msg.type === 'wiki-reload'");
        expect(content).toContain('handleWikiReload');
    });

    it('handles wiki-rebuilding WebSocket event', () => {
        expect(content).toContain("msg.type === 'wiki-rebuilding'");
        expect(content).toContain('handleWikiRebuilding');
    });

    it('handles wiki-error WebSocket event', () => {
        expect(content).toContain("msg.type === 'wiki-error'");
        expect(content).toContain('handleWikiError');
    });

    it('passes error message from wiki-error event', () => {
        expect(content).toContain('msg.message');
    });
});

// ============================================================================
// CSS — wiki styles
// ============================================================================

describe('CSS — wiki styles', () => {
    const html = generateDashboardHtml();

    it('defines wiki-layout grid', () => {
        expect(html).toContain('.wiki-layout');
    });

    it('defines wiki-sidebar styles', () => {
        expect(html).toContain('.wiki-sidebar');
    });

    it('defines wiki-sidebar-header styles', () => {
        expect(html).toContain('.wiki-sidebar-header');
    });

    it('defines wiki-sidebar-title styles', () => {
        expect(html).toContain('.wiki-sidebar-title');
    });

    it('defines wiki-sidebar-add-btn styles', () => {
        expect(html).toContain('.wiki-sidebar-add-btn');
    });

    it('defines wiki-sidebar-back-btn styles', () => {
        expect(html).toContain('.wiki-sidebar-back-btn');
    });

    it('defines wiki-card styles', () => {
        expect(html).toContain('.wiki-card');
    });

    it('defines wiki-card-dot styles', () => {
        expect(html).toContain('.wiki-card-dot');
    });

    it('defines wiki-card-name styles', () => {
        expect(html).toContain('.wiki-card-name');
    });

    it('defines wiki-card-gear styles with hover opacity', () => {
        expect(html).toContain('.wiki-card-gear');
        expect(html).toContain('.wiki-card:hover .wiki-card-gear');
    });

    it('defines wiki-card-active styles with left border accent', () => {
        expect(html).toContain('.wiki-card-active');
    });

    it('defines wiki-card-status badge styles', () => {
        expect(html).toContain('.wiki-card-status');
        expect(html).toContain('.wiki-card-status-ready');
        expect(html).toContain('.wiki-card-status-generating');
        expect(html).toContain('.wiki-card-status-error');
        expect(html).toContain('.wiki-card-status-pending');
    });

    it('defines wiki-pulse animation for generating status', () => {
        expect(html).toContain('@keyframes wiki-pulse');
    });

    it('defines wiki-card-list styles', () => {
        expect(html).toContain('.wiki-card-list');
    });

    it('defines wiki-component-tree styles', () => {
        expect(html).toContain('.wiki-component-tree');
    });

    it('defines wiki-tree-group styles', () => {
        expect(html).toContain('.wiki-tree-group');
    });

    it('defines wiki-tree-item styles', () => {
        expect(html).toContain('.wiki-tree-item');
    });

    it('defines wiki-tree-component styles', () => {
        expect(html).toContain('.wiki-tree-component');
    });

    it('defines wiki-tree-children styles', () => {
        expect(html).toContain('.wiki-tree-children');
    });

    it('defines wiki-content styles', () => {
        expect(html).toContain('.wiki-content');
    });

    it('defines wiki-component-detail markdown-body styles', () => {
        expect(html).toContain('.wiki-component-detail .markdown-body');
    });

    it('defines checkbox label styles for Generate with AI toggle', () => {
        expect(html).toContain('.enqueue-checkbox-label');
    });

    it('defines wiki article markdown styles', () => {
        expect(html).toContain('.wiki-article .markdown-body');
    });

    it('defines wiki ToC sidebar styles', () => {
        expect(html).toContain('.wiki-toc-sidebar');
        expect(html).toContain('.toc-nav a');
    });

    it('defines mermaid diagram styles', () => {
        expect(html).toContain('.mermaid-toolbar');
        expect(html).toContain('.mermaid-viewport');
        expect(html).toContain('.mermaid-zoom-btn');
    });

    it('defines wiki dependency graph styles', () => {
        expect(html).toContain('.wiki-graph-container');
        expect(html).toContain('.wiki-graph-toolbar');
        expect(html).toContain('.wiki-graph-legend');
        expect(html).toContain('.wiki-graph-tooltip');
    });

    it('defines source files section styles', () => {
        expect(html).toContain('.source-files-section');
        expect(html).toContain('.source-pill');
    });

    it('defines wiki admin panel styles', () => {
        expect(html).toContain('.admin-page');
        expect(html).toContain('.admin-editor');
        expect(html).toContain('.admin-btn');
    });

    it('defines generate tab styles', () => {
        expect(html).toContain('.generate-phases');
        expect(html).toContain('.generate-phase-card');
        expect(html).toContain('.phase-card-header');
    });

    it('defines home view and component card styles', () => {
        expect(html).toContain('.home-view');
        expect(html).toContain('.stat-card');
        expect(html).toContain('.component-card');
        expect(html).toContain('.complexity-badge');
    });

    it('defines copy button styles', () => {
        expect(html).toContain('.copy-btn');
        expect(html).toContain('.heading-anchor');
    });

    it('defines responsive breakpoints for wiki layout', () => {
        expect(html).toContain('@media (max-width: 900px)');
        expect(html).toContain('@media (max-width: 768px)');
    });
});

// ============================================================================
// wiki-routes.ts — componentCount in GET /api/wikis
// ============================================================================

describe('wiki-routes.ts — componentCount in API response', () => {
    let content: string;
    beforeAll(() => {
        content = fs.readFileSync(
            path.resolve(__dirname, '..', '..', 'src', 'server', 'wiki', 'wiki-routes.ts'),
            'utf8'
        );
    });

    it('includes componentCount for loaded wikis', () => {
        expect(content).toContain('componentCount');
    });

    it('reads component count from graph', () => {
        expect(content).toContain('runtime.wikiData?.graph?.components?.length');
    });

    it('includes color from persisted wiki data', () => {
        expect(content).toContain('color: persisted?.color');
    });
});
