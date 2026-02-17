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

    it('showRepoDetail calls setHashSilent (not location.hash)', () => {
        // showRepoDetail must use setHashSilent to update the hash
        // without triggering hashchange, preventing navigation away from repos.
        expect(script).toContain('setHashSilent');
        expect(script).toContain('showRepoDetail');
    });

    it('showRepoDetail updates selectedRepoId in appState', () => {
        expect(script).toContain('selectedRepoId');
    });

    it('showRepoDetail updates activeRepoSubTab in appState', () => {
        expect(script).toContain('activeRepoSubTab');
    });

    it('setHashSilent uses replaceState to avoid hashchange race', () => {
        // The fix: replaceState does not fire hashchange, so clicking a
        // repo item won't accidentally navigate back to the processes tab.
        expect(script).toContain('replaceState');
        expect(script).not.toContain('_hashChangeGuard');
    });

    it('clearRepoDetail resets selectedRepoId and hash', () => {
        expect(script).toContain('clearRepoDetail');
        expect(script).toContain('selectedRepoId');
    });
});

// ============================================================================
// Clone grouping (client bundle)
// ============================================================================

describe('client bundle — clone grouping', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines normalizeRemoteUrl function', () => {
        expect(script).toContain('normalizeRemoteUrl');
    });

    it('defines groupReposByRemote function', () => {
        expect(script).toContain('groupReposByRemote');
    });

    it('defines remoteUrlLabel function', () => {
        expect(script).toContain('remoteUrlLabel');
    });

    it('defines renderRepoGroup function', () => {
        expect(script).toContain('renderRepoGroup');
    });

    it('defines repoGroupExpandedState for expand/collapse tracking', () => {
        expect(script).toContain('repoGroupExpandedState');
    });

    it('tracks repoGroupingEnabled as always-on constant', () => {
        expect(script).toContain('repoGroupingEnabled');
    });

    it('renders repo groups with header containing toggle and label', () => {
        expect(script).toContain('repo-group-header');
        expect(script).toContain('repo-group-toggle');
        expect(script).toContain('repo-group-label');
    });

    it('renders repo group badge with clone count', () => {
        expect(script).toContain('repo-group-badge');
    });

    it('renders repo group children container', () => {
        expect(script).toContain('repo-group-children');
    });

    it('renders grouped repo items with indentation class', () => {
        expect(script).toContain('repo-item-grouped');
    });

    it('renders branch badges for grouped repo items', () => {
        expect(script).toContain('repo-branch-badge');
    });

    it('shows remote URL in repo detail info tab', () => {
        // The info tab should display the remote URL field
        expect(script).toContain('Remote');
        expect(script).toContain('remoteUrl');
    });

    it('normalizes SSH shorthand URLs (git@host:user/repo)', () => {
        // Verify the SSH regex pattern is in the bundle
        expect(script).toContain('sshMatch');
    });

    it('strips .git suffix during normalization', () => {
        expect(script).toContain('.git');
    });

    it('strips protocol during normalization', () => {
        // The regex pattern in the bundle strips protocol prefixes
        expect(script).toContain('https?');
        expect(script).toContain('ssh');
    });

    it('handles expand/collapse of repo groups', () => {
        // Verify toggle arrows are present (may be escaped in bundle)
        expect(script).toContain('repo-group-toggle');
        expect(script).toContain('expanded');
    });

    it('footer includes group count when grouping is enabled', () => {
        expect(script).toContain('group');
        expect(script).toContain('repos-footer');
    });

    it('always renders groups for repos with remote URL (even single repos)', () => {
        // The renderReposList logic now checks normalizedUrl rather than repos.length >= 2
        expect(script).toContain('normalizedUrl');
        expect(script).toContain('renderRepoGroup');
    });

    it('does not contain clone-siblings-list (Related Clones section removed)', () => {
        expect(script).not.toContain('clone-siblings-list');
        expect(script).not.toContain('clone-sibling-item');
        expect(script).not.toContain('clone-sibling-name');
    });

    it('does not contain setRepoGroupingEnabled (toggle removed)', () => {
        expect(script).not.toContain('setRepoGroupingEnabled');
    });
});

// ============================================================================
// Repos sidebar HTML structure
// ============================================================================

describe('Repos sidebar HTML structure', () => {
    const html = generateDashboardHtml();

    it('uses app-layout class for repos view (sidebar+detail)', () => {
        expect(html).toContain('class="app-layout" id="view-repos"');
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

    it('does not contain clone grouping toggle button (grouping is always on)', () => {
        expect(html).not.toContain('id="repo-group-toggle-btn"');
    });
});
