/**
 * Website Generator
 *
 * Generates a standalone HTML website from the wiki output.
 * The generated website includes:
 *   - Embedded component graph and markdown data (no CORS issues with file://)
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
import type { WebsiteOptions, WebsiteTheme } from '../types';
import { getStyles } from './website-styles';
import { getScript } from './website-client-script';
import { escapeHtml, readComponentGraph, readMarkdownFiles, generateEmbeddedData } from './website-data';

// Re-export for backward compatibility
export { readComponentGraph, readMarkdownFiles, generateEmbeddedData, stableStringify } from './website-data';

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
 * Reads component-graph.json and all component markdown files from the wiki directory,
 * then generates index.html with embedded data for offline viewing.
 *
 * @param wikiDir - Path to the wiki output directory (contains component-graph.json and components/)
 * @param options - Website generation options
 * @returns Paths to the generated files
 */
export function generateWebsite(wikiDir: string, options?: WebsiteOptions): string[] {
    const resolvedDir = path.resolve(wikiDir);

    // Read component graph
    const componentGraph = readComponentGraph(resolvedDir);

    // Read all markdown files
    const markdownData = readMarkdownFiles(resolvedDir, componentGraph);

    // Determine effective options
    const theme = options?.theme || DEFAULT_THEME;
    const title = options?.title || componentGraph.project.name;
    const enableSearch = !options?.noSearch;

    // Generate embedded data JS
    const embeddedDataContent = generateEmbeddedData(componentGraph, markdownData);
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
            <input type="text" id="search" placeholder="Search components..." aria-label="Search components">
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
