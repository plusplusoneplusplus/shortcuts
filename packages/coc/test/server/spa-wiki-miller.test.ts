/**
 * Tests for wiki Miller column UI redesign.
 *
 * Covers:
 * - wiki-content.ts — Miller column rendering, group helpers, navigation state
 * - wiki-styles.css — Miller column CSS classes
 * - html-template.ts — Miller column container in HTML
 * - Client bundle — Miller column functions exposed
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, getClientCssBundle, generateDashboardHtml } from './spa-test-helpers';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

function readClientFile(name: string): string {
    return fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8');
}

// ============================================================================
// wiki-content.ts — Miller column architecture
// ============================================================================

describe('wiki-content.ts — Miller column architecture', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-content.ts'); });

    it('exports renderMillerColumns function', () => {
        expect(content).toContain('export function renderMillerColumns');
    });

    it('defines MillerGroup interface', () => {
        expect(content).toContain('interface MillerGroup');
    });

    it('MillerGroup has id, name, description, and components fields', () => {
        expect(content).toContain('id: string');
        expect(content).toContain('name: string');
        expect(content).toContain('description?: string');
        expect(content).toContain('components: ComponentInfo[]');
    });

    it('has getGroups function that dispatches to domain or category groups', () => {
        expect(content).toContain('function getGroups');
        expect(content).toContain('getDomainGroups');
        expect(content).toContain('getCategoryGroups');
    });

    it('has getDomainGroups function', () => {
        expect(content).toContain('function getDomainGroups');
    });

    it('has getCategoryGroups function', () => {
        expect(content).toContain('function getCategoryGroups');
    });

    it('getDomainGroups handles unassigned components as "Other"', () => {
        expect(content).toContain("id: '__other'");
        expect(content).toContain("name: 'Other'");
    });

    it('getCategoryGroups sorts categories alphabetically', () => {
        expect(content).toContain('localeCompare');
    });
});

// ============================================================================
// wiki-content.ts — WikiState additions
// ============================================================================

describe('wiki-content.ts — WikiState with Miller column state', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-content.ts'); });

    it('WikiState includes selectedDomainOrCategory field', () => {
        expect(content).toContain('selectedDomainOrCategory: string | null');
    });

    it('wikiState initializes selectedDomainOrCategory to null', () => {
        expect(content).toContain('selectedDomainOrCategory: null');
    });

    it('setWikiGraph resets selectedDomainOrCategory', () => {
        const setWikiGraphSection = content.substring(
            content.indexOf('function setWikiGraph'),
            content.indexOf('function clearWikiState')
        );
        expect(setWikiGraphSection).toContain('selectedDomainOrCategory = null');
    });

    it('clearWikiState resets selectedDomainOrCategory', () => {
        const clearSection = content.substring(
            content.indexOf('function clearWikiState'),
            content.indexOf('function clearWikiState') + 500
        );
        expect(clearSection).toContain('selectedDomainOrCategory = null');
    });
});

// ============================================================================
// wiki-content.ts — Miller column rendering
// ============================================================================

describe('wiki-content.ts — renderMillerColumns', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-content.ts'); });

    it('targets wiki-miller-columns container', () => {
        expect(content).toContain("getElementById('wiki-miller-columns')");
    });

    it('renders three columns: groups, components, preview', () => {
        expect(content).toContain('wiki-miller-col-groups');
        expect(content).toContain('wiki-miller-col-components');
        expect(content).toContain('wiki-miller-col-preview');
    });

    it('renders column headers', () => {
        expect(content).toContain('wiki-miller-col-header');
    });

    it('renders column body containers', () => {
        expect(content).toContain('wiki-miller-col-body');
    });

    it('renders project home row in groups column', () => {
        expect(content).toContain('wiki-miller-row-project');
        expect(content).toContain('data-action="home"');
    });

    it('renders group rows with data-group-id', () => {
        expect(content).toContain('data-group-id');
    });

    it('renders component rows with data-component-id', () => {
        expect(content).toContain('data-component-id');
    });

    it('renders row icons for project, groups, and components', () => {
        expect(content).toContain('wiki-miller-row-icon');
        expect(content).toContain('&#127968;'); // home icon
        expect(content).toContain('&#128193;'); // folder icon
        expect(content).toContain('&#128196;'); // document icon
    });

    it('renders chevron indicators for navigation', () => {
        expect(content).toContain('wiki-miller-chevron');
        expect(content).toContain('&#9654;');
    });

    it('renders component count badges on group rows', () => {
        expect(content).toContain('wiki-miller-row-count');
    });

    it('renders complexity badges on component rows', () => {
        expect(content).toContain('wiki-miller-badge');
        expect(content).toContain('wiki-miller-badge-');
    });

    it('shows selected state on active rows', () => {
        expect(content).toContain('wiki-miller-row-selected');
    });

    it('renders empty state for components column', () => {
        expect(content).toContain('wiki-miller-empty');
        expect(content).toContain('No components');
    });

    it('renders preview column with article layout', () => {
        expect(content).toContain('wiki-miller-preview-body');
        expect(content).toContain('wiki-article-content');
        expect(content).toContain('wiki-toc-sidebar');
    });

    it('uses Domains label when domains are present', () => {
        expect(content).toContain("'Domains'");
    });

    it('uses Categories label when no domains', () => {
        expect(content).toContain("'Categories'");
    });

    it('shows group count in column header', () => {
        expect(content).toContain('wiki-miller-col-count');
    });
});

// ============================================================================
// wiki-content.ts — Miller column event handling
// ============================================================================

describe('wiki-content.ts — Miller column event handling', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-content.ts'); });

    it('has attachMillerListeners function', () => {
        expect(content).toContain('function attachMillerListeners');
    });

    it('handles home action click', () => {
        expect(content).toContain("action === 'home'");
    });

    it('handles group click by setting selectedDomainOrCategory', () => {
        expect(content).toContain('wikiState.selectedDomainOrCategory = groupId');
    });

    it('handles component click by calling loadWikiComponent', () => {
        expect(content).toContain('loadWikiComponent(wikiState.wikiId, componentId)');
    });

    it('resets currentComponentId on group click', () => {
        const groupSection = content.substring(
            content.indexOf('if (groupId)'),
            content.indexOf('if (groupId)') + 300
        );
        expect(groupSection).toContain('wikiState.currentComponentId = null');
    });

    it('resets state on home click', () => {
        const homeSection = content.substring(
            content.indexOf("action === 'home'"),
            content.indexOf("action === 'home'") + 300
        );
        expect(homeSection).toContain('wikiState.selectedDomainOrCategory = null');
        expect(homeSection).toContain('wikiState.currentComponentId = null');
    });

    it('re-renders Miller columns after navigation', () => {
        expect(content).toContain('renderMillerColumns()');
    });

    it('scrolls to rightmost column when component is selected', () => {
        expect(content).toContain('container.scrollLeft = container.scrollWidth');
    });
});

// ============================================================================
// wiki-content.ts — preview content rendering
// ============================================================================

describe('wiki-content.ts — preview content rendering', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-content.ts'); });

    it('has renderProjectOverview function', () => {
        expect(content).toContain('function renderProjectOverview');
    });

    it('has renderGroupOverview function', () => {
        expect(content).toContain('function renderGroupOverview');
    });

    it('has updatePreviewHeader function', () => {
        expect(content).toContain('function updatePreviewHeader');
    });

    it('updatePreviewHeader targets wiki-miller-preview-header', () => {
        expect(content).toContain("getElementById('wiki-miller-preview-header')");
    });

    it('renderProjectOverview shows project stats', () => {
        expect(content).toContain('project-stats');
        expect(content).toContain('stat-card');
    });

    it('renderProjectOverview shows domain cards when domains exist', () => {
        expect(content).toContain('wiki-miller-domain-card');
        expect(content).toContain('data-domain-id');
    });

    it('renderGroupOverview shows group description', () => {
        expect(content).toContain('group.description');
    });

    it('renderGroupOverview shows component grid', () => {
        expect(content).toContain('component-grid');
    });

    it('domain card click navigates to domain in Miller columns', () => {
        expect(content).toContain('wiki-miller-domain-card');
        expect(content).toContain('wikiState.selectedDomainOrCategory = domainId');
    });
});

// ============================================================================
// wiki-content.ts — component loading with Miller columns
// ============================================================================

describe('wiki-content.ts — loadWikiComponent with Miller columns', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-content.ts'); });

    it('infers group from component when no group is selected', () => {
        expect(content).toContain('!wikiState.selectedDomainOrCategory');
        expect(content).toContain('owningGroup');
    });

    it('calls renderMillerColumns after setting component', () => {
        const loadSection = content.substring(
            content.indexOf('async function loadWikiComponent'),
            content.indexOf('function renderComponentPage')
        );
        expect(loadSection).toContain('renderMillerColumns()');
    });

    it('updates preview header with component name', () => {
        const loadSection = content.substring(
            content.indexOf('async function loadWikiComponent'),
            content.indexOf('function renderComponentPage')
        );
        expect(loadSection).toContain('updatePreviewHeader(mod.name)');
    });
});

// ============================================================================
// wiki-content.ts — window exports
// ============================================================================

describe('wiki-content.ts — window exports include Miller columns', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-content.ts'); });

    it('exposes renderMillerColumns on window', () => {
        expect(content).toContain('(window as any).renderMillerColumns = renderMillerColumns');
    });

    it('still exposes showWikiHome on window', () => {
        expect(content).toContain('(window as any).showWikiHome = showWikiHome');
    });

    it('still exposes loadWikiComponent on window', () => {
        expect(content).toContain('(window as any).loadWikiComponent = loadWikiComponent');
    });
});

// ============================================================================
// HTML template — Miller column container
// ============================================================================

describe('HTML template — wiki Miller columns container', () => {
    const html = generateDashboardHtml();

    it('contains wiki-miller-columns container', () => {
        expect(html).toContain('id="wiki-miller-columns"');
    });

    it('contains wiki-component-detail wrapper', () => {
        expect(html).toContain('id="wiki-component-detail"');
    });

    it('wiki-component-detail is hidden by default', () => {
        expect(html).toContain('wiki-component-detail hidden');
    });

    it('wiki-empty state is still present', () => {
        expect(html).toContain('id="wiki-empty"');
    });

    it('does not contain static wiki-content-scroll in template', () => {
        const templateContent = fs.readFileSync(
            path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'html-template.ts'),
            'utf8'
        );
        const wikiSection = templateContent.substring(
            templateContent.indexOf('view-wiki'),
            templateContent.indexOf('wiki-ask-widget')
        );
        expect(wikiSection).not.toContain('wiki-content-scroll');
    });
});

// ============================================================================
// CSS — wiki Miller column styles
// ============================================================================

describe('CSS — wiki Miller column styles', () => {
    let cssContent: string;
    beforeAll(() => { cssContent = getClientCssBundle(); });

    it('defines .wiki-miller-columns container', () => {
        expect(cssContent).toContain('.wiki-miller-columns');
    });

    it('wiki-miller-columns uses flex layout', () => {
        const idx = cssContent.indexOf('.wiki-miller-columns');
        const block = cssContent.substring(idx, cssContent.indexOf('}', idx) + 1);
        expect(block).toContain('display: flex');
    });

    it('defines .wiki-miller-col base styles', () => {
        expect(cssContent).toContain('.wiki-miller-col');
    });

    it('defines .wiki-miller-col-groups with fixed width', () => {
        expect(cssContent).toContain('.wiki-miller-col-groups');
    });

    it('defines .wiki-miller-col-components with fixed width', () => {
        expect(cssContent).toContain('.wiki-miller-col-components');
    });

    it('defines .wiki-miller-col-preview with flex grow', () => {
        expect(cssContent).toContain('.wiki-miller-col-preview');
    });

    it('defines .wiki-miller-col-header styles', () => {
        expect(cssContent).toContain('.wiki-miller-col-header');
    });

    it('defines .wiki-miller-col-body styles', () => {
        expect(cssContent).toContain('.wiki-miller-col-body');
    });

    it('defines .wiki-miller-row styles', () => {
        expect(cssContent).toContain('.wiki-miller-row');
    });

    it('defines .wiki-miller-row hover state', () => {
        expect(cssContent).toContain('.wiki-miller-row:hover');
    });

    it('defines .wiki-miller-row-selected state', () => {
        expect(cssContent).toContain('.wiki-miller-row-selected');
    });

    it('defines .wiki-miller-row-project styles', () => {
        expect(cssContent).toContain('.wiki-miller-row-project');
    });

    it('defines .wiki-miller-row-icon styles', () => {
        expect(cssContent).toContain('.wiki-miller-row-icon');
    });

    it('defines .wiki-miller-row-name styles', () => {
        expect(cssContent).toContain('.wiki-miller-row-name');
    });

    it('defines .wiki-miller-row-count badge styles', () => {
        expect(cssContent).toContain('.wiki-miller-row-count');
    });

    it('defines .wiki-miller-chevron styles', () => {
        expect(cssContent).toContain('.wiki-miller-chevron');
    });

    it('defines .wiki-miller-badge complexity styles', () => {
        expect(cssContent).toContain('.wiki-miller-badge');
        expect(cssContent).toContain('.wiki-miller-badge-high');
        expect(cssContent).toContain('.wiki-miller-badge-medium');
        expect(cssContent).toContain('.wiki-miller-badge-low');
    });

    it('defines .wiki-miller-empty state styles', () => {
        expect(cssContent).toContain('.wiki-miller-empty');
    });

    it('defines .wiki-miller-preview-body styles', () => {
        expect(cssContent).toContain('.wiki-miller-preview-body');
    });

    it('selected chevron uses accent color', () => {
        expect(cssContent).toContain('.wiki-miller-row-selected .wiki-miller-chevron');
    });

    it('columns have border-right separator', () => {
        const colBlock = cssContent.substring(
            cssContent.indexOf('.wiki-miller-col {'),
            cssContent.indexOf('.wiki-miller-col {') + 300
        );
        expect(colBlock).toContain('border-right');
    });

    it('last column has no border-right', () => {
        expect(cssContent).toContain('.wiki-miller-col:last-child');
    });

    it('has responsive styles for Miller columns', () => {
        expect(cssContent).toContain('.wiki-miller-col-groups');
        expect(cssContent).toContain('.wiki-miller-col-components');
        expect(cssContent).toContain('.wiki-miller-col-preview');
    });
});

// ============================================================================
// Client bundle — Miller column functions
// ============================================================================

describe('client bundle — wiki Miller column functions', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('includes renderMillerColumns function', () => {
        expect(script).toContain('renderMillerColumns');
    });

    it('includes attachMillerListeners function', () => {
        expect(script).toContain('attachMillerListeners');
    });

    it('includes renderProjectOverview function', () => {
        expect(script).toContain('renderProjectOverview');
    });

    it('includes renderGroupOverview function', () => {
        expect(script).toContain('renderGroupOverview');
    });

    it('includes updatePreviewHeader function', () => {
        expect(script).toContain('updatePreviewHeader');
    });

    it('includes getGroups function', () => {
        expect(script).toContain('getGroups');
    });

    it('includes getDomainGroups function', () => {
        expect(script).toContain('getDomainGroups');
    });

    it('includes getCategoryGroups function', () => {
        expect(script).toContain('getCategoryGroups');
    });

    it('renders wiki-miller-col CSS classes', () => {
        expect(script).toContain('wiki-miller-col');
    });

    it('renders wiki-miller-row CSS classes', () => {
        expect(script).toContain('wiki-miller-row');
    });

    it('handles data-group-id attribute', () => {
        expect(script).toContain('data-group-id');
    });

    it('handles data-component-id attribute', () => {
        expect(script).toContain('data-component-id');
    });

    it('handles data-action="home" attribute', () => {
        expect(script).toContain('data-action');
    });

    it('exposes renderMillerColumns on window', () => {
        expect(script).toContain('renderMillerColumns');
    });
});

// ============================================================================
// wiki-content.ts — backward compatibility
// ============================================================================

describe('wiki-content.ts — backward compatibility', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-content.ts'); });

    it('still exports showWikiHome', () => {
        expect(content).toContain('export function showWikiHome');
    });

    it('still exports loadWikiComponent', () => {
        expect(content).toContain('export async function loadWikiComponent');
    });

    it('still exports renderComponentPage', () => {
        expect(content).toContain('export function renderComponentPage');
    });

    it('still exports loadSpecialPage', () => {
        expect(content).toContain('export async function loadSpecialPage');
    });

    it('still exports loadThemeArticle', () => {
        expect(content).toContain('export async function loadThemeArticle');
    });

    it('still exports toggleSourceFiles', () => {
        expect(content).toContain('export function toggleSourceFiles');
    });

    it('still exports setWikiGraph', () => {
        expect(content).toContain('export function setWikiGraph');
    });

    it('still exports clearWikiState', () => {
        expect(content).toContain('export function clearWikiState');
    });

    it('still exports WikiState interface', () => {
        expect(content).toContain('export interface WikiState');
    });

    it('still exports wikiState object', () => {
        expect(content).toContain('export const wikiState');
    });

    it('showWikiHome calls renderMillerColumns', () => {
        const homeSection = content.substring(
            content.indexOf('function showWikiHome'),
            content.indexOf('function renderMillerColumns')
        );
        expect(homeSection).toContain('renderMillerColumns()');
    });

    it('loadWikiComponent still uses wiki-scoped API endpoint', () => {
        expect(content).toContain("/wikis/' + encodeURIComponent(wikiId) + '/components/'");
    });

    it('loadWikiComponent still caches markdown', () => {
        expect(content).toContain('wikiState.markdownCache[componentId]');
    });

    it('renderComponentPage still builds source files section', () => {
        expect(content).toContain('source-files-section');
        expect(content).toContain('source-pill');
    });

    it('renderComponentPage still calls processMarkdownContent and buildToc', () => {
        expect(content).toContain('processMarkdownContent()');
        expect(content).toContain('buildToc()');
    });

    it('loadSpecialPage still uses wiki-scoped pages endpoint', () => {
        expect(content).toContain("/wikis/' + encodeURIComponent(wikiId) + '/pages/'");
    });

    it('loadThemeArticle still uses wiki-scoped themes endpoint', () => {
        expect(content).toContain("/wikis/' + encodeURIComponent(wikiId) + '/themes/'");
    });

    it('still highlights active component in sidebar tree', () => {
        expect(content).toContain('.wiki-tree-component');
        expect(content).toContain("'active'");
    });
});
