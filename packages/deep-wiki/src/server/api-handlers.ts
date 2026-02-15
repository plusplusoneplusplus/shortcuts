/**
 * API Handlers
 *
 * Handles all /api/* routes for the deep-wiki server.
 * Provides REST endpoints for component graph, components, and special pages.
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
import type { WebSocketServer } from './websocket';

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
    /** WebSocket server (for broadcasting events) */
    wsServer?: WebSocketServer;
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

    // GET /api/themes (must come before /api/themes/:id to avoid catch-all)
    if (method === 'GET' && pathname === '/api/themes') {
        handleGetThemes(res, wikiData);
        return;
    }

    // GET /api/themes/:themeId/:slug
    const themeArticleMatch = pathname.match(/^\/api\/themes\/([^/]+)\/([^/]+)$/);
    if (method === 'GET' && themeArticleMatch) {
        const themeId = decodeURIComponent(themeArticleMatch[1]);
        const slug = decodeURIComponent(themeArticleMatch[2]);
        handleGetThemeArticle(res, wikiData, themeId, slug);
        return;
    }

    // GET /api/themes/:themeId
    const themeMatch = pathname.match(/^\/api\/themes\/([^/]+)$/);
    if (method === 'GET' && themeMatch) {
        const themeId = decodeURIComponent(themeMatch[1]);
        handleGetThemeById(res, wikiData, themeId);
        return;
    }

    // GET /api/components
    if (method === 'GET' && pathname === '/api/components') {
        handleGetComponents(res, wikiData);
        return;
    }

    // GET /api/components/:id
    const componentMatch = pathname.match(/^\/api\/components\/(.+)$/);
    if (method === 'GET' && componentMatch) {
        const componentId = decodeURIComponent(componentMatch[1]);
        handleGetComponentById(res, wikiData, componentId);
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
        const exploreComponentId = decodeURIComponent(exploreMatch[1]);
        handleExploreRequest(req, res, exploreComponentId, {
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
            wikiData: context.wikiData,
            wsServer: context.wsServer,
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
 * GET /api/graph — Returns the full component graph JSON.
 */
function handleGetGraph(res: http.ServerResponse, wikiData: WikiData): void {
    try {
        sendJson(res, wikiData.graph);
    } catch (error) {
        sendJson(res, { error: getErrorMessage(error) }, 500);
    }
}

/**
 * GET /api/components — Returns a list of component summaries.
 */
function handleGetComponents(res: http.ServerResponse, wikiData: WikiData): void {
    try {
        const summaries = wikiData.getComponentSummaries();
        sendJson(res, summaries);
    } catch (error) {
        sendJson(res, { error: getErrorMessage(error) }, 500);
    }
}

/**
 * GET /api/components/:id — Returns detail for a single component.
 */
function handleGetComponentById(
    res: http.ServerResponse,
    wikiData: WikiData,
    componentId: string
): void {
    try {
        const detail = wikiData.getComponentDetail(componentId);
        if (!detail) {
            send404(res, `Component not found: ${componentId}`);
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

/**
 * GET /api/themes — Returns list of all theme areas.
 */
function handleGetThemes(res: http.ServerResponse, wikiData: WikiData): void {
    try {
        const themes = wikiData.getThemeList();
        sendJson(res, themes);
    } catch (error) {
        sendJson(res, { error: getErrorMessage(error) }, 500);
    }
}

/**
 * GET /api/themes/:themeId — Returns theme area with all articles.
 */
function handleGetThemeById(
    res: http.ServerResponse,
    wikiData: WikiData,
    themeId: string
): void {
    try {
        const themes = wikiData.getThemeList();
        const meta = themes.find(t => t.id === themeId);
        if (!meta) {
            send404(res, `Theme not found: ${themeId}`);
            return;
        }
        const articles = wikiData.getThemeArticles(themeId);
        sendJson(res, { ...meta, articles: articles.map(a => ({ slug: a.slug, title: a.title, content: a.content })) });
    } catch (error) {
        sendJson(res, { error: getErrorMessage(error) }, 500);
    }
}

/**
 * GET /api/themes/:themeId/:slug — Returns a single theme article.
 */
function handleGetThemeArticle(
    res: http.ServerResponse,
    wikiData: WikiData,
    themeId: string,
    slug: string
): void {
    try {
        const detail = wikiData.getThemeArticle(themeId, slug);
        if (!detail) {
            send404(res, `Theme article not found: ${themeId}/${slug}`);
            return;
        }
        sendJson(res, { themeId, slug, content: detail.content, meta: detail.meta });
    } catch (error) {
        sendJson(res, { error: getErrorMessage(error) }, 500);
    }
}
