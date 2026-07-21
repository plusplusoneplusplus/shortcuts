/**
 * Dashboard SPA route: `/` and `/index.html`.
 *
 * The container has NO SPA of its own — it reuses CoC's dashboard bundle by
 * importing CoC's compiled `generateDashboardHtml` from its dist, forcing
 * `containerMode: true` and the container-appropriate feature flags.
 */

import * as path from 'path';
import type { RouteTable } from '../http-util';

/** Load CoC's compiled dashboard HTML template from its dist. */
function getCocHtmlTemplate(): { generateDashboardHtml: (opts?: Record<string, unknown>) => string } {
    const cocPkg = require.resolve('@plusplusoneplusplus/coc/package.json');
    const templatePath = path.join(path.dirname(cocPkg), 'dist', 'server', 'spa', 'html-template.js');
    return require(templatePath);
}

let cachedHtml: string | null = null;

/** Generate (and cache) the container's dashboard HTML from CoC's template. */
export function generateContainerHtml(): string {
    if (cachedHtml) return cachedHtml;
    const { generateDashboardHtml } = getCocHtmlTemplate();
    cachedHtml = generateDashboardHtml({
        title: 'CoCContainer',
        containerMode: true,
        // CoC embeds runtime feature flags through the generic `features` map
        // (window.__DASHBOARD_CONFIG__.features), which the SPA flattens onto
        // its config. Container doesn't run terminal/notes/wiki locally — agents
        // provide those — but the Pull Requests tab must stay enabled.
        features: {
            terminalEnabled: false,
            notesEnabled: false,
            workflowsEnabled: false,
            pullRequestsEnabled: true,
        },
    });
    return cachedHtml;
}

export function installSpaRoutes(table: RouteTable): void {
    table.when((_method, url) => url.pathname === '/' || url.pathname === '/index.html', ({ res }) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(generateContainerHtml());
    });
}
