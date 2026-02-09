/**
 * SPA Template for Server Mode
 *
 * Generates a modified version of the static HTML template that fetches
 * data from the server's REST API instead of using embedded data.
 *
 * The key differences from the static site:
 *   - No embedded <script> with MODULE_GRAPH / MARKDOWN_DATA
 *   - Data is fetched lazily via /api/* endpoints
 *   - Module markdown is loaded on-demand (not all at once)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { WebsiteTheme } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface SpaTemplateOptions {
    /** Website theme */
    theme: WebsiteTheme;
    /** Project title */
    title: string;
    /** Enable search */
    enableSearch: boolean;
    /** Enable AI features (Ask panel) */
    enableAI: boolean;
    /** Enable interactive dependency graph */
    enableGraph: boolean;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate the SPA HTML for server mode.
 */
export function generateSpaHtml(options: SpaTemplateOptions): string {
    const { theme, title, enableSearch, enableAI, enableGraph } = options;

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
    <div class="sidebar" id="sidebar">
        <div class="sidebar-header">
            <h1 id="project-name">${escapeHtml(title)}</h1>
            <p id="project-description"></p>
        </div>
${enableSearch ? `        <div class="search-box">
            <input type="text" id="search" placeholder="Search modules..." aria-label="Search modules">
        </div>` : ''}
        <div id="nav-container"></div>
    </div>

    <div class="main-area">
        <div class="content" id="content-area">
            <div class="content-header">
                <div class="header-left">
                    <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">&#9776;</button>
                    <div>
                        <div class="breadcrumb" id="breadcrumb">Home</div>
                        <h2 class="content-title" id="content-title">Project Overview</h2>
                    </div>
                </div>
                <div class="header-right">
${enableAI ? `                    <button class="ask-toggle-btn" id="ask-toggle" aria-label="Toggle Ask AI panel">Ask AI</button>` : ''}
                    <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">&#9790;</button>
                </div>
            </div>
            <div class="content-body">
                <div id="content" class="markdown-body">
                    <div class="loading">Loading wiki data...</div>
                </div>
            </div>
        </div>
${enableAI ? `        <div class="ask-panel hidden" id="ask-panel">
            <div class="ask-panel-header">
                <h3>Ask AI</h3>
                <div class="ask-panel-actions">
                    <button class="ask-panel-clear" id="ask-clear" title="Clear conversation">Clear</button>
                    <button class="ask-panel-close" id="ask-close" aria-label="Close Ask panel">&times;</button>
                </div>
            </div>
            <div class="ask-messages" id="ask-messages"></div>
            <div class="ask-input-area">
                <textarea class="ask-input" id="ask-input" placeholder="Ask about this codebase..." rows="1"></textarea>
                <button class="ask-send-btn" id="ask-send">Send</button>
            </div>
        </div>` : ''}
    </div>

    <script>
${getSpaScript({ enableSearch, enableAI, enableGraph, defaultTheme: theme })}
    </script>
</body>
</html>`;
}

// ============================================================================
// Styles
// ============================================================================

function getSpaStyles(enableAI: boolean): string {
    // Reuse the same base styles as the static site
    let styles = `        :root {
            --sidebar-bg: #1e293b;
            --sidebar-header-bg: #0f172a;
            --sidebar-border: #334155;
            --sidebar-text: #e2e8f0;
            --sidebar-muted: #94a3b8;
            --sidebar-hover: #334155;
            --sidebar-active-border: #3b82f6;
            --content-bg: #ffffff;
            --content-text: #1e293b;
            --content-muted: #64748b;
            --content-border: #e2e8f0;
            --header-bg: #ffffff;
            --header-shadow: rgba(0,0,0,0.05);
            --code-bg: #f1f5f9;
            --code-border: #e2e8f0;
            --link-color: #2563eb;
            --badge-high-bg: #ef4444;
            --badge-medium-bg: #f59e0b;
            --badge-low-bg: #22c55e;
            --card-bg: #ffffff;
            --card-border: #e2e8f0;
            --card-hover-border: #3b82f6;
            --stat-bg: #f8fafc;
            --stat-border: #3b82f6;
            --copy-btn-bg: rgba(0,0,0,0.05);
            --copy-btn-hover-bg: rgba(0,0,0,0.1);
            --search-bg: #334155;
            --search-text: #e2e8f0;
            --search-placeholder: #94a3b8;
        }

        .dark-theme,
        html[data-theme="dark"] {
            --content-bg: #0f172a;
            --content-text: #e2e8f0;
            --content-muted: #94a3b8;
            --content-border: #334155;
            --header-bg: #1e293b;
            --header-shadow: rgba(0,0,0,0.2);
            --code-bg: #1e293b;
            --code-border: #334155;
            --link-color: #60a5fa;
            --card-bg: #1e293b;
            --card-border: #334155;
            --stat-bg: #1e293b;
            --copy-btn-bg: rgba(255,255,255,0.08);
            --copy-btn-hover-bg: rgba(255,255,255,0.15);
        }

        @media (prefers-color-scheme: dark) {
            html[data-theme="auto"] {
                --content-bg: #0f172a;
                --content-text: #e2e8f0;
                --content-muted: #94a3b8;
                --content-border: #334155;
                --header-bg: #1e293b;
                --header-shadow: rgba(0,0,0,0.2);
                --code-bg: #1e293b;
                --code-border: #334155;
                --link-color: #60a5fa;
                --card-bg: #1e293b;
                --card-border: #334155;
                --stat-bg: #1e293b;
                --copy-btn-bg: rgba(255,255,255,0.08);
                --copy-btn-hover-bg: rgba(255,255,255,0.15);
            }
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            display: flex;
            height: 100vh;
            overflow: hidden;
            background: var(--content-bg);
            color: var(--content-text);
        }

        .sidebar {
            width: 280px;
            min-width: 280px;
            background: var(--sidebar-bg);
            color: var(--sidebar-text);
            overflow-y: auto;
            border-right: 1px solid var(--sidebar-border);
            transition: margin-left 0.3s;
        }
        .sidebar.hidden { margin-left: -280px; }

        .sidebar-header {
            padding: 20px;
            background: var(--sidebar-header-bg);
            border-bottom: 1px solid var(--sidebar-border);
        }
        .sidebar-header h1 { font-size: 18px; margin-bottom: 8px; }
        .sidebar-header p { font-size: 12px; color: var(--sidebar-muted); line-height: 1.4; }

        .nav-section { padding: 12px 0; border-bottom: 1px solid var(--sidebar-border); }
        .nav-section h3 {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--sidebar-muted);
            padding: 8px 20px;
            font-weight: 600;
        }

        .nav-item {
            padding: 8px 20px;
            cursor: pointer;
            transition: background 0.15s;
            font-size: 14px;
            border-left: 3px solid transparent;
            display: block;
        }
        .nav-item:hover { background: var(--sidebar-hover); }
        .nav-item.active { background: var(--sidebar-hover); border-left-color: var(--sidebar-active-border); }
        .nav-item-name { display: block; color: var(--sidebar-text); margin-bottom: 2px; }
        .nav-item-path { display: block; font-size: 11px; color: var(--sidebar-muted); }

        .complexity-badge {
            display: inline-block;
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            margin-left: 6px;
            color: white;
        }
        .complexity-high { background: var(--badge-high-bg); }
        .complexity-medium { background: var(--badge-medium-bg); }
        .complexity-low { background: var(--badge-low-bg); }

        .search-box { margin: 12px 16px; }
        .search-box input {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--sidebar-border);
            border-radius: 6px;
            background: var(--search-bg);
            color: var(--search-text);
            font-size: 13px;
            outline: none;
        }
        .search-box input::placeholder { color: var(--search-placeholder); }
        .search-box input:focus { border-color: var(--sidebar-active-border); }

        .main-area {
            flex: 1;
            display: flex;
            overflow: hidden;
            min-width: 0;
        }

        .content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-width: 0;
        }

        .content-header {
            background: var(--header-bg);
            padding: 16px 32px;
            border-bottom: 1px solid var(--content-border);
            box-shadow: 0 1px 3px var(--header-shadow);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .header-left { display: flex; align-items: center; gap: 12px; }
        .header-right { display: flex; align-items: center; gap: 8px; }
        .breadcrumb { font-size: 13px; color: var(--content-muted); margin-bottom: 4px; }
        .content-title { font-size: 24px; color: var(--content-text); }

        .sidebar-toggle, .theme-toggle {
            background: none;
            border: 1px solid var(--content-border);
            border-radius: 6px;
            padding: 6px 10px;
            cursor: pointer;
            font-size: 18px;
            color: var(--content-muted);
        }
        .sidebar-toggle:hover, .theme-toggle:hover { background: var(--code-bg); }

        .content-body {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 32px;
            background: var(--content-bg);
        }

        .markdown-body { max-width: 900px; margin: 0 auto; line-height: 1.6; overflow-wrap: break-word; }
        .markdown-body h1 { margin-top: 32px; margin-bottom: 16px; font-size: 2em; border-bottom: 1px solid var(--content-border); padding-bottom: 8px; }
        .markdown-body h1:first-child { margin-top: 0; }
        .markdown-body h2 { margin-top: 28px; margin-bottom: 16px; font-size: 1.5em; border-bottom: 1px solid var(--content-border); padding-bottom: 6px; }
        .markdown-body h3 { margin-top: 24px; margin-bottom: 12px; font-size: 1.25em; }
        .markdown-body h4 { margin-top: 20px; margin-bottom: 8px; font-size: 1.1em; }
        .markdown-body p { margin-bottom: 16px; }
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
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
            margin-bottom: 16px;
            position: relative;
        }
        .markdown-body pre code { background: none; padding: 0; border-radius: 0; font-size: 13px; }
        .markdown-body table { border-collapse: collapse; width: 100%; margin: 16px 0; display: block; overflow-x: auto; }
        .markdown-body table th, .markdown-body table td {
            border: 1px solid var(--content-border);
            padding: 8px 12px;
            text-align: left;
        }
        .markdown-body table th { background: var(--code-bg); font-weight: 600; }
        .markdown-body ul, .markdown-body ol { margin-bottom: 16px; padding-left: 2em; }
        .markdown-body li { margin-bottom: 6px; }
        .markdown-body a { color: var(--link-color); text-decoration: none; }
        .markdown-body a:hover { text-decoration: underline; }
        .markdown-body blockquote {
            border-left: 4px solid var(--content-border);
            padding: 8px 16px;
            margin: 16px 0;
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
            padding: 4px 8px;
            cursor: pointer;
            font-size: 12px;
            color: var(--content-muted);
            opacity: 0;
            transition: opacity 0.15s;
        }
        .markdown-body pre:hover .copy-btn { opacity: 1; }
        .copy-btn:hover { background: var(--copy-btn-hover-bg); }

        .home-view { max-width: 900px; margin: 0 auto; }
        .project-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
            margin: 24px 0;
        }
        .stat-card {
            background: var(--stat-bg);
            padding: 16px;
            border-radius: 8px;
            border-left: 4px solid var(--stat-border);
        }
        .stat-card h3 { font-size: 13px; color: var(--content-muted); margin-bottom: 6px; font-weight: 500; }
        .stat-card .value { font-size: 28px; font-weight: 700; color: var(--content-text); }
        .stat-card .value.small { font-size: 16px; }

        .module-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: 12px;
            margin-top: 24px;
        }
        .module-card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 8px;
            padding: 14px;
            cursor: pointer;
            transition: border-color 0.15s, box-shadow 0.15s;
        }
        .module-card:hover {
            border-color: var(--card-hover-border);
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        .module-card h4 { margin-bottom: 6px; font-size: 14px; }
        .module-card p { font-size: 12px; color: var(--content-muted); line-height: 1.4; }

        .loading {
            text-align: center;
            padding: 48px;
            color: var(--content-muted);
            font-size: 16px;
        }

        .mermaid-container {
            position: relative;
            margin: 24px 0;
            border: 1px solid var(--content-border);
            border-radius: 8px;
            overflow: hidden;
            background: var(--code-bg);
            max-width: 100%;
            width: 100%;
        }
        .markdown-body pre.mermaid {
            background: transparent;
            border: none;
            padding: 0;
            margin: 0;
            text-align: center;
        }
        .markdown-body pre.mermaid svg {
            max-width: 100%;
            height: auto;
        }

        /* Dependency Graph */
        .graph-container {
            width: 100%;
            height: 100%;
            position: relative;
        }
        .graph-container svg {
            width: 100%;
            height: 100%;
        }
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
        .graph-toolbar button:hover {
            background: var(--code-bg);
            border-color: var(--sidebar-active-border);
        }
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
        .graph-legend-title {
            font-weight: 600;
            margin-bottom: 6px;
            color: var(--content-text);
        }
        .graph-legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
            cursor: pointer;
            user-select: none;
        }
        .graph-legend-item.disabled {
            opacity: 0.3;
        }
        .graph-legend-swatch {
            width: 12px;
            height: 12px;
            border-radius: 3px;
        }
        .graph-node text {
            font-size: 11px;
            fill: var(--content-text);
            pointer-events: none;
        }
        .graph-link {
            stroke: var(--content-border);
            stroke-opacity: 0.6;
        }
        .graph-link-arrow {
            fill: var(--content-border);
            fill-opacity: 0.6;
        }
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
        .graph-tooltip-name {
            font-weight: 600;
            margin-bottom: 4px;
        }
        .graph-tooltip-purpose {
            color: var(--content-muted);
            line-height: 1.4;
        }

        @media (max-width: 768px) {
            .sidebar { position: fixed; z-index: 100; height: 100vh; }
            .sidebar.hidden { margin-left: -280px; }
            .content-header { padding: 12px 16px; }
            .content-body { padding: 16px; }
        }`;

    if (enableAI) {
        styles += `

        /* Ask AI button */
        .ask-toggle-btn {
            background: var(--sidebar-active-border);
            color: white;
            border: none;
            border-radius: 6px;
            padding: 6px 14px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
        }
        .ask-toggle-btn:hover { opacity: 0.9; }

        /* Ask Panel (slide-out) */
        .ask-panel {
            width: 380px;
            min-width: 380px;
            background: var(--content-bg);
            border-left: 1px solid var(--content-border);
            display: flex;
            flex-direction: column;
            transition: margin-right 0.3s;
            height: 100%;
        }
        .ask-panel.hidden { display: none; }
        .ask-panel-header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--content-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .ask-panel-header h3 { font-size: 15px; color: var(--content-text); margin: 0; }
        .ask-panel-close {
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: var(--content-muted);
            padding: 0 4px;
        }
        .ask-panel-close:hover { color: var(--content-text); }
        .ask-panel-actions {
            display: flex;
            gap: 6px;
            align-items: center;
        }
        .ask-panel-clear {
            background: none;
            border: 1px solid var(--content-border);
            border-radius: 4px;
            padding: 2px 8px;
            cursor: pointer;
            font-size: 11px;
            color: var(--content-muted);
        }
        .ask-panel-clear:hover { background: var(--code-bg); }

        .ask-messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }
        .ask-message {
            margin-bottom: 16px;
            line-height: 1.5;
        }
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
        .ask-message-assistant .markdown-body {
            max-width: 100%;
            font-size: 13px;
            line-height: 1.5;
        }
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
        .ask-message-context a {
            color: var(--link-color);
            cursor: pointer;
            text-decoration: none;
        }
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

        .ask-input-area {
            padding: 12px 16px;
            border-top: 1px solid var(--content-border);
            display: flex;
            gap: 8px;
        }
        .ask-input {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid var(--content-border);
            border-radius: 8px;
            font-size: 13px;
            background: var(--content-bg);
            color: var(--content-text);
            outline: none;
            resize: none;
            min-height: 38px;
            max-height: 120px;
            font-family: inherit;
        }
        .ask-input:focus { border-color: var(--sidebar-active-border); }
        .ask-input::placeholder { color: var(--content-muted); }
        .ask-send-btn {
            background: var(--sidebar-active-border);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            align-self: flex-end;
        }
        .ask-send-btn:hover { opacity: 0.9; }
        .ask-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }`;
    }

    return styles;
}

// ============================================================================
// JavaScript
// ============================================================================

interface ScriptOptions {
    enableSearch: boolean;
    enableAI: boolean;
    enableGraph: boolean;
    defaultTheme: WebsiteTheme;
}

function getSpaScript(opts: ScriptOptions): string {
    return `        // ====================================================================
        // Deep Wiki Server Mode
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
        document.getElementById('sidebar-toggle').addEventListener('click', function() {
            document.getElementById('sidebar').classList.toggle('hidden');
        });

        // ================================================================
        // Sidebar
        // ================================================================

        function initializeSidebar() {
            document.getElementById('project-name').textContent = moduleGraph.project.name;
            document.getElementById('project-description').textContent = moduleGraph.project.description;

            var categories = {};
            moduleGraph.modules.forEach(function(mod) {
                var cat = mod.category || 'other';
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push(mod);
            });

            var navContainer = document.getElementById('nav-container');

            var homeSection = document.createElement('div');
            homeSection.className = 'nav-section';
            homeSection.innerHTML =
                '<div class="nav-item active" data-id="__home" onclick="showHome()">' +
                '<span class="nav-item-name">Home</span></div>' +
${opts.enableGraph ? `                '<div class="nav-item" data-id="__graph" onclick="showGraph()">' +
                '<span class="nav-item-name">Dependency Graph</span></div>' +` : ''}
                '';

            navContainer.appendChild(homeSection);

            Object.keys(categories).sort().forEach(function(category) {
                var section = document.createElement('div');
                section.className = 'nav-section';
                section.innerHTML = '<h3>' + escapeHtml(category) + '</h3>';

                categories[category].forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-item';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML =
                        '<span class="nav-item-name">' + escapeHtml(mod.name) +
                        ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                        mod.complexity + '</span></span>' +
                        '<span class="nav-item-path">' + escapeHtml(mod.path) + '</span>';
                    item.onclick = function() { loadModule(mod.id); };
                    section.appendChild(item);
                });

                navContainer.appendChild(section);
            });
