/**
 * Codex Auth REST API Routes
 *
 * Routes:
 *   GET    /api/codex-auth/status           Current auth status from the token store.
 *   POST   /api/codex-auth/start            Start an OAuth PKCE flow; returns authUrl.
 *   GET    /api/codex-auth/flows/:id        Status of a specific OAuth flow.
 *   DELETE /api/codex-auth/clear            Remove stored tokens.
 */

import type * as http from 'http';
import { sendJson, sendError } from '../shared/router';
import type { Route } from '../types';
import type { CodexAuthManager } from './codex-auth-manager';

export interface CodexAuthRouteContext {
    manager: CodexAuthManager;
    /** When true the server opens the auth URL in the browser automatically. */
    autoOpenBrowser?: boolean;
    /** Override the browser-open function (for testing). */
    openBrowser?: (url: string) => void;
}

const STATUS_ROUTE = /^\/api\/codex-auth\/status\/?$/;
const START_ROUTE = /^\/api\/codex-auth\/start\/?$/;
const FLOW_STATUS_ROUTE = /^\/api\/codex-auth\/flows\/([^/]+)$/;
const CLEAR_ROUTE = /^\/api\/codex-auth\/clear\/?$/;

function defaultOpenBrowser(url: string): void {
    const { platform } = process;
    let command: string;
    if (platform === 'darwin') {
        command = `open "${url}"`;
    } else if (platform === 'win32') {
        command = `start "" "${url}"`;
    } else {
        command = `xdg-open "${url}"`;
    }
    // Fire-and-forget — browser open is best-effort
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('child_process').exec(command);
    } catch { /* ignore */ }
}

export function registerCodexAuthRoutes(routes: Route[], ctx: CodexAuthRouteContext): void {
    const { manager } = ctx;
    const open = ctx.openBrowser ?? defaultOpenBrowser;

    // GET /api/codex-auth/status
    routes.push({
        method: 'GET',
        pattern: STATUS_ROUTE,
        handler: (_req: http.IncomingMessage, res: http.ServerResponse) => {
            const info = manager.getAuthInfo();
            sendJson(res, info);
        },
    });

    // POST /api/codex-auth/start
    routes.push({
        method: 'POST',
        pattern: START_ROUTE,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse) => {
            // Short-circuit: already authenticated
            const info = manager.getAuthInfo();
            if (info.status === 'authenticated') {
                sendJson(res, { alreadyAuthenticated: true, status: info.status });
                return;
            }
            try {
                const result = await manager.startFlow();
                if (ctx.autoOpenBrowser !== false) {
                    open(result.authUrl);
                }
                sendJson(res, {
                    requestId: result.requestId,
                    authUrl: result.authUrl,
                    callbackPort: result.callbackPort,
                    alreadyAuthenticated: false,
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                sendError(res, 500, msg);
            }
        },
    });

    // GET /api/codex-auth/flows/:id
    routes.push({
        method: 'GET',
        pattern: FLOW_STATUS_ROUTE,
        handler: (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const id = decodeURIComponent(match![1]);
            const status = manager.getFlowStatus(id);
            if (!status) {
                sendError(res, 404, `OAuth flow not found: ${id}`);
                return;
            }
            sendJson(res, status);
        },
    });

    // DELETE /api/codex-auth/clear
    routes.push({
        method: 'DELETE',
        pattern: CLEAR_ROUTE,
        handler: (_req: http.IncomingMessage, res: http.ServerResponse) => {
            const removed = manager.clearAuth();
            sendJson(res, { cleared: removed });
        },
    });
}
