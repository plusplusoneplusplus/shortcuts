/**
 * SPA Template for Server Mode
 *
 * Generates a DeepWiki-style SPA that fetches data from the server's REST API.
 * Designed to match the real DeepWiki (deepwiki.com) UI:
 *   - Top navigation bar with project name and dark/light toggle
 *   - Collapsible left sidebar with nested navigation
 *   - "Relevant source files" collapsible per article
 *   - "On this page" right-hand TOC
 *   - Bottom "Ask AI" input bar (like DeepWiki's "Ask Devin")
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { WebsiteTheme } from '../types';
import type { SpaTemplateOptions, ScriptOptions } from './spa/types';
import { escapeHtml } from './spa/helpers';
import { getSpaStyles } from './spa/styles';
import { getCoreScript } from './spa/scripts/core';
import { getThemeScript } from './spa/scripts/theme';
import { getSidebarScript } from './spa/scripts/sidebar';
import { getContentScript } from './spa/scripts/content';
import { getMarkdownScript } from './spa/scripts/markdown';
import { getTocScript } from './spa/scripts/toc';
import { getGraphScript } from './spa/scripts/graph';
import { getAskAiScript } from './spa/scripts/ask-ai';
import { getWebSocketScript } from './spa/scripts/websocket';

export type { SpaTemplateOptions } from './spa/types';

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate the SPA HTML for server mode.
 */
