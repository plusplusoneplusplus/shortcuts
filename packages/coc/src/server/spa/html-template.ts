/**
 * SPA HTML Template
 *
 * Main HTML generator for the AI Execution Dashboard.
 * Returns a complete <!DOCTYPE html> string with inlined <style> and <script>.
 * No external CDN dependencies — everything is inline.
 *
 * Mirrors packages/deep-wiki/src/server/spa/html-template.ts pattern.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { DashboardOptions } from './types';
import { escapeHtml } from './helpers';
import { getAllModels } from '@plusplusoneplusplus/pipeline-core';

/** Read the esbuild-bundled client CSS (built by npm run build:client). */
const bundleCss = fs.readFileSync(
    path.join(__dirname, 'client', 'dist', 'bundle.css'), 'utf-8'
);

/** Read the esbuild-bundled client JS (built by npm run build:client). */
const bundleJs = fs.readFileSync(
    path.join(__dirname, 'client', 'dist', 'bundle.js'), 'utf-8'
);

export function generateDashboardHtml(options: DashboardOptions = {}): string {
    const {
        title = 'AI Execution Dashboard',
        theme = 'auto',
        wsPath = '/ws',
        apiBasePath = '/api',
        enableWiki = false,
        reviewFilePath,
        projectDir,
    } = options;

    const themeAttr = theme === 'auto' ? '' : ` data-theme="${theme === 'dark' ? 'dark' : 'light'}"`;

    return `<!DOCTYPE html>
<html lang="en"${themeAttr}>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <!-- highlight.js 11.9.0 — syntax highlighting (review editor + wiki) -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" id="hljs-light">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" id="hljs-dark" disabled>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>${enableWiki ? `
    <!-- mermaid 10.x — diagram rendering (wiki) -->
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script>
    <!-- marked — markdown-to-HTML parser (wiki) -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>` : ''}
    <style>
${bundleCss}
    </style>
</head>
<body>
    <header class="top-bar">
        <div class="top-bar-left">
            <button class="hamburger-btn" id="hamburger-btn" aria-label="Toggle sidebar">&#9776;</button>
            <span class="top-bar-logo">${escapeHtml(title)}</span>
            <nav class="top-bar-nav">
                <a href="/" class="nav-link" data-page="dashboard">Dashboard</a>
            </nav>
        </div>
        <div class="top-bar-right">
            <select id="workspace-select" class="workspace-select">
                <option value="__all">All Repos</option>
            </select>
            <button id="theme-toggle" class="top-bar-btn" aria-label="Toggle theme">&#127761;</button>
        </div>
    </header>

    <nav class="tab-bar" id="tab-bar">
        <button class="tab-btn active" data-tab="processes">Processes</button>
        <button class="tab-btn" data-tab="repos">Repos</button>
        <button class="tab-btn" data-tab="wiki">Wiki</button>
        <button class="tab-btn" data-tab="reports" disabled>Reports</button>
    </nav>

    <div class="app-layout" id="view-processes">
        <aside class="sidebar" id="sidebar">
            <div class="filter-bar">
                <div class="view-mode-toggle">
                    <button id="view-mode-active" class="view-mode-btn active" title="Show running and queued processes">Active</button>
                    <button id="view-mode-history" class="view-mode-btn" title="Show completed, failed, and cancelled processes">History</button>
                </div>
                <input type="text" id="search-input" placeholder="Search processes..." />
                <select id="status-filter">
                    <option value="__all">All Statuses</option>
                    <option value="running">&#128260; Running</option>
                    <option value="queued">&#9203; Queued</option>
                    <option value="completed">&#9989; Completed</option>
                    <option value="failed">&#10060; Failed</option>
                    <option value="cancelled">&#128683; Cancelled</option>
                </select>
                <select id="type-filter">
                    <option value="__all">All Types</option>
                    <option value="code-review">Code Review</option>
                    <option value="code-review-group">CR Group</option>
                    <option value="pipeline-execution">Pipeline</option>
                    <option value="pipeline-item">Pipeline Item</option>
                    <option value="clarification">Clarification</option>
                    <option value="discovery">Discovery</option>
                </select>
            </div>
            <div id="queue-panel" class="queue-panel"></div>
            <nav id="process-list" class="process-list">
                <div class="empty-state" id="empty-state">
                    <div class="empty-state-icon">&#128203;</div>
                    <div class="empty-state-title">No processes yet</div>
                    <div class="empty-state-text">
                        AI processes will appear here when started via the CLI or VS Code extension.
                    </div>
                </div>
            </nav>
            <div class="sidebar-footer">
                <button id="clear-completed" class="sidebar-btn">Clear &#9989;&#10060;</button>
            </div>
        </aside>

        <main class="detail-panel" id="detail-panel">
            <div class="detail-empty" id="detail-empty">
                <div class="detail-empty-icon">&#128072;</div>
                <div class="detail-empty-text">Select a process to view details</div>
            </div>
            <div class="detail-content hidden" id="detail-content">
            </div>
        </main>
    </div>

    <div class="app-layout hidden" id="view-repos">
        <aside class="sidebar repos-sidebar" id="repos-sidebar">
            <div class="repos-sidebar-header">
                <h2>Repos</h2>
                <button class="enqueue-btn-primary repos-add-btn" id="add-repo-btn">+ Add Repo</button>
            </div>
            <nav id="repos-list" class="repos-list">
                <div class="empty-state" id="repos-empty">
                    <div class="empty-state-icon">&#128193;</div>
                    <div class="empty-state-title">No repos registered</div>
                    <div class="empty-state-text">Add a repo to get started.</div>
                </div>
            </nav>
            <div class="repos-sidebar-footer" id="repos-footer"></div>
        </aside>
        <main class="detail-panel" id="repo-detail-panel">
            <div class="detail-empty" id="repo-detail-empty">
                <div class="detail-empty-icon">&#128193;</div>
                <div class="detail-empty-text">Select a repo to view details</div>
            </div>
            <div class="detail-content hidden" id="repo-detail-content">
            </div>
        </main>
    </div>

    <div class="app-view hidden" id="view-reports">
        <div class="reports-placeholder">
            <div class="empty-state">
                <div class="empty-state-icon">&#128202;</div>
                <div class="empty-state-title">Reports</div>
                <div class="empty-state-text">Cross-repo comparison reports coming soon.</div>
            </div>
        </div>
    </div>

    <div class="app-view hidden" id="view-wiki">
        <div class="wiki-layout">
            <aside class="wiki-sidebar" id="wiki-sidebar">
                <div class="wiki-selector" id="wiki-selector">
                    <select id="wiki-select" class="workspace-select">
                        <option value="">Select wiki...</option>
                    </select>
                    <button class="enqueue-btn-primary" id="add-wiki-btn">+ Add Wiki</button>
                    <button class="wiki-admin-toggle-btn hidden" id="wiki-admin-toggle" title="Wiki Admin">&#9881;</button>
                </div>
                <div class="wiki-graph-btn-container hidden" id="wiki-graph-btn-container">
                    <button class="wiki-graph-btn" id="wiki-graph-btn">&#x1F4CA; Dependency Graph</button>
                </div>
                <div class="wiki-component-tree" id="wiki-component-tree"></div>
            </aside>
            <main class="wiki-content" id="wiki-content">
                <div class="empty-state" id="wiki-empty">
                    <div class="empty-state-icon">&#128214;</div>
                    <div class="empty-state-title">Select a wiki</div>
                    <div class="empty-state-text">Choose a wiki from the sidebar or add a new one.</div>
                </div>
                <div class="wiki-component-detail hidden" id="wiki-component-detail">
                    <div id="wiki-content-scroll" class="wiki-content-scroll">
                        <div class="wiki-content-layout">
                            <article class="wiki-article">
                                <div id="wiki-article-content">
                                </div>
                            </article>
                            <aside class="wiki-toc-sidebar" id="wiki-toc-sidebar">
                                <div class="toc-container">
                                    <h4 class="toc-title">On this page</h4>
                                    <nav id="wiki-toc-nav" class="toc-nav"></nav>
                                </div>
                            </aside>
                        </div>
                    </div>
                </div>
            </main>
        </div>
        <!-- Floating Ask AI Widget -->
        <div class="wiki-ask-widget" id="wiki-ask-widget">
            <div class="wiki-ask-widget-header hidden" id="wiki-ask-widget-header">
                <span class="wiki-ask-widget-title">Ask AI</span>
                <div class="wiki-ask-widget-actions">
                    <button class="wiki-ask-widget-clear" id="wiki-ask-clear" title="Clear conversation">Clear</button>
                    <button class="wiki-ask-widget-close" id="wiki-ask-close" aria-label="Close">&times;</button>
                </div>
            </div>
            <div class="wiki-ask-messages hidden" id="wiki-ask-messages"></div>
            <div class="wiki-ask-widget-input">
                <span class="wiki-ask-widget-label" id="wiki-ask-widget-label">Ask AI about this <strong id="wiki-ask-bar-subject">wiki</strong></span>
                <div class="wiki-ask-widget-input-row">
                    <textarea class="wiki-ask-widget-textarea" id="wiki-ask-textarea" placeholder="Ask about this codebase..." rows="1"></textarea>
                    <button class="wiki-ask-widget-send" id="wiki-ask-widget-send" aria-label="Send question">&#10148;</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Add Wiki Dialog Overlay -->
    <div id="add-wiki-overlay" class="enqueue-overlay hidden">
        <div class="enqueue-dialog" style="width: 480px;">
            <div class="enqueue-dialog-header">
                <h2>Add Wiki</h2>
                <button class="enqueue-close-btn" id="add-wiki-cancel">&times;</button>
            </div>
            <form id="add-wiki-form" class="enqueue-form">
                <div class="enqueue-field">
                    <label for="wiki-path">Repository Path</label>
                    <div class="path-input-row">
                        <input type="text" id="wiki-path" placeholder="/path/to/repository" required />
                        <button type="button" class="browse-btn" id="wiki-browse-btn">Browse</button>
                    </div>
                    <span class="enqueue-optional">Absolute path to the git repo to generate a wiki for</span>
                    <div id="wiki-path-browser" class="path-browser hidden">
                        <div class="path-browser-breadcrumb" id="wiki-path-breadcrumb"></div>
                        <div class="path-browser-list" id="wiki-path-browser-list">
                            <div class="path-browser-loading">Loading...</div>
                        </div>
                        <div class="path-browser-actions">
                            <button type="button" class="enqueue-btn-secondary path-browser-cancel-btn" id="wiki-path-browser-cancel">Cancel</button>
                            <button type="button" class="enqueue-btn-primary path-browser-select-btn" id="wiki-path-browser-select">Select This Directory</button>
                        </div>
                    </div>
                </div>
                <div class="enqueue-field">
                    <label for="wiki-name">Name <span class="enqueue-optional">(optional)</span></label>
                    <input type="text" id="wiki-name" placeholder="Auto-detected from directory name" />
                </div>
                <div class="enqueue-field-row">
                    <div class="enqueue-field">
                        <label for="wiki-color">Color</label>
                        <select id="wiki-color">
                            <option value="#0078d4">&#128309; Blue</option>
                            <option value="#16825d">&#128994; Green</option>
                            <option value="#f14c4c">&#128308; Red</option>
                            <option value="#e8912d">&#128992; Orange</option>
                            <option value="#b180d7">&#128995; Purple</option>
                            <option value="#848484">&#9898; Gray</option>
                        </select>
                    </div>
                    <div class="enqueue-field">
                        <label class="enqueue-checkbox-label">
                            <input type="checkbox" id="wiki-generate-ai" checked />
                            Generate with AI
                        </label>
                    </div>
                </div>
                <div id="wiki-validation" class="repo-validation"></div>
                <div class="enqueue-actions">
                    <button type="button" class="enqueue-btn-secondary" id="add-wiki-cancel-btn">Cancel</button>
                    <button type="submit" class="enqueue-btn-primary" id="add-wiki-submit">Add Wiki</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Add Repo Dialog Overlay -->
    <div id="add-repo-overlay" class="enqueue-overlay hidden">
        <div class="enqueue-dialog" style="width: 480px;">
            <div class="enqueue-dialog-header">
                <h2>Add Repository</h2>
                <button class="enqueue-close-btn" id="add-repo-cancel">&times;</button>
            </div>
            <form id="add-repo-form" class="enqueue-form">
                <div class="enqueue-field">
                    <label for="repo-path">Path</label>
                    <div class="path-input-row">
                        <input type="text" id="repo-path" placeholder="/path/to/repository" />
                        <button type="button" class="browse-btn" id="browse-btn">Browse</button>
                    </div>
                    <span class="enqueue-optional">Absolute path to git repo root</span>
                    <div id="path-browser" class="path-browser hidden">
                        <div class="path-browser-breadcrumb" id="path-breadcrumb"></div>
                        <div class="path-browser-list" id="path-browser-list">
                            <div class="path-browser-loading">Loading...</div>
                        </div>
                        <div class="path-browser-actions">
                            <button type="button" class="enqueue-btn-secondary path-browser-cancel-btn" id="path-browser-cancel">Cancel</button>
                            <button type="button" class="enqueue-btn-primary path-browser-select-btn" id="path-browser-select">Select This Directory</button>
                        </div>
                    </div>
                </div>
                <div class="enqueue-field">
                    <label for="repo-alias">Alias <span class="enqueue-optional">(optional)</span></label>
                    <input type="text" id="repo-alias" placeholder="Auto-detected from directory name" />
                </div>
                <div class="enqueue-field-row">
                    <div class="enqueue-field">
                        <label for="repo-color">Color</label>
                        <select id="repo-color">
                            <option value="#0078d4">&#128309; Blue</option>
                            <option value="#16825d">&#128994; Green</option>
                            <option value="#f14c4c">&#128308; Red</option>
                            <option value="#e8912d">&#128992; Orange</option>
                            <option value="#b180d7">&#128995; Purple</option>
                            <option value="#848484">&#9898; Gray</option>
                        </select>
                    </div>
                    <div class="enqueue-field">
                        <label for="repo-pipelines-folder">Pipelines Folder</label>
                        <input type="text" id="repo-pipelines-folder" value=".vscode/pipelines" />
                        <span class="enqueue-optional">Relative to repo root</span>
                    </div>
                </div>
                <div id="repo-validation" class="repo-validation"></div>
                <div class="enqueue-actions">
                    <button type="button" class="enqueue-btn-secondary" id="add-repo-cancel-btn">Cancel</button>
                    <button type="submit" class="enqueue-btn-primary" id="add-repo-submit">Add Repo</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Enqueue Dialog Overlay -->
    <div id="enqueue-overlay" class="enqueue-overlay hidden">
        <div class="enqueue-dialog">
            <div class="enqueue-dialog-header">
                <h2>Add Task to Queue</h2>
                <button class="enqueue-close-btn" id="enqueue-cancel">&times;</button>
            </div>
            <form id="enqueue-form" class="enqueue-form">
                <div class="enqueue-field">
                    <label for="enqueue-name">Task Name <span class="enqueue-optional">(optional &mdash; auto-generated if empty)</span></label>
                    <input type="text" id="enqueue-name" placeholder="e.g., Review PR #42" />
                </div>
                <div class="enqueue-field-row">
                    <div class="enqueue-field">
                        <label for="enqueue-type">Type</label>
                        <select id="enqueue-type">
                            <option value="custom">Custom</option>
                            <option value="ai-clarification">AI Clarification</option>
                            <option value="follow-prompt">Follow Prompt</option>
                            <option value="code-review">Code Review</option>
                        </select>
                    </div>
                    <div class="enqueue-field">
                        <label for="enqueue-priority">Priority</label>
                        <select id="enqueue-priority">
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                            <option value="low">Low</option>
                        </select>
                    </div>
                </div>
                <div class="enqueue-field-row">
                    <div class="enqueue-field">
                        <label for="enqueue-model">Model <span class="enqueue-optional">(optional)</span></label>
                        <select id="enqueue-model">
                            <option value="">Default</option>
${getAllModels().map(m => `                            <option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}${m.description ? ' ' + escapeHtml(m.description) : ''}</option>`).join('\n')}
                        </select>
                    </div>
                    <div class="enqueue-field">
                        <label for="enqueue-cwd">Working Directory <span class="enqueue-optional">(optional)</span></label>
                        <input type="text" id="enqueue-cwd" placeholder="e.g., /path/to/project" />
                    </div>
                </div>
                <div class="enqueue-field">
                    <label for="enqueue-prompt">Prompt / Details</label>
                    <textarea id="enqueue-prompt" rows="4" placeholder="Optional prompt or additional details..."></textarea>
                </div>
                <div class="enqueue-actions">
                    <button type="button" class="enqueue-btn-secondary" id="enqueue-cancel-btn" onclick="hideEnqueueDialog()">Cancel</button>
                    <button type="submit" class="enqueue-btn-primary">Add to Queue</button>
                </div>
            </form>
        </div>
    </div>

    <!-- File browser page -->
    <div class="page-container hidden" id="page-review-browser">
        <div class="review-browser-header">
            <h2>Markdown Files</h2>
            <input type="text" id="review-search" placeholder="Filter files..." />
        </div>
        <div id="review-browser-content" class="review-browser-content"></div>
    </div>

    <!-- Review editor page -->
    <div class="page-container hidden" id="page-review-editor">
        <div class="review-editor-toolbar" id="review-toolbar">
            <a href="/review" class="back-link" id="review-back-link">&larr; Files</a>
            <span class="review-file-name" id="review-file-name"></span>
            <div class="review-toolbar-actions">
                <div class="review-toolbar-group">
                    <div class="review-mode-toggle" id="review-mode-toggle">
                        <button class="review-mode-btn active" data-mode="review" id="review-mode-review">📝 Review</button>
                        <button class="review-mode-btn" data-mode="source" id="review-mode-source">📄 Source</button>
                    </div>
                </div>
                <div class="review-toolbar-group">
                    <label class="review-show-resolved">
                        <input type="checkbox" id="review-show-resolved" checked>
                        Show Resolved
                    </label>
                </div>
                <div class="review-toolbar-group review-stats" id="review-stats">
                    <span class="stat-open">Open: <span id="review-open-count">0</span></span>
                    <span class="stat-resolved">Resolved: <span id="review-resolved-count">0</span></span>
                </div>
                <button id="review-resolve-all" class="enqueue-btn-secondary">Resolve All</button>
            </div>
        </div>
        <div class="review-editor-layout">
            <div class="review-content" id="review-content">
                <div class="review-rendered-content" id="review-rendered-content"></div>
            </div>
            <aside class="review-comments-panel" id="review-comments-panel"></aside>
        </div>

        <!-- Floating comment input panel -->
        <div class="review-floating-panel" id="review-floating-panel">
            <div class="review-floating-header">
                <span>💬 Add Comment</span>
                <button class="review-floating-close" id="review-floating-close">&times;</button>
            </div>
            <div class="review-floating-selection" id="review-floating-selection"></div>
            <textarea class="review-floating-textarea" id="review-floating-input" placeholder="Enter your comment... (Ctrl+Enter to submit)" rows="3"></textarea>
            <div class="review-floating-footer">
                <button class="review-btn-secondary" id="review-floating-cancel">Cancel</button>
                <button class="review-btn-primary" id="review-floating-save">Add Comment</button>
            </div>
        </div>
    </div>

    <script>
        window.__DASHBOARD_CONFIG__ = {
            apiBasePath: '${escapeHtml(apiBasePath)}',
            wsPath: '${escapeHtml(wsPath)}'
        };
    </script>${reviewFilePath ? `
    <script>
        window.__REVIEW_CONFIG__ = {
            apiBasePath: '${escapeHtml(apiBasePath)}',
            wsPath: '${escapeHtml(wsPath)}',
            filePath: '${escapeHtml(reviewFilePath)}',
            projectDir: '${escapeHtml(projectDir || '')}'
        };
    </script>` : ''}
    <script>
${bundleJs}
    </script>
</body>
</html>`;
}
