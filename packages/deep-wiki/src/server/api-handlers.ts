/**
 * API Handlers
 *
 * Handles all /api/* routes for the deep-wiki server.
 * Provides REST endpoints for module graph, modules, and special pages.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import type { WikiData } from './wiki-data';
import { sendJson, send404, send400 } from './router';

// ============================================================================
// Types
// ============================================================================

export interface ApiHandlerContext {
    wikiData: WikiData;
    aiEnabled: boolean;
    repoPath?: string;
}

// ============================================================================
// Main API Router
// ============================================================================

/**
 * Route an API request to the appropriate handler.
 */
export function handleApiRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    method: string,
    context: ApiHandlerContext
): void {
    const { wikiData } = context;

    // GET /api/graph
    if (method === 'GET' && pathname === '/api/graph') {
        handleGetGraph(res, wikiData);
        return;
    }

    // GET /api/modules
    if (method === 'GET' && pathname === '/api/modules') {
        handleGetModules(res, wikiData);
        return;
    }

    // GET /api/modules/:id
    const moduleMatch = pathname.match(/^\/api\/modules\/(.+)$/);
    if (method === 'GET' && moduleMatch) {
        const moduleId = decodeURIComponent(moduleMatch[1]);
        handleGetModuleById(res, wikiData, moduleId);
        return;
    }

    // GET /api/pages/:key
    const pageMatch = pathname.match(/^\/api\/pages\/(.+)$/);
    if (method === 'GET' && pageMatch) {
        const key = decodeURIComponent(pageMatch[1]);
        handleGetPage(res, wikiData, key);
        return;
    }

    // POST /api/ask — AI Q&A (Phase C, gated by --ai flag)
    if (method === 'POST' && pathname === '/api/ask') {
        if (!context.aiEnabled) {
            send400(res, 'AI features are not enabled. Start the server with --ai flag.');
            return;
        }
        // Placeholder for Phase C
        send400(res, 'AI Q&A is not yet implemented. Coming in Phase C.');
        return;
    }

    // POST /api/explore/:id — Deep dive (Phase D, gated by --ai flag)
    const exploreMatch = pathname.match(/^\/api\/explore\/(.+)$/);
    if (method === 'POST' && exploreMatch) {
        if (!context.aiEnabled) {
            send400(res, 'AI features are not enabled. Start the server with --ai flag.');
            return;
        }
        // Placeholder for Phase D
        send400(res, 'Deep dive is not yet implemented. Coming in Phase D.');
        return;
    }

    // 404 for unknown API routes
    send404(res, `Unknown API endpoint: ${method} ${pathname}`);
}

// ============================================================================
// Handler Implementations
// ============================================================================

/**
 * GET /api/graph — Returns the full module graph JSON.
 */
function handleGetGraph(res: http.ServerResponse, wikiData: WikiData): void {
    try {
        sendJson(res, wikiData.graph);
    } catch (error) {
        sendJson(res, { error: (error as Error).message }, 500);
    }
}

/**
 * GET /api/modules — Returns a list of module summaries.
 */
function handleGetModules(res: http.ServerResponse, wikiData: WikiData): void {
    try {
        const summaries = wikiData.getModuleSummaries();
        sendJson(res, summaries);
    } catch (error) {
        sendJson(res, { error: (error as Error).message }, 500);
    }
}

/**
 * GET /api/modules/:id — Returns detail for a single module.
 */
function handleGetModuleById(
    res: http.ServerResponse,
    wikiData: WikiData,
    moduleId: string
): void {
    try {
        const detail = wikiData.getModuleDetail(moduleId);
        if (!detail) {
            send404(res, `Module not found: ${moduleId}`);
            return;
        }
        sendJson(res, detail);
    } catch (error) {
        sendJson(res, { error: (error as Error).message }, 500);
    }
}

/**
 * GET /api/pages/:key — Returns a special page.
 */
function handleGetPage(
    res: http.ServerResponse,
    wikiData: WikiData,
    key: string
): void {
    try {
        const page = wikiData.getSpecialPage(key);
        if (!page) {
            send404(res, `Page not found: ${key}`);
            return;
        }
        sendJson(res, page);
    } catch (error) {
        sendJson(res, { error: (error as Error).message }, 500);
    }
}
