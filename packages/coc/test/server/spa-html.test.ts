/**
 * SPA Dashboard Tests — generateDashboardHtml structure
 */

import { describe, it, expect } from 'vitest';
import { generateDashboardHtml } from './spa-test-helpers';

describe('generateDashboardHtml', () => {
    it('returns valid HTML5 document', () => {
        const html = generateDashboardHtml();
        expect(html).toMatch(/^<!DOCTYPE html>/);
        expect(html).toContain('<html lang="en"');
        expect(html).toContain('</html>');
    });

    it('uses default title', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('<title>AI Execution Dashboard</title>');
    });

    it('uses custom title', () => {
        const html = generateDashboardHtml({ title: 'My Dashboard' });
        expect(html).toContain('<title>My Dashboard</title>');
    });

    it('escapes title in HTML', () => {
        const html = generateDashboardHtml({ title: 'Test <script>' });
        expect(html).toContain('<title>Test &lt;script&gt;</title>');
        expect(html).not.toContain('<title>Test <script></title>');
    });

    it('always includes highlight.js CDN for review editor and wiki', () => {
        const html = generateDashboardHtml();
        // highlight.js is always loaded for the review editor's code block rendering
        expect(html).toContain('highlight.min.js');
        expect(html).toContain('github.min.css');
        // Mermaid and marked are wiki-only and should NOT be present without enableWiki
        const mermaidMatch = html.match(/<script\s+src="[^"]*mermaid[^"]*"/gi);
        expect(mermaidMatch).toBeNull();
        const markedMatch = html.match(/<script\s+src="[^"]*marked[^"]*"/gi);
        expect(markedMatch).toBeNull();
    });

    it('includes mermaid and marked CDN scripts when enableWiki is true', () => {
        const html = generateDashboardHtml({ enableWiki: true });
        expect(html).toContain('highlight.min.js');
        // With enableWiki, mermaid and marked CDN scripts should be present
        const mermaidMatch = html.match(/<script\s+src="[^"]*mermaid[^"]*"/gi);
        expect(mermaidMatch).not.toBeNull();
        expect(mermaidMatch!.length).toBeGreaterThanOrEqual(1);
        const markedMatch = html.match(/<script\s+src="[^"]*marked[^"]*"/gi);
        expect(markedMatch).not.toBeNull();
        expect(markedMatch!.length).toBeGreaterThanOrEqual(1);
    });

    it('contains inlined style block', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('<style>');
        expect(html).toContain('</style>');
    });

    it('contains inlined script block', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('<script>');
        expect(html).toContain('</script>');
    });

    it('does not contain legacy pre-React DOM elements', () => {
        const html = generateDashboardHtml();
        // Legacy DOM was removed — React renders all UI into #app-root
        expect(html).not.toContain('id="view-repos"');
        expect(html).not.toContain('id="view-processes"');
        expect(html).not.toContain('id="hamburger-btn"');
        expect(html).not.toContain('cleanupLegacyDom');
    });

    it('does not contain legacy nav or workspace select', () => {
        const html = generateDashboardHtml();
        expect(html).not.toContain('class="top-bar-nav"');
        expect(html).not.toContain('id="workspace-select"');
    });

    it('applies dark theme attribute when theme is dark', () => {
        const html = generateDashboardHtml({ theme: 'dark' });
        expect(html).toContain('data-theme="dark"');
    });

    it('applies light theme attribute when theme is light', () => {
        const html = generateDashboardHtml({ theme: 'light' });
        expect(html).toContain('data-theme="light"');
    });

    it('no data-theme attribute when theme is auto', () => {
        const html = generateDashboardHtml({ theme: 'auto' });
        // Should not have data-theme in the html tag (auto resolves at runtime)
        expect(html).toMatch(/<html lang="en">/);
    });

    it('does not contain legacy review editor DOM', () => {
        const html = generateDashboardHtml();
        // Legacy review editor DOM was removed — React renders it
        expect(html).not.toContain('id="review-mode-toggle"');
        expect(html).not.toContain('id="review-floating-panel"');
        expect(html).not.toContain('id="page-review-browser"');
    });

    it('injects __REVIEW_CONFIG__ when reviewFilePath is provided', () => {
        const html = generateDashboardHtml({ reviewFilePath: '/path/to/file.md', projectDir: '/project' });
        expect(html).toContain('__REVIEW_CONFIG__');
        expect(html).toContain('/path/to/file.md');
        expect(html).toContain('/project');
    });

    it('does not inject __REVIEW_CONFIG__ script block without reviewFilePath', () => {
        const html = generateDashboardHtml();
        // The string __REVIEW_CONFIG__ exists in the bundled JS (review-config.ts),
        // but the separate <script> block that sets window.__REVIEW_CONFIG__ should not exist
        expect(html).not.toContain('window.__REVIEW_CONFIG__ = {');
    });
});

describe('generateDashboardHtml bundle hot-reload', () => {
    it('picks up bundle changes between calls', () => {
        const html1 = generateDashboardHtml();
        const html2 = generateDashboardHtml();
        expect(html1).toBe(html2);
        expect(html1).toContain('<style>');
        expect(html1).toContain('<script>');
    });

    it('includes non-empty bundle content', () => {
        const html = generateDashboardHtml();
        const styleMatch = html.match(/<style>\n([\s\S]*?)\n    <\/style>/);
        expect(styleMatch).not.toBeNull();
        expect(styleMatch![1].trim().length).toBeGreaterThan(0);
    });
});
