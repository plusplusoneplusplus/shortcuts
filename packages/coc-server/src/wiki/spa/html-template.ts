/**
 * SPA HTML Template
 *
 * Contains the HTML skeleton (DOCTYPE, head with CDN links, body structure
 * with sidebar/main/admin/ask-widget) for the DeepWiki SPA.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SpaTemplateOptions } from './types';
import { escapeHtml } from './helpers';

/** Read the esbuild-bundled client CSS (built by npm run build:client). */
const bundleCss = fs.readFileSync(
    path.join(__dirname, 'client', 'dist', 'bundle.css'), 'utf-8'
);

/** Read the esbuild-bundled client JS (built by npm run build:client). */
const bundleJs = fs.readFileSync(
    path.join(__dirname, 'client', 'dist', 'bundle.js'), 'utf-8'
);

/**
 * Generate the SPA HTML for server mode.
 */
export function generateSpaHtml(options: SpaTemplateOptions): string {
    const { theme, title, enableSearch, enableAI, enableGraph, enableWatch = false, workspaceId } = options;

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
${bundleCss}
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
                <input type="text" id="search" placeholder="Search components..." aria-label="Search components">
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
                                                <span class="phase-desc">Scan repo and build component graph</span>
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
                                                <span class="phase-desc">Merge related components into clusters</span>
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
                                                <span class="phase-desc">Deep analysis of each component</span>
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
                                        <button class="phase-component-list-toggle" id="phase4-component-toggle" style="display: none;">
                                            <span class="toggle-arrow">&#x25B6;</span> Components (<span id="phase4-component-count">0</span>)
                                        </button>
                                        <div class="phase-component-list" id="phase4-component-list"></div>
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

            <!-- Git Branches Page (hidden by default, shown as full page via SPA routing) -->
            <div class="admin-page hidden" id="git-branches-page">
                <div class="admin-page-header">
                    <div class="admin-page-title-row">
                        <h1 class="admin-page-title">Git Branches</h1>
                        <button class="admin-btn admin-btn-back" id="git-branches-back">&larr; Back to Wiki</button>
                    </div>
                </div>
                <div class="git-branch-status-banner" id="git-branch-status-banner"></div>
                <div id="git-branch-actions" class="admin-actions" style="flex-wrap:wrap;gap:8px;margin:12px 24px;">
                    <button id="git-branch-btn-create" class="admin-btn admin-btn-save">Create Branch</button>
                    <button id="git-branch-btn-push" class="admin-btn admin-btn-reset">Push</button>
                    <button id="git-branch-btn-pull" class="admin-btn admin-btn-reset">Pull</button>
                    <button id="git-branch-btn-fetch" class="admin-btn admin-btn-reset">Fetch</button>
                    <button id="git-branch-btn-stash" class="admin-btn admin-btn-reset">Stash</button>
                    <button id="git-branch-btn-pop" class="admin-btn admin-btn-reset">Pop Stash</button>
                    <button id="git-branch-btn-merge" class="admin-btn admin-btn-reset">Merge\u2026</button>
                </div>
                <div class="admin-tabs" id="git-branches-tabs">
                    <button class="admin-tab active" data-tab="local" id="git-branches-tab-local">Local</button>
                    <button class="admin-tab" data-tab="remote" id="git-branches-tab-remote">Remote</button>
                </div>
                <div class="git-branches-search-row">
                    <input type="text" id="git-branches-search" placeholder="Search branches..." aria-label="Search branches">
                </div>
                <div class="admin-body" id="git-branches-body">
                    <div id="git-branches-table-container"></div>
                    <div id="git-branches-pagination"></div>
                </div>

                <!-- Modal overlay -->
                <div id="git-branch-modal-overlay" class="hidden" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;">
                    <div id="git-branch-modal-container" style="background:var(--vscode-editor-background,#1e1e1e);border:1px solid var(--content-border,#555);border-radius:6px;padding:24px;min-width:320px;max-width:480px;width:100%;"></div>
                </div>

                <!-- Dialog templates -->
                <div id="git-branch-dialog-create" class="hidden">
                    <h3 class="modal-title">Create Branch</h3>
                    <label>Branch name<input id="git-branch-create-name" type="text" class="admin-input" placeholder="feature/my-branch" /></label>
                    <label><input id="git-branch-create-checkout" type="checkbox" checked /> Switch to branch after creating</label>
                    <div class="admin-actions">
                        <button id="git-branch-create-submit" class="admin-btn admin-btn-save">Create</button>
                        <button id="git-branch-create-cancel" class="admin-btn admin-btn-reset">Cancel</button>
                    </div>
                    <div id="git-branch-create-status" class="admin-file-status"></div>
                </div>
                <div id="git-branch-dialog-rename" class="hidden">
                    <h3 class="modal-title">Rename Branch</h3>
                    <p>Renaming: <strong id="git-branch-rename-old"></strong></p>
                    <label>New name<input id="git-branch-rename-new" type="text" class="admin-input" /></label>
                    <div class="admin-actions">
                        <button id="git-branch-rename-submit" class="admin-btn admin-btn-save">Rename</button>
                        <button id="git-branch-rename-cancel" class="admin-btn admin-btn-reset">Cancel</button>
                    </div>
                    <div id="git-branch-rename-status" class="admin-file-status"></div>
                </div>
                <div id="git-branch-dialog-delete" class="hidden">
                    <h3 class="modal-title">Delete Branch</h3>
                    <p>Delete branch <strong id="git-branch-delete-name"></strong>?</p>
                    <label><input id="git-branch-delete-force" type="checkbox" /> Force delete (even if unmerged)</label>
                    <div class="admin-actions">
                        <button id="git-branch-delete-confirm" class="admin-btn admin-btn-danger">Delete</button>
                        <button id="git-branch-delete-cancel" class="admin-btn admin-btn-reset">Cancel</button>
                    </div>
                    <div id="git-branch-delete-status" class="admin-file-status"></div>
                </div>
                <div id="git-branch-dialog-merge" class="hidden">
                    <h3 class="modal-title">Merge Branch into Current</h3>
                    <label>Branch to merge<input id="git-branch-merge-source" type="text" class="admin-input" placeholder="feature/branch-name" /></label>
                    <div class="admin-actions">
                        <button id="git-branch-merge-submit" class="admin-btn admin-btn-save">Merge</button>
                        <button id="git-branch-merge-cancel" class="admin-btn admin-btn-reset">Cancel</button>
                    </div>
                    <div id="git-branch-merge-status" class="admin-file-status"></div>
                </div>
            </div>

            <!-- Toast notification container -->
            <div id="git-toast-container" style="position:fixed;top:16px;right:16px;z-index:2000;display:flex;flex-direction:column;gap:8px;"></div>
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
    window.__WIKI_CONFIG__ = {
        defaultTheme: ${JSON.stringify(theme)},
        enableSearch: ${JSON.stringify(enableSearch)},
        enableAI: ${JSON.stringify(enableAI)},
        enableGraph: ${JSON.stringify(enableGraph)},
        enableWatch: ${JSON.stringify(enableWatch)},
        workspaceId: ${JSON.stringify(workspaceId ?? null)}
    };
    </script>
    <script>
${bundleJs}
    </script>
</body>
</html>`;
}
