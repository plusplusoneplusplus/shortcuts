/**
 * Server-owned native Teams browser sign-in endpoints. Thin adapters that hand the
 * request to the TeamsAuthController and serialize its result.
 */

import type { TeamsAuthController } from '../teams-auth-controller';
import { type RouteTable, sendJson } from '../http-util';

export function installTeamsAuthRoutes(table: RouteTable, controller: TeamsAuthController): void {
    // POST /auth/start — return native browser instructions and start the waiter
    table.on('POST', '/api/container/messaging/teams/auth/start', async ({ res }) => {
        sendJson(res, await controller.start());
    });

    table.on('POST', '/api/container/messaging/teams/auth/cancel', async ({ res }) => {
        sendJson(res, await controller.cancel());
    });

    // GET /auth/status — report completion and native demand credential status
    table.on('GET', '/api/container/messaging/teams/auth/status', async ({ res }) => {
        sendJson(res, await controller.status());
    });

    // POST /auth/logout — stop the bridge and delete exact native credentials
    table.on('POST', '/api/container/messaging/teams/auth/logout', async ({ res }) => {
        sendJson(res, await controller.logout());
    });
}
