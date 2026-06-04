/**
 * SPA HTML Template
 *
 * Main HTML generator for the CoC (Copilot Of Copilot) dashboard.
 * Returns a complete <!DOCTYPE html> string with inlined <style> and <script>.
 * No external CDN dependencies — everything is inline.
 *
 * Mirrors packages/deep-wiki/src/server/spa/html-template.ts pattern.
 */

import * as crypto from 'crypto';
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

let cachedETag: { hash: string; cssMtime: number; jsMtime: number; configRevision: number } | null = null;

/**
 * Nonce unique to this server process.  Included in the ETag so that every
 * server restart invalidates the browser's cached SPA HTML.  This prevents
 * stale inline bundles from being served via 304 when the bundle files were
 * rebuilt between restarts.
 */
const processNonce = crypto.randomBytes(4).toString('hex');

/**
 * Compute a short SHA-256 ETag from the bundle CSS + JS content plus a
 * per-process nonce and optional config revision.  The nonce ensures that
 * a server restart always invalidates the browser cache; the config
 * revision ensures that admin config changes invalidate cached SPA HTML
 * containing stale feature flags.
 * Cached alongside mtime + revision — only rehashed when files or revision change.
 */
export function getBundleETag(configRevision?: number): string {
    const css = (cachedCss = readBundleFile(bundleCssPath, cachedCss));
    const js = (cachedJs = readBundleFile(bundleJsPath, cachedJs));
    const rev = configRevision ?? 0;
    if (cachedETag && cachedETag.cssMtime === css.mtime && cachedETag.jsMtime === js.mtime && cachedETag.configRevision === rev) {
        return cachedETag.hash;
    }
    const hash = crypto.createHash('sha256').update(css.content).update(js.content).update(processNonce).update(String(rev)).digest('hex').slice(0, 16);
    const etag = `"${hash}"`;
    cachedETag = { hash: etag, cssMtime: css.mtime, jsMtime: js.mtime, configRevision: rev };
    return etag;
}

export function generateDashboardHtml(options: DashboardOptions = {}): string {
    const {
        hostname,
        title = hostname ? `CoC @ ${hostname}` : 'CoC (Copilot Of Copilot)',
        theme = 'auto',
        wsPath = '/ws',
        apiBasePath = '/api',
        enableWiki = false,
        terminalEnabled = true,
        notesEnabled,
        myWorkEnabled,
        myLifeEnabled,
        scratchpadEnabled,
        scratchpadLayout,
        workflowsEnabled,
        pullRequestsEnabled,
        pullRequestsSuggestionsEnabled,
        serversEnabled,
        ralphEnabled,
        vimNavigationEnabled,
        containerMode,
        loopsEnabled,
        excalidrawEnabled,
        mcpOauthEnabled,
        focusedDiffEnabled,
        sessionContextAttachmentsEnabled,
        workItemsHierarchyEnabled,
        workItemsSyncEnabled,
        workItemsAiAuthoringEnabled,
        reviewFilePath,
        projectDir,
        bindAddress,
    } = options;

    const themeAttr = theme === 'auto' ? '' : ` data-theme="${theme === 'dark' ? 'dark' : 'light'}"`;

    return `<!DOCTYPE html>
<html lang="en"${themeAttr}>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <link rel="icon" type="image/svg+xml" href="/icon.svg">
    <!-- highlight.js 11.9.0 — syntax highlighting (review editor + wiki) -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" id="hljs-light">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" id="hljs-dark" disabled>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/powershell.min.js"><\/script>${enableWiki ? `
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
            wsPath: '${escapeHtml(wsPath)}',
            version: '${escapeHtml(getBundleETag())}'${hostname ? `,
            hostname: '${escapeHtml(hostname)}'` : ''},
            terminalEnabled: ${!!terminalEnabled},
            notesEnabled: ${!!notesEnabled},
            myWorkEnabled: ${!!myWorkEnabled},
            myLifeEnabled: ${!!myLifeEnabled},
            scratchpadEnabled: ${!!scratchpadEnabled},
            scratchpadLayout: '${scratchpadLayout || 'horizontal'}',
            workflowsEnabled: ${!!workflowsEnabled},
            pullRequestsEnabled: ${!!pullRequestsEnabled},
            pullRequestsSuggestionsEnabled: ${!!pullRequestsSuggestionsEnabled},
            serversEnabled: ${!!serversEnabled},
            ralphEnabled: ${!!ralphEnabled},
            vimNavigationEnabled: ${!!vimNavigationEnabled},
            containerMode: ${!!containerMode},
            loopsEnabled: ${!!loopsEnabled},
            excalidrawEnabled: ${!!excalidrawEnabled},
            mcpOauthEnabled: ${!!mcpOauthEnabled},
            focusedDiffEnabled: ${!!focusedDiffEnabled},
            sessionContextAttachmentsEnabled: ${!!sessionContextAttachmentsEnabled}${bindAddress ? `,
            bindAddress: '${escapeHtml(bindAddress)}'` : ''},
            workItemsHierarchyEnabled: ${!!workItemsHierarchyEnabled},
            workItemsSyncEnabled: ${!!workItemsSyncEnabled},
            workItemsAiAuthoringEnabled: ${!!workItemsAiAuthoringEnabled}
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
