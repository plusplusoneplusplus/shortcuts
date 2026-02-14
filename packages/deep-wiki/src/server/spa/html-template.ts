/**
 * SPA HTML Template
 *
 * Contains the HTML skeleton (DOCTYPE, head with CDN links, body structure
 * with sidebar/main/admin/ask-widget) for the DeepWiki SPA.
 */

import type { SpaTemplateOptions } from './types';
import { escapeHtml } from './helpers';
import { getSpaStyles } from './styles';
import { getSpaScript } from './script';

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
                    <p class="admin-page-desc">Manage seeds, configuration, and generation.</p>
                </div>
                <div class="admin-tabs" id="admin-tabs">
                    <button class="admin-tab active" data-tab="seeds" id="admin-tab-seeds">Seeds</button>
                    <button class="admin-tab" data-tab="config" id="admin-tab-config">Config</button>
                    <button class="admin-tab" data-tab="generate" id="admin-tab-generate">Generate</button>
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
                    <div class="admin-tab-content" id="admin-content-generate">
                        <div class="admin-section">
                            <div id="generate-unavailable" class="generate-unavailable hidden">
                                <p>Generation requires a repository path. Restart with:</p>
                                <code>deep-wiki serve &lt;wiki-dir&gt; --generate &lt;repo-path&gt;</code>
                            </div>
                            <div id="generate-controls">
                                <div class="generate-options">
                                    <label class="generate-force-label">
                                        <input type="checkbox" id="generate-force"> Force (ignore cache)
                                    </label>
                                </div>
                                <div class="generate-phases" id="generate-phases">
                                    <div class="generate-phase-card" data-phase="1" id="phase-card-1">
                                        <div class="phase-card-header">
                                            <span class="phase-number">1</span>
                                            <div class="phase-info">
                                                <span class="phase-name">Discovery</span>
                                                <span class="phase-desc">Scan repo and build module graph</span>
                                            </div>
                                            <span class="phase-cache-badge" id="phase-cache-1"></span>
                                            <button class="admin-btn admin-btn-save phase-run-btn" id="phase-run-1" data-phase="1">Run</button>
                                        </div>
                                        <div class="phase-log hidden" id="phase-log-1"></div>
                                    </div>
                                    <div class="generate-phase-card" data-phase="2" id="phase-card-2">
                                        <div class="phase-card-header">
                                            <span class="phase-number">2</span>
                                            <div class="phase-info">
                                                <span class="phase-name">Consolidation</span>
                                                <span class="phase-desc">Merge related modules into clusters</span>
                                            </div>
                                            <span class="phase-cache-badge" id="phase-cache-2"></span>
                                            <button class="admin-btn admin-btn-save phase-run-btn" id="phase-run-2" data-phase="2">Run</button>
                                        </div>
                                        <div class="phase-log hidden" id="phase-log-2"></div>
                                    </div>
                                    <div class="generate-phase-card" data-phase="3" id="phase-card-3">
                                        <div class="phase-card-header">
                                            <span class="phase-number">3</span>
                                            <div class="phase-info">
                                                <span class="phase-name">Analysis</span>
                                                <span class="phase-desc">Deep analysis of each module</span>
                                            </div>
                                            <span class="phase-cache-badge" id="phase-cache-3"></span>
                                            <button class="admin-btn admin-btn-save phase-run-btn" id="phase-run-3" data-phase="3">Run</button>
                                        </div>
                                        <div class="phase-log hidden" id="phase-log-3"></div>
                                    </div>
                                    <div class="generate-phase-card" data-phase="4" id="phase-card-4">
                                        <div class="phase-card-header">
                                            <span class="phase-number">4</span>
                                            <div class="phase-info">
                                                <span class="phase-name">Writing</span>
                                                <span class="phase-desc">Generate wiki articles from analyses</span>
                                            </div>
                                            <span class="phase-cache-badge" id="phase-cache-4"></span>
                                            <button class="admin-btn admin-btn-save phase-run-btn" id="phase-run-4" data-phase="4">Run</button>
                                        </div>
                                        <div class="phase-log hidden" id="phase-log-4"></div>
                                    </div>
                                    <div class="generate-phase-card" data-phase="5" id="phase-card-5">
                                        <div class="phase-card-header">
                                            <span class="phase-number">5</span>
                                            <div class="phase-info">
                                                <span class="phase-name">Website</span>
                                                <span class="phase-desc">Build static HTML site</span>
                                            </div>
                                            <span class="phase-cache-badge" id="phase-cache-5"></span>
                                            <button class="admin-btn admin-btn-save phase-run-btn" id="phase-run-5" data-phase="5">Run</button>
                                        </div>
                                        <div class="phase-log hidden" id="phase-log-5"></div>
                                    </div>
                                </div>
                                <div class="generate-range-controls" id="generate-range-controls">
                                    <div class="generate-range-row">
                                        <label>Run range:</label>
                                        <select id="generate-start-phase">
                                            <option value="1">Phase 1</option>
                                            <option value="2">Phase 2</option>
                                            <option value="3">Phase 3</option>
                                            <option value="4">Phase 4</option>
                                            <option value="5">Phase 5</option>
                                        </select>
                                        <span>to</span>
                                        <select id="generate-end-phase">
                                            <option value="1">Phase 1</option>
                                            <option value="2">Phase 2</option>
                                            <option value="3">Phase 3</option>
                                            <option value="4">Phase 4</option>
                                            <option value="5" selected>Phase 5</option>
                                        </select>
                                        <button class="admin-btn admin-btn-save" id="generate-run-range">Run Range</button>
                                    </div>
                                </div>
                                <div class="generate-status-bar hidden" id="generate-status-bar"></div>
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
