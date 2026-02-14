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
import { getMermaidZoomStyles, getMermaidZoomScript } from '../rendering/mermaid-zoom';
import type { SpaTemplateOptions, ScriptOptions } from './spa/types';
import { escapeHtml } from './spa/helpers';

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
// Styles
// ============================================================================

function getSpaStyles(enableAI: boolean): string {
    let styles = `        :root {
            --sidebar-bg: #ffffff;
            --sidebar-header-bg: #ffffff;
            --sidebar-border: #e5e7eb;
            --sidebar-text: #1f2937;
            --sidebar-muted: #6b7280;
            --sidebar-hover: #f3f4f6;
            --sidebar-active-bg: #eff6ff;
            --sidebar-active-text: #2563eb;
            --sidebar-active-border: #2563eb;
            --content-bg: #ffffff;
            --content-text: #1f2937;
            --content-muted: #6b7280;
            --content-border: #e5e7eb;
            --header-bg: #ffffff;
            --header-shadow: rgba(0,0,0,0.06);
            --code-bg: #f3f4f6;
            --code-border: #e5e7eb;
            --link-color: #2563eb;
            --badge-high-bg: #ef4444;
            --badge-medium-bg: #f59e0b;
            --badge-low-bg: #22c55e;
            --card-bg: #ffffff;
            --card-border: #e5e7eb;
            --card-hover-border: #2563eb;
            --stat-bg: #f9fafb;
            --stat-border: #2563eb;
            --copy-btn-bg: rgba(0,0,0,0.05);
            --copy-btn-hover-bg: rgba(0,0,0,0.1);
            --search-bg: #f3f4f6;
            --search-text: #1f2937;
            --search-placeholder: #9ca3af;
            --topbar-bg: #18181b;
            --topbar-text: #ffffff;
            --topbar-muted: #a1a1aa;
            --source-pill-bg: #f3f4f6;
            --source-pill-border: #e5e7eb;
            --source-pill-text: #374151;
            --toc-active: #2563eb;
            --toc-text: #6b7280;
            --toc-hover: #374151;
            --ask-bar-bg: #f9fafb;
            --ask-bar-border: #e5e7eb;
        }

        .dark-theme,
        html[data-theme="dark"] {
            --sidebar-bg: #111827;
            --sidebar-header-bg: #111827;
            --sidebar-border: #1f2937;
            --sidebar-text: #e5e7eb;
            --sidebar-muted: #9ca3af;
            --sidebar-hover: #1f2937;
            --sidebar-active-bg: #1e3a5f;
            --sidebar-active-text: #60a5fa;
            --content-bg: #0f172a;
            --content-text: #e5e7eb;
            --content-muted: #9ca3af;
            --content-border: #1f2937;
            --header-bg: #111827;
            --header-shadow: rgba(0,0,0,0.3);
            --code-bg: #1e293b;
            --code-border: #334155;
            --link-color: #60a5fa;
            --card-bg: #1e293b;
            --card-border: #334155;
            --stat-bg: #1e293b;
            --copy-btn-bg: rgba(255,255,255,0.08);
            --copy-btn-hover-bg: rgba(255,255,255,0.15);
            --search-bg: #1f2937;
            --search-text: #e5e7eb;
            --search-placeholder: #6b7280;
            --source-pill-bg: #1e293b;
            --source-pill-border: #334155;
            --source-pill-text: #d1d5db;
            --toc-active: #60a5fa;
            --toc-text: #9ca3af;
            --toc-hover: #e5e7eb;
            --ask-bar-bg: #111827;
            --ask-bar-border: #1f2937;
        }

        @media (prefers-color-scheme: dark) {
            html[data-theme="auto"] {
                --sidebar-bg: #111827;
                --sidebar-header-bg: #111827;
                --sidebar-border: #1f2937;
                --sidebar-text: #e5e7eb;
                --sidebar-muted: #9ca3af;
                --sidebar-hover: #1f2937;
                --sidebar-active-bg: #1e3a5f;
                --sidebar-active-text: #60a5fa;
                --content-bg: #0f172a;
                --content-text: #e5e7eb;
                --content-muted: #9ca3af;
                --content-border: #1f2937;
                --header-bg: #111827;
                --header-shadow: rgba(0,0,0,0.3);
                --code-bg: #1e293b;
                --code-border: #334155;
                --link-color: #60a5fa;
                --card-bg: #1e293b;
                --card-border: #334155;
                --stat-bg: #1e293b;
                --copy-btn-bg: rgba(255,255,255,0.08);
                --copy-btn-hover-bg: rgba(255,255,255,0.15);
                --search-bg: #1f2937;
                --search-text: #e5e7eb;
                --search-placeholder: #6b7280;
                --source-pill-bg: #1e293b;
                --source-pill-border: #334155;
                --source-pill-text: #d1d5db;
                --toc-active: #60a5fa;
                --toc-text: #9ca3af;
                --toc-hover: #e5e7eb;
                --ask-bar-bg: #111827;
                --ask-bar-border: #1f2937;
            }
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
            background: var(--content-bg);
            color: var(--content-text);
        }

        /* ========== Top Bar ========== */
        .top-bar {
            height: 48px;
            background: var(--topbar-bg);
            color: var(--topbar-text);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 16px;
            flex-shrink: 0;
            z-index: 200;
        }
        .top-bar-left {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
        }
        .top-bar-logo {
            font-weight: 700;
            font-size: 15px;
            letter-spacing: -0.01em;
        }
        .top-bar-project {
            color: var(--topbar-muted);
            font-weight: 400;
        }
        .top-bar-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .top-bar-btn {
            background: transparent;
            border: none;
            color: var(--topbar-muted);
            cursor: pointer;
            font-size: 18px;
            padding: 4px 8px;
            border-radius: 6px;
            transition: color 0.15s, background 0.15s;
        }
        .top-bar-btn:hover {
            color: var(--topbar-text);
            background: rgba(255,255,255,0.1);
        }

        /* ========== App Layout ========== */
        .app-layout {
            flex: 1;
            display: flex;
            overflow: hidden;
            min-height: 0;
        }

        /* ========== Sidebar ========== */
        .sidebar {
            width: 260px;
            min-width: 260px;
            background: var(--sidebar-bg);
            border-right: 1px solid var(--sidebar-border);
            overflow-y: auto;
            overflow-x: hidden;
            transition: width 0.25s, min-width 0.25s;
            position: relative;
            flex-shrink: 0;
        }
        .sidebar.collapsed {
            width: 0;
            min-width: 0;
            overflow: hidden;
            border-right: none;
        }
        .sidebar-collapse-btn {
            position: absolute;
            top: 10px;
            right: -14px;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: var(--sidebar-bg);
            border: 1px solid var(--sidebar-border);
            color: var(--sidebar-muted);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 101;
            font-size: 12px;
            transition: background 0.15s, transform 0.25s;
            padding: 0;
            line-height: 1;
        }
        .sidebar-collapse-btn:hover { background: var(--sidebar-hover); }
        .sidebar.collapsed .sidebar-collapse-btn {
            right: -36px;
            background: var(--content-bg);
            border-color: var(--content-border);
        }
        .sidebar.collapsed .sidebar-collapse-btn:hover { background: var(--code-bg); }

        .search-box { padding: 12px 14px 8px; }
        .search-box input {
            width: 100%;
            padding: 7px 10px;
            border: 1px solid var(--sidebar-border);
            border-radius: 6px;
            background: var(--search-bg);
            color: var(--search-text);
            font-size: 13px;
            outline: none;
        }
        .search-box input::placeholder { color: var(--search-placeholder); }
        .search-box input:focus { border-color: var(--sidebar-active-border); }

        .sidebar-nav { padding: 4px 0 16px; }

        .nav-section { padding: 4px 0; }
        .nav-section-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--sidebar-text);
            padding: 8px 14px 4px;
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .nav-section-title:hover { color: var(--sidebar-active-text); }
        .nav-section-arrow {
            font-size: 10px;
            transition: transform 0.2s;
            color: var(--sidebar-muted);
        }
        .nav-section.collapsed .nav-section-arrow { transform: rotate(-90deg); }
        .nav-section.collapsed .nav-section-items { display: none; }

        /* Area-based sidebar (DeepWiki-style hierarchy) */
        .nav-area-item {
            padding: 8px 14px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            color: var(--sidebar-text);
            border-radius: 4px;
            margin: 1px 6px;
            display: flex;
            align-items: center;
            transition: background 0.1s, color 0.1s;
        }
        .nav-area-item:hover { background: var(--sidebar-hover); }
        .nav-area-item.active {
            background: var(--sidebar-active-bg);
            color: var(--sidebar-active-text);
            font-weight: 600;
        }
        .nav-area-item .nav-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .nav-area-children { padding-left: 8px; }
        .nav-area-module {
            padding: 5px 14px 5px 20px;
            cursor: pointer;
            font-size: 13px;
            color: var(--sidebar-muted);
            border-radius: 4px;
            margin: 1px 6px;
            display: flex;
            align-items: center;
            transition: background 0.1s, color 0.1s;
        }
        .nav-area-module:hover { background: var(--sidebar-hover); color: var(--sidebar-text); }
        .nav-area-module.active {
            background: var(--sidebar-active-bg);
            color: var(--sidebar-active-text);
            font-weight: 500;
            border-left: 3px solid var(--sidebar-active-border);
        }
        .nav-area-module .nav-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* Category timestamp in sidebar (for non-area repos) */
        .nav-last-indexed {
            font-size: 12px;
            color: var(--sidebar-muted);
            padding: 12px 14px 4px;
        }

        .nav-item {
            padding: 6px 14px 6px 24px;
            cursor: pointer;
            font-size: 13px;
            color: var(--sidebar-text);
            border-radius: 4px;
            margin: 1px 6px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: background 0.1s, color 0.1s;
        }
        .nav-item:hover { background: var(--sidebar-hover); }
        .nav-item.active {
            background: var(--sidebar-active-bg);
            color: var(--sidebar-active-text);
            font-weight: 500;
        }
        .nav-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .complexity-badge {
            display: inline-block;
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            color: white;
            flex-shrink: 0;
            margin-left: 6px;
        }
        .complexity-high { background: var(--badge-high-bg); }
        .complexity-medium { background: var(--badge-medium-bg); }
        .complexity-low { background: var(--badge-low-bg); }

        /* ========== Main Content ========== */
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-width: 0;
            position: relative;
        }

        .content-scroll {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
        }

        .content-layout {
            display: flex;
            margin: 0 auto;
            padding: 0 20px;
            min-height: 100%;
        }

        .article {
            flex: 1;
            min-width: 0;
            padding: 32px 40px 120px;
        }

        /* ========== Source Files Section ========== */
        .source-files-section {
            margin-bottom: 20px;
            border: 1px solid var(--content-border);
            border-radius: 8px;
            overflow: hidden;
        }
        .source-files-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            background: var(--stat-bg);
            border: none;
            width: 100%;
            cursor: pointer;
            font-size: 13px;
            color: var(--content-text);
            font-weight: 500;
            text-align: left;
        }
        .source-files-toggle:hover { background: var(--code-bg); }
        .source-files-arrow {
            font-size: 10px;
            transition: transform 0.2s;
            color: var(--content-muted);
        }
        .source-files-section.expanded .source-files-arrow { transform: rotate(90deg); }
        .source-files-list {
            display: none;
            padding: 10px 14px;
            gap: 6px;
            flex-wrap: wrap;
        }
        .source-files-section.expanded .source-files-list { display: flex; }
        .source-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 10px;
            background: var(--source-pill-bg);
            border: 1px solid var(--source-pill-border);
            border-radius: 14px;
            font-size: 12px;
            color: var(--source-pill-text);
            cursor: default;
        }
        .source-pill-icon {
            font-size: 11px;
            color: var(--content-muted);
        }
        .source-pill-lines {
            background: var(--code-bg);
            border-radius: 8px;
            padding: 1px 6px;
            font-size: 10px;
            font-weight: 600;
            color: var(--content-muted);
            margin-left: 2px;
        }

        /* ========== TOC Sidebar ========== */
        .toc-sidebar {
            width: 220px;
            flex-shrink: 0;
            padding: 32px 16px 32px 0;
            position: sticky;
            top: 0;
            align-self: flex-start;
            max-height: calc(100vh - 48px);
            overflow-y: auto;
        }
        .toc-container {
            border-left: 1px solid var(--content-border);
            padding-left: 16px;
        }
        .toc-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--content-muted);
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: 10px;
        }
        .toc-nav a {
            display: block;
            padding: 3px 0;
            font-size: 13px;
            color: var(--toc-text);
            text-decoration: none;
            line-height: 1.5;
            transition: color 0.15s;
            border-left: 2px solid transparent;
            padding-left: 0;
            margin-left: -17px;
            padding-left: 15px;
        }
        .toc-nav a:hover { color: var(--toc-hover); }
        .toc-nav a.active {
            color: var(--toc-active);
            border-left-color: var(--toc-active);
            font-weight: 500;
        }
        .toc-nav a.toc-h3 { padding-left: 27px; font-size: 12px; }
        .toc-nav a.toc-h4 { padding-left: 39px; font-size: 12px; }

        /* ========== Markdown Body ========== */
        .markdown-body { line-height: 1.7; overflow-wrap: break-word; }
        .markdown-body h1 { margin-top: 32px; margin-bottom: 16px; font-size: 1.85em; font-weight: 700; border-bottom: 1px solid var(--content-border); padding-bottom: 8px; }
        .markdown-body h1:first-child { margin-top: 0; }
        .markdown-body h2 { margin-top: 28px; margin-bottom: 14px; font-size: 1.4em; font-weight: 600; border-bottom: 1px solid var(--content-border); padding-bottom: 6px; }
        .markdown-body h3 { margin-top: 22px; margin-bottom: 10px; font-size: 1.15em; font-weight: 600; }
        .markdown-body h4 { margin-top: 18px; margin-bottom: 8px; font-size: 1em; font-weight: 600; }
        .markdown-body p { margin-bottom: 14px; }
        .markdown-body > *:last-child { margin-bottom: 0; }
        .markdown-body code {
            background: var(--code-bg);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 85%;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
        }
        .markdown-body pre {
            background: var(--code-bg);
            border: 1px solid var(--code-border);
            padding: 14px;
            border-radius: 8px;
            overflow-x: auto;
            margin-bottom: 14px;
            position: relative;
        }
        .markdown-body pre code { background: none; padding: 0; border-radius: 0; font-size: 13px; }
        .markdown-body table { border-collapse: collapse; width: 100%; margin: 14px 0; display: block; overflow-x: auto; }
        .markdown-body table th, .markdown-body table td {
            border: 1px solid var(--content-border);
            padding: 8px 12px;
            text-align: left;
        }
        .markdown-body table th { background: var(--code-bg); font-weight: 600; }
        .markdown-body ul, .markdown-body ol { margin-bottom: 14px; padding-left: 2em; }
        .markdown-body li { margin-bottom: 4px; }
        .markdown-body a { color: var(--link-color); text-decoration: none; }
        .markdown-body a:hover { text-decoration: underline; }
        .markdown-body blockquote {
            border-left: 4px solid var(--content-border);
            padding: 8px 16px;
            margin: 14px 0;
            color: var(--content-muted);
        }
        .markdown-body img { max-width: 100%; border-radius: 8px; }
        .markdown-body hr { border: none; border-top: 1px solid var(--content-border); margin: 24px 0; }

        .heading-anchor {
            color: var(--content-muted);
            text-decoration: none;
            margin-left: 8px;
            opacity: 0;
            transition: opacity 0.15s;
            font-weight: 400;
        }
        .markdown-body h1:hover .heading-anchor,
        .markdown-body h2:hover .heading-anchor,
        .markdown-body h3:hover .heading-anchor,
        .markdown-body h4:hover .heading-anchor { opacity: 1; }

        .copy-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            background: var(--copy-btn-bg);
            border: 1px solid var(--code-border);
            border-radius: 4px;
            padding: 3px 8px;
            cursor: pointer;
            font-size: 11px;
            color: var(--content-muted);
            opacity: 0;
            transition: opacity 0.15s;
        }
        .markdown-body pre:hover .copy-btn { opacity: 1; }
        .copy-btn:hover { background: var(--copy-btn-hover-bg); }

        /* ========== Home View ========== */
        .home-view { max-width: 100%; }
        .project-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 12px;
            margin: 20px 0;
        }
        .stat-card {
            background: var(--stat-bg);
            padding: 14px;
            border-radius: 8px;
            border-left: 4px solid var(--stat-border);
        }
        .stat-card h3 { font-size: 12px; color: var(--content-muted); margin-bottom: 4px; font-weight: 500; }
        .stat-card .value { font-size: 24px; font-weight: 700; color: var(--content-text); }
        .stat-card .value.small { font-size: 15px; }

        .module-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 10px;
            margin-top: 20px;
        }
        .module-card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 8px;
            padding: 12px;
            cursor: pointer;
            transition: border-color 0.15s, box-shadow 0.15s;
        }
        .module-card:hover {
            border-color: var(--card-hover-border);
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .module-card h4 { margin-bottom: 4px; font-size: 14px; }
        .module-card p { font-size: 12px; color: var(--content-muted); line-height: 1.4; }

        .loading {
            text-align: center;
            padding: 48px;
            color: var(--content-muted);
            font-size: 15px;
        }

${getMermaidZoomStyles()}

        /* ========== Dependency Graph ========== */
        .graph-container { width: 100%; height: 100%; position: relative; }
        .graph-container svg { width: 100%; height: 100%; }
        .graph-toolbar {
            position: absolute;
            top: 12px;
            right: 12px;
            display: flex;
            gap: 6px;
            z-index: 10;
        }
        .graph-toolbar button {
            background: var(--card-bg);
            border: 1px solid var(--content-border);
            border-radius: 4px;
            padding: 4px 10px;
            cursor: pointer;
            font-size: 13px;
            color: var(--content-text);
        }
        .graph-toolbar button:hover { background: var(--code-bg); }
        .graph-legend {
            position: absolute;
            bottom: 12px;
            left: 12px;
            background: var(--card-bg);
            border: 1px solid var(--content-border);
            border-radius: 8px;
            padding: 10px 14px;
            z-index: 10;
            font-size: 12px;
        }
        .graph-legend-title { font-weight: 600; margin-bottom: 6px; color: var(--content-text); }
        .graph-legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
            cursor: pointer;
            user-select: none;
        }
        .graph-legend-item.disabled { opacity: 0.3; }
        .graph-legend-swatch { width: 12px; height: 12px; border-radius: 3px; }
        .graph-node text { font-size: 11px; fill: var(--content-text); pointer-events: none; }
        .graph-link { stroke: var(--content-border); stroke-opacity: 0.6; }
        .graph-link-arrow { fill: var(--content-border); fill-opacity: 0.6; }
        .graph-tooltip {
            position: absolute;
            background: var(--card-bg);
            border: 1px solid var(--content-border);
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12px;
            pointer-events: none;
            z-index: 20;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            max-width: 250px;
        }
        .graph-tooltip-name { font-weight: 600; margin-bottom: 4px; }
        .graph-tooltip-purpose { color: var(--content-muted); line-height: 1.4; }

        /* ========== Deep Dive ========== */
        .deep-dive-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--stat-bg);
            color: var(--link-color);
            border: 1px solid var(--content-border);
            border-radius: 6px;
            padding: 6px 14px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 16px;
            transition: background 0.15s, border-color 0.15s;
        }
        .deep-dive-btn:hover { background: var(--code-bg); border-color: var(--link-color); }
        .deep-dive-section {
            margin-top: 16px;
            padding: 14px;
            background: var(--stat-bg);
            border: 1px solid var(--content-border);
            border-radius: 8px;
        }
        .deep-dive-input-area { display: flex; gap: 8px; margin-bottom: 12px; }
        .deep-dive-input {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid var(--content-border);
            border-radius: 6px;
            font-size: 13px;
            background: var(--content-bg);
            color: var(--content-text);
            outline: none;
            font-family: inherit;
        }
        .deep-dive-input:focus { border-color: var(--sidebar-active-border); }
        .deep-dive-input::placeholder { color: var(--content-muted); }
        .deep-dive-submit {
            background: var(--sidebar-active-border);
            color: white;
            border: none;
            border-radius: 6px;
            padding: 8px 14px;
            cursor: pointer;
            font-size: 13px;
            white-space: nowrap;
        }
        .deep-dive-submit:hover { opacity: 0.9; }
        .deep-dive-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .deep-dive-result { margin-top: 12px; }
        .deep-dive-status { font-size: 12px; color: var(--content-muted); margin-bottom: 8px; }

        /* ========== Live Reload ========== */
        .live-reload-bar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 1000;
            padding: 8px 16px;
            font-size: 13px;
            text-align: center;
            transition: transform 0.3s;
            transform: translateY(-100%);
        }
        .live-reload-bar.visible { transform: translateY(0); }
        .live-reload-bar.rebuilding { background: var(--badge-medium-bg); color: white; }
        .live-reload-bar.reloaded { background: var(--badge-low-bg); color: white; }
        .live-reload-bar.error { background: var(--badge-high-bg); color: white; }

        /* ========== Responsive ========== */
        @media (max-width: 1024px) {
            .toc-sidebar { display: none; }
        }
        @media (max-width: 768px) {
            .sidebar { position: fixed; z-index: 100; height: calc(100vh - 48px); top: 48px; }
            .sidebar.collapsed { width: 0; min-width: 0; }
            .sidebar-collapse-btn { display: none; }
            .article { padding: 16px 20px; }
        }`;

    if (enableAI) {
        styles += `

        /* ========== Ask AI Floating Widget ========== */
        .ask-widget {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 200;
            background: var(--ask-bar-bg);
            border-radius: 16px;
            border: 1px solid var(--ask-bar-border);
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
            width: 720px;
            max-width: calc(100vw - 40px);
            display: flex;
            flex-direction: column;
            max-height: calc(100vh - 100px);
            transition: box-shadow 0.2s;
        }
        .ask-widget.expanded {
            box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
        }

        /* Widget header (visible when expanded) */
        .ask-widget-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 16px;
            border-bottom: 1px solid var(--content-border);
            flex-shrink: 0;
        }
        .ask-widget-header.hidden { display: none; }
        .ask-widget-title { font-size: 13px; font-weight: 600; color: var(--content-text); }
        .ask-widget-actions { display: flex; gap: 6px; align-items: center; }
        .ask-widget-clear {
            background: none;
            border: 1px solid var(--content-border);
            border-radius: 4px;
            padding: 2px 8px;
            cursor: pointer;
            font-size: 11px;
            color: var(--content-muted);
        }
        .ask-widget-clear:hover { background: var(--code-bg); }
        .ask-widget-close {
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            color: var(--content-muted);
            padding: 0 4px;
            line-height: 1;
        }
        .ask-widget-close:hover { color: var(--content-text); }

        /* Messages area (visible when expanded) */
        .ask-messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            min-height: 0;
        }
        .ask-messages.hidden { display: none; }
        .ask-message { margin-bottom: 14px; line-height: 1.5; }
        .ask-message-user {
            background: var(--sidebar-active-border);
            color: white;
            padding: 8px 12px;
            border-radius: 12px 12px 4px 12px;
            max-width: 85%;
            margin-left: auto;
            word-wrap: break-word;
        }
        .ask-message-assistant {
            background: var(--code-bg);
            color: var(--content-text);
            padding: 10px 14px;
            border-radius: 12px 12px 12px 4px;
            max-width: 95%;
            word-wrap: break-word;
        }
        .ask-message-assistant .markdown-body { max-width: 100%; font-size: 13px; line-height: 1.5; }
        .ask-message-assistant .markdown-body p { margin-bottom: 8px; }
        .ask-message-assistant .markdown-body p:last-child { margin-bottom: 0; }
        .ask-message-context {
            font-size: 11px;
            color: var(--content-muted);
            margin-bottom: 8px;
            padding: 6px 10px;
            background: var(--stat-bg);
            border-radius: 6px;
            border: 1px solid var(--content-border);
        }
        .ask-message-context a { color: var(--link-color); cursor: pointer; text-decoration: none; }
        .ask-message-context a:hover { text-decoration: underline; }
        .ask-message-error {
            color: var(--badge-high-bg);
            font-size: 12px;
            padding: 8px 12px;
            background: var(--code-bg);
            border-radius: 8px;
            border: 1px solid var(--badge-high-bg);
        }
        .ask-message-typing {
            display: inline-block;
            color: var(--content-muted);
            font-size: 12px;
        }
        .ask-message-typing::after {
            content: '...';
            animation: typing 1s infinite;
        }
        @keyframes typing {
            0%, 33% { content: '.'; }
            34%, 66% { content: '..'; }
            67%, 100% { content: '...'; }
        }

        /* Input area (always visible) */
        .ask-widget-input {
            padding: 12px 16px;
            flex-shrink: 0;
        }
        .ask-widget-label {
            display: block;
            font-size: 12px;
            color: var(--content-muted);
            margin-bottom: 6px;
        }
        .ask-widget-label strong { color: var(--content-text); }
        .ask-widget.expanded .ask-widget-label { display: none; }
        .ask-widget.expanded .ask-widget-input {
            border-top: 1px solid var(--content-border);
        }
        .ask-widget-input-row {
            display: flex;
            gap: 8px;
        }
        .ask-widget-textarea {
            flex: 1;
            padding: 9px 14px;
            border: 1px solid var(--content-border);
            border-radius: 8px;
            font-size: 14px;
            background: var(--content-bg);
            color: var(--content-text);
            outline: none;
            resize: none;
            min-height: 38px;
            max-height: 120px;
            font-family: inherit;
            line-height: 1.4;
        }
        .ask-widget-textarea:focus { border-color: var(--sidebar-active-border); }
        .ask-widget-textarea::placeholder { color: var(--content-muted); }
        .ask-widget-send {
            background: var(--sidebar-active-border);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 0 14px;
            cursor: pointer;
            font-size: 16px;
            flex-shrink: 0;
            align-self: flex-end;
            height: 38px;
        }
        .ask-widget-send:hover { opacity: 0.9; }
        .ask-widget-send:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ========== Ask AI Responsive ========== */
        @media (max-width: 768px) {
            .ask-widget { bottom: 12px; border-radius: 12px; }
            .ask-widget-label { font-size: 11px; margin-bottom: 4px; }
        }`;
    }

    // Admin page styles (full-page, not overlay)
    styles += `
        /* ========== Admin Page ========== */
        .admin-page {
            height: 100%; display: flex; flex-direction: column;
            overflow: auto;
        }
        .admin-page.hidden { display: none; }
        .admin-page-header {
            padding: 32px 40px 0;
        }
        .admin-page-title-row {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 4px;
        }
        .admin-page-title {
            margin: 0; font-size: 24px; color: var(--content-text);
        }
        .admin-page-desc {
            margin: 0 0 20px; font-size: 14px; color: var(--content-muted);
        }
        .admin-btn-back {
            background: var(--code-bg); color: var(--content-text);
            border: 1px solid var(--content-border);
            padding: 6px 16px; border-radius: 6px; font-size: 13px;
            cursor: pointer; white-space: nowrap;
        }
        .admin-btn-back:hover { background: var(--sidebar-hover); }
        .admin-tabs {
            display: flex; padding: 0 40px; gap: 0;
            border-bottom: 1px solid var(--content-border);
        }
        .admin-tab {
            padding: 10px 20px; border: none; background: none;
            color: var(--content-muted); cursor: pointer; font-size: 14px;
            border-bottom: 2px solid transparent; margin-bottom: -1px;
        }
        .admin-tab:hover { color: var(--content-text); }
        .admin-tab.active {
            color: var(--link-color); border-bottom-color: var(--link-color);
            font-weight: 600;
        }
        .admin-body { flex: 1; overflow: auto; padding: 24px 40px; }
        .admin-tab-content { display: none; flex-direction: column; }
        .admin-tab-content.active { display: flex; }
        .admin-section { max-width: 900px; }
        .admin-file-info {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 10px; font-size: 12px;
        }
        .admin-file-path {
            color: var(--content-muted); font-family: monospace;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .admin-file-status { font-weight: 600; margin-left: 8px; white-space: nowrap; }
        .admin-file-status.success { color: #22c55e; }
        .admin-file-status.error { color: #ef4444; }
        .admin-editor {
            width: 100%; min-height: 400px; resize: vertical;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 13px; line-height: 1.5;
            padding: 12px; border-radius: 8px;
            background: var(--code-bg); color: var(--content-text);
            border: 1px solid var(--code-border);
            tab-size: 2; white-space: pre; overflow: auto;
            box-sizing: border-box;
        }
        .admin-editor:focus { outline: 2px solid var(--link-color); outline-offset: -1px; }
        .admin-actions {
            display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end;
        }
        .admin-btn {
            padding: 8px 20px; border-radius: 6px; border: none;
            font-size: 14px; cursor: pointer; font-weight: 500;
        }
        .admin-btn-save {
            background: var(--link-color); color: #fff;
        }
        .admin-btn-save:hover { opacity: 0.9; }
        .admin-btn-reset {
            background: var(--code-bg); color: var(--content-text);
            border: 1px solid var(--content-border);
        }
        .admin-btn-reset:hover { background: var(--sidebar-hover); }
        @media (max-width: 768px) {
            .admin-page-header { padding: 20px 16px 0; }
            .admin-tabs { padding: 0 16px; }
            .admin-body { padding: 16px; }
            .admin-page-title-row { flex-direction: column; align-items: flex-start; gap: 8px; }
        }
    `;

    return styles;
}

