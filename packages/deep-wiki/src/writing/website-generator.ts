/**
 * Website Generator
 *
 * Generates a standalone HTML website from the wiki output.
 * The generated website includes:
 *   - Embedded module graph and markdown data (no CORS issues with file://)
 *   - Syntax highlighting via highlight.js CDN
 *   - Mermaid diagram rendering via mermaid.js CDN
 *   - Markdown rendering via marked.js CDN
 *   - Responsive sidebar navigation with search
 *   - Dark/light/auto theme support
 *   - Copy buttons for code blocks
 *   - Anchor links for headings
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ModuleGraph, WebsiteOptions, WebsiteTheme } from '../types';

// ============================================================================
// Constants
// ============================================================================

/** Default theme when not specified */
const DEFAULT_THEME: WebsiteTheme = 'auto';

/** Filename for the generated website */
const INDEX_HTML_FILENAME = 'index.html';

/** Filename for embedded data */
const EMBEDDED_DATA_FILENAME = 'embedded-data.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate a standalone HTML website from wiki output.
 *
 * Reads module-graph.json and all module markdown files from the wiki directory,
 * then generates index.html with embedded data for offline viewing.
 *
 * @param wikiDir - Path to the wiki output directory (contains module-graph.json and modules/)
 * @param options - Website generation options
 * @returns Paths to the generated files
 */
