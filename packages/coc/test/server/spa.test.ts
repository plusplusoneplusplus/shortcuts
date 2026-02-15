/**
 * SPA Dashboard Tests
 *
 * Tests for the SPA HTML generator, helpers, styles, and client bundle.
 * Verifies the generated HTML is valid and contains expected elements.
 * Script tests validate the esbuild-bundled client output (client/dist/bundle.js).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generateDashboardHtml } from '../../src/server/spa';
import { escapeHtml } from '../../src/server/spa/helpers';
import { getAllModels } from '@plusplusoneplusplus/pipeline-core';
import * as fs from 'fs';
import * as path from 'path';

/** Read the esbuild-bundled client JS for script content tests. */
function getClientBundle(): string {
    const bundlePath = path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'dist', 'bundle.js');
    return fs.readFileSync(bundlePath, 'utf8');
}

// ============================================================================
// escapeHtml
// ============================================================================

describe('escapeHtml', () => {
    it('escapes ampersands', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes angle brackets', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('escapes double quotes', () => {
        expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    });

    it('handles empty string', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('handles string with no special chars', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });

    it('escapes all special chars in one string', () => {
        expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
    });
});

// ============================================================================
// generateDashboardHtml
// ============================================================================

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

// ============================================================================
// Bundled CSS — via generateDashboardHtml
// ============================================================================

describe('Bundled CSS — via generateDashboardHtml', () => {
    const html = generateDashboardHtml();

    it('defines CSS custom properties for light theme', () => {
        expect(html).toContain('--bg-primary:');
        expect(html).toContain('--text-primary:');
        expect(html).toContain('--accent:');
    });

    it('defines dark theme overrides', () => {
        expect(html).toContain('data-theme');
        expect(html).toContain('dark');
    });

    it('defines status colors', () => {
        expect(html).toContain('--status-running');
        expect(html).toContain('--status-completed');
        expect(html).toContain('--status-failed');
    });

    it('defines responsive breakpoint', () => {
        expect(html).toContain('@media');
    });

    it('defines status badge styles', () => {
        expect(html).toContain('.status-badge');
    });

    it('defines process item styles', () => {
        expect(html).toContain('.process-item');
    });

    it('defines queue panel styles', () => {
        expect(html).toContain('.queue-panel');
        expect(html).toContain('.queue-header');
        expect(html).toContain('.queue-task');
    });

    it('defines enqueue dialog styles', () => {
        expect(html).toContain('.enqueue-overlay');
        expect(html).toContain('.enqueue-dialog');
    });

    it('defines conversation section styles', () => {
        expect(html).toContain('.conversation-section');
        expect(html).toContain('.streaming-indicator');
    });

    it('defines markdown result styles', () => {
        expect(html).toContain('.result-body');
    });

    it('defines collapsible prompt section', () => {
        expect(html).toContain('.prompt-section');
    });
});

// ============================================================================
// Script modules
// ============================================================================

describe('client bundle (getDashboardScript replacement)', () => {
    let script: string;

    beforeAll(() => {
        script = getClientBundle();
    });

    it('returns a non-empty string', () => {
        expect(typeof script).toBe('string');
        expect(script.length).toBeGreaterThan(0);
    });

    it('contains utility functions', () => {
        expect(script).toContain('formatDuration');
        expect(script).toContain('formatRelativeTime');
        expect(script).toContain('statusIcon');
        expect(script).toContain('statusLabel');
        expect(script).toContain('typeLabel');
        expect(script).toContain('copyToClipboard');
    });

    it('contains core state and init', () => {
        expect(script).toContain('appState');
        expect(script).toContain('init');
        expect(script).toContain('getFilteredProcesses');
        expect(script).toContain('fetchApi');
    });

    it('contains theme functions', () => {
        expect(script).toContain('initTheme');
        expect(script).toContain('toggleTheme');
        expect(script).toContain('applyTheme');
    });

    it('contains sidebar functions', () => {
        expect(script).toContain('renderProcessList');
        expect(script).toContain('renderProcessItem');
        expect(script).toContain('renderChildProcesses');
        expect(script).toContain('selectProcess');
        expect(script).toContain('startLiveTimers');
        expect(script).toContain('stopLiveTimers');
    });

    it('contains detail functions', () => {
        expect(script).toContain('renderDetail');
        expect(script).toContain('clearDetail');
        expect(script).toContain('renderMarkdown');
        expect(script).toContain('inlineFormat');
    });

    it('contains filter functions', () => {
        expect(script).toContain('debounce');
        expect(script).toContain('populateWorkspaces');
    });

    it('contains WebSocket functions', () => {
        expect(script).toContain('connectWebSocket');
        expect(script).toContain('handleWsMessage');
    });

    it('reads config from window.__DASHBOARD_CONFIG__', () => {
        expect(script).toContain('__DASHBOARD_CONFIG__');
    });

    it('uses getApiBase() for API calls', () => {
        expect(script).toContain('getApiBase');
    });

    it('uses getWsPath() for WebSocket', () => {
        expect(script).toContain('getWsPath');
    });
});

