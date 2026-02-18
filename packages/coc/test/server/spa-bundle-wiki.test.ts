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

    it('sidebar stays as list when wiki is selected (no view transition)', () => {
        expect(content).toContain('renderWikiListSidebar()');
    });

    it('deselects wiki on navigateToWikiList', () => {
        expect(content).toContain('appState.selectedWikiId = null');
    });
});

// ============================================================================
// wiki.ts source — project action tabs
// ============================================================================

describe('wiki.ts — project action tabs', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('defines wiki project tab type', () => {
        expect(content).toContain("type WikiProjectTab = 'browse' | 'seeds' | 'config' | 'generate'");
    });

    it('creates wiki project toolbar dynamically', () => {
        expect(content).toContain("id=\"wiki-project-toolbar\"");
        expect(content).toContain("data-wiki-project-tab=\"browse\"");
        expect(content).toContain("data-wiki-project-tab=\"seeds\"");
        expect(content).toContain("data-wiki-project-tab=\"config\"");
        expect(content).toContain("data-wiki-project-tab=\"generate\"");
    });

    it('creates dedicated admin shell container', () => {
        expect(content).toContain("adminShell.id = 'wiki-admin-shell'");
    });

    it('switches between browse and admin shells by tab', () => {
        expect(content).toContain("if (tab === 'browse' || !hasSelectedWiki)");
        expect(content).toContain("browseShell.classList.add('hidden')");
        expect(content).toContain("adminShell.classList.remove('hidden')");
    });

    it('opens admin tabs through showWikiAdminTab helper', () => {
        expect(content).toContain('showWikiAdminTab(appState.selectedWikiId!, tab)');
    });

    it('exposes setWikiProjectTab on window', () => {
        expect(content).toContain('(window as any).setWikiProjectTab');
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

    it('defines wiki-card-gear styles', () => {
        expect(html).toContain('.wiki-card-gear');
    });

    it('defines wiki-card-actions with hover visibility', () => {
        expect(html).toContain('.wiki-card-actions');
        expect(html).toContain('.wiki-card:hover .wiki-card-actions');
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
// CSS — wiki full-width layout
// ============================================================================

describe('CSS — wiki pages use full width', () => {
    const wikiCss = readClientFile('wiki-styles.css');

    it('does not constrain markdown-body with a fixed max-width', () => {
        const mdBodyRule = wikiCss.match(
            /\.wiki-article\s+\.markdown-body\s*\{[^}]*\}/s
        )?.[0] ?? '';
        const combinedRule = wikiCss.match(
            /\.wiki-component-detail\s+\.markdown-body[\s\S]*?\{[^}]*\}/
        )?.[0] ?? '';
        expect(mdBodyRule).not.toContain('max-width: 800px');
        expect(combinedRule).not.toContain('max-width: 800px');
    });

    it('wiki-article is flex-grow to fill available space', () => {
        expect(wikiCss).toContain('.wiki-article');
        const articleRule = wikiCss.match(/\.wiki-article\s*\{[^}]*\}/s)?.[0] ?? '';
        expect(articleRule).toContain('flex: 1');
        expect(articleRule).toContain('min-width: 0');
    });

    it('wiki-content-layout uses flex display without fixed max-width', () => {
        const layoutRule = wikiCss.match(
            /\.wiki-content-layout\s*\{[^}]*\}/s
        )?.[0] ?? '';
        expect(layoutRule).toContain('display: flex');
        expect(layoutRule).not.toMatch(/max-width:\s*\d+px/);
    });

    it('wiki-miller-col-preview expands to fill remaining space', () => {
        const previewRule = wikiCss.match(
            /\.wiki-miller-col-preview\s*\{[^}]*\}/s
        )?.[0] ?? '';
        expect(previewRule).toContain('flex: 1 1 auto');
    });

    it('admin-section uses full width', () => {
        expect(wikiCss).toContain('.admin-section');
        const sectionRule = wikiCss.match(
            /\.admin-section\s*\{[^}]*\}/s
        )?.[0] ?? '';
        expect(sectionRule).toContain('max-width: 100%');
    });

    it('admin-editor uses full width', () => {
        const editorRule = wikiCss.match(
            /\.admin-editor\s*\{[^}]*\}/s
        )?.[0] ?? '';
        expect(editorRule).toContain('width: 100%');
    });

    it('wiki-content is flex-1 to fill the main area', () => {
        const contentRule = wikiCss.match(
            /\.wiki-content\s*\{[^}]*\}/s
        )?.[0] ?? '';
        expect(contentRule).toContain('flex: 1');
    });

    it('embedded admin page overrides global max-width constraint', () => {
        const embeddedRule = wikiCss.match(
            /\.admin-page\.wiki-admin-embedded\s*\{[^}]*\}/s
        )?.[0] ?? '';
        expect(embeddedRule).toContain('max-width: none');
        expect(embeddedRule).toContain('margin: 0');
    });
});

