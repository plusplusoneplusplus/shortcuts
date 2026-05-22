/**
 * MCP OAuth REST API Handler
 *
 * Routes:
 *   GET    /api/mcp-oauth/pending          List pending OAuth requests
 *   GET    /api/mcp-oauth/pending/:id      Fetch a specific pending request
 *   POST   /api/mcp-oauth/pending/:id/resolve  Mark a request as completed/failed
 *   DELETE /api/mcp-oauth/pending/:id      Remove a pending request
 *   POST   /api/mcp-oauth/start            Start a new OAuth flow for an MCP server
 *
 * Filtering is supported via the `?status=`, `?workspaceId=`, and
 * `?processId=` query parameters on the list endpoint.
 */

import type * as http from 'http';
import { sendJson, sendError } from '../shared/router';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import type { McpOauthManager } from './mcp-oauth-manager';
import type { PendingMcpOAuth, PendingMcpOAuthStatus } from './mcp-oauth-types';
import {
    type ProcessStore,
    type ProcessOutputEvent,
    type ISDKService,
    type MCPServerConfig,
    loadDefaultMcpConfig,
    loadWorkspaceMcpConfig,
} from '@plusplusoneplusplus/forge';
import { initiateMcpOAuth, type McpOauthSdkService } from './mcp-oauth-initiator';
import { readMcpServerAuthInfo } from './mcp-oauth-token-cache';

export interface McpOauthRouteContext {
    manager: McpOauthManager;
    /** Process store — needed for emitting SSE events on completion. */
    store?: ProcessStore;
    /** Follow-up executor — needed for auto-retry after OAuth completes. */
    executeFollowUp?: (processId: string, message: string) => Promise<void>;
    /**
     * SDK service — required by the `POST /api/mcp-oauth/start` route which
     * spawns a transient session and calls `mcp.oauth.login`. When omitted
     * the route is not registered.
     */
    aiService?: ISDKService;
    /** Resolve a workspace id to its root path. Required alongside `aiService`. */
    resolveWorkspaceRoot?: (workspaceId: string) => Promise<string | undefined>;
}

function serialize(entry: PendingMcpOAuth): Record<string, unknown> {
    return {
        id: entry.id,
        serverName: entry.serverName,
        serverUrl: entry.serverUrl,
        authorizationUrl: entry.authorizationUrl,
        processId: entry.processId,
        workspaceId: entry.workspaceId,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        error: entry.error,
    };
}

function getQueryParam(req: http.IncomingMessage, key: string): string | undefined {
    if (!req.url) return undefined;
    const qIdx = req.url.indexOf('?');
    if (qIdx < 0) return undefined;
    const search = new URLSearchParams(req.url.slice(qIdx + 1));
    const value = search.get(key);
    return value !== null ? value : undefined;
}

const PENDING_LIST = /^\/api\/mcp-oauth\/pending\/?$/;
const PENDING_ITEM = /^\/api\/mcp-oauth\/pending\/([^/]+)$/;
const PENDING_RESOLVE = /^\/api\/mcp-oauth\/pending\/([^/]+)\/resolve$/;
const PENDING_COMPLETE_AND_RETRY = /^\/api\/mcp-oauth\/pending\/([^/]+)\/complete-and-retry$/;
const START_FLOW = /^\/api\/mcp-oauth\/start\/?$/;

/**
 * Find a server's config by name. Returns the workspace-scoped definition
 * when present (matching the effective merge order used elsewhere) and falls
 * back to the global config.
 */
function findServerConfig(serverName: string, workspaceRoot: string | undefined): MCPServerConfig | undefined {
    if (workspaceRoot) {
        const workspace = loadWorkspaceMcpConfig(workspaceRoot);
        if (workspace.mcpServers[serverName]) return workspace.mcpServers[serverName];
    }
    const global = loadDefaultMcpConfig();
    return global.mcpServers[serverName];
}

function supportsMcpOauthStart(service: ISDKService): service is McpOauthSdkService {
    return typeof (service as { createClient?: unknown }).createClient === 'function';
}