describe('client bundle — utils module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines formatDuration', () => {
        expect(script).toContain('formatDuration');
    });

    it('defines formatRelativeTime', () => {
        expect(script).toContain('formatRelativeTime');
    });

    it('defines statusIcon mapping', () => {
        expect(script).toContain('statusIcon');
    });

    it('defines typeLabel mapping', () => {
        expect(script).toContain('typeLabel');
        expect(script).toContain('code-review');
        expect(script).toContain('pipeline-execution');
    });

    it('defines clipboard copy with fallback', () => {
        expect(script).toContain('copyToClipboard');
        expect(script).toContain('navigator.clipboard');
        expect(script).toContain('execCommand');
    });
});

describe('client bundle — core module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('reads config from __DASHBOARD_CONFIG__', () => {
        expect(script).toContain('__DASHBOARD_CONFIG__');
    });

    it('defines appState with required fields', () => {
        expect(script).toContain('processes: []');
        expect(script).toContain('selectedId: null');
        expect(script).toContain('expandedGroups: {}');
        expect(script).toContain('liveTimers: {}');
    });

    it('handles deep link routing via hash', () => {
        expect(script).toContain('location.hash');
        expect(script).toContain('handleHashChange');
    });

    it('supports backward compat redirect from pathname', () => {
        expect(script).toContain('location.pathname.match');
        expect(script).toContain('location.replace');
    });

    it('defines hashchange handler', () => {
        expect(script).toContain('hashchange');
    });

    it('defines navigation functions with hash routing', () => {
        expect(script).toContain('navigateToProcess');
        expect(script).toContain('navigateToHome');
        expect(script).not.toContain('history.pushState');
    });

    it('routes hash to correct tab', () => {
        expect(script).toContain('#process/');
        expect(script).toContain('#repos/');
        expect(script).toContain('#processes');
        expect(script).toContain('reports');
    });

    it('has setHashSilent guard to prevent double-dispatch', () => {
        expect(script).toContain('setHashSilent');
        expect(script).toContain('_hashChangeGuard');
    });
});

describe('client bundle — theme module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('reads theme from localStorage', () => {
        expect(script).toContain('ai-dash-theme');
    });

    it('persists theme to localStorage', () => {
        expect(script).toContain('localStorage.setItem');
    });

    it('listens for system color scheme changes', () => {
        expect(script).toContain('prefers-color-scheme: dark');
    });

    it('cycles through auto → dark → light', () => {
        expect(script).toContain('auto');
        expect(script).toContain('dark');
        expect(script).toContain('light');
    });
});

describe('client bundle — sidebar module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines status order', () => {
        expect(script).toContain('running');
        expect(script).toContain('queued');
        expect(script).toContain('failed');
        expect(script).toContain('completed');
        expect(script).toContain('cancelled');
    });

    it('supports group expand/collapse', () => {
        expect(script).toContain('toggleGroup');
        expect(script).toContain('expandedGroups');
    });

    it('handles clear completed button', () => {
        expect(script).toContain('clear-completed');
        expect(script).toContain('/processes/completed');
        expect(script).toContain('DELETE');
    });

    it('has mobile hamburger handler', () => {
        expect(script).toContain('hamburger-btn');
    });
});

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

