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

    it('contains top bar with title', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('class="top-bar"');
        expect(html).toContain('class="top-bar-logo"');
    });

    it('contains workspace dropdown with All Repos option', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="workspace-select"');
        expect(html).toContain('All Repos');
    });

    it('contains theme toggle button', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="theme-toggle"');
    });

    it('contains tab bar with Processes, Repos, Wiki, and Reports tabs', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="tab-bar"');
        expect(html).toContain('data-tab="processes"');
        expect(html).toContain('data-tab="repos"');
        expect(html).toContain('data-tab="wiki"');
        expect(html).toContain('data-tab="reports"');
        expect(html).toContain('>Processes<');
        expect(html).toContain('>Repos<');
        expect(html).toContain('>Wiki<');
        expect(html).toContain('>Reports<');
    });

    it('contains repos view with sidebar list and add repo button', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="view-repos"');
        expect(html).toContain('id="repos-sidebar"');
        expect(html).toContain('id="repos-list"');
        expect(html).toContain('id="add-repo-btn"');
    });

    it('contains add repo dialog overlay', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="add-repo-overlay"');
        expect(html).toContain('id="repo-path"');
        expect(html).toContain('id="repo-alias"');
        expect(html).toContain('id="repo-color"');
        expect(html).toContain('Add Repository');
    });

    it('contains repo detail panel with empty and content sections', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="repo-detail-panel"');
        expect(html).toContain('id="repo-detail-empty"');
        expect(html).toContain('id="repo-detail-content"');
        expect(html).toContain('Select a repo to view details');
    });

    it('contains reports placeholder view', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="view-reports"');
        expect(html).toContain('coming soon');
    });

    it('contains sidebar with filter bar', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="sidebar"');
        expect(html).toContain('id="search-input"');
        expect(html).toContain('id="status-filter"');
        expect(html).toContain('id="type-filter"');
    });

    it('contains view mode toggle buttons for Active/History', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="view-mode-active"');
        expect(html).toContain('id="view-mode-history"');
        expect(html).toContain('class="view-mode-toggle"');
        expect(html).toContain('>Active<');
        expect(html).toContain('>History<');
    });

    it('contains status filter options', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('All Statuses');
        expect(html).toContain('Running');
        expect(html).toContain('Queued');
        expect(html).toContain('Completed');
        expect(html).toContain('Failed');
        expect(html).toContain('Cancelled');
    });

    it('contains type filter options', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('All Types');
        expect(html).toContain('Code Review');
        expect(html).toContain('Pipeline');
    });

    it('contains process list and empty state', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="process-list"');
        expect(html).toContain('id="empty-state"');
        expect(html).toContain('No processes yet');
    });

    it('contains detail panel', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="detail-panel"');
        expect(html).toContain('id="detail-empty"');
        expect(html).toContain('id="detail-content"');
        expect(html).toContain('Select a process to view details');
    });

    it('contains clear completed button', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="clear-completed"');
    });

    it('contains hamburger button for mobile', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="hamburger-btn"');
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

    it('contains review editor with rich UI elements', () => {
        const html = generateDashboardHtml();
        // Mode toggle
        expect(html).toContain('id="review-mode-toggle"');
        expect(html).toContain('review-mode-review');
        expect(html).toContain('review-mode-source');
        // Stats
        expect(html).toContain('id="review-open-count"');
        expect(html).toContain('id="review-resolved-count"');
        // Show resolved checkbox
        expect(html).toContain('id="review-show-resolved"');
        // Rich content container
        expect(html).toContain('id="review-rendered-content"');
        // Floating comment panel
        expect(html).toContain('id="review-floating-panel"');
        expect(html).toContain('id="review-floating-input"');
    });

    it('contains review file browser page', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="page-review-browser"');
        expect(html).toContain('id="review-browser-content"');
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
