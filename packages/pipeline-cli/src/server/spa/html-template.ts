/**
 * SPA HTML Template
 *
 * Main HTML generator for the AI Execution Dashboard.
 * Returns a complete <!DOCTYPE html> string with inlined <style> and <script>.
 * No external CDN dependencies — everything is inline.
 *
 * Mirrors packages/deep-wiki/src/server/spa/html-template.ts pattern.
 */

import type { DashboardOptions } from './types';
import { escapeHtml } from './helpers';
import { getDashboardStyles } from './styles';
import { getDashboardScript } from './scripts';

export function generateDashboardHtml(options: DashboardOptions = {}): string {
    const {
        title = 'AI Execution Dashboard',
        theme = 'auto',
        wsPath = '/ws',
        apiBasePath = '/api',
    } = options;

    const themeAttr = theme === 'auto' ? '' : ` data-theme="${theme === 'dark' ? 'dark' : 'light'}"`;

    return `<!DOCTYPE html>
<html lang="en"${themeAttr}>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
${getDashboardStyles()}
    </style>
</head>
<body>
    <header class="top-bar">
        <div class="top-bar-left">
            <button class="hamburger-btn" id="hamburger-btn" aria-label="Toggle sidebar">&#9776;</button>
            <span class="top-bar-logo">${escapeHtml(title)}</span>
        </div>
        <div class="top-bar-right">
            <select id="workspace-select" class="workspace-select">
                <option value="__all">All Workspaces</option>
            </select>
            <button id="theme-toggle" class="top-bar-btn" aria-label="Toggle theme">&#127761;</button>
        </div>
    </header>

    <div class="app-layout">
        <aside class="sidebar" id="sidebar">
            <div class="filter-bar">
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
                <button id="clear-completed" class="sidebar-btn">Clear &#9989;</button>
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

    <script>
${getDashboardScript({ defaultTheme: theme, wsPath, apiBasePath })}
    </script>
</body>
</html>`;
}