describe('Repos sidebar CSS styles', () => {
    const html = generateDashboardHtml();

    it('defines repos sidebar styles', () => {
        expect(html).toContain('.repos-sidebar');
        expect(html).toContain('.repos-sidebar-header');
    });

    it('defines repos list styles', () => {
        expect(html).toContain('.repos-list');
    });

    it('defines repo item styles', () => {
        expect(html).toContain('.repo-item');
        expect(html).toContain('.repo-item-row');
        expect(html).toContain('.repo-item-name');
    });

    it('defines repo item active state', () => {
        expect(html).toContain('.repo-item.active');
    });

    it('defines repo item stats styles', () => {
        expect(html).toContain('.repo-item-stats');
    });

    it('defines repos sidebar footer styles', () => {
        expect(html).toContain('.repos-sidebar-footer');
    });

    it('defines repo detail header styles', () => {
        expect(html).toContain('.repo-detail-header');
    });
});

describe('client bundle — detail module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('renders metadata grid', () => {
        expect(script).toContain('meta-grid');
        expect(script).toContain('meta-item');
    });

    it('renders child summary table for group types', () => {
        expect(script).toContain('child-summary');
        expect(script).toContain('child-table');
        expect(script).toContain('code-review-group');
        expect(script).toContain('pipeline-execution');
    });

    it('renders collapsible prompt section', () => {
        expect(script).toContain('prompt-section');
        expect(script).toContain('fullPrompt');
    });

    it('renders model in metadata grid when available', () => {
        expect(script).toContain('.metadata.model');
        expect(script).toContain('Model</label>');
    });

    it('renders working directory in metadata grid when available', () => {
        expect(script).toContain('.workingDirectory');
        expect(script).toContain('Working Directory</label>');
        expect(script).toContain('meta-path');
    });

    it('renders action buttons', () => {
        expect(script).toContain('Copy Result');
        expect(script).toContain('Copy Link');
    });

    it('markdown renderer handles headers', () => {
        expect(script).toContain('headerMatch');
    });

    it('markdown renderer handles code blocks', () => {
        expect(script).toContain('inCodeBlock');
        expect(script).toContain('language-');
    });

    it('markdown renderer handles lists', () => {
        expect(script).toContain('inList');
        expect(script).toContain('<ul>');
        expect(script).toContain('<ol>');
    });

    it('markdown renderer handles blockquotes', () => {
        expect(script).toContain('inBlockquote');
        expect(script).toContain('<blockquote>');
    });

    it('markdown renderer handles inline formatting', () => {
        expect(script).toContain('inlineFormat');
        expect(script).toContain('<strong>');
        expect(script).toContain('<em>');
    });

    it('markdown renderer handles links', () => {
        expect(script).toContain('target="_blank"');
        expect(script).toContain('rel="noopener"');
    });
});

describe('client bundle — filters module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('implements debounce', () => {
        expect(script).toContain('debounce');
        expect(script).toContain('clearTimeout');
    });

    it('handles search input with debounce', () => {
        expect(script).toContain('search-input');
        expect(script).toContain('searchQuery');
    });

    it('handles status filter', () => {
        expect(script).toContain('status-filter');
        expect(script).toContain('statusFilter');
    });

    it('handles type filter', () => {
        expect(script).toContain('type-filter');
        expect(script).toContain('typeFilter');
    });

    it('handles workspace filter with API call', () => {
        expect(script).toContain('workspace-select');
        expect(script).toContain('/processes?workspace=');
    });
});

