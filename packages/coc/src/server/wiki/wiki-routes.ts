/**
 * Wiki Routes
 *
 * Registers all wiki API endpoints under /api/wikis/* using the CoC Route[] pattern.
 * Each route uses a RegExp pattern with wikiId in match[1].
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { Route } from '../types';
import type { WikiServerOptions } from '../types';
import { WikiManager } from './wiki-manager';
import type { AskAIFunction } from './types';
import { sendJson, send404, send500 } from '../router';
import { handleWikiAskRequest } from './ask-handler';
import { handleWikiExploreRequest } from './explore-handler';
import { handleGetSeeds, handlePutSeeds, handleGetConfig, handlePutConfig } from './admin-handlers';
import {
    handleStartGenerate,
    handleCancelGenerate,
    handleGetGenerateStatus,
    handleComponentRegenerate,
} from './generate-handler';

// ============================================================================
// Types
// ============================================================================

export interface WikiRouteOptions {
    /** Initial wiki registrations (wikiId → { wikiDir, repoPath? }). */
    wikis?: Record<string, { wikiDir: string; repoPath?: string }>;
    /** Enable AI features for wikis. */
    aiEnabled?: boolean;
    /** AI send function shared across wikis. */
    aiSendMessage?: AskAIFunction;
    /** AI model override. */
    aiModel?: string;
    /** AI working directory override. */
    aiWorkingDirectory?: string;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register all wiki routes on the given route table.
 * Returns the WikiManager instance for external access.
 */
