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

    it('has no external CDN dependencies', () => {
        const html = generateDashboardHtml();
        expect(html).not.toContain('cdn.');
        expect(html).not.toContain('cdnjs.');
        expect(html).not.toContain('jsdelivr.');
        expect(html).not.toContain('unpkg.');
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

    it('contains tab bar with Processes, Repos, and Reports tabs', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="tab-bar"');
        expect(html).toContain('data-tab="processes"');
        expect(html).toContain('data-tab="repos"');
        expect(html).toContain('data-tab="reports"');
        expect(html).toContain('>Processes<');
        expect(html).toContain('>Repos<');
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
});
