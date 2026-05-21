/**
 * Teams Messaging REST Handler
 *
 * Registers HTTP routes for the Teams messaging integration:
 *   GET  /container/messaging/teams/status   — current connection status
 *   POST /container/messaging/teams/config   — update config (botName, teamName, channelName, enabled)
 *   POST /container/messaging/teams/reconnect — (re)connect the bot
 *
 * These routes power the TeamsSettingsCard in the admin dashboard (IMSettingsSection.tsx).
 */

import { sendJSON, sendError } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import { TeamsMessagingManager } from './teams-messaging-manager';

export function registerTeamsMessagingRoutes(
    routes: Route[],
    opts: { dataDir: string },
): TeamsMessagingManager {
    const manager = new TeamsMessagingManager(opts.dataDir);

    // GET /container/messaging/teams/status
    routes.push({
        method: 'GET',
        pattern: /^\/container\/messaging\/teams\/status$/,
        handler: (_req, res) => {
            sendJSON(res, 200, manager.getStatus());
        },
    });

    // POST /container/messaging/teams/config
    routes.push({
        method: 'POST',
        pattern: /^\/container\/messaging\/teams\/config$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (!body) return;

            const patch: Record<string, unknown> = {};
            if (typeof body.botName === 'string') patch.botName = body.botName;
            if (typeof body.teamName === 'string') patch.teamName = body.teamName;
            if (typeof body.channelName === 'string') patch.channelName = body.channelName;
            if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;

            await manager.updateConfig(patch);
            sendJSON(res, 200, { ok: true });
        },
    });

    // POST /container/messaging/teams/reconnect
    routes.push({
        method: 'POST',
        pattern: /^\/container\/messaging\/teams\/reconnect$/,
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
