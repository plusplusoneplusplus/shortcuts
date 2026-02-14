/**
 * SPA Dashboard Tests
 *
 * Tests for the SPA HTML generator, helpers, styles, and script modules.
 * Verifies the generated HTML is valid and contains expected elements.
 */

import { describe, it, expect } from 'vitest';
import { generateDashboardHtml } from '../../src/server/spa';
import { escapeHtml } from '../../src/server/spa/helpers';
import { getDashboardStyles } from '../../src/server/spa/styles';
import { getDashboardScript } from '../../src/server/spa/scripts';
import { getUtilsScript } from '../../src/server/spa/scripts/utils';
import { getCoreScript } from '../../src/server/spa/scripts/core';
import { getThemeScript } from '../../src/server/spa/scripts/theme';
import { getSidebarScript } from '../../src/server/spa/scripts/sidebar';
import { getDetailScript } from '../../src/server/spa/scripts/detail';
import { getFiltersScript } from '../../src/server/spa/scripts/filters';
import { getWebSocketScript } from '../../src/server/spa/scripts/websocket';

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

    it('contains workspace dropdown with All Workspaces option', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="workspace-select"');
        expect(html).toContain('All Workspaces');
    });

    it('contains theme toggle button', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="theme-toggle"');
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
// getDashboardStyles
// ============================================================================

describe('getDashboardStyles', () => {
    const styles = getDashboardStyles();

    it('defines CSS custom properties for light theme', () => {
        expect(styles).toContain('--bg-primary: #ffffff');
        expect(styles).toContain('--text-primary: #1e1e1e');
        expect(styles).toContain('--accent: #0078d4');
    });

    it('defines dark theme overrides', () => {
        expect(styles).toContain('html[data-theme="dark"]');
        expect(styles).toContain('--bg-primary: #1e1e1e');
        expect(styles).toContain('--text-primary: #cccccc');
    });

    it('defines status colors', () => {
        expect(styles).toContain('--status-running');
        expect(styles).toContain('--status-completed');
        expect(styles).toContain('--status-failed');
        expect(styles).toContain('--status-cancelled');
        expect(styles).toContain('--status-queued');
    });

    it('defines grid layout for app', () => {
        expect(styles).toContain('grid-template-columns: 320px 1fr');
    });

    it('defines responsive breakpoint', () => {
        expect(styles).toContain('@media (max-width: 768px)');
    });

    it('defines custom scrollbar styles', () => {
        expect(styles).toContain('::-webkit-scrollbar');
    });

    it('defines status badge styles', () => {
        expect(styles).toContain('.status-badge.running');
        expect(styles).toContain('.status-badge.completed');
        expect(styles).toContain('.status-badge.failed');
    });

    it('defines process item styles', () => {
        expect(styles).toContain('.process-item');
        expect(styles).toContain('.child-item');
        expect(styles).toContain('.status-dot');
    });

    it('defines markdown result styles', () => {
        expect(styles).toContain('.result-body h1');
        expect(styles).toContain('.result-body code');
        expect(styles).toContain('.result-body pre');
        expect(styles).toContain('.result-body blockquote');
    });

    it('defines collapsible prompt section', () => {
        expect(styles).toContain('.prompt-section');
        expect(styles).toContain('.prompt-section summary');
    });
});

// ============================================================================
// Script modules
// ============================================================================

describe('getDashboardScript', () => {
    const script = getDashboardScript({
        defaultTheme: 'auto',
        wsPath: '/ws',
        apiBasePath: '/api',
    });

    it('returns a non-empty string', () => {
        expect(typeof script).toBe('string');
        expect(script.length).toBeGreaterThan(0);
    });

    it('contains utility functions', () => {
        expect(script).toContain('function formatDuration');
        expect(script).toContain('function formatRelativeTime');
        expect(script).toContain('function statusIcon');
        expect(script).toContain('function statusLabel');
        expect(script).toContain('function typeLabel');
        expect(script).toContain('function copyToClipboard');
    });

    it('contains core state and init', () => {
        expect(script).toContain('var appState');
        expect(script).toContain('function init()');
        expect(script).toContain('function getFilteredProcesses()');
        expect(script).toContain('function fetchApi(');
    });

    it('contains theme functions', () => {
        expect(script).toContain('function initTheme()');
        expect(script).toContain('function toggleTheme()');
        expect(script).toContain('function applyTheme()');
    });

    it('contains sidebar functions', () => {
        expect(script).toContain('function renderProcessList()');
        expect(script).toContain('function renderProcessItem(');
        expect(script).toContain('function renderChildProcesses(');
        expect(script).toContain('function selectProcess(');
        expect(script).toContain('function startLiveTimers()');
        expect(script).toContain('function stopLiveTimers()');
    });

    it('contains detail functions', () => {
        expect(script).toContain('function renderDetail(');
        expect(script).toContain('function clearDetail()');
        expect(script).toContain('function renderMarkdown(');
        expect(script).toContain('function inlineFormat(');
    });

    it('contains filter functions', () => {
        expect(script).toContain('function debounce(');
        expect(script).toContain('function populateWorkspaces(');
    });

    it('contains WebSocket functions', () => {
        expect(script).toContain('function connectWebSocket()');
        expect(script).toContain('function handleWsMessage(');
    });

    it('injects API base path', () => {
        expect(script).toContain("var API_BASE = '/api'");
    });

    it('injects WebSocket path', () => {
        expect(script).toContain("'/ws'");
    });
});

describe('getUtilsScript', () => {
    const script = getUtilsScript();

    it('defines formatDuration', () => {
        expect(script).toContain('function formatDuration');
    });

    it('defines formatRelativeTime', () => {
        expect(script).toContain('function formatRelativeTime');
    });

    it('defines statusIcon mapping', () => {
        expect(script).toContain('function statusIcon');
    });

    it('defines typeLabel mapping', () => {
        expect(script).toContain('function typeLabel');
        expect(script).toContain("'code-review'");
        expect(script).toContain("'pipeline-execution'");
    });

    it('defines clipboard copy with fallback', () => {
        expect(script).toContain('function copyToClipboard');
        expect(script).toContain('navigator.clipboard');
        expect(script).toContain('execCommand');
    });
});

describe('getCoreScript', () => {
    it('uses provided API base path', () => {
        const script = getCoreScript({ defaultTheme: 'auto', wsPath: '/ws', apiBasePath: '/custom-api' });
        expect(script).toContain("var API_BASE = '/custom-api'");
    });

    it('uses provided WS path', () => {
        const script = getCoreScript({ defaultTheme: 'auto', wsPath: '/custom-ws', apiBasePath: '/api' });
        expect(script).toContain("var WS_PATH = '/custom-ws'");
    });

    it('defines appState with required fields', () => {
        const script = getCoreScript({ defaultTheme: 'auto', wsPath: '/ws', apiBasePath: '/api' });
        expect(script).toContain('processes: []');
        expect(script).toContain('selectedId: null');
        expect(script).toContain('workspace:');
        expect(script).toContain('expandedGroups: {}');
        expect(script).toContain('liveTimers: {}');
    });

    it('handles deep link routing', () => {
        const script = getCoreScript({ defaultTheme: 'auto', wsPath: '/ws', apiBasePath: '/api' });
        expect(script).toContain('location.pathname.match');
        expect(script).toContain('/process/');
    });

    it('defines popstate handler', () => {
        const script = getCoreScript({ defaultTheme: 'auto', wsPath: '/ws', apiBasePath: '/api' });
        expect(script).toContain("window.addEventListener('popstate'");
    });

    it('defines navigation functions', () => {
        const script = getCoreScript({ defaultTheme: 'auto', wsPath: '/ws', apiBasePath: '/api' });
        expect(script).toContain('function navigateToProcess(');
        expect(script).toContain('function navigateToHome()');
        expect(script).toContain('history.pushState');
    });
});

describe('getThemeScript', () => {
    const script = getThemeScript();

    it('reads theme from localStorage', () => {
        expect(script).toContain("localStorage.getItem('ai-dash-theme')");
    });

    it('persists theme to localStorage', () => {
        expect(script).toContain("localStorage.setItem('ai-dash-theme'");
    });

    it('listens for system color scheme changes', () => {
        expect(script).toContain('prefers-color-scheme: dark');
    });

    it('cycles through auto → dark → light', () => {
        expect(script).toContain("currentTheme === 'auto'");
        expect(script).toContain("currentTheme = 'dark'");
        expect(script).toContain("currentTheme = 'light'");
    });
});

describe('getSidebarScript', () => {
    const script = getSidebarScript();

    it('defines status order', () => {
        expect(script).toContain("var STATUS_ORDER = ['running', 'queued', 'failed', 'completed', 'cancelled']");
    });

    it('supports group expand/collapse', () => {
        expect(script).toContain('function toggleGroup(');
        expect(script).toContain('expandedGroups');
    });

    it('handles clear completed button', () => {
        expect(script).toContain("getElementById('clear-completed')");
        expect(script).toContain('/processes/completed');
        expect(script).toContain("method: 'DELETE'");
    });

    it('has mobile hamburger handler', () => {
        expect(script).toContain("getElementById('hamburger-btn')");
    });
});

describe('getDetailScript', () => {
    const script = getDetailScript();

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
        expect(script).toContain('function inlineFormat');
        expect(script).toContain('<strong>');
        expect(script).toContain('<em>');
    });

    it('markdown renderer handles links', () => {
        expect(script).toContain('target="_blank"');
        expect(script).toContain('rel="noopener"');
    });
});

