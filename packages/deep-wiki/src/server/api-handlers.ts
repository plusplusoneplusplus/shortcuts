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
import type { ContextBuilder } from './context-builder';
import type { AskAIFunction } from './ask-handler';
import { handleAskRequest } from './ask-handler';
import { getErrorMessage } from '../utils/error-utils';
import { handleExploreRequest } from './explore-handler';
import { handleAdminRequest } from './admin-handlers';
import type { ConversationSessionManager } from './conversation-session-manager';

// ============================================================================
// Types
// ============================================================================

export interface ApiHandlerContext {
    wikiData: WikiData;
    aiEnabled: boolean;
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

    // POST /api/ask — AI Q&A (gated by --ai flag)
    if (method === 'POST' && pathname === '/api/ask') {
        if (!context.aiEnabled) {
            send400(res, 'AI features are not enabled. Start the server with --ai flag.');
            return;
        }
        if (!context.contextBuilder || !context.aiSendMessage) {
            send400(res, 'AI service is not configured.');
            return;
        }
        handleAskRequest(req, res, {
            contextBuilder: context.contextBuilder,
            sendMessage: context.aiSendMessage,
            model: context.aiModel,
            workingDirectory: context.aiWorkingDirectory,
            sessionManager: context.sessionManager,
        }).catch(() => {
            if (!res.headersSent) {
                sendJson(res, { error: 'Internal server error' }, 500);
            }
        });
        return;
    }

    // DELETE /api/ask/session/:id — Destroy a conversation session
    const sessionDeleteMatch = pathname.match(/^\/api\/ask\/session\/(.+)$/);
    if (method === 'DELETE' && sessionDeleteMatch) {
        if (!context.sessionManager) {
            send400(res, 'Session management is not enabled.');
            return;
        }
        const sessionId = decodeURIComponent(sessionDeleteMatch[1]);
        const destroyed = context.sessionManager.destroy(sessionId);
        sendJson(res, { destroyed, sessionId });
        return;
    }

    // POST /api/explore/:id — Deep dive (gated by --ai flag)
    const exploreMatch = pathname.match(/^\/api\/explore\/(.+)$/);
    if (method === 'POST' && exploreMatch) {
        if (!context.aiEnabled) {
            send400(res, 'AI features are not enabled. Start the server with --ai flag.');
            return;
        }
        if (!context.aiSendMessage) {
            send400(res, 'AI service is not configured.');
            return;
        }
        const exploreModuleId = decodeURIComponent(exploreMatch[1]);
        handleExploreRequest(req, res, exploreModuleId, {
            wikiData: context.wikiData,
            sendMessage: context.aiSendMessage,
            model: context.aiModel,
            workingDirectory: context.aiWorkingDirectory,
        }).catch(() => {
            if (!res.headersSent) {
                sendJson(res, { error: 'Internal server error' }, 500);
            }
        });
        return;
    }

    // Admin routes: /api/admin/*
    if (pathname.startsWith('/api/admin/')) {
        const handled = handleAdminRequest(req, res, pathname, method, {
            wikiDir: wikiData.dir,
            repoPath: context.repoPath,
        });
        if (handled) {
            return;
        }
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
        sendJson(res, { error: getErrorMessage(error) }, 500);
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
        sendJson(res, { error: getErrorMessage(error) }, 500);
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
        sendJson(res, { error: getErrorMessage(error) }, 500);
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
        sendJson(res, { error: getErrorMessage(error) }, 500);
    }
}
