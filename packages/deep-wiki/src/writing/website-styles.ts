/**
 * Website Styles
 *
 * CSS generation for the standalone HTML website.
 * Extracted from website-generator.ts for maintainability.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { getMermaidZoomStyles } from '../rendering/mermaid-zoom';

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate the CSS styles for the website template.
 * @returns CSS string to embed in <style> tag
 */
export function getStyles(): string {
    return `        :root {
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

        /* Sidebar */
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

        /* Area-based sidebar (DeepWiki-style hierarchy) */
        .nav-area-group { padding: 2px 0; }
        .nav-area-item {
            padding: 8px 20px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            color: var(--sidebar-text);
            display: block;
            transition: background 0.15s;
        }
        .nav-area-item:hover { background: var(--sidebar-hover); }
        .nav-area-item.active { background: var(--sidebar-hover); border-left: 3px solid var(--sidebar-active-border); }

        .nav-area-children { padding-left: 8px; }
        .nav-area-module {
            padding: 6px 20px 6px 28px;
            cursor: pointer;
            font-size: 13px;
            color: var(--sidebar-muted);
            display: block;
            transition: background 0.15s, color 0.15s;
        }
        .nav-area-module:hover { background: var(--sidebar-hover); color: var(--sidebar-text); }
        .nav-area-module.active { background: var(--sidebar-hover); color: var(--sidebar-text); border-left: 3px solid var(--sidebar-active-border); }

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

        /* Content */
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
        .breadcrumb { font-size: 13px; color: var(--content-muted); margin-bottom: 4px; }
        .content-title { font-size: 24px; color: var(--content-text); }

        .sidebar-toggle {
            background: none;
            border: 1px solid var(--content-border);
            border-radius: 6px;
            padding: 6px 10px;
            cursor: pointer;
            font-size: 18px;
            color: var(--content-muted);
        }
        .sidebar-toggle:hover { background: var(--code-bg); }

        .theme-toggle {
            background: none;
            border: 1px solid var(--content-border);
            border-radius: 6px;
            padding: 6px 10px;
            cursor: pointer;
            font-size: 18px;
            color: var(--content-muted);
        }
        .theme-toggle:hover { background: var(--code-bg); }

        .content-body {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 32px;
            background: var(--content-bg);
        }

        /* Markdown styles */
        .markdown-body { max-width: 900px; margin: 0 auto; line-height: 1.6; overflow-wrap: break-word; word-wrap: break-word; }
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
        .markdown-body li > p { margin-bottom: 6px; }
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

        /* Heading anchors */
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

        /* Copy button for code blocks */
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

        /* Home view */
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

        /* Topic items in sidebar */
        .nav-topic-group { padding: 2px 0; }
        .nav-topic-header {
            padding: 8px 20px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--sidebar-muted);
            font-weight: 600;
        }
        .nav-topic-item {
            padding: 8px 20px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            color: var(--sidebar-text);
            display: block;
            transition: background 0.15s;
        }
        .nav-topic-item:hover { background: var(--sidebar-hover); }
        .nav-topic-item.active { background: var(--sidebar-hover); border-left: 3px solid var(--sidebar-active-border); }
        .nav-topic-children { padding-left: 8px; }
        .nav-topic-article {
            padding: 6px 20px 6px 28px;
            cursor: pointer;
            font-size: 13px;
            color: var(--sidebar-muted);
            display: block;
            transition: background 0.15s, color 0.15s;
        }
        .nav-topic-article:hover { background: var(--sidebar-hover); color: var(--sidebar-text); }
        .nav-topic-article.active { background: var(--sidebar-hover); color: var(--sidebar-text); border-left: 3px solid var(--sidebar-active-border); }

        /* Topic page layout */
        .topic-wide .markdown-body { max-width: 1200px; }

${getMermaidZoomStyles()}

        /* Responsive */
        @media (max-width: 768px) {
            .sidebar { position: fixed; z-index: 100; height: 100vh; }
            .sidebar.hidden { margin-left: -280px; }
            .content-header { padding: 12px 16px; }
            .content-body { padding: 16px; }
            .markdown-body .mermaid-container {
                max-width: 100%;
                width: 100%;
            }
        }`;
}