export function generateSpaHtml(options: SpaTemplateOptions): string {
    const { theme, title, enableSearch, enableAI, enableGraph, enableWatch = false } = options;

    const themeClass = theme === 'auto' ? '' : `class="${theme}-theme"`;
    const themeMetaTag = theme === 'auto'
        ? '<meta name="color-scheme" content="light dark">'
        : '';

    return `<!DOCTYPE html>
<html lang="en" ${themeClass} data-theme="${theme}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${themeMetaTag}
    <title>${escapeHtml(title)} — Wiki</title>

    <!-- Syntax Highlighting -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" id="hljs-light">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" id="hljs-dark" disabled>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>

    <!-- Mermaid Diagrams -->
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>

    <!-- Markdown Parser -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

${enableGraph ? `    <!-- D3.js for interactive dependency graph -->
    <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>` : ''}

    <style>
${getSpaStyles(enableAI)}
    </style>
</head>
<body>
    <!-- Top Navigation Bar -->
    <header class="top-bar" id="top-bar">
        <div class="top-bar-left">
            <span class="top-bar-logo">DeepWiki</span>
            <span class="top-bar-project" id="top-bar-project">${escapeHtml(title)}</span>
        </div>
        <div class="top-bar-right">
            <button class="top-bar-btn" id="admin-toggle" aria-label="Admin portal" title="Admin portal">&#9881;</button>
            <button class="top-bar-btn" id="theme-toggle" aria-label="Toggle theme" title="Toggle theme">&#9790;</button>
        </div>
    </header>

    <div class="app-layout">
        <!-- Left Sidebar -->
        <aside class="sidebar" id="sidebar">
            <button class="sidebar-collapse-btn" id="sidebar-collapse" aria-label="Collapse sidebar" title="Collapse sidebar">&#x25C0;</button>
${enableSearch ? `            <div class="search-box">
                <input type="text" id="search" placeholder="Search modules..." aria-label="Search modules">
            </div>` : ''}
            <nav id="nav-container" class="sidebar-nav"></nav>
        </aside>

        <!-- Main Content Area -->
        <main class="main-content" id="main-content">
            <div class="content-scroll" id="content-scroll">
                <div class="content-layout">
                    <article class="article" id="article">
                        <div id="content" class="markdown-body">
                            <div class="loading">Loading wiki data...</div>
                        </div>
                    </article>

                    <!-- Right TOC Sidebar -->
                    <aside class="toc-sidebar" id="toc-sidebar">
                        <div class="toc-container" id="toc-container">
                            <h4 class="toc-title">On this page</h4>
                            <nav id="toc-nav" class="toc-nav"></nav>
                        </div>
                    </aside>
                </div>
            </div>

            <!-- Admin Page (hidden by default, shown as full page via SPA routing) -->
            <div class="admin-page hidden" id="admin-page">
                <div class="admin-page-header">
                    <div class="admin-page-title-row">
                        <h1 class="admin-page-title">Admin Portal</h1>
                        <button class="admin-btn admin-btn-back" id="admin-back" aria-label="Back to wiki">&larr; Back to Wiki</button>
                    </div>
                    <p class="admin-page-desc">Manage seeds and configuration files for wiki generation.</p>
                </div>
                <div class="admin-tabs" id="admin-tabs">
                    <button class="admin-tab active" data-tab="seeds" id="admin-tab-seeds">Seeds</button>
                    <button class="admin-tab" data-tab="config" id="admin-tab-config">Config</button>
                </div>
                <div class="admin-body">
                    <div class="admin-tab-content active" id="admin-content-seeds">
                        <div class="admin-section">
                            <div class="admin-file-info">
                                <span class="admin-file-path" id="seeds-path">Loading...</span>
                                <span class="admin-file-status" id="seeds-status"></span>
                            </div>
                            <textarea class="admin-editor" id="seeds-editor" spellcheck="false" placeholder="Seeds file not found. Paste seeds JSON here to create one."></textarea>
                            <div class="admin-actions">
                                <button class="admin-btn admin-btn-save" id="seeds-save">Save</button>
                                <button class="admin-btn admin-btn-reset" id="seeds-reset">Reset</button>
                            </div>
                        </div>
                    </div>
                    <div class="admin-tab-content" id="admin-content-config">
                        <div class="admin-section">
                            <div class="admin-file-info">
                                <span class="admin-file-path" id="config-path">Loading...</span>
                                <span class="admin-file-status" id="config-status"></span>
                            </div>
                            <textarea class="admin-editor" id="config-editor" spellcheck="false" placeholder="Config file not found. Paste YAML config here to create one."></textarea>
                            <div class="admin-actions">
                                <button class="admin-btn admin-btn-save" id="config-save">Save</button>
                                <button class="admin-btn admin-btn-reset" id="config-reset">Reset</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    </div>

${enableAI ? `    <!-- Floating Ask AI Widget -->
    <div class="ask-widget" id="ask-widget">
        <div class="ask-widget-header hidden" id="ask-widget-header">
            <span class="ask-widget-title">Ask AI</span>
            <div class="ask-widget-actions">
                <button class="ask-widget-clear" id="ask-clear" title="Clear conversation">Clear</button>
                <button class="ask-widget-close" id="ask-close" aria-label="Close">&times;</button>
            </div>
        </div>
        <div class="ask-messages hidden" id="ask-messages"></div>
        <div class="ask-widget-input">
            <span class="ask-widget-label" id="ask-widget-label">Ask AI about <strong id="ask-bar-subject">${escapeHtml(title)}</strong></span>
            <div class="ask-widget-input-row">
                <textarea class="ask-widget-textarea" id="ask-textarea" placeholder="Ask about this codebase..." rows="1"></textarea>
                <button class="ask-widget-send" id="ask-widget-send" aria-label="Send question">&#10148;</button>
            </div>
        </div>
    </div>` : ''}

${enableWatch ? `    <div class="live-reload-bar" id="live-reload-bar"></div>` : ''}

    <script>
${getSpaScript({ enableSearch, enableAI, enableGraph, enableWatch, defaultTheme: theme })}
    </script>
</body>
</html>`;
}

// ============================================================================
// JavaScript
// ============================================================================

