/**
 * SPA Dashboard Tests — Wiki tab scaffold (HTML, bundle, CSS, routing)
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

    it('wiki tab button is between repos and reports', () => {
        const reposIdx = html.indexOf('data-tab="repos"');
        const wikiIdx = html.indexOf('data-tab="wiki"');
        const reportsIdx = html.indexOf('data-tab="reports"');
        expect(wikiIdx).toBeGreaterThan(reposIdx);
        expect(wikiIdx).toBeLessThan(reportsIdx);
    });
});

// ============================================================================
// HTML template — wiki view structure
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

    it('contains wiki selector with dropdown and add button', () => {
        expect(html).toContain('id="wiki-select"');
        expect(html).toContain('Select wiki...');
        expect(html).toContain('id="add-wiki-btn"');
        expect(html).toContain('+ Add Wiki');
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

    it('defines wiki-selector styles', () => {
        expect(html).toContain('.wiki-selector');
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
});
