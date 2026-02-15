/**
 * SPA Dashboard Tests — client bundle repos module + repos HTML structure
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';

// ============================================================================
// Repos module (client bundle)
// ============================================================================

describe('client bundle — repos module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines renderReposList function', () => {
        expect(script).toContain('renderReposList');
    });

    it('defines renderRepoItem function', () => {
        expect(script).toContain('renderRepoItem');
    });

    it('defines renderRepoDetail function', () => {
        expect(script).toContain('renderRepoDetail');
    });

    it('defines clearRepoDetail function', () => {
        expect(script).toContain('clearRepoDetail');
    });

    it('defines fetchReposData function', () => {
        expect(script).toContain('fetchReposData');
    });

    it('defines showRepoDetail function', () => {
        expect(script).toContain('showRepoDetail');
    });

    it('defines showAddRepoDialog function', () => {
        expect(script).toContain('showAddRepoDialog');
    });

    it('defines hideAddRepoDialog function', () => {
        expect(script).toContain('hideAddRepoDialog');
    });

    it('renders repo items with color dot', () => {
        expect(script).toContain('repo-color-dot');
    });

    it('renders repo items with name', () => {
        expect(script).toContain('repo-item-name');
    });

    it('renders repo items with path', () => {
        expect(script).toContain('repo-item-path');
    });

    it('renders repo items with stats', () => {
        expect(script).toContain('repo-item-stats');
    });

    it('uses repo-item active class for selected repo', () => {
        expect(script).toContain('repo-item');
        expect(script).toContain('active');
    });

    it('updates active repo item on selection', () => {
        expect(script).toContain('updateActiveRepoItem');
    });

    it('renders repo detail with metadata grid', () => {
        expect(script).toContain('meta-grid');
        expect(script).toContain('meta-item');
    });

    it('renders repo detail with pipeline list', () => {
        expect(script).toContain('repo-pipeline-list');
        expect(script).toContain('repo-pipeline-item');
    });

    it('renders repo detail with recent processes', () => {
        expect(script).toContain('repo-processes-list');
    });

    it('supports repo removal with confirmation', () => {
        expect(script).toContain('confirmRemoveRepo');
        expect(script).toContain('confirm(');
    });

    it('supports repo editing', () => {
        expect(script).toContain('showEditRepoDialog');
        expect(script).toContain('repo-edit-btn');
    });

    it('exposes switchTab on window', () => {
        expect(script).toContain('switchTab');
    });

    it('exposes showRepoDetail on window', () => {
        expect(script).toContain('showRepoDetail');
    });

    it('renders footer with repo count and stats', () => {
        expect(script).toContain('repos-footer');
    });

    it('handles empty repos state', () => {
        expect(script).toContain('repos-empty');
    });

    it('supports directory browser for add repo', () => {
        expect(script).toContain('path-browser');
        expect(script).toContain('openPathBrowser');
    });
});

// ============================================================================
// Repos sidebar HTML structure
// ============================================================================

describe('Repos sidebar HTML structure', () => {
    const html = generateDashboardHtml();

    it('uses app-layout class for repos view (sidebar+detail)', () => {
        expect(html).toContain('class="app-layout hidden" id="view-repos"');
    });

    it('contains repos sidebar with correct class', () => {
        expect(html).toContain('class="sidebar repos-sidebar"');
        expect(html).toContain('id="repos-sidebar"');
    });

    it('contains repos sidebar header with title', () => {
        expect(html).toContain('class="repos-sidebar-header"');
        expect(html).toContain('>Repos<');
    });

    it('contains repos list nav element', () => {
        expect(html).toContain('id="repos-list"');
        expect(html).toContain('class="repos-list"');
    });

    it('contains repos empty state', () => {
        expect(html).toContain('id="repos-empty"');
        expect(html).toContain('No repos registered');
    });

    it('contains repos sidebar footer', () => {
        expect(html).toContain('id="repos-footer"');
        expect(html).toContain('class="repos-sidebar-footer"');
    });

    it('contains repo detail panel as main element', () => {
        expect(html).toContain('id="repo-detail-panel"');
        expect(html).toContain('class="detail-panel"');
    });

    it('contains repo detail empty state', () => {
        expect(html).toContain('id="repo-detail-empty"');
        expect(html).toContain('Select a repo to view details');
    });

    it('contains repo detail content area', () => {
        expect(html).toContain('id="repo-detail-content"');
    });
});