function getSpaScript(opts: ScriptOptions): string {
    return getCoreScript(opts.defaultTheme) +
        getThemeScript() +
        getSidebarScript({ enableSearch: opts.enableSearch, enableGraph: opts.enableGraph }) +
        getContentScript({ enableAI: opts.enableAI }) +
        getMarkdownScript() +
        getTocScript() +
        (opts.enableGraph ? getGraphScript() : '') + '\n' +
        (opts.enableAI ? getAskAiScript() : '') + '\n' +
        (opts.enableWatch ? getWebSocketScript() : '') + '\n' +
        `
        // ================================================================
        // Admin Portal (full page via SPA routing)
        // ================================================================

        var adminSeedsOriginal = '';
        var adminConfigOriginal = '';
        var adminInitialized = false;

        function showAdmin(skipHistory) {
            currentModuleId = null;
            showAdminContent();
            if (!skipHistory) {
                history.pushState({ type: 'admin' }, '', location.pathname + '#admin');
            }
            if (!adminInitialized) {
                initAdminEvents();
                adminInitialized = true;
            }
            loadAdminSeeds();
            loadAdminConfig();
        }

        document.getElementById('admin-toggle').addEventListener('click', function() {
            showAdmin(false);
        });

        document.getElementById('admin-back').addEventListener('click', function() {
            showHome(false);
        });

        function initAdminEvents() {
            // Tab switching
            document.querySelectorAll('.admin-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    var target = this.getAttribute('data-tab');
                    document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
                    document.querySelectorAll('.admin-tab-content').forEach(function(c) { c.classList.remove('active'); });
                    this.classList.add('active');
                    document.getElementById('admin-content-' + target).classList.add('active');
                });
            });

            // Save seeds
            document.getElementById('seeds-save').addEventListener('click', async function() {
                clearAdminStatus('seeds');
                var text = document.getElementById('seeds-editor').value;
                var content;
                try {
                    content = JSON.parse(text);
                } catch (e) {
                    setAdminStatus('seeds', 'Invalid JSON: ' + e.message, true);
                    return;
                }
                try {
                    var res = await fetch('/api/admin/seeds', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: content })
                    });
                    var data = await res.json();
                    if (data.success) {
                        setAdminStatus('seeds', 'Saved', false);
                        adminSeedsOriginal = text;
                    } else {
                        setAdminStatus('seeds', data.error || 'Save failed', true);
                    }
                } catch (err) {
                    setAdminStatus('seeds', 'Error: ' + err.message, true);
                }
            });

            // Reset seeds
            document.getElementById('seeds-reset').addEventListener('click', function() {
                document.getElementById('seeds-editor').value = adminSeedsOriginal;
                clearAdminStatus('seeds');
            });

            // Save config
            document.getElementById('config-save').addEventListener('click', async function() {
                clearAdminStatus('config');
                var text = document.getElementById('config-editor').value;
                try {
                    var res = await fetch('/api/admin/config', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: text })
                    });
                    var data = await res.json();
                    if (data.success) {
                        setAdminStatus('config', 'Saved', false);
                        adminConfigOriginal = text;
                    } else {
                        setAdminStatus('config', data.error || 'Save failed', true);
                    }
                } catch (err) {
                    setAdminStatus('config', 'Error: ' + err.message, true);
                }
            });

            // Reset config
            document.getElementById('config-reset').addEventListener('click', function() {
                document.getElementById('config-editor').value = adminConfigOriginal;
                clearAdminStatus('config');
            });
        }

        function setAdminStatus(which, msg, isError) {
            var el = document.getElementById(which + '-status');
            el.textContent = msg;
            el.className = 'admin-file-status ' + (isError ? 'error' : 'success');
        }

        function clearAdminStatus(which) {
            var el = document.getElementById(which + '-status');
            el.textContent = '';
            el.className = 'admin-file-status';
        }

        async function loadAdminSeeds() {
            try {
                var res = await fetch('/api/admin/seeds');
                var data = await res.json();
                document.getElementById('seeds-path').textContent = data.path || 'seeds.json';
                if (data.exists && data.content) {
                    var text = JSON.stringify(data.content, null, 2);
                    document.getElementById('seeds-editor').value = text;
                    adminSeedsOriginal = text;
                } else if (data.exists && data.raw) {
                    document.getElementById('seeds-editor').value = data.raw;
                    adminSeedsOriginal = data.raw;
                } else {
                    document.getElementById('seeds-editor').value = '';
                    adminSeedsOriginal = '';
                }
            } catch (err) {
                setAdminStatus('seeds', 'Failed to load: ' + err.message, true);
            }
        }

        async function loadAdminConfig() {
            try {
                var res = await fetch('/api/admin/config');
                var data = await res.json();
                document.getElementById('config-path').textContent = data.path || 'deep-wiki.config.yaml';
                if (data.exists && data.content) {
                    document.getElementById('config-editor').value = data.content;
                    adminConfigOriginal = data.content;
                } else {
                    document.getElementById('config-editor').value = '';
                    adminConfigOriginal = '';
                }
            } catch (err) {
                setAdminStatus('config', 'Failed to load: ' + err.message, true);
            }
        }`;

}