describe('client bundle — websocket module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('uses getWsPath() for WebSocket URL', () => {
        expect(script).toContain('getWsPath');
    });

    it('implements exponential backoff reconnect', () => {
        expect(script).toContain('wsReconnectDelay');
        expect(script).toContain('Math.min(wsReconnectDelay * 2,');
    });

    it('sends ping every 30 seconds', () => {
        // esbuild converts 30000 to 3e4
        expect(script).toContain('3e4');
        expect(script).toContain("ping");
    });

    it('handles process-added messages', () => {
        expect(script).toContain('process-added');
    });

    it('handles process-updated messages', () => {
        expect(script).toContain('process-updated');
    });

    it('handles process-removed messages', () => {
        expect(script).toContain('process-removed');
    });

    it('handles processes-cleared messages', () => {
        expect(script).toContain('processes-cleared');
    });

    it('handles workspace-registered messages', () => {
        expect(script).toContain('workspace-registered');
    });

    it('auto-starts WebSocket connection', () => {
        expect(script).toContain('connectWebSocket');
    });

    it('resets reconnect delay on successful connection', () => {
        // esbuild converts 1000 to 1e3
        expect(script).toContain('wsReconnectDelay = 1e3');
    });

    it('handles queue-updated messages', () => {
        expect(script).toContain('queue-updated');
        expect(script).toContain('renderQueuePanel');
    });

    it('uses history from queue-updated WS message when available', () => {
        expect(script).toContain('.queue.history');
    });

    it('renders immediately before REST fallback', () => {
        expect(script).toContain('renderQueuePanel');
    });

    it('falls back to REST fetch when history not in WS message', () => {
        expect(script).toContain('/queue/history');
    });

    it('starts queue polling when active tasks detected via WS', () => {
        expect(script).toContain('startQueuePolling');
    });

    it('stops queue polling when no active tasks via WS', () => {
        expect(script).toContain('stopQueuePolling');
    });

    it('auto-expands history when tasks complete or fail', () => {
        expect(script).toContain('showHistory');
    });

    it('tracks previous completed/failed counts for comparison', () => {
        expect(script).toContain('prevCompleted');
        expect(script).toContain('prevFailed');
    });
});

// ============================================================================
// Queue panel
// ============================================================================

describe('Queue panel HTML', () => {
    it('contains queue panel element', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="queue-panel"');
        expect(html).toContain('class="queue-panel"');
    });

    it('contains enqueue dialog overlay', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="enqueue-overlay"');
        expect(html).toContain('id="enqueue-form"');
        expect(html).toContain('id="enqueue-name"');
        expect(html).toContain('id="enqueue-type"');
        expect(html).toContain('id="enqueue-priority"');
        expect(html).toContain('id="enqueue-prompt"');
    });

    it('has optional task name field (not required)', () => {
        const html = generateDashboardHtml();
        // Name input should NOT have required attribute
        const nameInputMatch = html.match(/<input[^>]*id="enqueue-name"[^>]*>/);
        expect(nameInputMatch).toBeTruthy();
        expect(nameInputMatch![0]).not.toContain('required');
        // Should show optional hint
        expect(html).toContain('auto-generated if empty');
    });

    it('contains enqueue dialog with model selector', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="enqueue-model"');
        // Model field should be a <select>, not an <input>
        const modelSelectMatch = html.match(/<select[^>]*id="enqueue-model"[^>]*>/);
        expect(modelSelectMatch).toBeTruthy();
        // Should have a default empty option
        expect(html).toContain('<option value="">Default</option>');
        // Should contain model options from the registry
        expect(html).toContain('claude-sonnet-4.5');
        expect(html).toContain('Claude Sonnet 4.5');
    });

    it('model selector is not a text input', () => {
        const html = generateDashboardHtml();
        // Should NOT have an <input> with id="enqueue-model"
        const modelInputMatch = html.match(/<input[^>]*id="enqueue-model"[^>]*>/);
        expect(modelInputMatch).toBeNull();
    });

    it('model selector contains all models from registry', () => {
        const html = generateDashboardHtml();
        const models = getAllModels();
        for (const model of models) {
            expect(html).toContain(`value="${model.id}"`);
            expect(html).toContain(model.label);
        }
    });

    it('model selector includes descriptions for models that have them', () => {
        const html = generateDashboardHtml();
        const models = getAllModels();
        for (const model of models) {
            if (model.description) {
                expect(html).toContain(model.description);
            }
        }
    });

    it('model selector default option has empty value', () => {
        const html = generateDashboardHtml();
        // The default option should have value="" so submitting without selection sends no model
        expect(html).toContain('<option value="">Default</option>');
    });

    it('model selector has correct number of options (models + default)', () => {
        const html = generateDashboardHtml();
        const models = getAllModels();
        // Count option tags within the model select
        const modelSelectSection = html.match(/<select[^>]*id="enqueue-model"[^>]*>[\s\S]*?<\/select>/);
        expect(modelSelectSection).toBeTruthy();
        const optionCount = (modelSelectSection![0].match(/<option /g) || []).length;
        expect(optionCount).toBe(models.length + 1); // +1 for "Default" option
    });

    it('contains enqueue dialog with working directory field', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="enqueue-cwd"');
        const cwdInputMatch = html.match(/<input[^>]*id="enqueue-cwd"[^>]*>/);
        expect(cwdInputMatch).toBeTruthy();
        expect(cwdInputMatch![0]).not.toContain('required');
        expect(html).toContain('/path/to/project');
    });

    it('contains enqueue dialog with task type options', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('Custom');
        expect(html).toContain('AI Clarification');
        expect(html).toContain('Follow Prompt');
    });

    it('contains enqueue dialog with priority options', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('value="normal"');
        expect(html).toContain('value="high"');
        expect(html).toContain('value="low"');
    });

    it('contains Add to Queue submit button', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('Add to Queue');
    });
});

