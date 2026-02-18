/**
 * HTTP Router
 *
 * Deep-wiki server router using shared Router implementation.
 * Routes requests to static file serving or API handlers.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as path from 'path';
import type { WikiData } from './wiki-data';
import { handleApiRequest } from './api-handlers';
import type { ContextBuilder } from './context-builder';
import type { AskAIFunction } from './dw-ask-handler';
import type { ConversationSessionManager } from './conversation-session-manager';
import type { WebSocketServer } from './websocket';
import { createRouter } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Router Options
// ============================================================================

/**
 * Options for the wiki router.
 */
export interface RouterOptions {
    /** Wiki data layer */
    wikiData: WikiData;
    /** SPA HTML content (served at / and for SPA fallback) */
    spaHtml: string;
    /** Whether AI features are enabled */
    aiEnabled: boolean;
    /** Repo path (needed for AI features) */
    repoPath?: string;
    /** Context builder for AI Q&A (only when AI is enabled) */
    contextBuilder?: ContextBuilder;
    /** AI SDK send function (only when AI is enabled) */
    aiSendMessage?: AskAIFunction;
    /** AI model override */
    aiModel?: string;
    /** Working directory for AI sessions */
    aiWorkingDirectory?: string;
    /** Session manager for multi-turn conversations */
    sessionManager?: ConversationSessionManager;
    /** WebSocket server (for broadcasting events) */
    wsServer?: WebSocketServer;
}

// ============================================================================
// Router Factory
// ============================================================================

/**
 * Create a request handler (listener) for the HTTP server.
 *
 * Routes:
 *   GET /            → SPA shell (modified index.html)
 *   GET /api/*       → API handlers
 *   GET /static/*    → Static files from wiki dir
 *   GET /*           → SPA fallback (for client-side routing)
 */
export function createRequestHandler(
    options: RouterOptions
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    const { wikiData, spaHtml, aiEnabled, repoPath, contextBuilder, aiSendMessage, aiModel, aiWorkingDirectory, sessionManager, wsServer } = options;

    // Build a handler that delegates to handleApiRequest
    const apiContext = {
        wikiData,
        aiEnabled,
        repoPath,
        contextBuilder,
        aiSendMessage,
        aiModel,
        aiWorkingDirectory,
        sessionManager,
        wsServer,
    };
    const apiHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
        const pathname = decodeURIComponent(req.url?.split('?')[0] || '/');
        const method = req.method?.toUpperCase() || 'GET';
        handleApiRequest(req, res, pathname, method, apiContext);
    };

    // All API requests go through handleApiRequest for every method
    const apiPattern = /^\/api\/.*/;
    const routes = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map(method => ({
        method,
        pattern: apiPattern,
        handler: apiHandler,
    }));

    // Static files from wiki directory
    const staticHandlers = [
        {
            resolve: (pathname: string) => {
                if (pathname === '/' || pathname === '/index.html') {
                    return undefined; // SPA handles root
                }
                return path.join(wikiData.dir, pathname);
            },
        },
    ];

    return createRouter({
        routes,
        spaHtml,
        staticHandlers,
    });
}

// Re-export helpers for backward compatibility
export { sendJson, send404, send400, send500, readBody } from '@plusplusoneplusplus/coc-server';