export function generateWebsite(wikiDir: string, options?: WebsiteOptions): string[] {
    const resolvedDir = path.resolve(wikiDir);

    // Read module graph
    const moduleGraph = readModuleGraph(resolvedDir);

    // Read all markdown files
    const markdownData = readMarkdownFiles(resolvedDir, moduleGraph);

    // Determine effective options
    const theme = options?.theme || DEFAULT_THEME;
    const title = options?.title || moduleGraph.project.name;
    const enableSearch = !options?.noSearch;

    // Generate embedded data JS
    const embeddedDataContent = generateEmbeddedData(moduleGraph, markdownData);
    const embeddedDataPath = path.join(resolvedDir, EMBEDDED_DATA_FILENAME);
    fs.writeFileSync(embeddedDataPath, embeddedDataContent, 'utf-8');

    // Generate HTML
    let htmlContent: string;
    if (options?.customTemplate) {
        const templatePath = path.resolve(options.customTemplate);
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Custom template not found: ${templatePath}`);
        }
        htmlContent = fs.readFileSync(templatePath, 'utf-8');
    } else {
        htmlContent = generateHtmlTemplate({ theme, title, enableSearch });
    }

    const htmlPath = path.join(resolvedDir, INDEX_HTML_FILENAME);
    fs.writeFileSync(htmlPath, htmlContent, 'utf-8');

    return [htmlPath, embeddedDataPath];
}

// ============================================================================
// Module Graph Reader
// ============================================================================

/**
 * Read module-graph.json from the wiki directory.
 * @param wikiDir - Resolved wiki directory path
 * @returns Parsed module graph
 */
export function readModuleGraph(wikiDir: string): ModuleGraph {
    const graphPath = path.join(wikiDir, 'module-graph.json');
    if (!fs.existsSync(graphPath)) {
        throw new Error(`module-graph.json not found in ${wikiDir}`);
    }

    const content = fs.readFileSync(graphPath, 'utf-8');
    return JSON.parse(content) as ModuleGraph;
}

// ============================================================================
// Markdown Reader
// ============================================================================

/**
 * Read all markdown files for modules from the wiki directory.
 *
 * Supports both flat and hierarchical layouts:
 *   - Flat: modules/{slug}.md
 *   - Hierarchical: areas/{areaId}/modules/{slug}.md
 *
 * Also reads top-level markdown files (index.md, architecture.md, getting-started.md)
 * and area-level index/architecture files.
 *
 * @param wikiDir - Resolved wiki directory path
 * @param moduleGraph - The module graph (for module ID mapping)
 * @returns Map of module ID to markdown content
 */
export function readMarkdownFiles(
    wikiDir: string,
    moduleGraph: ModuleGraph
): Record<string, string> {
    const data: Record<string, string> = {};

    // Read top-level markdown files
    const topLevelFiles = ['index.md', 'architecture.md', 'getting-started.md'];
    for (const file of topLevelFiles) {
        const filePath = path.join(wikiDir, file);
        if (fs.existsSync(filePath)) {
            const key = path.basename(file, '.md');
            data[`__${key}`] = fs.readFileSync(filePath, 'utf-8');
        }
    }

    // Read flat-layout module files
    const modulesDir = path.join(wikiDir, 'modules');
    if (fs.existsSync(modulesDir) && fs.statSync(modulesDir).isDirectory()) {
        const files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
            const slug = path.basename(file, '.md');
            const moduleId = findModuleIdBySlug(slug, moduleGraph);
            const key = moduleId || slug;
            data[key] = fs.readFileSync(path.join(modulesDir, file), 'utf-8');
        }
    }

    // Read hierarchical-layout area files
    const areasDir = path.join(wikiDir, 'areas');
    if (fs.existsSync(areasDir) && fs.statSync(areasDir).isDirectory()) {
        const areaDirs = fs.readdirSync(areasDir).filter(d =>
            fs.statSync(path.join(areasDir, d)).isDirectory()
        );

        for (const areaId of areaDirs) {
            const areaDir = path.join(areasDir, areaId);

            // Area-level files
            for (const file of ['index.md', 'architecture.md']) {
                const filePath = path.join(areaDir, file);
                if (fs.existsSync(filePath)) {
                    const key = path.basename(file, '.md');
                    data[`__area_${areaId}_${key}`] = fs.readFileSync(filePath, 'utf-8');
                }
            }

            // Area module files
            const areaModulesDir = path.join(areaDir, 'modules');
            if (fs.existsSync(areaModulesDir) && fs.statSync(areaModulesDir).isDirectory()) {
                const files = fs.readdirSync(areaModulesDir).filter(f => f.endsWith('.md'));
                for (const file of files) {
                    const slug = path.basename(file, '.md');
                    const moduleId = findModuleIdBySlug(slug, moduleGraph);
                    const key = moduleId || slug;
                    data[key] = fs.readFileSync(path.join(areaModulesDir, file), 'utf-8');
                }
            }
        }
    }

    return data;
}

// ============================================================================
// Data Embedding
// ============================================================================

/**
 * Generate the embedded-data.js content.
 *
 * Produces a JavaScript file that defines two global constants:
 *   - MODULE_GRAPH: The module graph JSON
 *   - MARKDOWN_DATA: Map of module ID to markdown content
 *
 * Uses JSON.stringify with sorted keys for deterministic output.
 *
 * @param moduleGraph - The module graph
 * @param markdownData - Map of module ID to markdown content
 * @returns JavaScript source code
 */
export function generateEmbeddedData(
    moduleGraph: ModuleGraph,
    markdownData: Record<string, string>
): string {
    // Sort keys for deterministic output
    const sortedGraph = stableStringify(moduleGraph);
    const sortedMarkdown = stableStringify(markdownData);

    return `// Auto-generated by deep-wiki. Do not edit manually.\nconst MODULE_GRAPH = ${sortedGraph};\nconst MARKDOWN_DATA = ${sortedMarkdown};\n`;
}

// ============================================================================
// HTML Template Generator
// ============================================================================

interface TemplateOptions {
    theme: WebsiteTheme;
    title: string;
    enableSearch: boolean;
}

/**
 * Generate the index.html content from the built-in template.
 *
 * @param options - Template options
 * @returns Complete HTML content
 */
export function generateHtmlTemplate(options: TemplateOptions): string {
    const { theme, title, enableSearch } = options;

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

    <style>
${getStyles()}
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

    <div class="content">
        <div class="content-header">
            <div class="header-left">
                <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">&#9776;</button>
                <div>
                    <div class="breadcrumb" id="breadcrumb">Home</div>
                    <h2 class="content-title" id="content-title">Project Overview</h2>
                </div>
            </div>
            <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">&#9790;</button>
        </div>
        <div class="content-body">
            <div id="content" class="markdown-body"></div>
        </div>
    </div>

    <script src="embedded-data.js"></script>
    <script>
${getScript(enableSearch, theme)}
    </script>
</body>
</html>`;
}

// ============================================================================
// Styles
// ============================================================================

function getStyles(): string {
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

        /* Mermaid diagrams */
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
        /* Mermaid container with zoom/pan support */
        .markdown-body .mermaid-container {
            position: relative;
            margin: 24px 0;
            border: 1px solid var(--content-border);
            border-radius: 8px;
            overflow: hidden;
            background: var(--code-bg);
        }
        .mermaid-toolbar {
            display: flex;
            align-items: center;
            padding: 6px 12px;
            background: var(--code-bg);
            border-bottom: 1px solid var(--content-border);
            gap: 4px;
            user-select: none;
        }
        .mermaid-toolbar-label {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--content-muted);
            margin-right: auto;
        }
        .mermaid-zoom-btn {
            background: var(--copy-btn-bg);
            border: 1px solid var(--content-border);
            cursor: pointer;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.2;
            transition: background-color 0.15s, border-color 0.15s;
            color: var(--content-text);
            min-width: 28px;
            text-align: center;
        }
        .mermaid-zoom-btn:hover {
            background: var(--copy-btn-hover-bg);
            border-color: var(--sidebar-active-border);
        }
        .mermaid-zoom-btn:active {
            transform: scale(0.95);
        }
        .mermaid-zoom-level {
            font-size: 11px;
            font-weight: 500;
            color: var(--content-muted);
            min-width: 42px;
            text-align: center;
            padding: 0 4px;
        }
        .mermaid-zoom-reset {
            font-size: 12px;
        }
        .mermaid-viewport {
            overflow: hidden;
            cursor: grab;
            min-height: 200px;
            position: relative;
        }
        .mermaid-viewport:active {
            cursor: grabbing;
        }
        .mermaid-viewport.mermaid-dragging {
            cursor: grabbing;
        }
        .mermaid-svg-wrapper {
            transform-origin: 0 0;
            transition: transform 0.15s ease-out;
            display: inline-block;
            padding: 24px;
        }
        .mermaid-viewport.mermaid-dragging .mermaid-svg-wrapper {
            transition: none;
        }
        /* Allow mermaid containers to use full available width */
        .markdown-body .mermaid-container {
            max-width: 100%;
            width: 100%;
        }

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

// ============================================================================
// JavaScript
// ============================================================================

function getScript(enableSearch: boolean, defaultTheme: WebsiteTheme): string {
    return `        // ====================================================================
        // Deep Wiki Viewer
        // ====================================================================

        let moduleGraph = null;
        let currentModuleId = null;
        let currentTheme = '${defaultTheme}';
        let mermaidInitialized = false;

        // Initialize
        try {
            moduleGraph = MODULE_GRAPH;
            initTheme();
            initializeSidebar();
            showHome(true);
            // Use replaceState for initial load to avoid extra history entry
            history.replaceState({ type: 'home' }, '', location.pathname);
        } catch(err) {
            document.getElementById('content').innerHTML =
                '<p style="color: red;">Error loading module graph: ' + err.message + '</p>';
        }

        // ================================================================
        // Browser History (Back/Forward)
        // ================================================================

        window.addEventListener('popstate', function(e) {
            var state = e.state;
            if (!state) {
                showHome(true);
                return;
            }
            if (state.type === 'home') {
                showHome(true);
            } else if (state.type === 'module' && state.id) {
                loadModule(state.id, true);
            } else if (state.type === 'special' && state.key && state.title) {
                loadSpecialPage(state.key, state.title, true);
            } else {
                showHome(true);
            }
        });

        // ================================================================
        // Theme
        // ================================================================

        function initTheme() {
            const saved = localStorage.getItem('deep-wiki-theme');
            if (saved) {
                currentTheme = saved;
                document.documentElement.setAttribute('data-theme', currentTheme);
            }
            updateThemeStyles();
        }

        function toggleTheme() {
            if (currentTheme === 'auto') {
                currentTheme = 'dark';
            } else if (currentTheme === 'dark') {
                currentTheme = 'light';
            } else {
                currentTheme = 'auto';
            }
            document.documentElement.setAttribute('data-theme', currentTheme);
            localStorage.setItem('deep-wiki-theme', currentTheme);
            updateThemeStyles();
            // Re-render current content to apply new highlight theme
            if (currentModuleId) {
                loadModule(currentModuleId);
            }
        }

        function updateThemeStyles() {
            const isDark = currentTheme === 'dark' ||
                (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
            const lightSheet = document.getElementById('hljs-light');
            const darkSheet = document.getElementById('hljs-dark');
            if (lightSheet) lightSheet.disabled = isDark;
            if (darkSheet) darkSheet.disabled = !isDark;

            const btn = document.getElementById('theme-toggle');
            if (btn) btn.textContent = isDark ? '\\u2600' : '\\u263E';
        }

        // Listen for system theme changes
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

            var navContainer = document.getElementById('nav-container');
            var hasAreas = moduleGraph.areas && moduleGraph.areas.length > 0;

            // Home link
            var homeSection = document.createElement('div');
            homeSection.className = 'nav-section';
            homeSection.innerHTML =
                '<div class="nav-item active" data-id="__home" onclick="showHome()">' +
                '<span class="nav-item-name">Home</span></div>';

            // Overview pages
            if (typeof MARKDOWN_DATA !== 'undefined') {
                if (MARKDOWN_DATA['__index']) {
                    homeSection.innerHTML +=
                        '<div class="nav-item" data-id="__index" onclick="loadSpecialPage(\\'__index\\', \\'Index\\')">' +
                        '<span class="nav-item-name">Index</span></div>';
                }
                if (MARKDOWN_DATA['__architecture']) {
                    homeSection.innerHTML +=
                        '<div class="nav-item" data-id="__architecture" onclick="loadSpecialPage(\\'__architecture\\', \\'Architecture\\')">' +
                        '<span class="nav-item-name">Architecture</span></div>';
                }
                if (MARKDOWN_DATA['__getting-started']) {
                    homeSection.innerHTML +=
                        '<div class="nav-item" data-id="__getting-started" onclick="loadSpecialPage(\\'__getting-started\\', \\'Getting Started\\')">' +
                        '<span class="nav-item-name">Getting Started</span></div>';
                }
            }
            navContainer.appendChild(homeSection);

            if (hasAreas) {
                // DeepWiki-style: areas as top-level, modules indented underneath
                buildAreaSidebar(navContainer);
            } else {
                // Fallback: category-based grouping
                buildCategorySidebar(navContainer);
            }
${enableSearch ? `
            // Search
            document.getElementById('search').addEventListener('input', function(e) {
                var query = e.target.value.toLowerCase();
                document.querySelectorAll('.nav-area-module[data-id], .nav-item[data-id]').forEach(function(item) {
                    var id = item.getAttribute('data-id');
                    if (id === '__home' || id === '__index' || id === '__architecture' || id === '__getting-started') {
                        return;
                    }
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
                // Show/hide category section headers
                document.querySelectorAll('.nav-section').forEach(function(section) {
                    var visibleItems = section.querySelectorAll('.nav-item[data-id]:not([style*="display: none"])');
                    var header = section.querySelector('h3');
                    if (header) {
                        header.style.display = visibleItems.length === 0 ? 'none' : '';
                    }
                });
            });` : ''}
        }

        // Build area-based sidebar (DeepWiki-style hierarchy)
        function buildAreaSidebar(navContainer) {
            var areaModules = {};
            moduleGraph.areas.forEach(function(area) {
                areaModules[area.id] = [];
            });

            moduleGraph.modules.forEach(function(mod) {
                var areaId = mod.area;
                if (areaId && areaModules[areaId]) {
                    areaModules[areaId].push(mod);
                } else {
                    var found = false;
                    moduleGraph.areas.forEach(function(area) {
                        if (area.modules && area.modules.indexOf(mod.id) !== -1) {
                            areaModules[area.id].push(mod);
                            found = true;
                        }
                    });
                    if (!found) {
                        if (!areaModules['__other']) areaModules['__other'] = [];
                        areaModules['__other'].push(mod);
                    }
                }
            });

            moduleGraph.areas.forEach(function(area) {
                var modules = areaModules[area.id] || [];
                if (modules.length === 0) return;

                var group = document.createElement('div');
                group.className = 'nav-area-group';

                var areaItem = document.createElement('div');
                areaItem.className = 'nav-area-item';
                areaItem.setAttribute('data-area-id', area.id);
                areaItem.innerHTML = escapeHtml(area.name);
                group.appendChild(areaItem);

                var childrenEl = document.createElement('div');
                childrenEl.className = 'nav-area-children';

                modules.forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-area-module';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML = escapeHtml(mod.name);
                    item.onclick = function() { loadModule(mod.id); };
                    childrenEl.appendChild(item);
                });

                group.appendChild(childrenEl);
                navContainer.appendChild(group);
            });

            var otherModules = areaModules['__other'] || [];
            if (otherModules.length > 0) {
                var group = document.createElement('div');
                group.className = 'nav-area-group';
                var areaItem = document.createElement('div');
                areaItem.className = 'nav-area-item';
                areaItem.innerHTML = 'Other';
                group.appendChild(areaItem);

                var childrenEl = document.createElement('div');
                childrenEl.className = 'nav-area-children';
                otherModules.forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-area-module';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML = escapeHtml(mod.name);
                    item.onclick = function() { loadModule(mod.id); };
                    childrenEl.appendChild(item);
                });
                group.appendChild(childrenEl);
                navContainer.appendChild(group);
            }
        }

        // Build category-based sidebar (fallback)
        function buildCategorySidebar(navContainer) {
            var categories = {};
            moduleGraph.modules.forEach(function(mod) {
                var cat = mod.category || 'other';
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push(mod);
            });

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
        }

        function setActive(id) {
            document.querySelectorAll('.nav-item, .nav-area-module, .nav-area-item').forEach(function(el) {
                el.classList.remove('active');
            });
            var target = document.querySelector('.nav-item[data-id="' + id + '"]') ||
                         document.querySelector('.nav-area-module[data-id="' + id + '"]');
            if (target) target.classList.add('active');
        }

        // ================================================================
        // Content
        // ================================================================

        function showHome(skipHistory) {
            currentModuleId = null;
            setActive('__home');
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

            if (moduleGraph.project.entryPoints && moduleGraph.project.entryPoints.length > 0) {
                html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">Entry Points</h3><ul>';
                moduleGraph.project.entryPoints.forEach(function(ep) {
                    html += '<li><code>' + escapeHtml(ep) + '</code></li>';
                });
                html += '</ul>';
            }

            var hasAreas = moduleGraph.areas && moduleGraph.areas.length > 0;
            if (hasAreas) {
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
                html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">All Modules</h3>' +
                    '<div class="module-grid">';
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
        }

        function loadModule(moduleId, skipHistory) {
            var mod = moduleGraph.modules.find(function(m) { return m.id === moduleId; });
            if (!mod) return;

            currentModuleId = moduleId;
            setActive(moduleId);

            document.getElementById('breadcrumb').textContent = mod.category + ' / ' + mod.name;
            document.getElementById('content-title').textContent = mod.name;
            if (!skipHistory) {
                history.pushState({ type: 'module', id: moduleId }, '', location.pathname + '#module-' + encodeURIComponent(moduleId));
            }

            var markdown = (typeof MARKDOWN_DATA !== 'undefined') ? MARKDOWN_DATA[moduleId] : null;
            if (markdown) {
                renderMarkdownContent(markdown);
            } else {
                document.getElementById('content').innerHTML =
                    '<div class="markdown-body">' +
                    '<h2>' + escapeHtml(mod.name) + '</h2>' +
                    '<p><strong>Purpose:</strong> ' + escapeHtml(mod.purpose) + '</p>' +
                    '<p><strong>Path:</strong> <code>' + escapeHtml(mod.path) + '</code></p>' +
                    '<p><strong>Complexity:</strong> ' + mod.complexity + '</p>' +
                    '<h3>Key Files</h3><ul>' +
                    mod.keyFiles.map(function(f) { return '<li><code>' + escapeHtml(f) + '</code></li>'; }).join('') +
                    '</ul>' +
                    '<h3>Dependencies</h3><ul>' +
                    mod.dependencies.map(function(d) { return '<li>' + escapeHtml(d) + '</li>'; }).join('') +
                    '</ul></div>';
            }
            // Scroll content to top
            document.querySelector('.content-body').scrollTop = 0;
        }

        function loadSpecialPage(key, title, skipHistory) {
            currentModuleId = null;
            setActive(key);
            document.getElementById('breadcrumb').textContent = title;
            document.getElementById('content-title').textContent = title;
            if (!skipHistory) {
                history.pushState({ type: 'special', key: key, title: title }, '', location.pathname + '#' + encodeURIComponent(key));
            }

            var markdown = MARKDOWN_DATA[key];
            if (markdown) {
                renderMarkdownContent(markdown);
            } else {
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

            // Syntax highlighting
            body.querySelectorAll('pre code').forEach(function(block) {
                // Check for mermaid
                if (block.classList.contains('language-mermaid')) {
                    var pre = block.parentElement;
                    pre.classList.add('mermaid');
                    pre.textContent = block.textContent;
                    pre.removeAttribute('style');
                    // Build zoom/pan container
                    var container = document.createElement('div');
                    container.className = 'mermaid-container';
                    container.innerHTML =
                        '<div class="mermaid-toolbar">' +
                        '<span class="mermaid-toolbar-label">Diagram</span>' +
                        '<button class="mermaid-zoom-btn mermaid-zoom-out" title="Zoom out">\\u2212</button>' +
                        '<span class="mermaid-zoom-level">100%</span>' +
                        '<button class="mermaid-zoom-btn mermaid-zoom-in" title="Zoom in">+</button>' +
                        '<button class="mermaid-zoom-btn mermaid-zoom-reset" title="Reset view">\\u27F2</button>' +
                        '</div>' +
                        '<div class="mermaid-viewport">' +
                        '<div class="mermaid-svg-wrapper"></div>' +
                        '</div>';
                    pre.parentNode.insertBefore(container, pre);
                    container.querySelector('.mermaid-svg-wrapper').appendChild(pre);
                } else {
                    hljs.highlightElement(block);
                    addCopyButton(block.parentElement);
                }
            });

            // Add anchor links to headings
            body.querySelectorAll('h1, h2, h3, h4').forEach(function(heading) {
                var id = heading.textContent.toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
                heading.id = id;
                var anchor = document.createElement('a');
                anchor.className = 'heading-anchor';
                anchor.href = '#' + id;
                anchor.textContent = '#';
                anchor.setAttribute('aria-label', 'Link to ' + heading.textContent);
                heading.appendChild(anchor);
            });

            // Render mermaid then attach zoom controls
            initMermaid().then(function() { initMermaidZoom(); });

            // Intercept internal .md links
            container.addEventListener('click', function(e) {
                var target = e.target;
                while (target && target !== container) {
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
                var slug = href.replace(/^(\\.\\/|\\.\\.\\/)*/, '').replace(/^modules\\//, '').replace(/\\.md$/, '');

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
            btn.setAttribute('aria-label', 'Copy code');
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
            var mermaidBlocks = document.querySelectorAll('.mermaid');
            if (mermaidBlocks.length === 0) return Promise.resolve();

            var isDark = currentTheme === 'dark' ||
                (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);

            mermaid.initialize({
                startOnLoad: false,
                theme: isDark ? 'dark' : 'default',
                securityLevel: 'loose',
                flowchart: {
                    useMaxWidth: false,
                    htmlLabels: true,
                    curve: 'basis',
                    padding: 15,
                    nodeSpacing: 50,
                    rankSpacing: 50,
                },
                fontSize: 14,
            });
            return mermaid.run({ nodes: mermaidBlocks });
        }

        // ================================================================
        // Mermaid Zoom & Pan
        // ================================================================

        var MERMAID_MIN_ZOOM = 0.25;
        var MERMAID_MAX_ZOOM = 4;
        var MERMAID_ZOOM_STEP = 0.25;

        function initMermaidZoom() {
            document.querySelectorAll('.mermaid-container').forEach(function(container) {
                var viewport = container.querySelector('.mermaid-viewport');
                var svgWrapper = container.querySelector('.mermaid-svg-wrapper');
                if (!viewport || !svgWrapper) return;

                var state = { scale: 1, translateX: 0, translateY: 0, isDragging: false, dragStartX: 0, dragStartY: 0, lastTX: 0, lastTY: 0 };

                function applyTransform() {
                    svgWrapper.style.transform = 'translate(' + state.translateX + 'px, ' + state.translateY + 'px) scale(' + state.scale + ')';
                    var display = container.querySelector('.mermaid-zoom-level');
                    if (display) display.textContent = Math.round(state.scale * 100) + '%';
                }

                // Zoom in
                var zoomInBtn = container.querySelector('.mermaid-zoom-in');
                if (zoomInBtn) {
                    zoomInBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        state.scale = Math.min(MERMAID_MAX_ZOOM, state.scale + MERMAID_ZOOM_STEP);
                        applyTransform();
                    });
                }

                // Zoom out
                var zoomOutBtn = container.querySelector('.mermaid-zoom-out');
                if (zoomOutBtn) {
                    zoomOutBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        state.scale = Math.max(MERMAID_MIN_ZOOM, state.scale - MERMAID_ZOOM_STEP);
                        applyTransform();
                    });
                }

                // Reset
                var resetBtn = container.querySelector('.mermaid-zoom-reset');
                if (resetBtn) {
                    resetBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        state.scale = 1;
                        state.translateX = 0;
                        state.translateY = 0;
                        applyTransform();
                    });
                }

                // Ctrl/Cmd + mouse wheel zoom toward cursor
                viewport.addEventListener('wheel', function(e) {
                    if (!e.ctrlKey && !e.metaKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    var delta = e.deltaY > 0 ? -MERMAID_ZOOM_STEP : MERMAID_ZOOM_STEP;
                    var newScale = Math.max(MERMAID_MIN_ZOOM, Math.min(MERMAID_MAX_ZOOM, state.scale + delta));
                    if (newScale !== state.scale) {
                        var rect = viewport.getBoundingClientRect();
                        var mx = e.clientX - rect.left;
                        var my = e.clientY - rect.top;
                        var px = (mx - state.translateX) / state.scale;
                        var py = (my - state.translateY) / state.scale;
                        state.scale = newScale;
                        state.translateX = mx - px * state.scale;
                        state.translateY = my - py * state.scale;
                        applyTransform();
                    }
                }, { passive: false });

                // Mouse drag panning
                viewport.addEventListener('mousedown', function(e) {
                    if (e.button !== 0) return;
                    state.isDragging = true;
                    state.dragStartX = e.clientX;
                    state.dragStartY = e.clientY;
                    state.lastTX = state.translateX;
                    state.lastTY = state.translateY;
                    viewport.classList.add('mermaid-dragging');
                    e.preventDefault();
                });

                document.addEventListener('mousemove', function(e) {
                    if (!state.isDragging) return;
                    state.translateX = state.lastTX + (e.clientX - state.dragStartX);
                    state.translateY = state.lastTY + (e.clientY - state.dragStartY);
                    applyTransform();
                });

                document.addEventListener('mouseup', function() {
                    if (!state.isDragging) return;
                    state.isDragging = false;
                    viewport.classList.remove('mermaid-dragging');
                });
            });
        }

        // ================================================================
        // Utility
        // ================================================================

        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }`;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find a module ID by its slug.
 * Matches by normalizing the module ID to a slug.
 */
function findModuleIdBySlug(slug: string, moduleGraph: ModuleGraph): string | null {
    const normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    for (const mod of moduleGraph.modules) {
        const modSlug = mod.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (modSlug === normalized) {
            return mod.id;
        }
    }
    return null;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * JSON.stringify with sorted keys for deterministic output.
 */
export function stableStringify(value: unknown): string {
    return JSON.stringify(value, sortedReplacer, 2);
}

/**
 * JSON replacer that sorts object keys.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            sorted[k] = (value as Record<string, unknown>)[k];
        }
        return sorted;
    }
    return value;
}