describe('client bundle — queue module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines queueState', () => {
        expect(script).toContain('queueState');
        expect(script).toContain('queued: []');
        expect(script).toContain('running: []');
        expect(script).toContain('isPaused: false');
    });

    it('defines fetchQueue function', () => {
        expect(script).toContain('fetchQueue');
        expect(script).toContain('/queue');
    });

    it('defines renderQueuePanel function', () => {
        expect(script).toContain('renderQueuePanel');
        expect(script).toContain('queue-panel');
    });

    it('defines renderQueueTask function', () => {
        expect(script).toContain('renderQueueTask');
        expect(script).toContain('queue-task');
    });

    it('defines queue control functions', () => {
        expect(script).toContain('queuePause');
        expect(script).toContain('queueResume');
        expect(script).toContain('queueClear');
        expect(script).toContain('queueCancelTask');
        expect(script).toContain('queueMoveToTop');
        expect(script).toContain('queueMoveUp');
    });

    it('defines enqueue dialog functions', () => {
        expect(script).toContain('showEnqueueDialog');
        expect(script).toContain('hideEnqueueDialog');
        expect(script).toContain('submitEnqueueForm');
    });

    it('auto-fetches queue on load', () => {
        expect(script).toContain('fetchQueue');
    });

    it('defines queue polling functions', () => {
        expect(script).toContain('startQueuePolling');
        expect(script).toContain('stopQueuePolling');
    });

    it('polls queue every 3 seconds when active', () => {
        // esbuild converts 3000 to 3e3
        expect(script).toContain('3e3');
        expect(script).toContain('queuePollInterval');
    });

    it('stops polling when no active tasks', () => {
        expect(script).toContain('stopQueuePolling');
    });

    it('starts polling after enqueue', () => {
        expect(script).toContain('startQueuePolling');
    });

    it('auto-expands history on fetchQueue when tasks complete', () => {
        expect(script).toContain('showHistory');
    });

    it('reads model select and cwd input in submitEnqueueForm', () => {
        expect(script).toContain('enqueue-model');
        expect(script).toContain('enqueue-cwd');
    });

    it('sends model in config when provided', () => {
        expect(script).toContain('config.model = model');
    });

    it('sends workingDirectory in payload for ai-clarification and follow-prompt', () => {
        expect(script).toContain('payload.workingDirectory = cwd');
    });

    it('resets model select and clears cwd input after submit', () => {
        expect(script).toContain('modelSelect');
        expect(script).toContain('cwdInput');
    });

    it('sets up enqueue form event listeners', () => {
        expect(script).toContain('enqueue-form');
        expect(script).toContain('enqueue-cancel');
        expect(script).toContain('enqueue-overlay');
    });

    it('supports priority icons', () => {
        expect(script).toContain('priorityIcon');
    });

    it('uses confirm dialog for clear', () => {
        expect(script).toContain('confirm(');
    });
});

