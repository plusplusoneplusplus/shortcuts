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
import { getQueueScript } from '../../src/server/spa/scripts/queue';
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

    it('defines meta-path style for working directory display', () => {
        expect(styles).toContain('.meta-path');
        expect(styles).toContain('word-break: break-all');
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

    it('renders model in metadata grid when available', () => {
        expect(script).toContain('process.metadata.model');
        expect(script).toContain('Model</label>');
    });

    it('renders working directory in metadata grid when available', () => {
        expect(script).toContain('process.workingDirectory');
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

    it('handles queue-updated messages', () => {
        expect(script).toContain("msg.type === 'queue-updated'");
        expect(script).toContain('renderQueuePanel');
    });

    it('uses history from queue-updated WS message when available', () => {
        expect(script).toContain('msg.queue.history');
        expect(script).toContain('queueState.history = msg.queue.history');
    });

    it('renders immediately before REST fallback', () => {
        // renderQueuePanel is called immediately, not deferred to REST callback
        expect(script).toContain('// Always render immediately with current state');
        expect(script).toContain('renderQueuePanel()');
    });

    it('falls back to REST fetch when history not in WS message', () => {
        expect(script).toContain("if (!msg.queue.history)");
        expect(script).toContain("fetchApi('/queue/history')");
    });

    it('starts queue polling when active tasks detected via WS', () => {
        expect(script).toContain('startQueuePolling');
    });

    it('stops queue polling when no active tasks via WS', () => {
        expect(script).toContain('stopQueuePolling');
    });

    it('auto-expands history when tasks complete', () => {
        expect(script).toContain('newCompleted > prevCompleted');
        expect(script).toContain('queueState.showHistory = true');
    });

    it('auto-expands history when tasks fail', () => {
        expect(script).toContain('newFailed > prevFailed');
        expect(script).toContain('queueState.showHistory = true');
    });

    it('tracks previous completed/failed counts for comparison', () => {
        expect(script).toContain('prevCompleted');
        expect(script).toContain('prevFailed');
        expect(script).toContain('newCompleted');
        expect(script).toContain('newFailed');
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

    it('contains enqueue dialog with model field', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="enqueue-model"');
        const modelInputMatch = html.match(/<input[^>]*id="enqueue-model"[^>]*>/);
        expect(modelInputMatch).toBeTruthy();
        expect(modelInputMatch![0]).not.toContain('required');
        expect(html).toContain('claude-sonnet-4-5');
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

describe('getQueueScript', () => {
    const opts = { defaultTheme: 'auto' as const, wsPath: '/ws', apiBasePath: '/api' };
    const script = getQueueScript(opts);

    it('defines queueState', () => {
        expect(script).toContain('var queueState');
        expect(script).toContain('queued: []');
        expect(script).toContain('running: []');
        expect(script).toContain('isPaused: false');
    });

    it('defines fetchQueue function', () => {
        expect(script).toContain('function fetchQueue()');
        expect(script).toContain('/queue');
    });

    it('defines renderQueuePanel function', () => {
        expect(script).toContain('function renderQueuePanel()');
        expect(script).toContain('queue-panel');
    });

    it('defines renderQueueTask function', () => {
        expect(script).toContain('function renderQueueTask(');
        expect(script).toContain('queue-task');
    });

    it('defines queue control functions', () => {
        expect(script).toContain('function queuePause()');
        expect(script).toContain('function queueResume()');
        expect(script).toContain('function queueClear()');
        expect(script).toContain('function queueCancelTask(');
        expect(script).toContain('function queueMoveToTop(');
        expect(script).toContain('function queueMoveUp(');
        expect(script).toContain('function queueMoveDown(');
    });

    it('defines enqueue dialog functions', () => {
        expect(script).toContain('function showEnqueueDialog()');
        expect(script).toContain('function hideEnqueueDialog()');
        expect(script).toContain('function submitEnqueueForm(');
    });

    it('auto-fetches queue on load', () => {
        expect(script).toContain('fetchQueue();');
    });

    it('defines queue polling functions', () => {
        expect(script).toContain('function startQueuePolling()');
        expect(script).toContain('function stopQueuePolling()');
    });

    it('polls queue every 3 seconds when active', () => {
        expect(script).toContain('3000');
        expect(script).toContain('queuePollInterval');
    });

    it('stops polling when no active tasks', () => {
        expect(script).toContain('stopQueuePolling()');
    });

    it('starts polling after enqueue', () => {
        expect(script).toContain('startQueuePolling()');
    });

    it('auto-expands history on fetchQueue when tasks complete', () => {
        expect(script).toContain('queueState.showHistory = true');
    });

    it('reads model and cwd inputs in submitEnqueueForm', () => {
        expect(script).toContain("getElementById('enqueue-model')");
        expect(script).toContain("getElementById('enqueue-cwd')");
    });

    it('sends model in config when provided', () => {
        expect(script).toContain('config.model = model');
    });

    it('sends workingDirectory in payload for ai-clarification and follow-prompt', () => {
        expect(script).toContain('payload.workingDirectory = cwd');
    });

    it('clears model and cwd inputs after submit', () => {
        expect(script).toContain("modelInput) modelInput.value = ''");
        expect(script).toContain("cwdInput) cwdInput.value = ''");
    });

    it('sets up enqueue form event listeners', () => {
        expect(script).toContain("getElementById('enqueue-form')");
        expect(script).toContain("getElementById('enqueue-cancel')");
        expect(script).toContain("getElementById('enqueue-overlay')");
    });

    it('supports priority icons', () => {
        expect(script).toContain('priorityIcon');
        expect(script).toContain('high');
        expect(script).toContain('low');
    });

    it('uses confirm dialog for clear', () => {
        expect(script).toContain('confirm(');
    });
});

describe('Queue styles', () => {
    const styles = getDashboardStyles();

    it('defines queue panel styles', () => {
        expect(styles).toContain('.queue-panel');
        expect(styles).toContain('.queue-header');
        expect(styles).toContain('.queue-task');
    });

    it('defines queue control button styles', () => {
        expect(styles).toContain('.queue-ctrl-btn');
        expect(styles).toContain('.queue-ctrl-danger');
    });

    it('defines queue task action styles', () => {
        expect(styles).toContain('.queue-task-actions');
        expect(styles).toContain('.queue-action-btn');
        expect(styles).toContain('.queue-action-danger');
    });

    it('defines queue empty state styles', () => {
        expect(styles).toContain('.queue-empty');
        expect(styles).toContain('.queue-add-btn');
    });

    it('defines enqueue dialog styles', () => {
        expect(styles).toContain('.enqueue-overlay');
        expect(styles).toContain('.enqueue-dialog');
        expect(styles).toContain('.enqueue-form');
        expect(styles).toContain('.enqueue-btn-primary');
        expect(styles).toContain('.enqueue-btn-secondary');
    });

    it('defines queue count badge styles', () => {
        expect(styles).toContain('.queue-count');
        expect(styles).toContain('.queue-paused-badge');
    });

    it('defines optional hint style for task name label', () => {
        expect(styles).toContain('.enqueue-optional');
    });

    it('hides task actions until hover', () => {
        expect(styles).toContain('.queue-task-actions');
        expect(styles).toContain('opacity: 0');
        expect(styles).toContain('.queue-task:hover .queue-task-actions');
        expect(styles).toContain('opacity: 1');
    });
});

// ============================================================================
// Queue Task Conversation View
// ============================================================================

describe('Queue task conversation view', () => {
    const detailScript = getDetailScript();
    const queueScript = getQueueScript({ apiBasePath: '/api', wsPath: '/ws' });

    describe('detail script — conversation functions', () => {
        it('defines showQueueTaskDetail function', () => {
            expect(detailScript).toContain('function showQueueTaskDetail(taskId)');
        });

        it('defines renderQueueTaskConversation function', () => {
            expect(detailScript).toContain('function renderQueueTaskConversation(processId, taskId, proc)');
        });

        it('defines connectQueueTaskSSE function', () => {
            expect(detailScript).toContain('function connectQueueTaskSSE(processId, taskId, proc)');
        });

        it('defines closeQueueTaskStream function', () => {
            expect(detailScript).toContain('function closeQueueTaskStream()');
        });

        it('defines updateConversationContent function', () => {
            expect(detailScript).toContain('function updateConversationContent()');
        });

        it('defines scrollConversationToBottom function', () => {
            expect(detailScript).toContain('function scrollConversationToBottom()');
        });

        it('defines copyQueueTaskResult function', () => {
            expect(detailScript).toContain('function copyQueueTaskResult(processId)');
        });

        it('constructs process ID with queue- prefix', () => {
            expect(detailScript).toContain("var processId = 'queue-' + taskId");
        });

        it('uses EventSource for SSE streaming', () => {
            expect(detailScript).toContain('new EventSource(sseUrl)');
        });

        it('listens for chunk events', () => {
            expect(detailScript).toContain("addEventListener('chunk'");
        });

        it('listens for status events', () => {
            expect(detailScript).toContain("addEventListener('status'");
        });

        it('listens for done events', () => {
            expect(detailScript).toContain("addEventListener('done'");
        });

        it('listens for heartbeat events', () => {
            expect(detailScript).toContain("addEventListener('heartbeat'");
        });

        it('accumulates streaming content', () => {
            expect(detailScript).toContain('queueTaskStreamContent += data.content');
        });

        it('auto-scrolls conversation to bottom during streaming', () => {
            expect(detailScript).toContain('scrollConversationToBottom()');
        });

        it('shows streaming indicator for running tasks', () => {
            expect(detailScript).toContain('streaming-indicator');
            expect(detailScript).toContain('Live');
        });

        it('shows waiting message when no content yet', () => {
            expect(detailScript).toContain('Waiting for response...');
        });

        it('closes previous SSE stream when opening new task', () => {
            expect(detailScript).toContain('closeQueueTaskStream()');
        });

        it('cleans up SSE stream on clearDetail', () => {
            // clearDetail should call closeQueueTaskStream
            expect(detailScript).toContain('function clearDetail()');
            // The clearDetail function should reference closeQueueTaskStream
            const clearDetailMatch = detailScript.match(/function clearDetail\(\)[^}]*closeQueueTaskStream/s);
            expect(clearDetailMatch).toBeTruthy();
        });

        it('fetches process data via REST API', () => {
            expect(detailScript).toContain("fetchApi('/processes/' + encodeURIComponent(processId))");
        });

        it('renders markdown in conversation body', () => {
            expect(detailScript).toContain('renderMarkdown(proc.result)');
            expect(detailScript).toContain('renderMarkdown(queueTaskStreamContent)');
        });

        it('retries SSE connection on error with delay', () => {
            expect(detailScript).toContain('setTimeout(function()');
            expect(detailScript).toContain('2000');
        });

        it('renders back button in detail header', () => {
            expect(detailScript).toContain('detail-back-btn');
            expect(detailScript).toContain('clearDetail()');
        });

        it('renders copy result button for completed tasks', () => {
            expect(detailScript).toContain('Copy Result');
            expect(detailScript).toContain('copyQueueTaskResult');
        });

        it('renders prompt section when available', () => {
            expect(detailScript).toContain('prompt-section');
            expect(detailScript).toContain('Prompt');
        });

        it('renders error alert when process has error', () => {
            expect(detailScript).toContain('error-alert');
        });

        it('renders model in queue task conversation metadata', () => {
            expect(detailScript).toContain('proc.metadata.model');
        });

        it('renders working directory in queue task conversation metadata', () => {
            expect(detailScript).toContain('proc.workingDirectory');
        });
    });

    describe('queue script — clickable tasks', () => {
        it('makes running tasks clickable with showQueueTaskDetail', () => {
            expect(queueScript).toContain("showQueueTaskDetail(\\'");
        });

        it('makes history tasks clickable with showQueueTaskDetail', () => {
            // renderQueueHistoryTask should have onclick
            expect(queueScript).toContain("onclick=\"showQueueTaskDetail(\\'");
        });

        it('sets cursor pointer on clickable tasks', () => {
            expect(queueScript).toContain('cursor:pointer');
        });

        it('stops event propagation on action buttons', () => {
            expect(queueScript).toContain('event.stopPropagation()');
        });
    });

    describe('conversation styles', () => {
        const conversationStyles = getDashboardStyles();

        it('defines conversation section styles', () => {
            expect(conversationStyles).toContain('.conversation-section');
            expect(conversationStyles).toContain('.conversation-body');
        });

        it('defines streaming indicator with pulse animation', () => {
            expect(conversationStyles).toContain('.streaming-indicator');
            expect(conversationStyles).toContain('@keyframes pulse');
        });

        it('defines conversation waiting state style', () => {
            expect(conversationStyles).toContain('.conversation-waiting');
        });

        it('defines back button style', () => {
            expect(conversationStyles).toContain('.detail-back-btn');
            expect(conversationStyles).toContain('.detail-header-top');
        });

        it('sets max-height and overflow on conversation body', () => {
            expect(conversationStyles).toContain('max-height: 60vh');
            expect(conversationStyles).toContain('overflow-y: auto');
        });

        it('styles code blocks in conversation', () => {
            expect(conversationStyles).toContain('.conversation-body pre');
            expect(conversationStyles).toContain('.conversation-body code');
        });

        it('styles blockquotes in conversation', () => {
            expect(conversationStyles).toContain('.conversation-body blockquote');
        });
    });
});