export function registerWikiRoutes(
    routes: Route[],
    options: WikiRouteOptions,
): WikiManager {
    const wikiManager = new WikiManager({
        aiSendMessage: options.aiSendMessage,
    });

    // Register initial wikis
    if (options.wikis) {
        for (const [wikiId, config] of Object.entries(options.wikis)) {
            try {
                wikiManager.register({
                    wikiId,
                    wikiDir: config.wikiDir,
                    repoPath: config.repoPath,
                    aiEnabled: options.aiEnabled ?? false,
                });
            } catch {
                // Skip invalid wikis at startup — they can be re-registered later
            }
        }
    }

    const askOptions = {
        wikiManager,
        aiSendMessage: options.aiSendMessage,
        aiModel: options.aiModel,
        aiWorkingDirectory: options.aiWorkingDirectory,
    };
    const exploreOptions = {
        wikiManager,
        aiSendMessage: options.aiSendMessage,
        aiModel: options.aiModel,
        aiWorkingDirectory: options.aiWorkingDirectory,
    };

    // ========================================================================
    // Wiki CRUD endpoints (manage the registry — not per-wiki scoped)
    // ========================================================================

    // GET /api/wikis — List all registered wikis
    routes.push({
        method: 'GET',
        pattern: '/api/wikis',
        handler: async (_req, res) => {
            const ids = wikiManager.getRegisteredIds();
            const wikis = ids.map(id => {
                const runtime = wikiManager.get(id)!;
                return {
                    id,
                    wikiDir: runtime.registration.wikiDir,
                    repoPath: runtime.registration.repoPath,
                    aiEnabled: runtime.registration.aiEnabled,
                    title: runtime.registration.title,
                };
            });
            sendJson(res, wikis);
        },
    });

    // POST /api/wikis — Register a new wiki
    routes.push({
        method: 'POST',
        pattern: '/api/wikis',
        handler: async (req, res) => {
            try {
                const { readJsonBody } = await import('../router');
                const body = await readJsonBody<{ id: string; wikiDir: string; repoPath?: string; aiEnabled?: boolean; title?: string }>(req);
                if (!body.id || !body.wikiDir) {
                    sendJson(res, { error: 'Missing required fields: id, wikiDir' }, 400);
                    return;
                }
                wikiManager.register({
                    wikiId: body.id,
                    wikiDir: body.wikiDir,
                    repoPath: body.repoPath,
                    aiEnabled: body.aiEnabled ?? options.aiEnabled ?? false,
                    title: body.title,
                });
                sendJson(res, { success: true, id: body.id }, 201);
            } catch (err) {
                sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
            }
        },
    });

    // GET /api/wikis/:wikiId — Get wiki metadata
    routes.push({
        method: 'GET',
        pattern: /^\/api\/wikis\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const runtime = wikiManager.get(wikiId);
            if (!runtime) {
                send404(res, `Wiki not found: ${wikiId}`);
                return;
            }
            sendJson(res, {
                id: wikiId,
                wikiDir: runtime.registration.wikiDir,
                repoPath: runtime.registration.repoPath,
                aiEnabled: runtime.registration.aiEnabled,
                title: runtime.registration.title,
                componentCount: runtime.wikiData.graph.components.length,
            });
        },
    });

    // DELETE /api/wikis/:wikiId — Remove a wiki
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/wikis\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const removed = wikiManager.unregister(wikiId);
            if (!removed) {
                send404(res, `Wiki not found: ${wikiId}`);
                return;
            }
            sendJson(res, { success: true, id: wikiId });
        },
    });

    // PATCH /api/wikis/:wikiId — Update wiki metadata
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/wikis\/([^/]+)$/,
        handler: async (req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const runtime = wikiManager.get(wikiId);
            if (!runtime) {
                send404(res, `Wiki not found: ${wikiId}`);
                return;
            }
            try {
                const { readJsonBody } = await import('../router');
                const body = await readJsonBody<{ title?: string; aiEnabled?: boolean }>(req);
                // Re-register with updated fields
                const reg = { ...runtime.registration };
                if (body.title !== undefined) reg.title = body.title;
                if (body.aiEnabled !== undefined) reg.aiEnabled = body.aiEnabled;
                wikiManager.register(reg);
                sendJson(res, { success: true, id: wikiId });
            } catch (err) {
                sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
            }
        },
    });

    // ========================================================================
    // Data endpoints (per-wiki)
    // ========================================================================

    // GET /api/wikis/:wikiId/graph
    routes.push({
        method: 'GET',
        pattern: /^\/api\/wikis\/([^/]+)\/graph$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const wiki = wikiManager.get(wikiId);
            if (!wiki) { send404(res, `Wiki not found: ${wikiId}`); return; }
            try { sendJson(res, wiki.wikiData.graph); }
            catch (err) { send500(res, err instanceof Error ? err.message : String(err)); }
        },
    });

    // GET /api/wikis/:wikiId/themes
    routes.push({
        method: 'GET',
        pattern: /^\/api\/wikis\/([^/]+)\/themes$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const wiki = wikiManager.get(wikiId);
            if (!wiki) { send404(res, `Wiki not found: ${wikiId}`); return; }
            try { sendJson(res, wiki.wikiData.getThemeList()); }
            catch (err) { send500(res, err instanceof Error ? err.message : String(err)); }
        },
    });

    // GET /api/wikis/:wikiId/themes/:themeId/:slug
    routes.push({
        method: 'GET',
        pattern: /^\/api\/wikis\/([^/]+)\/themes\/([^/]+)\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const themeId = decodeURIComponent(match![2]);
            const slug = decodeURIComponent(match![3]);
            const wiki = wikiManager.get(wikiId);
            if (!wiki) { send404(res, `Wiki not found: ${wikiId}`); return; }
            try {
                const detail = wiki.wikiData.getThemeArticle(themeId, slug);
                if (!detail) { send404(res, `Theme article not found: ${themeId}/${slug}`); return; }
                sendJson(res, { themeId, slug, content: detail.content, meta: detail.meta });
            } catch (err) { send500(res, err instanceof Error ? err.message : String(err)); }
        },
    });

    // GET /api/wikis/:wikiId/themes/:themeId
    routes.push({
        method: 'GET',
        pattern: /^\/api\/wikis\/([^/]+)\/themes\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const themeId = decodeURIComponent(match![2]);
            const wiki = wikiManager.get(wikiId);
            if (!wiki) { send404(res, `Wiki not found: ${wikiId}`); return; }
            try {
                const themes = wiki.wikiData.getThemeList();
                const meta = themes.find((t: any) => t.id === themeId);
                if (!meta) { send404(res, `Theme not found: ${themeId}`); return; }
                const articles = wiki.wikiData.getThemeArticles(themeId);
                sendJson(res, { ...meta, articles: articles.map((a: any) => ({ slug: a.slug, title: a.title, content: a.content })) });
            } catch (err) { send500(res, err instanceof Error ? err.message : String(err)); }
        },
    });

    // GET /api/wikis/:wikiId/components
    routes.push({
        method: 'GET',
        pattern: /^\/api\/wikis\/([^/]+)\/components$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const wiki = wikiManager.get(wikiId);
            if (!wiki) { send404(res, `Wiki not found: ${wikiId}`); return; }
            try { sendJson(res, wiki.wikiData.getComponentSummaries()); }
            catch (err) { send500(res, err instanceof Error ? err.message : String(err)); }
        },
    });

    // GET /api/wikis/:wikiId/components/:id
    routes.push({
        method: 'GET',
        pattern: /^\/api\/wikis\/([^/]+)\/components\/(.+)$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const componentId = decodeURIComponent(match![2]);
            const wiki = wikiManager.get(wikiId);
            if (!wiki) { send404(res, `Wiki not found: ${wikiId}`); return; }
            try {
                const detail = wiki.wikiData.getComponentDetail(componentId);
                if (!detail) { send404(res, `Component not found: ${componentId}`); return; }
                sendJson(res, detail);
            } catch (err) { send500(res, err instanceof Error ? err.message : String(err)); }
        },
    });

    // GET /api/wikis/:wikiId/pages/:key
    routes.push({
        method: 'GET',
        pattern: /^\/api\/wikis\/([^/]+)\/pages\/(.+)$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const key = decodeURIComponent(match![2]);
            const wiki = wikiManager.get(wikiId);
            if (!wiki) { send404(res, `Wiki not found: ${wikiId}`); return; }
            try {
                const page = wiki.wikiData.getSpecialPage(key);
                if (!page) { send404(res, `Page not found: ${key}`); return; }
                sendJson(res, page);
            } catch (err) { send500(res, err instanceof Error ? err.message : String(err)); }
        },
    });

    // ========================================================================
    // AI endpoints (ask, explore)
    // ========================================================================

    // POST /api/wikis/:wikiId/ask
    routes.push({
        method: 'POST',
        pattern: /^\/api\/wikis\/([^/]+)\/ask$/,
        handler: async (req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            await handleWikiAskRequest(req, res, wikiId, askOptions);
        },
    });

    // DELETE /api/wikis/:wikiId/ask/session/:sessionId
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/wikis\/([^/]+)\/ask\/session\/(.+)$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const sessionId = decodeURIComponent(match![2]);
            const wiki = wikiManager.get(wikiId);
            if (!wiki) { send404(res, `Wiki not found: ${wikiId}`); return; }
            if (!wiki.sessionManager) {
                sendJson(res, { error: 'Session management is not enabled for this wiki' }, 400);
                return;
            }
            const destroyed = wiki.sessionManager.destroy(sessionId);
            sendJson(res, { destroyed, sessionId });
        },
    });

    // POST /api/wikis/:wikiId/explore/:componentId
    routes.push({
        method: 'POST',
        pattern: /^\/api\/wikis\/([^/]+)\/explore\/(.+)$/,
        handler: async (req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const componentId = decodeURIComponent(match![2]);
            await handleWikiExploreRequest(req, res, wikiId, componentId, exploreOptions);
        },
    });

    // ========================================================================
    // Admin endpoints (seeds, config, generate)
    // ========================================================================

    // GET /api/wikis/:wikiId/admin/seeds
    routes.push({
        method: 'GET',
        pattern: /^\/api\/wikis\/([^/]+)\/admin\/seeds$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            handleGetSeeds(res, wikiId, wikiManager);
        },
    });

    // PUT /api/wikis/:wikiId/admin/seeds
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/wikis\/([^/]+)\/admin\/seeds$/,
        handler: async (req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            await handlePutSeeds(req, res, wikiId, wikiManager);
        },
    });

    // GET /api/wikis/:wikiId/admin/config
    routes.push({
        method: 'GET',
        pattern: /^\/api\/wikis\/([^/]+)\/admin\/config$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            handleGetConfig(res, wikiId, wikiManager);
        },
    });

    // PUT /api/wikis/:wikiId/admin/config
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/wikis\/([^/]+)\/admin\/config$/,
        handler: async (req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            await handlePutConfig(req, res, wikiId, wikiManager);
        },
    });

    // POST /api/wikis/:wikiId/admin/generate
    routes.push({
        method: 'POST',
        pattern: /^\/api\/wikis\/([^/]+)\/admin\/generate$/,
        handler: async (req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            await handleStartGenerate(req, res, wikiId, wikiManager);
        },
    });

    // POST /api/wikis/:wikiId/admin/generate/cancel
    routes.push({
        method: 'POST',
        pattern: /^\/api\/wikis\/([^/]+)\/admin\/generate\/cancel$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            handleCancelGenerate(res, wikiId);
        },
    });

    // GET /api/wikis/:wikiId/admin/generate/status
    routes.push({
        method: 'GET',
        pattern: /^\/api\/wikis\/([^/]+)\/admin\/generate\/status$/,
        handler: async (_req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            handleGetGenerateStatus(res, wikiId, wikiManager);
        },
    });

    // POST /api/wikis/:wikiId/admin/generate/component/:componentId
    routes.push({
        method: 'POST',
        pattern: /^\/api\/wikis\/([^/]+)\/admin\/generate\/component\/(.+)$/,
        handler: async (req, res, match) => {
            const wikiId = decodeURIComponent(match![1]);
            const componentId = decodeURIComponent(match![2]);
            await handleComponentRegenerate(req, res, wikiId, componentId, wikiManager);
        },
    });

    return wikiManager;
}