describe('Queue styles — via generateDashboardHtml', () => {
    const html = generateDashboardHtml();

    it('defines queue panel styles', () => {
        expect(html).toContain('.queue-panel');
        expect(html).toContain('.queue-header');
        expect(html).toContain('.queue-task');
    });

    it('defines queue control button styles', () => {
        expect(html).toContain('.queue-ctrl-btn');
    });

    it('defines queue task action styles', () => {
        expect(html).toContain('.queue-task-actions');
    });

    it('defines queue empty state styles', () => {
        expect(html).toContain('.queue-empty');
        expect(html).toContain('.queue-add-btn');
    });

    it('defines enqueue dialog styles', () => {
        expect(html).toContain('.enqueue-overlay');
        expect(html).toContain('.enqueue-dialog');
    });

    it('defines queue count badge styles', () => {
        expect(html).toContain('.queue-count');
    });

    it('defines optional hint style for task name label', () => {
        expect(html).toContain('.enqueue-optional');
    });
});

// ============================================================================
// Queue Task Conversation View
// ============================================================================

describe('Queue task conversation view', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    describe('detail script — conversation functions', () => {
        it('defines showQueueTaskDetail function', () => {
            expect(script).toContain('showQueueTaskDetail');
        });

        it('defines renderQueueTaskConversation function', () => {
            expect(script).toContain('renderQueueTaskConversation');
        });

        it('defines connectQueueTaskSSE function', () => {
            expect(script).toContain('connectQueueTaskSSE');
        });

        it('defines closeQueueTaskStream function', () => {
            expect(script).toContain('closeQueueTaskStream');
        });

        it('defines updateConversationContent function', () => {
            expect(script).toContain('updateConversationContent');
        });

        it('defines scrollConversationToBottom function', () => {
            expect(script).toContain('scrollConversationToBottom');
        });

        it('defines copyQueueTaskResult function', () => {
            expect(script).toContain('copyQueueTaskResult');
        });

        it('defines copyConversationOutput function', () => {
            expect(script).toContain('copyConversationOutput');
        });

        it('constructs process ID with queue- prefix', () => {
            expect(script).toContain('queue-');
        });

        it('uses EventSource for SSE streaming', () => {
            expect(script).toContain('EventSource');
        });

        it('listens for chunk events', () => {
            expect(script).toContain('chunk');
        });

        it('listens for status events', () => {
            expect(script).toContain('status');
        });

        it('listens for done events', () => {
            expect(script).toContain('done');
        });

        it('listens for heartbeat events', () => {
            expect(script).toContain('heartbeat');
        });

        it('accumulates streaming content', () => {
            expect(script).toContain('queueTaskStreamContent');
        });

        it('auto-scrolls conversation to bottom during streaming', () => {
            expect(script).toContain('scrollConversationToBottom');
        });

        it('shows streaming indicator for running tasks', () => {
            expect(script).toContain('streaming-indicator');
            expect(script).toContain('Live');
        });

        it('shows waiting message when no content yet', () => {
            expect(script).toContain('Waiting for response...');
        });

        it('closes previous SSE stream when opening new task', () => {
            expect(script).toContain('closeQueueTaskStream');
        });

        it('cleans up SSE stream on clearDetail', () => {
            expect(script).toContain('clearDetail');
            expect(script).toContain('closeQueueTaskStream');
        });

        it('fetches process data via REST API', () => {
            expect(script).toContain('/processes/');
        });

        it('renders markdown in conversation body', () => {
            expect(script).toContain('renderMarkdown');
        });

        it('retries SSE connection on error with delay', () => {
            expect(script).toContain('setTimeout');
            // esbuild converts 2000 to 2e3
            expect(script).toContain('2e3');
        });

        it('renders back button in detail header', () => {
            expect(script).toContain('detail-back-btn');
            expect(script).toContain('clearDetail');
        });

        it('renders copy result button for completed tasks', () => {
            expect(script).toContain('Copy Result');
            expect(script).toContain('copyQueueTaskResult');
        });

        it('renders prompt section when available', () => {
            expect(script).toContain('prompt-section');
            expect(script).toContain('Prompt');
        });

        it('renders error alert when process has error', () => {
            expect(script).toContain('error-alert');
        });

        it('renders model in queue task conversation metadata', () => {
            expect(script).toContain('.metadata.model');
        });

        it('renders working directory in queue task conversation metadata', () => {
            expect(script).toContain('.workingDirectory');
        });
    });

    describe('queue script — clickable tasks', () => {
        it('makes running tasks clickable with showQueueTaskDetail', () => {
            expect(script).toContain('showQueueTaskDetail');
        });

        it('makes history tasks clickable with showQueueTaskDetail', () => {
            expect(script).toContain('showQueueTaskDetail');
        });

        it('sets cursor pointer on clickable tasks', () => {
            expect(script).toContain('cursor:pointer');
        });

        it('stops event propagation on action buttons', () => {
            expect(script).toContain('event.stopPropagation()');
        });
    });

    describe('conversation styles — via generateDashboardHtml', () => {
        const styledHtml = generateDashboardHtml();

        it('defines conversation section styles', () => {
            expect(styledHtml).toContain('.conversation-section');
            expect(styledHtml).toContain('.conversation-body');
        });

        it('defines streaming indicator with pulse animation', () => {
            expect(styledHtml).toContain('.streaming-indicator');
            expect(styledHtml).toContain('@keyframes');
        });

        it('defines back button style', () => {
            expect(styledHtml).toContain('.detail-back-btn');
        });
    });
});

