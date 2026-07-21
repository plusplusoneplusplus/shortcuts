/**
 * Teams OAuth auth endpoints (client-side PKCE). Thin adapters that hand the
 * request to the TeamsAuthController and serialize its result.
 */

import type { TeamsAuthController } from '../teams-auth-controller';
import { type RouteTable, sendJson, readBody } from '../http-util';

export function installTeamsAuthRoutes(table: RouteTable, controller: TeamsAuthController): void {
    // POST /auth/start — start a temporary callback server and return OAuth params
    table.on('POST', '/api/container/messaging/teams/auth/start', async ({ res }) => {
        sendJson(res, await controller.start());
    });

    // POST /auth/exchange — client sends { code, codeVerifier, redirectUri }
    table.on('POST', '/api/container/messaging/teams/auth/exchange', async ({ req, res }) => {
        const body = await readBody(req) as { code?: string; codeVerifier?: string; redirectUri?: string };
        sendJson(res, await controller.exchange(body));
    });

    // GET /auth/status — check whether a valid cached token exists
    table.on('GET', '/api/container/messaging/teams/auth/status', async ({ res }) => {
        sendJson(res, await controller.status());
    });

    // POST /auth/logout — clear cached tokens and stop the bridge
    table.on('POST', '/api/container/messaging/teams/auth/logout', async ({ res }) => {
        sendJson(res, await controller.logout());
    });
}
