/**
 * REST endpoints for the global browser-control "Always allow" site list.
 */

import { parseBody, sendJSON } from '../core/api-handler';
import { badRequest, handleAPIError, invalidJSON, notFound } from '../errors';
import type { Route } from '../types';
import { addBrowserApprovedSite, readBrowserApprovedSites, removeBrowserApprovedSite } from '../llm-tools/browser-navigation-approval';
import { validateBrowserApprovalUrl } from '../shared/browser-approval-site';
import type { BrowserApprovedSiteAddResponse } from '@plusplusoneplusplus/coc-client';
import type { AdminRouteOptions } from './admin-route-types';

export function registerBrowserRoutes(routes: Route[], options: AdminRouteOptions): void {
    const { dataDir } = options;

    // GET /api/admin/browser-approved-sites — List always-allowed sites
    routes.push({
        method: 'GET',
        pattern: '/api/admin/browser-approved-sites',
        handler: async (_req, res) => {
            sendJSON(res, 200, { sites: dataDir ? readBrowserApprovedSites(dataDir) : [] });
        },
    });

    routes.push({
        method: 'POST',
        pattern: '/api/admin/browser-approved-sites',
        handler: async (req, res) => {
            if (!dataDir) return handleAPIError(res, badRequest('dataDir not configured'));
            let body: unknown;
            try { body = await parseBody(req); }
            catch { return handleAPIError(res, invalidJSON()); }
            const result = validateBrowserApprovalUrl((body as { url?: unknown } | null)?.url);
            if (result.site === undefined) return handleAPIError(res, badRequest(result.error));
            const site = result.site;
            try {
                const added = !readBrowserApprovedSites(dataDir).includes(site);
                addBrowserApprovedSite(dataDir, site);
                const response: BrowserApprovedSiteAddResponse = { site, added, sites: readBrowserApprovedSites(dataDir) };
                sendJSON(res, 200, response);
            } catch (err) {
                return handleAPIError(res, err);
            }
        },
    });

    // DELETE /api/admin/browser-approved-sites/:site — Remove one always-allowed site
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/admin\/browser-approved-sites\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const site = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            if (!site) return handleAPIError(res, badRequest('Missing site'));
            if (!dataDir) return handleAPIError(res, badRequest('dataDir not configured'));
            let removed: boolean;
            try {
                removed = removeBrowserApprovedSite(dataDir, site);
            } catch (err) {
                return handleAPIError(res, err);
            }
            if (!removed) return handleAPIError(res, notFound(`site '${site}'`));
            sendJSON(res, 200, { site: site.trim().toLowerCase(), removed: true, sites: readBrowserApprovedSites(dataDir) });
        },
    });
}
