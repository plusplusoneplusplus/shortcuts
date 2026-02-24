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

const bundleCssPath = path.join(__dirname, 'client', 'dist', 'bundle.css');
const bundleJsPath = path.join(__dirname, 'client', 'dist', 'bundle.js');

let cachedCss: { content: string; mtime: number } | null = null;
let cachedJs: { content: string; mtime: number } | null = null;

function readBundleFile(filePath: string, cache: { content: string; mtime: number } | null): { content: string; mtime: number } {
    try {
        const stat = fs.statSync(filePath);
        const mtime = stat.mtimeMs;
        if (cache && cache.mtime === mtime) {
            return cache;
        }
        return { content: fs.readFileSync(filePath, 'utf-8'), mtime };
    } catch {
        if (cache) return cache;
        return { content: '', mtime: 0 };
    }
}

function getBundleCss(): string {
    cachedCss = readBundleFile(bundleCssPath, cachedCss);
    return cachedCss.content;
}

function getBundleJs(): string {
    cachedJs = readBundleFile(bundleJsPath, cachedJs);
    return cachedJs.content;
}

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
${getBundleCss()}
    </style>
</head>
<body>
    <div id="app-root"></div>
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
${getBundleJs()}
    </script>
</body>
</html>`;
}