export function registerMcpOauthRoutes(routes: Route[], ctx: McpOauthRouteContext): void {
    const { manager } = ctx;

    // List
    routes.push({
        method: 'GET',
        pattern: PENDING_LIST,
        handler: (req: http.IncomingMessage, res: http.ServerResponse) => {
            const status = getQueryParam(req, 'status') as PendingMcpOAuthStatus | undefined;
            const workspaceId = getQueryParam(req, 'workspaceId');
            const processId = getQueryParam(req, 'processId');
            const items = manager.listPending({ status, workspaceId, processId }).map(serialize);
            sendJson(res, { items });
        },
    });

    // Get
    routes.push({
        method: 'GET',
        pattern: PENDING_ITEM,
        handler: (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const id = decodeURIComponent(match![1]);
            const entry = manager.getPending(id);
            if (!entry) {
                sendError(res, 404, 'Pending OAuth request not found');
                return;
            }
            sendJson(res, serialize(entry));
        },
    });

    // Resolve
    routes.push({
        method: 'POST',
        pattern: PENDING_RESOLVE,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const id = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const status = (body as Record<string, unknown>).status;
            if (status !== 'completed' && status !== 'failed') {
                sendError(res, 400, "Body must include status: 'completed' | 'failed'");
                return;
            }
            const rawError = (body as Record<string, unknown>).error;
            const error = typeof rawError === 'string' ? rawError : undefined;
            const entry = manager.resolve(id, status, error);
            if (!entry) {
                sendError(res, 404, 'Pending OAuth request not found');
                return;
            }
            sendJson(res, serialize(entry));
        },
    });

    // Delete
    routes.push({
        method: 'DELETE',
        pattern: PENDING_ITEM,
        handler: (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const id = decodeURIComponent(match![1]);
            const removed = manager.remove(id);
            if (!removed) {
                sendError(res, 404, 'Pending OAuth request not found');
                return;
            }
            sendJson(res, { removed: true, id });
        },
    });

    // Start a new OAuth flow on demand (not tied to a chat session).
    //
    // Body: { workspaceId?: string, serverName: string }
    //
    // The flow:
    //   1. Look up the server's config (workspace-scoped, falls back to global).
    //   2. If it's not HTTP/SSE, return 400 — only remote servers do OAuth.
    //   3. If a valid cached token already exists, return { alreadyAuthenticated: true }.
    //   4. Otherwise spawn a transient SDK session and call mcp.oauth.login.
    //   5. Return the authorization URL so the dashboard can open it.
    const oauthAiService = ctx.aiService && supportsMcpOauthStart(ctx.aiService) ? ctx.aiService : undefined;
    if (oauthAiService) {
        routes.push({
            method: 'POST',
            pattern: START_FLOW,
            handler: async (req: http.IncomingMessage, res: http.ServerResponse) => {
                const body = await parseBodyOrReject(req, res);
                if (body === null) return;
                const params = body as Record<string, unknown>;
                const serverName = typeof params.serverName === 'string' ? params.serverName : undefined;
                const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : undefined;
                if (!serverName) {
                    sendError(res, 400, 'Body must include `serverName: string`');
                    return;
                }

                let workspaceRoot: string | undefined;
                if (workspaceId && ctx.resolveWorkspaceRoot) {
                    try {
                        workspaceRoot = await ctx.resolveWorkspaceRoot(workspaceId);
                    } catch {
                        workspaceRoot = undefined;
                    }
                }

                const serverConfig = findServerConfig(serverName, workspaceRoot);
                if (!serverConfig) {
                    sendError(res, 404, `MCP server "${serverName}" not found in config`);
                    return;
                }

                const transport = serverConfig.type ?? 'stdio';
                if (transport !== 'http' && transport !== 'sse') {
                    sendError(res, 400, `MCP server "${serverName}" is ${transport}; only HTTP/SSE servers use OAuth`);
                    return;
                }

                const serverUrl = 'url' in serverConfig ? serverConfig.url : undefined;
                if (!serverUrl) {
                    sendError(res, 400, `MCP server "${serverName}" has no URL configured`);
                    return;
                }

                // Short-circuit: if we already have a valid token, no flow needed.
                const cached = readMcpServerAuthInfo(serverUrl, transport);
                if (cached.status === 'authenticated') {
                    sendJson(res, { requestId: '', alreadyAuthenticated: true, authStatus: cached.status });
                    return;
                }

                try {
                    const result = await initiateMcpOAuth({
                        serverName,
                        serverConfig,
                        workspaceId,
                        workingDirectory: workspaceRoot,
                        aiService: oauthAiService,
                        manager,
                    });
                    sendJson(res, {
                        requestId: result.requestId,
                        authorizationUrl: result.authorizationUrl,
                        alreadyAuthenticated: result.alreadyAuthenticated,
                    });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    sendError(res, 500, msg);
                }
            },
        });
    }

    // Complete and Retry — marks OAuth as completed, emits SSE, and retries the original message
    routes.push({
        method: 'POST',
        pattern: PENDING_COMPLETE_AND_RETRY,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const id = decodeURIComponent(match![1]);
            const entry = manager.resolve(id, 'completed');
            if (!entry) {
                sendError(res, 404, 'Pending OAuth request not found');
                return;
            }

            // Emit mcp-oauth-completed SSE event to the process
            if (ctx.store && entry.processId) {
                try {
                    ctx.store.emitProcessEvent(entry.processId, {
                        type: 'mcp-oauth-completed',
                        mcpOAuth: {
                            requestId: entry.id,
                            serverName: entry.serverName,
                            serverUrl: entry.serverUrl,
                            authorizationUrl: entry.authorizationUrl,
                        },
                    } as ProcessOutputEvent);
                } catch {
                    // Non-fatal
                }
            }

            // Auto-retry: re-send the original message as a follow-up
            let retryEnqueued = false;
            if (ctx.executeFollowUp && entry.processId && entry.originalMessage) {
                try {
                    await ctx.executeFollowUp(entry.processId, entry.originalMessage);
                    retryEnqueued = true;
                } catch {
                    // Non-fatal: retry failed, user can manually re-send
                }
            }

            sendJson(res, { ...serialize(entry), retryEnqueued });
        },
    });
}
