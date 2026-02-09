/**
 * SPA Template Tests
 *
 * Tests for the server-mode SPA HTML template generation.
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
// Server-Mode Specific Features
// ============================================================================

describe('generateSpaHtml — server mode', () => {
    it('should NOT include embedded-data.js script reference', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        // Server mode fetches from API, not embedded data
        expect(html).not.toContain('src="embedded-data.js"');
    });

    it('should fetch module graph from /api/graph', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain("fetch('/api/graph')");
    });

    it('should fetch module data from /api/modules/', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain("fetch('/api/modules/'");
    });

    it('should fetch special pages from /api/pages/', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain("fetch('/api/pages/'");
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
    it('should include Ask AI button when AI is enabled', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: true, enableGraph: false,
        });
        expect(html).toContain('id="ask-toggle"');
        expect(html).toContain('Ask AI');
    });

    it('should NOT include Ask AI button when AI is disabled', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).not.toContain('id="ask-toggle"');
    });

    it('should include AI button styling when enabled', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: true, enableGraph: false,
        });
        expect(html).toContain('.ask-toggle-btn');
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
        expect(html).toContain("addEventListener('popstate'");
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

    it('should include sidebar toggle', () => {
        const html = generateSpaHtml({
            theme: 'auto', title: 'Test', enableSearch: true,
            enableAI: false, enableGraph: false,
        });
        expect(html).toContain('id="sidebar-toggle"');
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
            expect(html).toContain("fetch('/api/graph')");
            expect(html).toContain('renderMarkdownContent');
            expect(html).toContain('history.pushState');
            expect(html).toContain('initMermaid');
        }
    });
});
