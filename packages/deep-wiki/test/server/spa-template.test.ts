/**
 * SPA Template Tests
 *
 * Tests for the server-mode SPA HTML template generation.
 * Tests the DeepWiki-style UI with top bar, collapsible sidebar,
 * source files section, TOC sidebar, and bottom Ask AI bar.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import { generateSpaHtml } from '../../src/server/spa-template';

// ============================================================================
// Basic HTML Structure
// ============================================================================

describe('generateSpaHtml — basic structure', () => {
    it('should generate valid HTML with doctype', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toMatch(/^<!DOCTYPE html>/);
        expect(html).toContain('</html>');
    });

    it('should include title in the page', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'My Project', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('<title>My Project — Wiki</title>');
    });

    it('should escape HTML in title', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: '<script>alert("xss")</script>', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).not.toContain('<script>alert("xss")</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('should include CDN links for highlight.js, mermaid, marked', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('highlight.js');
        expect(html).toContain('mermaid');
        expect(html).toContain('marked');
    });
});

// ============================================================================
// Top Navigation Bar
// ============================================================================

describe('generateSpaHtml — top bar', () => {
    it('should include the top navigation bar', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('id="top-bar"');
        expect(html).toContain('class="top-bar"');
    });

    it('should include DeepWiki logo text', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('class="top-bar-logo"');
        expect(html).toContain('DeepWiki');
    });

    it('should include project name in top bar', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'MyProject', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('id="top-bar-project"');
        expect(html).toContain('MyProject');
    });

    it('should include top-bar CSS styles', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.top-bar');
        expect(html).toContain('--topbar-bg');
    });
});

// ============================================================================
// Server-Mode Specific Features
// ============================================================================

describe('generateSpaHtml — server mode', () => {
    it('should NOT include embedded-data.js script reference', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).not.toContain('src="embedded-data.js"');
    });

    it('should fetch module graph from /api/graph', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('fetch("/api/graph")');
    });

    it('should fetch module data from /api/modules/', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('fetch("/api/modules/"');
    });

    it('should fetch special pages from /api/pages/', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('fetch("/api/pages/"');
    });

    it('should use a markdown cache for fetched content', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('markdownCache');
    });

    it('should use async loadModule function', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('async function loadModule');
    });

    it('should show loading indicator', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('Loading wiki data');
    });
});

// ============================================================================
// Theme Support
// ============================================================================

describe('generateSpaHtml — themes', () => {
    it('should set auto theme correctly', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('data-theme="auto"');
    });

    it('should set dark theme correctly', () => {
        const html = generateSpaHtml({
            theme: 'dark', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('data-theme="dark"');
        expect(html).toContain('class="dark-theme"');
    });

    it('should set light theme correctly', () => {
        const html = generateSpaHtml({
            theme: 'light', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('data-theme="light"');
        expect(html).toContain('class="light-theme"');
    });

    it('should include theme toggle', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('id="theme-toggle"');
        expect(html).toContain('toggleTheme');
    });
});

// ============================================================================
// Search
// ============================================================================

describe('generateSpaHtml — search', () => {
    it('should include search box when enabled', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('id="search"');
    });

    it('should exclude search box when disabled', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: false,
            enableAI: false, enableGraph: false,
        });
        expect(html).not.toContain('id="search"');
    });
});

// ============================================================================
// AI Features
// ============================================================================

describe('generateSpaHtml — AI features', () => {
    it('should include Ask AI widget when AI is enabled', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: true, enableGraph: false,
        });
        expect(html).toContain('id="ask-widget"');
        expect(html).toContain('Ask AI about');
    });

    it('should NOT include Ask AI widget when AI is disabled', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).not.toContain('id="ask-widget"');
    });

    it('should include AI widget styling when enabled', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: true, enableGraph: false,
        });
        expect(html).toContain('.ask-widget');
    });
});

// ============================================================================
// AI Floating Ask Widget Layout
// ============================================================================

describe('generateSpaHtml — floating ask widget layout', () => {
    it('should place ask-widget outside of main-content (after app-layout closing div)', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: true, enableGraph: false,
        });
        const mainEnd = html.indexOf('</main>');
        const askWidgetPos = html.indexOf('id="ask-widget"');
        expect(mainEnd).toBeGreaterThan(-1);
        expect(askWidgetPos).toBeGreaterThan(-1);
        expect(askWidgetPos).toBeGreaterThan(mainEnd);
    });

    it('should NOT have ask-widget inside main-content element', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: true, enableGraph: false,
        });
        const mainStart = html.indexOf('<main class="main-content"');
        const mainEnd = html.indexOf('</main>');
        const mainContent = html.slice(mainStart, mainEnd);
        expect(mainContent).not.toContain('id="ask-widget"');
    });

    it('should use position: fixed for ask-widget CSS', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: true, enableGraph: false,
        });
        expect(html).toContain('.ask-widget {');
        expect(html).toContain('position: fixed');
    });

    it('should always include ask-widget CSS in the bundle', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.ask-widget');
    });

    it('should include responsive adjustments for ask widget on mobile', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: true, enableGraph: false,
        });
        expect(html).toContain('.ask-widget {');
        expect(html).toContain('bottom:');
    });

    it('should render ask-widget as direct child of body', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: true, enableGraph: false,
        });
        const appLayoutEnd = html.indexOf('</div>', html.indexOf('class="app-layout"'));
        const scriptTag = html.indexOf('<script>');
        const askWidgetPos = html.indexOf('id="ask-widget"');
        expect(askWidgetPos).toBeGreaterThan(appLayoutEnd);
        expect(askWidgetPos).toBeLessThan(scriptTag);
    });

    it('should start with header and messages hidden', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: true, enableGraph: false,
        });
        expect(html).toContain('class="ask-widget-header hidden"');
        expect(html).toContain('class="ask-messages hidden"');
    });

    it('floating ask widget should work across all themes', () => {
        const themes: Array<'auto' | 'dark' | 'light'> = ['auto', 'dark', 'light'];
        for (const theme of themes) {
            const html = generateSpaHtml({
                theme, title: 'Test', enableSearch: true,
                enableAI: true, enableGraph: false,
            });
            expect(html).toContain('position: fixed');
            const mainEnd = html.indexOf('</main>');
            expect(html.indexOf('id="ask-widget"')).toBeGreaterThan(mainEnd);
        }
    });
});

// ============================================================================
// Browser History
// ============================================================================

describe('generateSpaHtml — browser history', () => {
    it('should use history.pushState for navigation', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('history.pushState');
    });

    it('should use history.replaceState for initial load', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('history.replaceState');
    });

    it('should handle popstate events', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('addEventListener("popstate"');
    });
});

// ============================================================================
// Markdown Rendering
// ============================================================================

describe('generateSpaHtml — markdown rendering', () => {
    it('should include renderMarkdownContent function', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('function renderMarkdownContent');
    });

    it('should include syntax highlighting setup', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('hljs.highlightElement');
    });

    it('should include copy button for code blocks', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('addCopyButton');
    });

    it('should include mermaid initialization', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('initMermaid');
    });

    it('should include heading anchor links', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('heading-anchor');
    });
});

// ============================================================================
// Source Files Section
// ============================================================================

describe('generateSpaHtml — source files', () => {
    it('should include source-files-section CSS', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.source-files-section');
        expect(html).toContain('.source-pill');
    });

    it('should include toggleSourceFiles function', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('function toggleSourceFiles');
    });

    it('should include renderModulePage function', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('function renderModulePage');
    });

    it('should include Relevant source files toggle', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('Relevant source files');
    });
});

// ============================================================================
// Table of Contents Sidebar
// ============================================================================

describe('generateSpaHtml — TOC sidebar', () => {
    it('should include TOC sidebar HTML', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('id="toc-sidebar"');
        expect(html).toContain('id="toc-nav"');
    });

    it('should include On this page title', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('On this page');
    });

    it('should include buildToc function', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('function buildToc');
    });

    it('should include scroll spy for active TOC tracking', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('function setupScrollSpy');
        expect(html).toContain('function updateActiveToc');
    });

    it('should include TOC CSS styles', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.toc-sidebar');
        expect(html).toContain('.toc-nav');
        expect(html).toContain('.toc-title');
    });

    it('should include TOC heading level classes', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.toc-h3');
        expect(html).toContain('.toc-h4');
    });

    it('should hide TOC on small screens', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('@media (max-width: 1024px)');
        expect(html).toContain('.toc-sidebar');
        expect(html).toContain('display: none');
    });
});

// ============================================================================
// Responsive
// ============================================================================

describe('generateSpaHtml — responsive', () => {
    it('should include responsive styles', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('@media (max-width: 768px)');
    });
});

// ============================================================================
// Sidebar Collapse/Expand
// ============================================================================

describe('generateSpaHtml — sidebar collapse/expand', () => {
    it('should include the sidebar collapse button', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('id="sidebar-collapse"');
    });

    it('should include collapse button with left arrow', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('aria-label="Collapse sidebar"');
        expect(html).toContain('&#x25C0;');
    });

    it('should include sidebar-collapse-btn CSS styles', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.sidebar-collapse-btn');
    });

    it('should include collapsed sidebar CSS', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.sidebar.collapsed');
    });

    it('should include collapse button event listener', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('getElementById("sidebar-collapse")');
        expect(html).toContain('addEventListener("click"');
    });

    it('should include updateSidebarCollapseBtn function', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('function updateSidebarCollapseBtn');
    });

    it('should persist sidebar state to localStorage', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('localStorage.setItem("deep-wiki-sidebar-collapsed"');
        expect(html).toContain('localStorage.getItem("deep-wiki-sidebar-collapsed")');
    });

    it('should restore sidebar collapsed state on load', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('initializeSidebar');
    });

    it('should update button icon when toggling collapse', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('&#x25B6;');
        expect(html).toContain('&#x25C0;');
    });

    it('should hide collapse button on mobile', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.sidebar-collapse-btn');
        expect(html).toContain('display: none');
    });

    it('should include sidebar collapse button in all themes', () => {
        const themes: Array<'auto' | 'dark' | 'light'> = ['auto', 'dark', 'light'];
        for (const theme of themes) {
            const html = generateSpaHtml({
                theme, title: 'Test', enableSearch: true,
                enableAI: false, enableGraph: false,
            });
            expect(html).toContain('id="sidebar-collapse"');
            expect(html).toContain('.sidebar.collapsed');
        }
    });
});

// ============================================================================
// Collapsible Nav Sections
// ============================================================================

describe('generateSpaHtml — nav sections', () => {
    it('should include nav-section CSS class (used for home section)', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.nav-section');
    });

    it('should include nav-section-title CSS styles', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.nav-section-title');
    });

    it('should include nav-section-arrow CSS', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('nav-section-arrow');
    });

    it('should use area-style classes for categories (nav-area-group)', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        // buildCategorySidebar now uses nav-area-group style like buildAreaSidebar
        expect(html).toContain('group.className = "nav-area-group"');
    });
});

// ============================================================================
// Area-Based Sidebar (DeepWiki-style hierarchy)
// ============================================================================

describe('generateSpaHtml — area-based sidebar', () => {
    it('should include buildAreaSidebar function for area-based hierarchy', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('function buildAreaSidebar');
    });

    it('should include buildCategorySidebar function for fallback', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('function buildCategorySidebar');
    });

    it('should detect areas via moduleGraph.areas', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('moduleGraph.areas && moduleGraph.areas.length > 0');
    });

    it('should include area-based CSS classes', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.nav-area-item');
        expect(html).toContain('.nav-area-children');
        expect(html).toContain('.nav-area-module');
        expect(html).toContain('.nav-area-group');
    });

    it('should include nav-area-item active styles', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.nav-area-item.active');
        expect(html).toContain('.nav-area-module.active');
    });

    it('should assign modules to areas by mod.area field', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('mod.area');
    });

    it('should fall back to area.modules list for assignment', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('area.modules');
    });

    it('should handle unassigned modules in an Other group', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('"__other"');
    });

    it('should include data-area-id attribute on area items', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('data-area-id');
    });

    it('should support area-based search filtering', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        // Should search area-module items as well as regular nav-items
        expect(html).toContain('.nav-area-module[data-id]');
    });

    it('should hide area headers when no children match search', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.nav-area-group');
    });

    it('should use area indentation via nav-area-children padding', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('nav-area-children');
        expect(html).toContain('padding-left: 8px');
    });

    it('should set active state on area modules via setActive', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        // setActive should also handle .nav-area-module
        expect(html).toContain('.nav-area-module');
        expect(html).toContain("'.nav-area-module[data-id=");
    });

    it('should include area-based sidebar in all themes', () => {
        const themes: Array<'auto' | 'dark' | 'light'> = ['auto', 'dark', 'light'];
        for (const theme of themes) {
            const html = generateSpaHtml({
                theme, title: 'Test', enableSearch: true,
                enableAI: false, enableGraph: false,
            });
            expect(html).toContain('buildAreaSidebar');
            expect(html).toContain('buildCategorySidebar');
            expect(html).toContain('.nav-area-item');
            expect(html).toContain('.nav-area-module');
        }
    });

    it('should group modules by area in showHome when areas present', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        // showHome should check for areas and group accordingly
        expect(html).toContain('hasAreas = moduleGraph.areas && moduleGraph.areas.length > 0');
    });

    it('should show area names and descriptions in home overview', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('area.description');
        expect(html).toContain('area.name');
    });

    it('should show unassigned modules under Other in home overview', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('assignedIds');
        expect(html).toContain('unassigned');
    });

    it('should fall back to All Modules when no areas present', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('All Modules');
    });

    it('should include area-based active border for sidebar module items', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('--sidebar-active-border');
    });

    it('should include area module font styling (muted color for child items)', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('.nav-area-module');
        // Modules use muted color by default, highlight on active
        expect(html).toContain('color: var(--sidebar-muted)');
    });
});

// ============================================================================
// Cross-theme Consistency
// ============================================================================

describe('generateSpaHtml — cross-theme', () => {
    it('core features should be present in all themes', () => {
        const themes: Array<'auto' | 'dark' | 'light'> = ['auto', 'dark', 'light'];
        for (const theme of themes) {
            const html = generateSpaHtml({
                theme, title: 'Test', enableSearch: true,
                enableAI: false, enableGraph: false,
            });
            expect(html).toContain('fetch("/api/graph")');
            expect(html).toContain('renderMarkdownContent');
            expect(html).toContain('history.pushState');
            expect(html).toContain('initMermaid');
            expect(html).toContain('id="top-bar"');
            expect(html).toContain('id="toc-sidebar"');
        }
    });
});