// ============================================================================
// HTML template — Edit Wiki dialog
// ============================================================================

describe('HTML template — Edit Wiki dialog', () => {
    const html = generateDashboardHtml();

    it('contains edit wiki overlay', () => {
        expect(html).toContain('id="edit-wiki-overlay"');
    });

    it('edit wiki dialog is hidden by default', () => {
        expect(html).toMatch(/id="edit-wiki-overlay"\s+class="enqueue-overlay hidden"/);
    });

    it('contains edit wiki name input', () => {
        expect(html).toContain('id="edit-wiki-name"');
    });

    it('contains edit wiki color select', () => {
        expect(html).toContain('id="edit-wiki-color"');
    });

    it('contains edit wiki validation area', () => {
        expect(html).toContain('id="edit-wiki-validation"');
    });

    it('contains cancel and save buttons', () => {
        expect(html).toContain('id="edit-wiki-cancel-btn"');
        expect(html).toContain('id="edit-wiki-submit"');
        expect(html).toContain('>Save<');
    });

    it('dialog header says Edit Wiki', () => {
        expect(html).toContain('>Edit Wiki<');
    });

    it('contains edit wiki form', () => {
        expect(html).toContain('id="edit-wiki-form"');
    });
});

// ============================================================================
// HTML template — Delete Wiki confirmation dialog
// ============================================================================

describe('HTML template — Delete Wiki confirmation dialog', () => {
    const html = generateDashboardHtml();

    it('contains delete wiki overlay', () => {
        expect(html).toContain('id="delete-wiki-overlay"');
    });

    it('delete wiki dialog is hidden by default', () => {
        expect(html).toMatch(/id="delete-wiki-overlay"\s+class="enqueue-overlay hidden"/);
    });

    it('contains delete wiki name placeholder', () => {
        expect(html).toContain('id="delete-wiki-name"');
    });

    it('contains cancel and confirm buttons', () => {
        expect(html).toContain('id="delete-wiki-cancel-btn"');
        expect(html).toContain('id="delete-wiki-confirm"');
    });

    it('confirm button has danger class', () => {
        expect(html).toContain('enqueue-btn-danger');
    });

    it('dialog header says Remove Wiki', () => {
        expect(html).toContain('>Remove Wiki<');
    });

    it('explains that files on disk are not deleted', () => {
        expect(html).toContain('Generated files on disk will not be deleted');
    });
});

// ============================================================================
// wiki.ts source — edit/delete wiki functions
// ============================================================================

describe('wiki.ts — edit wiki dialog', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('has showEditWikiDialog function', () => {
        expect(content).toContain('function showEditWikiDialog');
    });

    it('has hideEditWikiDialog function', () => {
        expect(content).toContain('function hideEditWikiDialog');
    });

    it('has submitEditWiki function', () => {
        expect(content).toContain('function submitEditWiki');
    });

    it('sends PATCH request to update wiki', () => {
        expect(content).toContain("method: 'PATCH'");
    });

    it('pre-populates name input from wiki data', () => {
        expect(content).toContain('edit-wiki-name');
    });

    it('pre-populates color select from wiki data', () => {
        expect(content).toContain('edit-wiki-color');
    });

    it('validates that name is required', () => {
        expect(content).toContain('Name is required');
    });

    it('exposes showEditWikiDialog on window', () => {
        expect(content).toContain('showEditWikiDialog');
    });

    it('exposes hideEditWikiDialog on window', () => {
        expect(content).toContain('hideEditWikiDialog');
    });
});

