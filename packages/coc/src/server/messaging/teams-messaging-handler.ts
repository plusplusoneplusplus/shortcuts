/**
 * Registers HTTP routes for the Teams messaging integration:
 *   GET  /api/messaging/teams/status   — current connection status
 *   POST /api/messaging/teams/server   — configure global MCP endpoint
 *   POST /api/messaging/teams/config   — update config (botName, teamName, channelName, enabled)
 *   POST /api/messaging/teams/reconnect — (re)connect the bot
 *
 * Also wires the {@link TeamsCommandRouter} as the inbound message handler,
 * enabling Teams users to send commands (list agents, select repo, chat, etc.).
 *
 * These routes power the normal CoC Teams connection card.
 */

import { sendJSON, sendError } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { McpOauthManager } from '../mcp-oauth/mcp-oauth-manager';
import { TeamsMessagingManager } from './teams-messaging-manager';
import { TeamsCommandRouter } from './teams-command-router';
import { TeamsOAuthFlow } from './teams-oauth-flow';

export interface TeamsMessagingRoutesOptions {
    dataDir: string;
    getObservabilityEnabled?: () => boolean;
    /** ProcessStore for querying workspaces and processes. */
    store?: ProcessStore;
    /** Enqueue a new chat task. Returns the task ID. */
    enqueueChat?: (workspaceId: string, message: string) => Promise<string>;
    /** Send a follow-up message to an existing process. */
    executeFollowUp?: (processId: string, message: string) => Promise<void>;
    /** Existing manager, shared with the server lifecycle. */
    manager?: TeamsMessagingManager;
    oauthAvailable?: boolean;
    oauthManager?: McpOauthManager;
}

export function registerTeamsMessagingRoutes(
    routes: Route[],
    opts: TeamsMessagingRoutesOptions,
): TeamsMessagingManager {
    const manager = opts.manager ?? new TeamsMessagingManager(opts.dataDir, { getObservabilityEnabled: opts.getObservabilityEnabled });
    const oauthFlow = opts.oauthManager ? new TeamsOAuthFlow(opts.oauthManager) : null;
    if (oauthFlow) manager.setOAuthFlow(oauthFlow);

    // Wire the command router if store + queue deps are provided
    if (opts.store && opts.enqueueChat && opts.executeFollowUp) {
        const router = new TeamsCommandRouter({
            store: opts.store,
            enqueueChat: opts.enqueueChat,
            executeFollowUp: opts.executeFollowUp,
            sendReply: async (text, replyToId) => {
                manager.recordEvent('reply-attempt');
                try {
                    await manager.sendMessage(text, replyToId);
                } catch (err) {
                    console.error('[teams-messaging] Failed to send reply:', err);
                }
            },
            dataDir: opts.dataDir,
        });

        manager.setMessageHandler(async (msg, observe) => {
            await router.handle(msg, observe);
        });
    }

    routes.push({
        method: 'GET',
        pattern: /^\/api\/messaging\/teams\/status$/,
        handler: (_req, res) => {
            sendJSON(res, 200, { ...manager.getStatus(), oauthAvailable: opts.oauthAvailable ?? false, teamsOAuthAvailable: !!oauthFlow });
        },
    });

    if (oauthFlow) {
        routes.push({
            method: 'POST',
            pattern: /^\/api\/messaging\/teams\/auth\/start$/,
            handler: async (_req, res) => {
                const serverUrl = manager.getStatus().serverUrl;
                if (!serverUrl) {
                    sendError(res, 400, 'Configure a global HTTP Microsoft Teams MCP server before authenticating');
                    return;
                }
                try {
                    sendJSON(res, 200, await oauthFlow.start(serverUrl));
                } catch (err) {
                    sendError(res, 500, err instanceof Error ? err.message : String(err));
                }
            },
        });
    }

    routes.push({
        method: 'POST',
        pattern: /^\/api\/messaging\/teams\/server$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (!body) return;
            if (typeof body.url !== 'string' || !body.url.trim()) {
                sendError(res, 400, 'Provide a Teams MCP server URL');
                return;
            }
            try {
                await manager.configureServer(body.url.trim());
                sendJSON(res, 200, manager.getStatus());
            } catch (err) {
                sendError(res, err instanceof TypeError || err instanceof RangeError ? 400 : 500, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/messaging\/teams\/config$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (!body) return;

            const patch: Record<string, unknown> = {};
            if (typeof body.botName === 'string') patch.botName = body.botName;
            if (typeof body.teamName === 'string') patch.teamName = body.teamName;
            if (typeof body.channelName === 'string') patch.channelName = body.channelName;
            if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;

            try {
                if (Object.keys(patch).length === 0) {
                    sendError(res, 400, 'Provide a Teams configuration field');
                    return;
                }
                await manager.updateConfig(patch);
                sendJSON(res, 200, manager.getStatus());
            } catch (err) {
                sendError(res, 500, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/messaging\/teams\/reconnect$/,
        handler: async (_req, res) => {
            try {
                await manager.connect();
                sendJSON(res, 200, { ok: true, status: manager.getStatus() });
            } catch (err: any) {
                sendError(res, 500, err.message ?? 'Failed to connect');
            }
        },
    });

    return manager;
}