// ============================================================================
// JavaScript
// ============================================================================

function getSpaScript(opts: ScriptOptions): string {
    return `        // ====================================================================
        // Deep Wiki — Server Mode SPA
        // ====================================================================

        var moduleGraph = null;
        var currentModuleId = null;
        var currentTheme = '${opts.defaultTheme}';
        var markdownCache = {};

        // Initialize
        init();

        async function init() {
            try {
                var res = await fetch('/api/graph');
                if (!res.ok) throw new Error('Failed to load module graph');
                moduleGraph = await res.json();

                initTheme();
                initializeSidebar();
                showHome(true);
                history.replaceState({ type: 'home' }, '', location.pathname);
            } catch(err) {
                document.getElementById('content').innerHTML =
                    '<p style="color: red;">Error loading wiki data: ' + err.message + '</p>';
            }
        }

        // ================================================================
        // Browser History
        // ================================================================

        window.addEventListener('popstate', function(e) {
            var state = e.state;
            if (!state) { showHome(true); return; }
            if (state.type === 'home') showHome(true);
            else if (state.type === 'module' && state.id) loadModule(state.id, true);
            else if (state.type === 'special' && state.key && state.title) loadSpecialPage(state.key, state.title, true);
            else if (state.type === 'graph') { if (typeof showGraph === 'function') showGraph(true); else showHome(true); }
            else if (state.type === 'admin') showAdmin(true);
            else showHome(true);
        });

        // ================================================================
        // Theme
        // ================================================================

        function initTheme() {
            var saved = localStorage.getItem('deep-wiki-theme');
            if (saved) {
                currentTheme = saved;
                document.documentElement.setAttribute('data-theme', currentTheme);
            }
            updateThemeStyles();
        }

        function toggleTheme() {
            if (currentTheme === 'auto') currentTheme = 'dark';
            else if (currentTheme === 'dark') currentTheme = 'light';
            else currentTheme = 'auto';
            document.documentElement.setAttribute('data-theme', currentTheme);
            localStorage.setItem('deep-wiki-theme', currentTheme);
            updateThemeStyles();
        }

        function updateThemeStyles() {
            var isDark = currentTheme === 'dark' ||
                (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
            var ls = document.getElementById('hljs-light');
            var ds = document.getElementById('hljs-dark');
            if (ls) ls.disabled = isDark;
            if (ds) ds.disabled = !isDark;
            var btn = document.getElementById('theme-toggle');
            if (btn) btn.textContent = isDark ? '\\u2600' : '\\u263E';
        }

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeStyles);
        document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

        // Sidebar collapse
        document.getElementById('sidebar-collapse').addEventListener('click', function() {
            var sidebar = document.getElementById('sidebar');
            var isCollapsed = sidebar.classList.toggle('collapsed');
            updateSidebarCollapseBtn(isCollapsed);
            localStorage.setItem('deep-wiki-sidebar-collapsed', isCollapsed ? 'true' : 'false');
        });

        function updateSidebarCollapseBtn(isCollapsed) {
            var btn = document.getElementById('sidebar-collapse');
            if (isCollapsed) {
                btn.innerHTML = '&#x25B6;';
                btn.title = 'Expand sidebar';
                btn.setAttribute('aria-label', 'Expand sidebar');
            } else {
                btn.innerHTML = '&#x25C0;';
                btn.title = 'Collapse sidebar';
                btn.setAttribute('aria-label', 'Collapse sidebar');
            }
        }

        // Restore sidebar collapsed state
        (function restoreSidebarState() {
            var saved = localStorage.getItem('deep-wiki-sidebar-collapsed');
            if (saved === 'true') {
                document.getElementById('sidebar').classList.add('collapsed');
                updateSidebarCollapseBtn(true);
            }
        })();

        // ================================================================
        // Sidebar Navigation
        // ================================================================

        function initializeSidebar() {
            document.getElementById('top-bar-project').textContent = moduleGraph.project.name;

            var navContainer = document.getElementById('nav-container');
            var hasAreas = moduleGraph.areas && moduleGraph.areas.length > 0;

            // Home + special items
            var homeSection = document.createElement('div');
            homeSection.className = 'nav-section';
            homeSection.innerHTML =
                '<div class="nav-item active" data-id="__home" onclick="showHome()">' +
                '<span class="nav-item-name">Overview</span></div>' +
${opts.enableGraph ? `                '<div class="nav-item" data-id="__graph" onclick="showGraph()">' +
                '<span class="nav-item-name">Dependency Graph</span></div>' +` : ''}
                '';
            navContainer.appendChild(homeSection);

            if (hasAreas) {
                // DeepWiki-style: areas as top-level, modules indented underneath
                buildAreaSidebar(navContainer);
            } else {
                // Fallback: category-based grouping
                buildCategorySidebar(navContainer);
            }
${opts.enableSearch ? `
            document.getElementById('search').addEventListener('input', function(e) {
                var query = e.target.value.toLowerCase();
                // Search area-based items
                document.querySelectorAll('.nav-area-module[data-id], .nav-item[data-id]').forEach(function(item) {
                    var id = item.getAttribute('data-id');
                    if (id === '__home' || id === '__graph') return;
                    var text = item.textContent.toLowerCase();
                    item.style.display = text.includes(query) ? '' : 'none';
                });
                // Hide area headers when no children match
                document.querySelectorAll('.nav-area-group').forEach(function(group) {
                    var visibleChildren = group.querySelectorAll('.nav-area-module:not([style*="display: none"])');
                    var areaItem = group.querySelector('.nav-area-item');
                    if (areaItem) {
                        areaItem.style.display = visibleChildren.length === 0 ? 'none' : '';
                    }
                    var childrenEl = group.querySelector('.nav-area-children');
                    if (childrenEl) {
                        childrenEl.style.display = visibleChildren.length === 0 ? 'none' : '';
                    }
                });
                // Hide category sections when no children match
                document.querySelectorAll('.nav-section').forEach(function(section) {
                    var title = section.querySelector('.nav-section-title');
                    if (!title) return;
                    var visible = section.querySelectorAll('.nav-item[data-id]:not([style*="display: none"])');
                    title.style.display = visible.length === 0 ? 'none' : '';
                });
            });` : ''}
        }

        // Build area-based sidebar (DeepWiki-style hierarchy)
        function buildAreaSidebar(navContainer) {
            // Build a map of area ID → area info
            var areaMap = {};
            moduleGraph.areas.forEach(function(area) {
                areaMap[area.id] = area;
            });

            // Build a map of area ID → modules
            var areaModules = {};
            moduleGraph.areas.forEach(function(area) {
                areaModules[area.id] = [];
            });

            // Assign modules to their areas
            moduleGraph.modules.forEach(function(mod) {
                var areaId = mod.area;
                if (areaId && areaModules[areaId]) {
                    areaModules[areaId].push(mod);
                } else {
                    // Try to find area by module ID listed in area.modules
                    var found = false;
                    moduleGraph.areas.forEach(function(area) {
                        if (area.modules && area.modules.indexOf(mod.id) !== -1) {
                            areaModules[area.id].push(mod);
                            found = true;
                        }
                    });
                    if (!found) {
                        // Put unassigned modules in an "Other" group
                        if (!areaModules['__other']) areaModules['__other'] = [];
                        areaModules['__other'].push(mod);
                    }
                }
            });

            // Render each area with its modules
            moduleGraph.areas.forEach(function(area) {
                var modules = areaModules[area.id] || [];
                if (modules.length === 0) return;

                var group = document.createElement('div');
                group.className = 'nav-area-group';

                // Area header (top-level item)
                var areaItem = document.createElement('div');
                areaItem.className = 'nav-area-item';
                areaItem.setAttribute('data-area-id', area.id);
                areaItem.innerHTML = '<span class="nav-item-name">' + escapeHtml(area.name) + '</span>';
                group.appendChild(areaItem);

                // Module children (indented)
                var childrenEl = document.createElement('div');
                childrenEl.className = 'nav-area-children';

                modules.forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-area-module';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
                    item.onclick = function() { loadModule(mod.id); };
                    childrenEl.appendChild(item);
                });

                group.appendChild(childrenEl);
                navContainer.appendChild(group);
            });

            // Render unassigned modules if any
            var otherModules = areaModules['__other'] || [];
            if (otherModules.length > 0) {
                var group = document.createElement('div');
                group.className = 'nav-area-group';
                var areaItem = document.createElement('div');
                areaItem.className = 'nav-area-item';
                areaItem.innerHTML = '<span class="nav-item-name">Other</span>';
                group.appendChild(areaItem);

                var childrenEl = document.createElement('div');
                childrenEl.className = 'nav-area-children';
                otherModules.forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-area-module';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
                    item.onclick = function() { loadModule(mod.id); };
                    childrenEl.appendChild(item);
                });
                group.appendChild(childrenEl);
                navContainer.appendChild(group);
            }
        }

        // Build category-based sidebar (fallback for non-area repos)
        // Uses the same visual style as area-based sidebar (DeepWiki-style)
        function buildCategorySidebar(navContainer) {
            var categories = {};
            moduleGraph.modules.forEach(function(mod) {
                var cat = mod.category || 'other';
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push(mod);
            });

            Object.keys(categories).sort().forEach(function(category) {
                var group = document.createElement('div');
                group.className = 'nav-area-group';

                // Category header (same style as area header)
                var catItem = document.createElement('div');
                catItem.className = 'nav-area-item';
                catItem.innerHTML = '<span class="nav-item-name">' + escapeHtml(category) + '</span>';
                group.appendChild(catItem);

                // Module children (indented)
                var childrenEl = document.createElement('div');
                childrenEl.className = 'nav-area-children';

                categories[category].forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-area-module';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
                    item.onclick = function() { loadModule(mod.id); };
                    childrenEl.appendChild(item);
                });

                group.appendChild(childrenEl);
                navContainer.appendChild(group);
            });
        }

        function setActive(id) {
            document.querySelectorAll('.nav-item, .nav-area-module, .nav-area-item').forEach(function(el) {
                el.classList.remove('active');
            });
            var target = document.querySelector('.nav-item[data-id="' + id + '"]') ||
                         document.querySelector('.nav-area-module[data-id="' + id + '"]');
            if (target) target.classList.add('active');
        }

        function showWikiContent() {
            document.getElementById('content-scroll').style.display = '';
            document.getElementById('admin-page').classList.add('hidden');
            document.getElementById('sidebar').style.display = '';
            var askWidget = document.getElementById('ask-widget');
            if (askWidget) askWidget.style.display = '';
        }

        function showAdminContent() {
            document.getElementById('content-scroll').style.display = 'none';
            document.getElementById('admin-page').classList.remove('hidden');
            document.getElementById('sidebar').style.display = 'none';
            var askWidget = document.getElementById('ask-widget');
            if (askWidget) askWidget.style.display = 'none';
        }

        // ================================================================
        // Content Loading
        // ================================================================

        function showHome(skipHistory) {
            currentModuleId = null;
            setActive('__home');
            showWikiContent();
            document.getElementById('toc-nav').innerHTML = '';
            if (!skipHistory) {
                history.pushState({ type: 'home' }, '', location.pathname);
            }
${opts.enableAI ? `            updateAskSubject(moduleGraph.project.name);` : ''}

            var stats = {
                modules: moduleGraph.modules.length,
                categories: (moduleGraph.categories || []).length,
                language: moduleGraph.project.language,
                buildSystem: moduleGraph.project.buildSystem,
            };

            var html = '<div class="home-view">' +
                '<h1>' + escapeHtml(moduleGraph.project.name) + '</h1>' +
                '<p style="font-size: 15px; color: var(--content-muted); margin-bottom: 24px;">' +
                escapeHtml(moduleGraph.project.description) + '</p>' +
                '<div class="project-stats">' +
                '<div class="stat-card"><h3>Modules</h3><div class="value">' + stats.modules + '</div></div>' +
                '<div class="stat-card"><h3>Categories</h3><div class="value">' + stats.categories + '</div></div>' +
                '<div class="stat-card"><h3>Language</h3><div class="value small">' + escapeHtml(stats.language) + '</div></div>' +
                '<div class="stat-card"><h3>Build System</h3><div class="value small">' + escapeHtml(stats.buildSystem) + '</div></div>' +
                '</div>';

            var hasAreas = moduleGraph.areas && moduleGraph.areas.length > 0;
            if (hasAreas) {
                // Group modules by area for the overview
                moduleGraph.areas.forEach(function(area) {
                    var areaModules = moduleGraph.modules.filter(function(mod) {
                        if (mod.area === area.id) return true;
                        return area.modules && area.modules.indexOf(mod.id) !== -1;
                    });
                    if (areaModules.length === 0) return;

                    html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">' + escapeHtml(area.name) + '</h3>';
                    if (area.description) {
                        html += '<p style="color: var(--content-muted); margin-bottom: 12px; font-size: 14px;">' +
                            escapeHtml(area.description) + '</p>';
                    }
                    html += '<div class="module-grid">';
                    areaModules.forEach(function(mod) {
                        html += '<div class="module-card" onclick="loadModule(\\'' +
                            mod.id.replace(/'/g, "\\\\'") + '\\')">' +
                            '<h4>' + escapeHtml(mod.name) +
                            ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                            mod.complexity + '</span></h4>' +
                            '<p>' + escapeHtml(mod.purpose) + '</p></div>';
                    });
                    html += '</div>';
                });

                // Show unassigned modules if any
                var assignedIds = new Set();
                moduleGraph.areas.forEach(function(area) {
                    moduleGraph.modules.forEach(function(mod) {
                        if (mod.area === area.id || (area.modules && area.modules.indexOf(mod.id) !== -1)) {
                            assignedIds.add(mod.id);
                        }
                    });
                });
                var unassigned = moduleGraph.modules.filter(function(mod) { return !assignedIds.has(mod.id); });
                if (unassigned.length > 0) {
                    html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">Other</h3><div class="module-grid">';
                    unassigned.forEach(function(mod) {
                        html += '<div class="module-card" onclick="loadModule(\\'' +
                            mod.id.replace(/'/g, "\\\\'") + '\\')">' +
                            '<h4>' + escapeHtml(mod.name) +
                            ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                            mod.complexity + '</span></h4>' +
                            '<p>' + escapeHtml(mod.purpose) + '</p></div>';
                    });
                    html += '</div>';
                }
            } else {
                html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">All Modules</h3><div class="module-grid">';
                moduleGraph.modules.forEach(function(mod) {
                    html += '<div class="module-card" onclick="loadModule(\\'' +
                        mod.id.replace(/'/g, "\\\\'") + '\\')">' +
                        '<h4>' + escapeHtml(mod.name) +
                        ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                        mod.complexity + '</span></h4>' +
                        '<p>' + escapeHtml(mod.purpose) + '</p></div>';
                });
                html += '</div>';
            }

            html += '</div>';

            document.getElementById('content').innerHTML = html;
            document.getElementById('content-scroll').scrollTop = 0;
        }

        async function loadModule(moduleId, skipHistory) {
            var mod = moduleGraph.modules.find(function(m) { return m.id === moduleId; });
            if (!mod) return;

            currentModuleId = moduleId;
            setActive(moduleId);
            showWikiContent();
            if (!skipHistory) {
                history.pushState({ type: 'module', id: moduleId }, '', location.pathname + '#module-' + encodeURIComponent(moduleId));
            }
${opts.enableAI ? `            updateAskSubject(mod.name);` : ''}

            // Check cache
            if (markdownCache[moduleId]) {
                renderModulePage(mod, markdownCache[moduleId]);
                document.getElementById('content-scroll').scrollTop = 0;
                return;
            }

            // Fetch from API
            document.getElementById('content').innerHTML = '<div class="loading">Loading module...</div>';
            try {
                var res = await fetch('/api/modules/' + encodeURIComponent(moduleId));
                if (!res.ok) throw new Error('Failed to load module');
                var data = await res.json();
                if (data.markdown) {
                    markdownCache[moduleId] = data.markdown;
                    renderModulePage(mod, data.markdown);
                } else {
                    document.getElementById('content').innerHTML =
                        '<div class="markdown-body"><h2>' + escapeHtml(mod.name) + '</h2>' +
                        '<p>' + escapeHtml(mod.purpose) + '</p></div>';
                }
            } catch(err) {
                document.getElementById('content').innerHTML =
                    '<p style="color: red;">Error loading module: ' + err.message + '</p>';
            }
            document.getElementById('content-scroll').scrollTop = 0;
        }

        function renderModulePage(mod, markdown) {
            var html = '';

            // Source files section
            if (mod.keyFiles && mod.keyFiles.length > 0) {
                html += '<div class="source-files-section" id="source-files">' +
                    '<button class="source-files-toggle" onclick="toggleSourceFiles()">' +
                    '<span class="source-files-arrow">&#x25B6;</span> Relevant source files' +
                    '</button>' +
                    '<div class="source-files-list">';
                mod.keyFiles.forEach(function(f) {
                    html += '<span class="source-pill"><span class="source-pill-icon">&#9671;</span> ' +
                        escapeHtml(f) + '</span>';
                });
                html += '</div></div>';
            }

            // Markdown content
            html += '<div class="markdown-body">' + marked.parse(markdown) + '</div>';
            document.getElementById('content').innerHTML = html;

            // Post-processing
            processMarkdownContent();
            buildToc();
${opts.enableAI ? `            addDeepDiveButton(mod.id);` : ''}
        }

        function toggleSourceFiles() {
            var section = document.getElementById('source-files');
            if (section) section.classList.toggle('expanded');
        }

        async function loadSpecialPage(key, title, skipHistory) {
            currentModuleId = null;
            setActive(key);
            showWikiContent();
            if (!skipHistory) {
                history.pushState({ type: 'special', key: key, title: title }, '', location.pathname + '#' + encodeURIComponent(key));
            }

            var cacheKey = '__page_' + key;
            if (markdownCache[cacheKey]) {
                renderMarkdownContent(markdownCache[cacheKey]);
                buildToc();
                document.getElementById('content-scroll').scrollTop = 0;
                return;
            }

            document.getElementById('content').innerHTML = '<div class="loading">Loading page...</div>';
            try {
                var res = await fetch('/api/pages/' + encodeURIComponent(key));
                if (!res.ok) throw new Error('Page not found');
                var data = await res.json();
                markdownCache[cacheKey] = data.markdown;
                renderMarkdownContent(data.markdown);
                buildToc();
            } catch(err) {
                document.getElementById('content').innerHTML = '<p>Content not available.</p>';
            }
            document.getElementById('content-scroll').scrollTop = 0;
        }

        // ================================================================
        // Markdown Rendering
        // ================================================================

        function renderMarkdownContent(markdown) {
            var html = marked.parse(markdown);
            var container = document.getElementById('content');
            container.innerHTML = '<div class="markdown-body">' + html + '</div>';
            processMarkdownContent();
        }

        function processMarkdownContent() {
            var container = document.getElementById('content');
            var body = container.querySelector('.markdown-body');
            if (!body) return;

            body.querySelectorAll('pre code').forEach(function(block) {
                if (block.classList.contains('language-mermaid')) {
                    var pre = block.parentElement;
                    var mermaidCode = block.textContent;
                    // Create container with zoom controls (shared structure from mermaid-zoom)
                    var mContainer = document.createElement('div');
                    mContainer.className = 'mermaid-container';
                    mContainer.innerHTML =
                        '<div class="mermaid-toolbar">' +
                            '<span class="mermaid-toolbar-label">Diagram</span>' +
                            '<button class="mermaid-zoom-btn mermaid-zoom-out" title="Zoom out">\\u2212</button>' +
                            '<span class="mermaid-zoom-level">100%</span>' +
                            '<button class="mermaid-zoom-btn mermaid-zoom-in" title="Zoom in">+</button>' +
                            '<button class="mermaid-zoom-btn mermaid-zoom-reset" title="Reset view">\\u27F2</button>' +
                        '</div>' +
                        '<div class="mermaid-viewport">' +
                            '<div class="mermaid-svg-wrapper">' +
                                '<pre class="mermaid">' + mermaidCode + '</pre>' +
                            '</div>' +
                        '</div>';
                    pre.parentNode.replaceChild(mContainer, pre);
                } else {
                    hljs.highlightElement(block);
                    addCopyButton(block.parentElement);
                }
            });

            body.querySelectorAll('h1, h2, h3, h4').forEach(function(heading) {
                var id = heading.textContent.toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
                heading.id = id;
                var anchor = document.createElement('a');
                anchor.className = 'heading-anchor';
                anchor.href = '#' + id;
                anchor.textContent = '#';
                heading.appendChild(anchor);
            });

            initMermaid();

            // Intercept internal .md links and route through SPA navigation
            body.addEventListener('click', function(e) {
                var target = e.target;
                while (target && target !== body) {
                    if (target.tagName === 'A') break;
                    target = target.parentElement;
                }
                if (!target || target.tagName !== 'A') return;
                var href = target.getAttribute('href');
                if (!href || !href.match(/\\.md(#.*)?$/)) return;
                // Don't intercept external links
                if (/^https?:\\/\\//.test(href)) return;

                e.preventDefault();
                var hashPart = '';
                var hashIdx = href.indexOf('#');
                if (hashIdx !== -1) {
                    hashPart = href.substring(hashIdx + 1);
                    href = href.substring(0, hashIdx);
                }

                // Extract slug from the href path
                // Handle patterns like:
                //   ./modules/module-id.md
                //   ./module-id.md
                //   ../../other-area/modules/module-id.md
                //   ./areas/area-id/index.md
                //   ../index.md
                var slug = href.replace(/^(\\.\\.\\/|\\.\\/)*/g, '')
                    .replace(/^areas\\/[^/]+\\/modules\\//, '')
                    .replace(/^areas\\/[^/]+\\//, '')
                    .replace(/^modules\\//, '')
                    .replace(/\\.md$/, '');

                // Check special pages
                var specialPages = {
                    'index': { key: '__index', title: 'Index' },
                    'architecture': { key: '__architecture', title: 'Architecture' },
                    'getting-started': { key: '__getting-started', title: 'Getting Started' }
                };
                if (specialPages[slug]) {
                    loadSpecialPage(specialPages[slug].key, specialPages[slug].title);
                    return;
                }

                // Try to find matching module ID
                var matchedId = findModuleIdBySlugClient(slug);
                if (matchedId) {
                    loadModule(matchedId);
                    if (hashPart) {
                        setTimeout(function() {
                            var el = document.getElementById(hashPart);
                            if (el) el.scrollIntoView({ behavior: 'smooth' });
                        }, 100);
                    }
                }
            });
        }

        // Client-side module ID lookup by slug
        function findModuleIdBySlugClient(slug) {
            var normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            for (var i = 0; i < moduleGraph.modules.length; i++) {
                var mod = moduleGraph.modules[i];
                var modSlug = mod.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                if (modSlug === normalized) return mod.id;
            }
            return null;
        }

        function addCopyButton(pre) {
            var btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.textContent = 'Copy';
            btn.onclick = function() {
                var code = pre.querySelector('code');
                var text = code ? code.textContent : pre.textContent;
                navigator.clipboard.writeText(text).then(function() {
                    btn.textContent = 'Copied!';
                    setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
                });
            };
            pre.appendChild(btn);
        }

        function initMermaid() {
            var blocks = document.querySelectorAll('.mermaid');
            if (blocks.length === 0) return Promise.resolve();

            var isDark = currentTheme === 'dark' ||
                (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);

            mermaid.initialize({
                startOnLoad: false,
                theme: isDark ? 'dark' : 'default',
                securityLevel: 'loose',
                flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
                fontSize: 14,
            });
            return mermaid.run({ nodes: blocks }).then(function() {
                initMermaidZoom();
            });
        }

        // ================================================================
        // Mermaid Zoom & Pan (shared via mermaid-zoom module)
        // ================================================================
${getMermaidZoomScript()}

        // ================================================================
        // Table of Contents
        // ================================================================

        function buildToc() {
            var tocNav = document.getElementById('toc-nav');
            tocNav.innerHTML = '';
            var body = document.querySelector('#content .markdown-body');
            if (!body) return;

            var headings = body.querySelectorAll('h2, h3, h4');
            headings.forEach(function(heading) {
                if (!heading.id) return;
                var link = document.createElement('a');
                link.href = '#' + heading.id;
                link.textContent = heading.textContent.replace(/#$/, '').trim();
                var level = heading.tagName.toLowerCase();
                if (level === 'h3') link.className = 'toc-h3';
                if (level === 'h4') link.className = 'toc-h4';
                link.onclick = function(e) {
                    e.preventDefault();
                    var target = document.getElementById(heading.id);
                    if (target) {
                        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                };
                tocNav.appendChild(link);
            });

            // Scroll spy
            setupScrollSpy();
        }

        function setupScrollSpy() {
            var scrollEl = document.getElementById('content-scroll');
            if (!scrollEl) return;
            scrollEl.addEventListener('scroll', updateActiveToc);
        }

        function updateActiveToc() {
            var tocLinks = document.querySelectorAll('#toc-nav a');
            if (tocLinks.length === 0) return;

            var scrollEl = document.getElementById('content-scroll');
            var scrollTop = scrollEl.scrollTop;
            var activeId = null;

            var headings = document.querySelectorAll('#content .markdown-body h2, #content .markdown-body h3, #content .markdown-body h4');
            headings.forEach(function(h) {
                if (h.offsetTop - 80 <= scrollTop) {
                    activeId = h.id;
                }
            });

            tocLinks.forEach(function(link) {
                var href = link.getAttribute('href');
                if (href === '#' + activeId) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });
        }

        // ================================================================
        // Utility
        // ================================================================

        function escapeHtml(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
${opts.enableGraph ? `
        // ================================================================
        // Interactive Dependency Graph (D3.js)
        // ================================================================

        var graphRendered = false;
        var disabledCategories = new Set();

        var CATEGORY_COLORS = [
            '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
            '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
        ];

        var COMPLEXITY_RADIUS = { low: 8, medium: 12, high: 18 };

        function getCategoryColor(category, allCategories) {
            var idx = allCategories.indexOf(category);
            return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
        }

        function showGraph(skipHistory) {
            currentModuleId = null;
            setActive('__graph');
            document.getElementById('toc-nav').innerHTML = '';
            if (!skipHistory) {
                history.pushState({ type: 'graph' }, '', location.pathname + '#graph');
            }

            var article = document.getElementById('article');
            article.style.maxWidth = '100%';
            article.style.padding = '0';

            var container = document.getElementById('content');
            container.innerHTML = '<div class="graph-container" id="graph-container">' +
                '<div class="graph-toolbar">' +
                '<button id="graph-zoom-in" title="Zoom in">+</button>' +
                '<button id="graph-zoom-out" title="Zoom out">\\u2212</button>' +
                '<button id="graph-zoom-reset" title="Reset view">Reset</button>' +
                '</div>' +
                '<div class="graph-legend" id="graph-legend"></div>' +
                '<div class="graph-tooltip" id="graph-tooltip" style="display:none;"></div>' +
                '</div>';

            // Make graph fill the available space
            var gc = document.getElementById('graph-container');
            gc.style.height = (article.parentElement.parentElement.clientHeight - 48) + 'px';

            renderGraph();
        }

        function renderGraph() {
            if (typeof d3 === 'undefined') return;

            var container = document.getElementById('graph-container');
            if (!container) return;

            var width = container.clientWidth || 800;
            var height = container.clientHeight || 600;

            var allCategories = [];
            moduleGraph.modules.forEach(function(m) {
                if (allCategories.indexOf(m.category) === -1) allCategories.push(m.category);
            });
            allCategories.sort();

            var legendEl = document.getElementById('graph-legend');
            legendEl.innerHTML = '<div class="graph-legend-title">Categories</div>';
            allCategories.forEach(function(cat) {
                var color = getCategoryColor(cat, allCategories);
                var item = document.createElement('div');
                item.className = 'graph-legend-item';
                item.setAttribute('data-category', cat);
                item.innerHTML = '<div class="graph-legend-swatch" style="background:' + color + '"></div>' +
                    '<span>' + escapeHtml(cat) + '</span>';
                item.onclick = function() {
                    if (disabledCategories.has(cat)) {
                        disabledCategories.delete(cat);
                        item.classList.remove('disabled');
                    } else {
                        disabledCategories.add(cat);
                        item.classList.add('disabled');
                    }
                    updateGraphVisibility();
                };
                legendEl.appendChild(item);
            });

            var nodes = moduleGraph.modules.map(function(m) {
                return { id: m.id, name: m.name, category: m.category, complexity: m.complexity, path: m.path, purpose: m.purpose };
            });

            var nodeIds = new Set(nodes.map(function(n) { return n.id; }));
            var links = [];
            moduleGraph.modules.forEach(function(m) {
                (m.dependencies || []).forEach(function(dep) {
                    if (nodeIds.has(dep)) {
                        links.push({ source: m.id, target: dep });
                    }
                });
            });

            var svg = d3.select('#graph-container')
                .append('svg')
                .attr('width', width)
                .attr('height', height);

            svg.append('defs').append('marker')
                .attr('id', 'arrowhead')
                .attr('viewBox', '0 -5 10 10')
                .attr('refX', 20)
                .attr('refY', 0)
                .attr('markerWidth', 6)
                .attr('markerHeight', 6)
                .attr('orient', 'auto')
                .append('path')
                .attr('d', 'M0,-5L10,0L0,5')
                .attr('class', 'graph-link-arrow');

            var g = svg.append('g');

            var link = g.selectAll('.graph-link')
                .data(links)
                .join('line')
                .attr('class', 'graph-link')
                .attr('marker-end', 'url(#arrowhead)');

            var node = g.selectAll('.graph-node')
                .data(nodes)
                .join('g')
                .attr('class', 'graph-node')
                .style('cursor', 'pointer')
                .call(d3.drag()
                    .on('start', dragstarted)
                    .on('drag', dragged)
                    .on('end', dragended));

            node.append('circle')
                .attr('r', function(d) { return COMPLEXITY_RADIUS[d.complexity] || 10; })
                .attr('fill', function(d) { return getCategoryColor(d.category, allCategories); })
                .attr('stroke', '#fff')
                .attr('stroke-width', 1.5);

            node.append('text')
                .attr('dx', function(d) { return (COMPLEXITY_RADIUS[d.complexity] || 10) + 4; })
                .attr('dy', 4)
                .text(function(d) { return d.name; });

            node.on('click', function(event, d) {
                event.stopPropagation();
                // Restore article styles before loading module
                var article = document.getElementById('article');
                article.style.maxWidth = '';
                article.style.padding = '';
                loadModule(d.id);
            });

            var tooltip = document.getElementById('graph-tooltip');
            node.on('mouseover', function(event, d) {
                tooltip.style.display = 'block';
                tooltip.innerHTML = '<div class="graph-tooltip-name">' + escapeHtml(d.name) + '</div>' +
                    '<div class="graph-tooltip-purpose">' + escapeHtml(d.purpose) + '</div>' +
                    '<div style="margin-top:4px;font-size:11px;color:var(--content-muted);">' +
                    'Complexity: ' + d.complexity + '</div>';
            });
            node.on('mousemove', function(event) {
                tooltip.style.left = (event.pageX + 12) + 'px';
                tooltip.style.top = (event.pageY - 12) + 'px';
            });
            node.on('mouseout', function() { tooltip.style.display = 'none'; });

            var simulation = d3.forceSimulation(nodes)
                .force('link', d3.forceLink(links).id(function(d) { return d.id; }).distance(100))
                .force('charge', d3.forceManyBody().strength(-300))
                .force('center', d3.forceCenter(width / 2, height / 2))
                .force('collision', d3.forceCollide().radius(function(d) { return (COMPLEXITY_RADIUS[d.complexity] || 10) + 8; }))
                .on('tick', function() {
                    link.attr('x1', function(d) { return d.source.x; })
                        .attr('y1', function(d) { return d.source.y; })
                        .attr('x2', function(d) { return d.target.x; })
                        .attr('y2', function(d) { return d.target.y; });
                    node.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
                });

            var zoom = d3.zoom()
                .scaleExtent([0.1, 4])
                .on('zoom', function(event) { g.attr('transform', event.transform); });

            svg.call(zoom);

            document.getElementById('graph-zoom-in').onclick = function() { svg.transition().call(zoom.scaleBy, 1.3); };
            document.getElementById('graph-zoom-out').onclick = function() { svg.transition().call(zoom.scaleBy, 0.7); };
            document.getElementById('graph-zoom-reset').onclick = function() { svg.transition().call(zoom.transform, d3.zoomIdentity); };

            window._graphNode = node;
            window._graphLink = link;

            function dragstarted(event, d) {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
            }
            function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
            function dragended(event, d) {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null; d.fy = null;
            }

            graphRendered = true;
        }

        function updateGraphVisibility() {
            if (!window._graphNode) return;
            window._graphNode.style('display', function(d) {
                return disabledCategories.has(d.category) ? 'none' : null;
            });
            window._graphLink.style('display', function(d) {
                var src = typeof d.source === 'object' ? d.source : { category: '' };
                var tgt = typeof d.target === 'object' ? d.target : { category: '' };
                return (disabledCategories.has(src.category) || disabledCategories.has(tgt.category)) ? 'none' : null;
            });
        }` : ''}
${opts.enableAI ? `
        // ================================================================
        // Ask AI
        // ================================================================

        var conversationHistory = [];
        var askStreaming = false;
        var askPanelOpen = false;
        var currentSessionId = null;

        function updateAskSubject(name) {
            var el = document.getElementById('ask-bar-subject');
            if (el) el.textContent = name;
        }

        // Widget controls
        document.getElementById('ask-close').addEventListener('click', collapseWidget);
        document.getElementById('ask-clear').addEventListener('click', function() {
            if (currentSessionId) {
                fetch('/api/ask/session/' + encodeURIComponent(currentSessionId), { method: 'DELETE' }).catch(function() {});
                currentSessionId = null;
            }
            conversationHistory = [];
            document.getElementById('ask-messages').innerHTML = '';
        });
        document.getElementById('ask-widget-send').addEventListener('click', askPanelSend);
        document.getElementById('ask-textarea').addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                askPanelSend();
            }
        });
        document.getElementById('ask-textarea').addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        function expandWidget() {
            if (askPanelOpen) return;
            askPanelOpen = true;
            var widget = document.getElementById('ask-widget');
            widget.classList.add('expanded');
            document.getElementById('ask-widget-header').classList.remove('hidden');
            document.getElementById('ask-messages').classList.remove('hidden');
        }

        function collapseWidget() {
            askPanelOpen = false;
            var widget = document.getElementById('ask-widget');
            widget.classList.remove('expanded');
            document.getElementById('ask-widget-header').classList.add('hidden');
            document.getElementById('ask-messages').classList.add('hidden');
        }

        function askPanelSend() {
            if (askStreaming) return;
            var input = document.getElementById('ask-textarea');
            var question = input.value.trim();
            if (!question) return;

            expandWidget();

            input.value = '';
            input.style.height = 'auto';

            appendAskMessage('user', question);
            conversationHistory.push({ role: 'user', content: question });

            askStreaming = true;
            document.getElementById('ask-widget-send').disabled = true;

            var typingEl = appendAskTyping();

            var requestBody = { question: question };
            if (currentSessionId) {
                requestBody.sessionId = currentSessionId;
            } else {
                requestBody.conversationHistory = conversationHistory.slice(0, -1);
            }

            fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            }).then(function(response) {
                if (!response.ok) {
                    return response.json().then(function(err) {
                        throw new Error(err.error || 'Request failed');
                    });
                }

                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var buffer = '';
                var fullResponse = '';
                var contextShown = false;
                var responseEl = null;

                function processChunk(result) {
                    if (result.done) {
                        if (buffer.trim()) {
                            var remaining = buffer.trim();
                            if (remaining.startsWith('data: ')) {
                                try {
                                    var data = JSON.parse(remaining.slice(6));
                                    if (data.type === 'chunk') {
                                        fullResponse += data.content;
                                        if (!responseEl) responseEl = appendAskAssistantStreaming('');
                                        updateAskAssistantStreaming(responseEl, fullResponse);
                                    } else if (data.type === 'done') {
                                        fullResponse = data.fullResponse || fullResponse;
                                        if (data.sessionId) currentSessionId = data.sessionId;
                                    }
                                } catch(e) {}
                            }
                        }
                        finishStreaming(fullResponse, typingEl);
                        return;
                    }

                    buffer += decoder.decode(result.value, { stream: true });
                    var lines = buffer.split('\\n');
                    buffer = lines.pop() || '';

                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i].trim();
                        if (!line.startsWith('data: ')) continue;
                        try {
                            var data = JSON.parse(line.slice(6));
                            if (data.type === 'context' && !contextShown) {
                                contextShown = true;
                                appendAskContext(data.moduleIds);
                            } else if (data.type === 'chunk') {
                                if (typingEl && typingEl.parentNode) {
                                    typingEl.parentNode.removeChild(typingEl);
                                    typingEl = null;
                                }
                                fullResponse += data.content;
                                if (!responseEl) responseEl = appendAskAssistantStreaming('');
                                updateAskAssistantStreaming(responseEl, fullResponse);
                            } else if (data.type === 'done') {
                                fullResponse = data.fullResponse || fullResponse;
                                if (data.sessionId) currentSessionId = data.sessionId;
                                finishStreaming(fullResponse, typingEl);
                                return;
                            } else if (data.type === 'error') {
                                appendAskError(data.message);
                                finishStreaming('', typingEl);
                                return;
                            }
                        } catch(e) {}
                    }

                    return reader.read().then(processChunk);
                }

                return reader.read().then(processChunk);
            }).catch(function(err) {
                if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
                appendAskError(err.message || 'Failed to connect');
                finishStreaming('', null);
            });
        }

        function finishStreaming(fullResponse, typingEl) {
            if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
            askStreaming = false;
            document.getElementById('ask-widget-send').disabled = false;
            if (fullResponse) {
                conversationHistory.push({ role: 'assistant', content: fullResponse });
            }
        }

        function appendAskMessage(role, content) {
            var messages = document.getElementById('ask-messages');
            var div = document.createElement('div');
            div.className = 'ask-message';
            var inner = document.createElement('div');
            inner.className = 'ask-message-' + role;
            inner.textContent = content;
            div.appendChild(inner);
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
            return div;
        }

        function appendAskAssistantStreaming(content) {
            var messages = document.getElementById('ask-messages');
            var div = document.createElement('div');
            div.className = 'ask-message';
            var inner = document.createElement('div');
            inner.className = 'ask-message-assistant';
            inner.innerHTML = '<div class="markdown-body">' + (typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content)) + '</div>';
            div.appendChild(inner);
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
            return inner;
        }

        function updateAskAssistantStreaming(el, content) {
            if (!el) return;
            el.innerHTML = '<div class="markdown-body">' + (typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content)) + '</div>';
            var messages = document.getElementById('ask-messages');
            messages.scrollTop = messages.scrollHeight;
        }

        function appendAskContext(moduleIds) {
            if (!moduleIds || moduleIds.length === 0) return;
            var messages = document.getElementById('ask-messages');
            var div = document.createElement('div');
            div.className = 'ask-message-context';
            var links = moduleIds.map(function(id) {
                var mod = moduleGraph.modules.find(function(m) { return m.id === id; });
                var name = mod ? mod.name : id;
                return '<a onclick="loadModule(\\'' + id.replace(/'/g, "\\\\'") + '\\')">' + escapeHtml(name) + '</a>';
            });
            div.innerHTML = 'Context: ' + links.join(', ');
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
        }

        function appendAskTyping() {
            var messages = document.getElementById('ask-messages');
            var div = document.createElement('div');
            div.className = 'ask-message';
            var inner = document.createElement('div');
            inner.className = 'ask-message-typing';
            inner.textContent = 'Thinking';
            div.appendChild(inner);
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
            return div;
        }

        function appendAskError(message) {
            var messages = document.getElementById('ask-messages');
            var div = document.createElement('div');
            div.className = 'ask-message-error';
            div.textContent = 'Error: ' + message;
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
        }

        // Deep Dive (Explore Further)
        var deepDiveStreaming = false;

        function addDeepDiveButton(moduleId) {
            var content = document.getElementById('content');
            if (!content) return;
            var markdownBody = content.querySelector('.markdown-body');
            if (!markdownBody) return;

            var btn = document.createElement('button');
            btn.className = 'deep-dive-btn';
            btn.innerHTML = '&#128269; Explore Further';
            btn.onclick = function() { toggleDeepDiveSection(moduleId, btn); };
            markdownBody.insertBefore(btn, markdownBody.firstChild);
        }

        function toggleDeepDiveSection(moduleId, btn) {
            var existing = document.getElementById('deep-dive-section');
            if (existing) { existing.parentNode.removeChild(existing); return; }

            var section = document.createElement('div');
            section.id = 'deep-dive-section';
            section.className = 'deep-dive-section';
            section.innerHTML =
                '<div class="deep-dive-input-area">' +
                '<input type="text" class="deep-dive-input" id="deep-dive-input" ' +
                'placeholder="Ask a specific question about this module... (optional)">' +
                '<button class="deep-dive-submit" id="deep-dive-submit">Explore</button>' +
                '</div>' +
                '<div class="deep-dive-result" id="deep-dive-result"></div>';

            btn.insertAdjacentElement('afterend', section);

            document.getElementById('deep-dive-submit').onclick = function() { startDeepDive(moduleId); };
            document.getElementById('deep-dive-input').addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); startDeepDive(moduleId); }
            });
            document.getElementById('deep-dive-input').focus();
        }

        function startDeepDive(moduleId) {
            if (deepDiveStreaming) return;
            deepDiveStreaming = true;

            var input = document.getElementById('deep-dive-input');
            var submitBtn = document.getElementById('deep-dive-submit');
            var resultDiv = document.getElementById('deep-dive-result');
            var question = input ? input.value.trim() : '';

            submitBtn.disabled = true;
            resultDiv.innerHTML = '<div class="deep-dive-status">Analyzing module...</div>';

            var body = {};
            if (question) body.question = question;
            body.depth = 'deep';

            fetch('/api/explore/' + encodeURIComponent(moduleId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }).then(function(response) {
                if (!response.ok) {
                    return response.json().then(function(err) { throw new Error(err.error || 'Request failed'); });
                }

                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var buffer = '';
                var fullResponse = '';

                function processChunk(result) {
                    if (result.done) {
                        if (buffer.trim()) {
                            var remaining = buffer.trim();
                            if (remaining.startsWith('data: ')) {
                                try {
                                    var data = JSON.parse(remaining.slice(6));
                                    if (data.type === 'chunk') fullResponse += data.text;
                                    else if (data.type === 'done') fullResponse = data.fullResponse || fullResponse;
                                } catch(e) {}
                            }
                        }
                        finishDeepDive(fullResponse, resultDiv, submitBtn);
                        return;
                    }

                    buffer += decoder.decode(result.value, { stream: true });
                    var lines = buffer.split('\\n');
                    buffer = lines.pop() || '';

                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i].trim();
                        if (!line.startsWith('data: ')) continue;
                        try {
                            var data = JSON.parse(line.slice(6));
                            if (data.type === 'status') {
                                resultDiv.innerHTML = '<div class="deep-dive-status">' + escapeHtml(data.message) + '</div>';
                            } else if (data.type === 'chunk') {
                                fullResponse += data.text;
                                resultDiv.innerHTML = '<div class="markdown-body">' +
                                    (typeof marked !== 'undefined' ? marked.parse(fullResponse) : escapeHtml(fullResponse)) + '</div>';
                            } else if (data.type === 'done') {
                                fullResponse = data.fullResponse || fullResponse;
                                finishDeepDive(fullResponse, resultDiv, submitBtn);
                                return;
                            } else if (data.type === 'error') {
                                resultDiv.innerHTML = '<div class="ask-message-error">Error: ' + escapeHtml(data.message) + '</div>';
                                finishDeepDive('', resultDiv, submitBtn);
                                return;
                            }
                        } catch(e) {}
                    }

                    return reader.read().then(processChunk);
                }

                return reader.read().then(processChunk);
            }).catch(function(err) {
                resultDiv.innerHTML = '<div class="ask-message-error">Error: ' + escapeHtml(err.message) + '</div>';
                finishDeepDive('', resultDiv, submitBtn);
            });
        }

        function finishDeepDive(fullResponse, resultDiv, submitBtn) {
            deepDiveStreaming = false;
            if (submitBtn) submitBtn.disabled = false;
            if (fullResponse && resultDiv) {
                resultDiv.innerHTML = '<div class="markdown-body">' +
                    (typeof marked !== 'undefined' ? marked.parse(fullResponse) : escapeHtml(fullResponse)) + '</div>';
                resultDiv.querySelectorAll('pre code').forEach(function(block) { hljs.highlightElement(block); });
            }
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                e.preventDefault();
                document.getElementById('sidebar-collapse').click();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
                e.preventDefault();
                if (askPanelOpen) collapseWidget();
                else { expandWidget(); document.getElementById('ask-textarea').focus(); }
            }
            if (e.key === 'Escape') {
                if (askPanelOpen) collapseWidget();
            }
        });` : ''}
${opts.enableWatch ? `
        // ================================================================
        // WebSocket Live Reload
        // ================================================================

        var wsReconnectTimer = null;
        var wsReconnectDelay = 1000;

        function connectWebSocket() {
            var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            var wsUrl = protocol + '//' + location.host + '/ws';
            var ws = new WebSocket(wsUrl);

            ws.onopen = function() {
                wsReconnectDelay = 1000;
                setInterval(function() {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ping' }));
                    }
                }, 30000);
            };

            ws.onmessage = function(event) {
                try {
                    var msg = JSON.parse(event.data);
                    handleWsMessage(msg);
                } catch(e) {}
            };

            ws.onclose = function() {
                wsReconnectTimer = setTimeout(function() {
                    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
                    connectWebSocket();
                }, wsReconnectDelay);
            };

            ws.onerror = function() {};
        }

        function handleWsMessage(msg) {
            var bar = document.getElementById('live-reload-bar');
            if (!bar) return;

            if (msg.type === 'rebuilding') {
                bar.className = 'live-reload-bar visible rebuilding';
                bar.textContent = 'Rebuilding: ' + (msg.modules || []).join(', ') + '...';
            } else if (msg.type === 'reload') {
                bar.className = 'live-reload-bar visible reloaded';
                bar.textContent = 'Updated: ' + (msg.modules || []).join(', ');
                (msg.modules || []).forEach(function(id) { delete markdownCache[id]; });
                if (currentModuleId && (msg.modules || []).indexOf(currentModuleId) !== -1) {
                    loadModule(currentModuleId, true);
                }
                setTimeout(function() { bar.className = 'live-reload-bar'; }, 3000);
            } else if (msg.type === 'error') {
                bar.className = 'live-reload-bar visible error';
                bar.textContent = 'Error: ' + (msg.message || 'Unknown error');
                setTimeout(function() { bar.className = 'live-reload-bar'; }, 5000);
            }
        }

        connectWebSocket();` : ''}

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