describe('wiki.ts — delete wiki', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('has deleteWiki function', () => {
        expect(content).toContain('function deleteWiki');
    });

    it('sends DELETE request to remove wiki', () => {
        expect(content).toContain("method: 'DELETE'");
    });

    it('shows confirmation overlay before deleting', () => {
        expect(content).toContain('delete-wiki-overlay');
    });

    it('resets selectedWikiId after deleting current wiki', () => {
        expect(content).toContain('appState.selectedWikiId = null');
    });

    it('navigates to wiki list after deletion', () => {
        expect(content).toContain("setHashSilent('#wiki')");
    });

    it('exposes deleteWiki on window', () => {
        expect(content).toContain('deleteWiki');
    });
});

describe('wiki.ts — wiki card actions', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('renders edit button on wiki cards', () => {
        expect(content).toContain('wiki-card-edit');
    });

    it('renders delete button on wiki cards', () => {
        expect(content).toContain('wiki-card-delete');
    });

    it('renders actions container on wiki cards', () => {
        expect(content).toContain('wiki-card-actions');
    });

    it('attaches click listener for edit buttons', () => {
        expect(content).toContain('.wiki-card-edit');
        expect(content).toContain('showEditWikiDialog');
    });

    it('attaches click listener for delete buttons', () => {
        expect(content).toContain('.wiki-card-delete');
        expect(content).toContain('deleteWiki');
    });

    it('stops propagation on action button clicks', () => {
        expect(content).toContain('e.stopPropagation()');
    });

    it('card click ignores clicks on actions container', () => {
        expect(content).toContain('.wiki-card-actions');
    });
});

// ============================================================================
// CSS — edit/delete wiki styles
// ============================================================================

describe('CSS — wiki edit/delete styles', () => {
    const html = generateDashboardHtml();

    it('defines wiki-card-actions styles', () => {
        expect(html).toContain('.wiki-card-actions');
    });

    it('defines wiki-card-action-btn styles', () => {
        expect(html).toContain('.wiki-card-action-btn');
    });

    it('defines wiki-card-edit styles', () => {
        expect(html).toContain('.wiki-card-edit');
    });

    it('defines wiki-card-delete hover color', () => {
        expect(html).toContain('.wiki-card-delete:hover');
    });

    it('defines enqueue-btn-danger styles', () => {
        expect(html).toContain('.enqueue-btn-danger');
    });

    it('defines delete-wiki-message styles', () => {
        expect(html).toContain('.delete-wiki-message');
    });

    it('actions are hidden by default and shown on hover', () => {
        expect(html).toContain('.wiki-card:hover .wiki-card-actions');
    });
});

// ============================================================================
// Client bundle — edit/delete wiki functions
// ============================================================================

describe('client bundle — wiki edit/delete functions', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines showEditWikiDialog function', () => {
        expect(script).toContain('showEditWikiDialog');
    });

    it('defines hideEditWikiDialog function', () => {
        expect(script).toContain('hideEditWikiDialog');
    });

    it('defines deleteWiki function', () => {
        expect(script).toContain('deleteWiki');
    });

    it('exposes showEditWikiDialog on window', () => {
        expect(script).toContain('showEditWikiDialog');
    });

    it('exposes deleteWiki on window', () => {
        expect(script).toContain('deleteWiki');
    });

    it('renders wiki-card-edit buttons', () => {
        expect(script).toContain('wiki-card-edit');
    });

    it('renders wiki-card-delete buttons', () => {
        expect(script).toContain('wiki-card-delete');
    });

    it('sends PATCH request for edit', () => {
        expect(script).toContain('PATCH');
    });

    it('sends DELETE request for remove', () => {
        expect(script).toContain('DELETE');
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