${opts.enableSearch ? `
            document.getElementById('search').addEventListener('input', function(e) {
                var query = e.target.value.toLowerCase();
                document.querySelectorAll('.nav-item[data-id]').forEach(function(item) {
                    var id = item.getAttribute('data-id');
                    if (id === '__home') return;
                    var text = item.textContent.toLowerCase();
                    item.style.display = text.includes(query) ? '' : 'none';
                });
                document.querySelectorAll('.nav-section').forEach(function(section) {
                    var visible = section.querySelectorAll('.nav-item[data-id]:not([style*="display: none"])');
                    var header = section.querySelector('h3');
                    if (header) header.style.display = visible.length === 0 ? 'none' : '';
                });
            });` : ''}
        }

        function setActive(id) {
            document.querySelectorAll('.nav-item').forEach(function(el) {
                el.classList.remove('active');
            });
            var target = document.querySelector('.nav-item[data-id="' + id + '"]');
            if (target) target.classList.add('active');
        }

        // ================================================================
        // Content Loading
        // ================================================================

        function restoreContentPadding() {
            var cb = document.querySelector('.content-body');
            if (cb) { cb.style.padding = '32px'; cb.style.overflow = ''; }
        }

        function showHome(skipHistory) {
            currentModuleId = null;
            setActive('__home');
            restoreContentPadding();
            document.getElementById('breadcrumb').textContent = 'Home';
            document.getElementById('content-title').textContent = 'Project Overview';
            if (!skipHistory) {
                history.pushState({ type: 'home' }, '', location.pathname);
            }

            var stats = {
                modules: moduleGraph.modules.length,
                categories: (moduleGraph.categories || []).length,
                language: moduleGraph.project.language,
                buildSystem: moduleGraph.project.buildSystem,
            };

            var html = '<div class="home-view">' +
                '<p style="font-size: 15px; color: var(--content-muted); margin-bottom: 24px;">' +
                escapeHtml(moduleGraph.project.description) + '</p>' +
                '<div class="project-stats">' +
                '<div class="stat-card"><h3>Modules</h3><div class="value">' + stats.modules + '</div></div>' +
                '<div class="stat-card"><h3>Categories</h3><div class="value">' + stats.categories + '</div></div>' +
                '<div class="stat-card"><h3>Language</h3><div class="value small">' + escapeHtml(stats.language) + '</div></div>' +
                '<div class="stat-card"><h3>Build System</h3><div class="value small">' + escapeHtml(stats.buildSystem) + '</div></div>' +
                '</div>';

            html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">All Modules</h3><div class="module-grid">';
            moduleGraph.modules.forEach(function(mod) {
                html += '<div class="module-card" onclick="loadModule(\\'' +
                    mod.id.replace(/'/g, "\\\\'") + '\\')">' +
                    '<h4>' + escapeHtml(mod.name) +
                    ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                    mod.complexity + '</span></h4>' +
                    '<p>' + escapeHtml(mod.purpose) + '</p></div>';
            });
            html += '</div></div>';

            document.getElementById('content').innerHTML = html;
        }

        async function loadModule(moduleId, skipHistory) {
            var mod = moduleGraph.modules.find(function(m) { return m.id === moduleId; });
            if (!mod) return;

            currentModuleId = moduleId;
            setActive(moduleId);
            restoreContentPadding();
            document.getElementById('breadcrumb').textContent = mod.category + ' / ' + mod.name;
            document.getElementById('content-title').textContent = mod.name;
            if (!skipHistory) {
                history.pushState({ type: 'module', id: moduleId }, '', location.pathname + '#module-' + encodeURIComponent(moduleId));
            }

            // Check cache
            if (markdownCache[moduleId]) {
                renderMarkdownContent(markdownCache[moduleId]);
                document.querySelector('.content-body').scrollTop = 0;
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
                    renderMarkdownContent(data.markdown);
                } else {
                    document.getElementById('content').innerHTML =
                        '<div class="markdown-body"><h2>' + escapeHtml(mod.name) + '</h2>' +
                        '<p>' + escapeHtml(mod.purpose) + '</p></div>';
                }
            } catch(err) {
                document.getElementById('content').innerHTML =
                    '<p style="color: red;">Error loading module: ' + err.message + '</p>';
            }
            document.querySelector('.content-body').scrollTop = 0;
        }

        async function loadSpecialPage(key, title, skipHistory) {
            currentModuleId = null;
            setActive(key);
            restoreContentPadding();
            document.getElementById('breadcrumb').textContent = title;
            document.getElementById('content-title').textContent = title;
            if (!skipHistory) {
                history.pushState({ type: 'special', key: key, title: title }, '', location.pathname + '#' + encodeURIComponent(key));
            }

            var cacheKey = '__page_' + key;
            if (markdownCache[cacheKey]) {
                renderMarkdownContent(markdownCache[cacheKey]);
                document.querySelector('.content-body').scrollTop = 0;
                return;
            }

            document.getElementById('content').innerHTML = '<div class="loading">Loading page...</div>';
            try {
                var res = await fetch('/api/pages/' + encodeURIComponent(key));
                if (!res.ok) throw new Error('Page not found');
                var data = await res.json();
                markdownCache[cacheKey] = data.markdown;
                renderMarkdownContent(data.markdown);
            } catch(err) {
                document.getElementById('content').innerHTML = '<p>Content not available.</p>';
            }
            document.querySelector('.content-body').scrollTop = 0;
        }

        // ================================================================
        // Markdown Rendering
        // ================================================================

        function renderMarkdownContent(markdown) {
            var html = marked.parse(markdown);
            var container = document.getElementById('content');
            container.innerHTML = '<div class="markdown-body">' + html + '</div>';

            var body = container.querySelector('.markdown-body');

            body.querySelectorAll('pre code').forEach(function(block) {
                if (block.classList.contains('language-mermaid')) {
                    var pre = block.parentElement;
                    pre.classList.add('mermaid');
                    pre.textContent = block.textContent;
                    pre.removeAttribute('style');
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
            if (blocks.length === 0) return;

            var isDark = currentTheme === 'dark' ||
                (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);

            mermaid.initialize({
                startOnLoad: false,
                theme: isDark ? 'dark' : 'default',
                securityLevel: 'loose',
                flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
                fontSize: 14,
            });
            mermaid.run({ nodes: blocks });
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
            document.getElementById('breadcrumb').textContent = 'Dependency Graph';
            document.getElementById('content-title').textContent = 'Dependency Graph';
            if (!skipHistory) {
                history.pushState({ type: 'graph' }, '', location.pathname + '#graph');
            }

            var contentBody = document.querySelector('.content-body');
            contentBody.style.padding = '0';
            contentBody.style.overflow = 'hidden';

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

            renderGraph();
        }

        function renderGraph() {
            if (typeof d3 === 'undefined') return;

            var container = document.getElementById('graph-container');
            if (!container) return;

            var width = container.clientWidth || 800;
            var height = container.clientHeight || 600;

            // Gather categories
            var allCategories = [];
            moduleGraph.modules.forEach(function(m) {
                if (allCategories.indexOf(m.category) === -1) allCategories.push(m.category);
            });
            allCategories.sort();

            // Build legend
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

            // Build nodes/links
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

            // Create SVG
            var svg = d3.select('#graph-container')
                .append('svg')
                .attr('width', width)
                .attr('height', height);

            // Arrow marker
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

            // Links
            var link = g.selectAll('.graph-link')
                .data(links)
                .join('line')
                .attr('class', 'graph-link')
                .attr('marker-end', 'url(#arrowhead)');

            // Nodes
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

            // Click to navigate
            node.on('click', function(event, d) {
                event.stopPropagation();
                loadModule(d.id);
            });

            // Tooltip
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
            node.on('mouseout', function() {
                tooltip.style.display = 'none';
            });

            // Force simulation
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

            // Zoom
            var zoom = d3.zoom()
                .scaleExtent([0.1, 4])
                .on('zoom', function(event) {
                    g.attr('transform', event.transform);
                });

            svg.call(zoom);

            // Toolbar buttons
            document.getElementById('graph-zoom-in').onclick = function() {
                svg.transition().call(zoom.scaleBy, 1.3);
            };
            document.getElementById('graph-zoom-out').onclick = function() {
                svg.transition().call(zoom.scaleBy, 0.7);
            };
            document.getElementById('graph-zoom-reset').onclick = function() {
                svg.transition().call(zoom.transform, d3.zoomIdentity);
            };

            // Store refs for category toggle
            window._graphNode = node;
            window._graphLink = link;
            window._graphLinks = links;

            function dragstarted(event, d) {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
            }
            function dragged(event, d) {
                d.fx = event.x;
                d.fy = event.y;
            }
            function dragended(event, d) {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
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
        // Ask AI Panel
        // ================================================================

        var conversationHistory = [];
        var askStreaming = false;

        // Panel toggle
        document.getElementById('ask-toggle').addEventListener('click', function() {
            var panel = document.getElementById('ask-panel');
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) {
                document.getElementById('ask-input').focus();
            }
        });
        document.getElementById('ask-close').addEventListener('click', function() {
            document.getElementById('ask-panel').classList.add('hidden');
        });
        document.getElementById('ask-clear').addEventListener('click', function() {
            conversationHistory = [];
            document.getElementById('ask-messages').innerHTML = '';
        });

        // Send message
        document.getElementById('ask-send').addEventListener('click', askSend);
        document.getElementById('ask-input').addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                askSend();
            }
        });

        // Auto-resize textarea
        document.getElementById('ask-input').addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        function askSend() {
            if (askStreaming) return;
            var input = document.getElementById('ask-input');
            var question = input.value.trim();
            if (!question) return;

            input.value = '';
            input.style.height = 'auto';

            // Add user message
            appendAskMessage('user', question);
            conversationHistory.push({ role: 'user', content: question });

            // Start streaming
            askStreaming = true;
            document.getElementById('ask-send').disabled = true;

            // Show typing indicator
            var typingEl = appendAskTyping();

            // SSE via fetch
            fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: question,
                    conversationHistory: conversationHistory.slice(0, -1),
                }),
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
                                if (!responseEl) {
                                    responseEl = appendAskAssistantStreaming('');
                                }
                                updateAskAssistantStreaming(responseEl, fullResponse);
                            } else if (data.type === 'done') {
                                fullResponse = data.fullResponse || fullResponse;
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
                if (typingEl && typingEl.parentNode) {
                    typingEl.parentNode.removeChild(typingEl);
                }
                appendAskError(err.message || 'Failed to connect');
                finishStreaming('', null);
            });
        }

        function finishStreaming(fullResponse, typingEl) {
            if (typingEl && typingEl.parentNode) {
                typingEl.parentNode.removeChild(typingEl);
            }
            askStreaming = false;
            document.getElementById('ask-send').disabled = false;
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
        }` : ''}`;

}

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