describe('getFiltersScript', () => {
    const script = getFiltersScript();

    it('implements debounce', () => {
        expect(script).toContain('function debounce(');
        expect(script).toContain('clearTimeout');
    });

    it('handles search input with debounce', () => {
        expect(script).toContain("getElementById('search-input')");
        expect(script).toContain('searchQuery');
    });

    it('handles status filter', () => {
        expect(script).toContain("getElementById('status-filter')");
        expect(script).toContain('statusFilter');
    });

    it('handles type filter', () => {
        expect(script).toContain("getElementById('type-filter')");
        expect(script).toContain('typeFilter');
    });

    it('handles workspace filter with API call', () => {
        expect(script).toContain("getElementById('workspace-select')");
        expect(script).toContain('/processes?workspace=');
    });
});

describe('getWebSocketScript', () => {
    const opts = { defaultTheme: 'auto' as const, wsPath: '/ws', apiBasePath: '/api' };
    const script = getWebSocketScript(opts);

    it('uses correct WebSocket URL', () => {
        expect(script).toContain("location.host + '/ws'");
    });

    it('implements exponential backoff reconnect', () => {
        expect(script).toContain('wsReconnectDelay');
        expect(script).toContain('Math.min(wsReconnectDelay * 2, 30000)');
    });

    it('sends ping every 30 seconds', () => {
        expect(script).toContain('30000');
        expect(script).toContain("type: 'ping'");
    });

    it('handles process-added messages', () => {
        expect(script).toContain("msg.type === 'process-added'");
    });

    it('handles process-updated messages', () => {
        expect(script).toContain("msg.type === 'process-updated'");
    });

    it('handles process-removed messages', () => {
        expect(script).toContain("msg.type === 'process-removed'");
    });

    it('handles processes-cleared messages', () => {
        expect(script).toContain("msg.type === 'processes-cleared'");
    });

    it('handles workspace-registered messages', () => {
        expect(script).toContain("msg.type === 'workspace-registered'");
    });

    it('auto-starts WebSocket connection', () => {
        expect(script).toContain('connectWebSocket();');
    });

    it('uses custom wsPath', () => {
        const custom = getWebSocketScript({ ...opts, wsPath: '/custom-ws' });
        expect(custom).toContain("'/custom-ws'");
    });

    it('resets reconnect delay on successful connection', () => {
        expect(script).toContain('wsReconnectDelay = 1000');
    });
});