// ============================================================================
// Bundle file existence
// ============================================================================

describe('Bundle files', () => {
    const pkgRoot = path.resolve(__dirname, '../..');
    const clientDist = path.resolve(pkgRoot, 'src/server/spa/client/dist');

    it('bundle.js exists on disk', () => {
        expect(fs.existsSync(path.resolve(clientDist, 'bundle.js'))).toBe(true);
    });

    it('bundle.css exists on disk', () => {
        expect(fs.existsSync(path.resolve(clientDist, 'bundle.css'))).toBe(true);
    });

    it('bundle.js is non-empty', () => {
        const stat = fs.statSync(path.resolve(clientDist, 'bundle.js'));
        expect(stat.size).toBeGreaterThan(100);
    });

    it('bundle.css is non-empty', () => {
        const stat = fs.statSync(path.resolve(clientDist, 'bundle.css'));
        expect(stat.size).toBeGreaterThan(100);
    });
});

// ============================================================================
// Config injection
// ============================================================================

describe('Bundled JS — config injection', () => {
    it('injects __DASHBOARD_CONFIG__ with default options', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('__DASHBOARD_CONFIG__');
    });

    it('injects custom wsPath into config', () => {
        const html = generateDashboardHtml({ wsPath: '/custom-ws' });
        expect(html).toContain('/custom-ws');
    });

    it('injects custom apiBasePath into config', () => {
        const html = generateDashboardHtml({ apiBasePath: '/custom-api' });
        expect(html).toContain('/custom-api');
    });

    it('injects theme setting into config', () => {
        const html = generateDashboardHtml({ theme: 'dark' });
        expect(html).toContain('__DASHBOARD_CONFIG__');
        // Config script appears before the bundle script
        const configIdx = html.indexOf('__DASHBOARD_CONFIG__');
        const bundleScriptIdx = html.lastIndexOf('</script>');
        expect(configIdx).toBeLessThan(bundleScriptIdx);
    });
});

// ============================================================================
// Session ID support in dashboard
// ============================================================================

describe('client bundle — session ID features', () => {
    let bundle: string;
    beforeAll(() => { bundle = getClientBundle(); });

    it('defines navigateToSession function', () => {
        expect(bundle).toContain('navigateToSession');
    });

    it('exposes navigateToSession on window', () => {
        expect(bundle).toContain('navigateToSession');
        // Bundler may rename `window` but the function is assigned globally
        expect(bundle).toMatch(/navigateToSession/);
    });

    it('handles #session/ hash route', () => {
        expect(bundle).toContain('session/');
        expect(bundle).toContain('sessionMatch');
    });

    it('resolves session via local process lookup', () => {
        // resolveSession checks appState.processes for sdkSessionId
        expect(bundle).toContain('sdkSessionId');
    });

    it('falls back to API lookup for session ID', () => {
        // resolveSession calls fetchApi with sdkSessionId query param
        expect(bundle).toContain('sdkSessionId=');
    });

    it('displays sdkSessionId in process detail metadata', () => {
        expect(bundle).toContain('Session ID');
    });

    it('makes session ID copyable in detail view', () => {
        expect(bundle).toContain('meta-copyable');
    });
});
