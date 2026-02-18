/**
 * Tests for wiki content renderer modules (007).
 *
 * Covers:
 * - wiki-mermaid-zoom.ts — zoom constants, initMermaidZoom
 * - wiki-toc.ts — buildToc, setupScrollSpy, updateActiveToc
 * - wiki-markdown.ts — renderMarkdownContent, processMarkdownContent, findComponentIdBySlugClient, addCopyButton, initMermaid
 * - wiki-content.ts — wikiState, setWikiGraph, clearWikiState, showWikiHome, loadWikiComponent, renderComponentPage, toggleSourceFiles, loadSpecialPage, loadThemeArticle
 * - html-template.ts — enableWiki CDN script injection
 * - styles.css — wiki content CSS classes
 * - theme.ts — hljs-light/hljs-dark toggling
 * - index.ts — new module imports
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');
const SPA_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa');

function readClientFile(name: string): string {
    return fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8');
}

function readSpaFile(name: string): string {
    return fs.readFileSync(path.join(SPA_DIR, name), 'utf8');
}

// ============================================================================
// File existence
// ============================================================================

describe('wiki content renderer — file existence', () => {
    const newFiles = [
        'wiki-content.ts',
        'wiki-markdown.ts',
        'wiki-toc.ts',
        'wiki-mermaid-zoom.ts',
    ];

    for (const file of newFiles) {
        it(`should have client/${file}`, () => {
            expect(fs.existsSync(path.join(CLIENT_DIR, file))).toBe(true);
        });
    }
});

// ============================================================================
// wiki-mermaid-zoom.ts
// ============================================================================

describe('wiki-mermaid-zoom.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-mermaid-zoom.ts'); });

    it('exports MERMAID_MIN_ZOOM constant', () => {
        expect(content).toContain('export const MERMAID_MIN_ZOOM = 0.25');
    });

    it('exports MERMAID_MAX_ZOOM constant', () => {
        expect(content).toContain('export const MERMAID_MAX_ZOOM = 4');
    });

    it('exports MERMAID_ZOOM_STEP constant', () => {
        expect(content).toContain('export const MERMAID_ZOOM_STEP = 0.25');
    });

    it('exports initMermaidZoom function', () => {
        expect(content).toContain('export function initMermaidZoom');
    });

    it('defines MermaidZoomState interface with all required fields', () => {
        expect(content).toContain('scale: number');
        expect(content).toContain('translateX: number');
        expect(content).toContain('translateY: number');
        expect(content).toContain('isDragging: boolean');
        expect(content).toContain('dragStartX: number');
        expect(content).toContain('dragStartY: number');
        expect(content).toContain('lastTX: number');
        expect(content).toContain('lastTY: number');
    });

    it('queries .mermaid-container elements', () => {
        expect(content).toContain("document.querySelectorAll('.mermaid-container')");
    });

    it('handles zoom in button (.mermaid-zoom-in)', () => {
        expect(content).toContain("container.querySelector('.mermaid-zoom-in')");
    });

    it('handles zoom out button (.mermaid-zoom-out)', () => {
        expect(content).toContain("container.querySelector('.mermaid-zoom-out')");
    });

    it('handles reset button (.mermaid-zoom-reset)', () => {
        expect(content).toContain("container.querySelector('.mermaid-zoom-reset')");
    });

    it('handles Ctrl/Cmd + wheel zoom', () => {
        expect(content).toContain('e.ctrlKey');
        expect(content).toContain('e.metaKey');
    });

    it('implements mouse drag panning (mousedown/mousemove/mouseup)', () => {
        expect(content).toContain("'mousedown'");
        expect(content).toContain("'mousemove'");
        expect(content).toContain("'mouseup'");
    });

    it('adds mermaid-dragging class during drag', () => {
        expect(content).toContain("'mermaid-dragging'");
    });

    it('clamps scale to min/max', () => {
        expect(content).toContain('Math.min(MERMAID_MAX_ZOOM');
        expect(content).toContain('Math.max(MERMAID_MIN_ZOOM');
    });

    it('applies transform with translate and scale', () => {
        expect(content).toContain("'translate('");
        expect(content).toContain("'px) scale('");
    });

    it('updates zoom level display percentage', () => {
        expect(content).toContain("Math.round(state.scale * 100) + '%'");
    });
});

// ============================================================================
// wiki-toc.ts
// ============================================================================

describe('wiki-toc.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-toc.ts'); });

    it('exports buildToc function', () => {
        expect(content).toContain('export function buildToc');
    });

    it('exports setupScrollSpy function', () => {
        expect(content).toContain('export function setupScrollSpy');
    });

    it('exports updateActiveToc function', () => {
        expect(content).toContain('export function updateActiveToc');
    });

    it('uses CoC wiki-prefixed toc-nav element ID', () => {
        expect(content).toContain("getElementById('wiki-toc-nav')");
    });

    it('uses CoC wiki-prefixed content-scroll element ID', () => {
        expect(content).toContain("getElementById('wiki-content-scroll')");
    });

    it('queries h2, h3, h4 headings from wiki-article-content', () => {
        expect(content).toContain("#wiki-article-content .markdown-body");
        expect(content).toContain("'h2, h3, h4'");
    });

    it('creates toc-h3 and toc-h4 CSS classes for indent levels', () => {
        expect(content).toContain("'toc-h3'");
        expect(content).toContain("'toc-h4'");
    });

    it('strips trailing # from heading text in ToC links', () => {
        expect(content).toContain("replace(/#$/, '').trim()");
    });

    it('implements smooth scroll on ToC link click', () => {
        expect(content).toContain("scrollIntoView({ behavior: 'smooth', block: 'start' })");
    });

    it('calls setupScrollSpy from buildToc', () => {
        expect(content).toContain('setupScrollSpy()');
    });

    it('tracks active heading based on scroll position with 80px offset', () => {
        expect(content).toContain('offsetTop - 80');
    });

    it('toggles .active class on ToC links', () => {
        expect(content).toContain("'active'");
    });

    it('exposes buildToc globally on window', () => {
        expect(content).toContain('(window as any).buildToc = buildToc');
    });
});

// ============================================================================
// wiki-markdown.ts
// ============================================================================

describe('wiki-markdown.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-markdown.ts'); });

    it('exports renderMarkdownContent function', () => {
        expect(content).toContain('export function renderMarkdownContent');
    });

    it('exports processMarkdownContent function', () => {
        expect(content).toContain('export function processMarkdownContent');
    });

    it('exports findComponentIdBySlugClient function', () => {
        expect(content).toContain('export function findComponentIdBySlugClient');
    });

    it('exports addCopyButton function', () => {
        expect(content).toContain('export function addCopyButton');
    });

    it('exports initMermaid function', () => {
        expect(content).toContain('export function initMermaid');
    });

    it('declares CDN globals (marked, hljs, mermaid)', () => {
        expect(content).toContain('declare const marked');
        expect(content).toContain('declare const hljs');
        expect(content).toContain('declare const mermaid');
    });

    it('uses marked.parse for markdown-to-HTML conversion', () => {
        expect(content).toContain('marked.parse(markdown)');
    });

    it('renders into wiki-article-content element', () => {
        expect(content).toContain("getElementById('wiki-article-content')");
    });

    it('wraps output in .markdown-body div', () => {
        expect(content).toContain("'<div class=\"markdown-body\">'");
    });

    it('handles mermaid code blocks (language-mermaid)', () => {
        expect(content).toContain("'language-mermaid'");
    });

    it('creates mermaid-container with toolbar and viewport', () => {
        expect(content).toContain("'mermaid-container'");
        expect(content).toContain('"mermaid-toolbar"');
        expect(content).toContain('"mermaid-viewport"');
        expect(content).toContain('"mermaid-svg-wrapper"');
    });

    it('calls hljs.highlightElement for non-mermaid code blocks', () => {
        expect(content).toContain('hljs.highlightElement');
    });

    it('adds copy buttons to code blocks', () => {
        expect(content).toContain('addCopyButton');
    });

    it('generates kebab-case heading IDs', () => {
        expect(content).toContain(".replace(/[^a-z0-9]+/g, '-')");
        expect(content).toContain(".replace(/^-+|-+$/g, '')");
    });

    it('appends heading anchors with # text', () => {
        expect(content).toContain("'heading-anchor'");
        expect(content).toContain("anchor.textContent = '#'");
    });

    it('intercepts internal .md links', () => {
        expect(content).toContain('.md');
        expect(content).toContain('e.preventDefault()');
    });

    it('strips path prefixes from .md link slugs', () => {
        expect(content).toContain("replace(/^domains\\/[^/]+\\/components\\//");
        expect(content).toContain("replace(/^components\\//");
    });

    it('routes intercepted links through CoC SPA navigation', () => {
        expect(content).toContain('showWikiComponent');
    });

    it('normalizes slugs for component ID matching', () => {
        expect(content).toContain('findComponentIdBySlugClient');
    });

    it('uses wikiState.components for slug lookup', () => {
        expect(content).toContain('wikiState.components');
    });

    it('copy button writes to clipboard', () => {
        expect(content).toContain('navigator.clipboard.writeText');
    });

    it('copy button shows "Copied!" feedback', () => {
        expect(content).toContain("'Copied!'");
    });

    it('initializes mermaid with theme-aware config', () => {
        expect(content).toContain('mermaid.initialize');
        expect(content).toContain("'dark'");
        expect(content).toContain("'default'");
    });

    it('calls mermaid.run then initMermaidZoom', () => {
        expect(content).toContain('mermaid.run');
        expect(content).toContain('initMermaidZoom');
    });

    it('checks for mermaid availability before init', () => {
        expect(content).toContain("typeof mermaid === 'undefined'");
    });

    it('checks for marked availability before rendering', () => {
        expect(content).toContain("typeof marked === 'undefined'");
    });

    it('exposes renderMarkdownContent globally on window', () => {
        expect(content).toContain('(window as any).renderMarkdownContent = renderMarkdownContent');
    });

    it('exposes processMarkdownContent globally on window', () => {
        expect(content).toContain('(window as any).processMarkdownContent = processMarkdownContent');
    });
});

// ============================================================================
// wiki-content.ts
// ============================================================================

describe('wiki-content.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-content.ts'); });

    it('exports WikiState interface', () => {
        expect(content).toContain('export interface WikiState');
    });

    it('exports wikiState object with required fields', () => {
        expect(content).toContain('export const wikiState: WikiState');
        expect(content).toContain('wikiId: null');
        expect(content).toContain('graph: null');
        expect(content).toContain('components: []');
        expect(content).toContain('currentComponentId: null');
        expect(content).toContain('markdownCache: {}');
    });

    it('exports setWikiGraph function', () => {
        expect(content).toContain('export function setWikiGraph');
    });

    it('exports clearWikiState function', () => {
        expect(content).toContain('export function clearWikiState');
    });

    it('exports showWikiHome function', () => {
        expect(content).toContain('export function showWikiHome');
    });

    it('exports loadWikiComponent function', () => {
        expect(content).toContain('export async function loadWikiComponent');
    });

    it('exports renderComponentPage function', () => {
        expect(content).toContain('export function renderComponentPage');
    });

    it('exports loadSpecialPage function', () => {
        expect(content).toContain('export async function loadSpecialPage');
    });

    it('exports loadThemeArticle function', () => {
        expect(content).toContain('export async function loadThemeArticle');
    });

    it('exports toggleSourceFiles function', () => {
        expect(content).toContain('export function toggleSourceFiles');
    });

    it('showWikiHome renders project stats (components, categories, language)', () => {
        expect(content).toContain('project-stats');
        expect(content).toContain('stat-card');
        expect(content).toContain('Components');
        expect(content).toContain('Categories');
        expect(content).toContain('Language');
    });

    it('showWikiHome renders component grid', () => {
        expect(content).toContain('component-grid');
        expect(content).toContain('component-card');
    });

    it('showWikiHome groups components by domain when available', () => {
        expect(content).toContain('graph.domains');
        expect(content).toContain('domainComponents');
    });

    it('showWikiHome shows flat list when no domains', () => {
        expect(content).toContain('All Components');
    });

    it('showWikiHome renders complexity badges', () => {
        expect(content).toContain('complexity-badge');
    });

    it('loadWikiComponent uses wiki-scoped API endpoint', () => {
        expect(content).toContain("/wikis/' + encodeURIComponent(wikiId) + '/components/'");
    });

    it('loadWikiComponent caches markdown', () => {
        expect(content).toContain('wikiState.markdownCache[componentId]');
    });

    it('loadWikiComponent shows loading spinner', () => {
        expect(content).toContain('Loading component...');
    });

    it('renderComponentPage builds source files section', () => {
        expect(content).toContain('source-files-section');
        expect(content).toContain('source-pill');
    });

    it('renderComponentPage calls processMarkdownContent and buildToc', () => {
        expect(content).toContain('processMarkdownContent()');
        expect(content).toContain('buildToc()');
    });

    it('toggleSourceFiles toggles expanded class', () => {
        expect(content).toContain("classList.toggle('expanded')");
    });

    it('loadSpecialPage uses wiki-scoped pages endpoint', () => {
        expect(content).toContain("/wikis/' + encodeURIComponent(wikiId) + '/pages/'");
    });

    it('loadThemeArticle uses wiki-scoped themes endpoint', () => {
        expect(content).toContain("/wikis/' + encodeURIComponent(wikiId) + '/themes/'");
    });

    it('uses CoC hash routing for navigation', () => {
        expect(content).toContain("'#wiki/'");
    });

    it('highlights active component in tree', () => {
        expect(content).toContain('.wiki-tree-component');
        expect(content).toContain("'active'");
    });

    it('does not contain regenerateComponent (omitted for CoC v1)', () => {
        expect(content).not.toContain('regenerateComponent');
        expect(content).not.toContain('/api/admin/generate');
    });

    it('exposes key functions globally on window', () => {
        expect(content).toContain('(window as any).showWikiHome = showWikiHome');
        expect(content).toContain('(window as any).loadWikiComponent = loadWikiComponent');
        expect(content).toContain('(window as any).loadSpecialPage = loadSpecialPage');
        expect(content).toContain('(window as any).loadThemeArticle = loadThemeArticle');
        expect(content).toContain('(window as any).toggleSourceFiles = toggleSourceFiles');
    });
});

// ============================================================================
// HTML template — CDN scripts conditional on enableWiki
// ============================================================================

describe('html-template.ts — enableWiki CDN scripts', () => {
    let templateContent: string;
    beforeAll(() => { templateContent = readSpaFile('html-template.ts'); });

    it('accepts enableWiki option', () => {
        expect(templateContent).toContain('enableWiki');
    });

    it('defaults enableWiki to false', () => {
        expect(templateContent).toContain("enableWiki = false");
    });

    it('conditionally includes highlight.js CDN link', () => {
        expect(templateContent).toContain('highlight.js');
        expect(templateContent).toContain('hljs-light');
        expect(templateContent).toContain('hljs-dark');
    });

    it('conditionally includes mermaid CDN script', () => {
        expect(templateContent).toContain('mermaid');
        expect(templateContent).toContain('cdn.jsdelivr.net/npm/mermaid');
    });

    it('conditionally includes marked CDN script', () => {
        expect(templateContent).toContain('marked');
        expect(templateContent).toContain('cdn.jsdelivr.net/npm/marked');
    });

    it('CDN scripts only appear when enableWiki is truthy', () => {
        expect(templateContent).toContain('enableWiki ?');
    });

    it('does not include CDN scripts by default (enableWiki false)', () => {
        // When enableWiki=false, the template should return empty string for CDN block
        expect(templateContent).toContain(": ''");
    });
});

// ============================================================================
// HTML template — wiki content area structure
// ============================================================================

describe('html-template.ts — wiki content area structure', () => {
    let templateContent: string;
    beforeAll(() => { templateContent = readSpaFile('html-template.ts'); });

    it('contains wiki-content-scroll wrapper', () => {
        expect(templateContent).toContain('wiki-content-scroll');
    });

    it('contains wiki-content-layout flex container', () => {
        expect(templateContent).toContain('wiki-content-layout');
    });

    it('contains wiki-article element', () => {
        expect(templateContent).toContain('wiki-article');
    });

    it('contains wiki-article-content for rendered content', () => {
        expect(templateContent).toContain('wiki-article-content');
    });

    it('contains wiki-toc-sidebar aside', () => {
        expect(templateContent).toContain('wiki-toc-sidebar');
    });

    it('contains toc-container with toc-title and wiki-toc-nav', () => {
        expect(templateContent).toContain('toc-container');
        expect(templateContent).toContain('toc-title');
        expect(templateContent).toContain('wiki-toc-nav');
    });

    it('ToC title reads "On this page"', () => {
        expect(templateContent).toContain('On this page');
    });
});

// ============================================================================
// DashboardOptions — enableWiki field
// ============================================================================

describe('spa/types.ts — enableWiki option', () => {
    let typesContent: string;
    beforeAll(() => { typesContent = readSpaFile('types.ts'); });

    it('DashboardOptions includes enableWiki field', () => {
        expect(typesContent).toContain('enableWiki');
    });
});

// ============================================================================
// CSS styles — wiki content styles
// ============================================================================

describe('styles.css — wiki content styles', () => {
    let cssContent: string;
    beforeAll(() => { cssContent = fs.readFileSync(path.join(CLIENT_DIR, 'dist', 'bundle.css'), 'utf8'); });

    // CSS variables
    it('defines --code-bg variable', () => {
        expect(cssContent).toContain('--code-bg:');
    });

    it('defines --code-border variable', () => {
        expect(cssContent).toContain('--code-border:');
    });

    it('defines --copy-btn-bg variable', () => {
        expect(cssContent).toContain('--copy-btn-bg:');
    });

    it('defines --source-pill-bg variable', () => {
        expect(cssContent).toContain('--source-pill-bg:');
    });

    it('defines --toc-active variable', () => {
        expect(cssContent).toContain('--toc-active:');
    });

    it('defines --link-color variable', () => {
        expect(cssContent).toContain('--link-color:');
    });

    it('defines --content-border variable', () => {
        expect(cssContent).toContain('--content-border:');
    });

    it('defines --card-bg variable', () => {
        expect(cssContent).toContain('--card-bg:');
    });

    it('defines --stat-bg variable', () => {
        expect(cssContent).toContain('--stat-bg:');
    });

    it('defines --badge-high-bg variable', () => {
        expect(cssContent).toContain('--badge-high-bg:');
    });

    // Dark theme variables
    it('defines dark theme --code-bg', () => {
        const darkSection = cssContent.substring(cssContent.indexOf('html[data-theme="dark"]'));
        expect(darkSection).toContain('--code-bg:');
    });

    it('defines dark theme --toc-active', () => {
        const darkSection = cssContent.substring(cssContent.indexOf('html[data-theme="dark"]'));
        expect(darkSection).toContain('--toc-active:');
    });

    // Content layout
    it('has .wiki-content-scroll style', () => {
        expect(cssContent).toContain('.wiki-content-scroll');
    });

    it('has .wiki-content-layout style', () => {
        expect(cssContent).toContain('.wiki-content-layout');
    });

    it('has .wiki-article style', () => {
        expect(cssContent).toContain('.wiki-article');
    });

    // Markdown body
    it('has .markdown-body styles under .wiki-article', () => {
        expect(cssContent).toContain('.wiki-article .markdown-body');
    });

    it('has heading styles (h1-h4) for markdown body', () => {
        expect(cssContent).toContain('.wiki-article .markdown-body h1');
        expect(cssContent).toContain('.wiki-article .markdown-body h2');
        expect(cssContent).toContain('.wiki-article .markdown-body h3');
        expect(cssContent).toContain('.wiki-article .markdown-body h4');
    });

    it('has code block styles', () => {
        expect(cssContent).toContain('.wiki-article .markdown-body code');
        expect(cssContent).toContain('.wiki-article .markdown-body pre');
        expect(cssContent).toContain('.wiki-article .markdown-body pre code');
    });

    it('has table styles', () => {
        expect(cssContent).toContain('.wiki-article .markdown-body table');
    });

    it('has blockquote styles', () => {
        expect(cssContent).toContain('.wiki-article .markdown-body blockquote');
    });

    // Heading anchors
    it('has .heading-anchor style', () => {
        expect(cssContent).toContain('.heading-anchor');
    });

    it('heading anchor opacity 0 by default, 1 on hover', () => {
        expect(cssContent).toContain('opacity: 0');
        expect(cssContent).toContain(':hover .heading-anchor');
        expect(cssContent).toContain('opacity: 1');
    });

    // Copy button
    it('has .copy-btn style', () => {
        expect(cssContent).toContain('.copy-btn');
    });

    it('copy button appears on pre:hover', () => {
        expect(cssContent).toContain('pre:hover .copy-btn');
    });

    // Source files
    it('has .source-files-section style', () => {
        expect(cssContent).toContain('.source-files-section');
    });

    it('source files expand/collapse with .expanded class', () => {
        expect(cssContent).toContain('.source-files-section.expanded');
    });

    it('has .source-pill style', () => {
        expect(cssContent).toContain('.source-pill');
    });

    // ToC sidebar
    it('has .wiki-toc-sidebar style', () => {
        expect(cssContent).toContain('.wiki-toc-sidebar');
    });

    it('ToC sidebar has sticky positioning', () => {
        const tocSection = cssContent.substring(cssContent.indexOf('.wiki-toc-sidebar'));
        const endIdx = tocSection.indexOf('}');
        const tocBlock = tocSection.substring(0, endIdx);
        expect(tocBlock).toContain('sticky');
    });

    it('has .toc-nav a styles', () => {
        expect(cssContent).toContain('.toc-nav a');
    });

    it('has .toc-nav a.active style', () => {
        expect(cssContent).toContain('.toc-nav a.active');
    });

    it('has .toc-h3 and .toc-h4 indent styles', () => {
        expect(cssContent).toContain('.toc-nav a.toc-h3');
        expect(cssContent).toContain('.toc-nav a.toc-h4');
    });

    // Home view
    it('has .home-view style', () => {
        expect(cssContent).toContain('.home-view');
    });

    it('has .project-stats grid style', () => {
        expect(cssContent).toContain('.project-stats');
    });

    it('has .stat-card style', () => {
        expect(cssContent).toContain('.stat-card');
    });

    it('has .component-grid style', () => {
        expect(cssContent).toContain('.component-grid');
    });

    it('has .component-card style with hover', () => {
        expect(cssContent).toContain('.component-card');
        expect(cssContent).toContain('.component-card:hover');
    });

    // Complexity badges
    it('has complexity badge styles', () => {
        expect(cssContent).toContain('.complexity-badge');
        expect(cssContent).toContain('.complexity-high');
        expect(cssContent).toContain('.complexity-medium');
        expect(cssContent).toContain('.complexity-low');
    });

    // Mermaid styles
    it('has .mermaid-container style', () => {
        expect(cssContent).toContain('.mermaid-container');
    });

    it('has .mermaid-toolbar style', () => {
        expect(cssContent).toContain('.mermaid-toolbar');
    });

    it('has .mermaid-zoom-btn style', () => {
        expect(cssContent).toContain('.mermaid-zoom-btn');
    });

    it('has .mermaid-viewport style with grab cursor', () => {
        expect(cssContent).toContain('.mermaid-viewport');
        expect(cssContent).toContain('cursor: grab');
    });

    it('has .mermaid-svg-wrapper with transform-origin', () => {
        expect(cssContent).toContain('.mermaid-svg-wrapper');
        expect(cssContent).toContain('transform-origin: 0 0');
    });

    it('has .mermaid-dragging style disabling transition', () => {
        expect(cssContent).toContain('.mermaid-viewport.mermaid-dragging');
    });

    // Loading
    it('has .loading style', () => {
        expect(cssContent).toContain('.loading');
    });

    // Responsive
    it('hides ToC sidebar on small screens', () => {
        expect(cssContent).toContain('@media');
        expect(cssContent).toContain('.wiki-toc-sidebar');
    });
});

// ============================================================================
// theme.ts — hljs stylesheet toggling
// ============================================================================

describe('theme.ts — hljs dark/light toggle', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('theme.ts'); });

    it('toggles hljs-light stylesheet', () => {
        expect(content).toContain("getElementById('hljs-light')");
    });

    it('toggles hljs-dark stylesheet', () => {
        expect(content).toContain("getElementById('hljs-dark')");
    });

    it('disables hljs-light in dark mode and hljs-dark in light mode', () => {
        expect(content).toContain('hljsLight.disabled');
        expect(content).toContain('hljsDark.disabled');
    });
});

// ============================================================================
// index.ts — new module imports
// ============================================================================

describe('index.ts — wiki content module imports', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('index.ts'); });

    it('imports wiki-content module', () => {
        expect(content).toContain("import './wiki-content'");
    });

    it('imports wiki-markdown module', () => {
        expect(content).toContain("import './wiki-markdown'");
    });

    it('imports wiki-toc module', () => {
        expect(content).toContain("import './wiki-toc'");
    });

    it('imports wiki-mermaid-zoom module', () => {
        expect(content).toContain("import './wiki-mermaid-zoom'");
    });
});

// ============================================================================
// wiki.ts — integration with content renderer
// ============================================================================

describe('wiki.ts — content renderer integration', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('imports setWikiGraph from wiki-content', () => {
        expect(content).toContain("import { setWikiGraph");
    });

    it('imports clearWikiState from wiki-content', () => {
        expect(content).toContain('clearWikiState');
    });

    it('imports showWikiHome from wiki-content', () => {
        expect(content).toContain('showWikiHome');
    });

    it('imports loadWikiComponent from wiki-content', () => {
        expect(content).toContain('loadWikiComponent');
    });

    it('calls setWikiGraph when wiki is selected', () => {
        expect(content).toContain('setWikiGraph(wikiId, graph)');
    });

    it('calls clearWikiState when wiki is deselected', () => {
        expect(content).toContain('clearWikiState()');
    });

    it('calls showWikiHome after wiki selection', () => {
        expect(content).toContain('showWikiHome()');
    });

    it('showWikiComponent delegates to loadWikiComponent', () => {
        // Verify the old inline rendering is gone, replaced by loadWikiComponent call
        expect(content).toContain('loadWikiComponent(wikiId, compId)');
        expect(content).not.toContain('data.markdown');
    });
});

// ============================================================================
// Client bundle build includes new modules
// ============================================================================

describe('client bundle includes wiki content modules', () => {
    let bundleJs: string;

    beforeAll(() => {
        const bundlePath = path.join(CLIENT_DIR, 'dist', 'bundle.js');
        if (fs.existsSync(bundlePath)) {
            bundleJs = fs.readFileSync(bundlePath, 'utf8');
        } else {
            bundleJs = '';
        }
    });

    it('bundle.js exists', () => {
        expect(bundleJs.length).toBeGreaterThan(0);
    });

    it('bundle includes initMermaidZoom', () => {
        expect(bundleJs).toContain('initMermaidZoom');
    });

    it('bundle includes buildToc', () => {
        expect(bundleJs).toContain('buildToc');
    });

    it('bundle includes renderMarkdownContent', () => {
        expect(bundleJs).toContain('renderMarkdownContent');
    });

    it('bundle includes processMarkdownContent', () => {
        expect(bundleJs).toContain('processMarkdownContent');
    });

    it('bundle includes wikiState', () => {
        expect(bundleJs).toContain('wikiState');
    });

    it('bundle includes showWikiHome', () => {
        expect(bundleJs).toContain('showWikiHome');
    });

    it('bundle includes loadWikiComponent', () => {
        expect(bundleJs).toContain('loadWikiComponent');
    });
});
