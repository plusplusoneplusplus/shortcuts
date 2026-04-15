/**
 * REST endpoints for terminal session management.
 *
 * - GET  /api/terminal/status                        — always registered
 * - GET  /api/workspaces/:id/terminals               — list sessions
 * - DELETE /api/workspaces/:id/terminals/:sessionId  — kill session
 *
 * The `getTerminalSessionManager` getter is used (instead of a direct reference)
 * because terminal infrastructure is created after route registration, following
 * the same forward-declaration pattern as `getWsServer`.
 */

import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { TerminalSessionManager } from './terminal-session-manager';
import type { ResolvedCLIConfig } from '../../config';
import { toSessionInfo } from './terminal-session-manager';
import { sendJSON } from '../api-handler';
import { handleAPIError, notFound } from '../errors';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';

export function registerTerminalRoutes(
    routes: Route[],
    store: ProcessStore,
    getTerminalSessionManager: () => TerminalSessionManager | undefined,
    resolvedConfig?: ResolvedCLIConfig,
): void {
    // GET /api/terminal/status — always registered regardless of manager
    routes.push({
        method: 'GET',
        pattern: '/api/terminal/status',
        handler: async (_req, res) => {
            const mgr = getTerminalSessionManager();
            sendJSON(res, 200, {
                enabled: resolvedConfig?.terminal?.enabled ?? false,
                nodePtyAvailable: mgr != null,
                activeSessions: mgr?.size ?? 0,
            });
        },
    });

    // GET /api/workspaces/:id/terminals — list active sessions for workspace
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/terminals$/,
        handler: async (_req, res, match) => {
            const mgr = getTerminalSessionManager();
            if (!mgr) {
                sendJSON(res, 200, { sessions: [] });
                return;
            }

            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const sessions = mgr.getSessionsByWorkspace(ws.id);
            sendJSON(res, 200, {
                sessions: sessions.map(s => toSessionInfo(s)),
            });
        },
    });

    // DELETE /api/workspaces/:id/terminals/:sessionId — kill a specific session
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/terminals\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const mgr = getTerminalSessionManager();
            if (!mgr) {
                return handleAPIError(res, notFound('Terminal session'));
            }

            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const sessionId = decodeURIComponent(match![2]);
            const destroyed = mgr.destroySession(sessionId);
            if (!destroyed) {
                return handleAPIError(res, notFound('Terminal session'));
            }
            res.writeHead(204);
            res.end();
        },
    });

    // PATCH /api/workspaces/:id/terminals/:sessionId/pin — toggle pin state
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/terminals\/([^/]+)\/pin$/,
        handler: async (req, res, match) => {
            const mgr = getTerminalSessionManager();
            if (!mgr) {
                return handleAPIError(res, notFound('Terminal session'));
            }

            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const sessionId = decodeURIComponent(match![2]);

            let body: { pinned: boolean };
            try {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(chunk as Buffer);
                body = JSON.parse(Buffer.concat(chunks).toString());
            } catch {
                sendJSON(res, 400, { error: 'Invalid JSON body' });
                return;
            }

            if (typeof body.pinned !== 'boolean') {
                sendJSON(res, 400, { error: 'Missing or invalid "pinned" field (boolean required)' });
                return;
            }

            const success = body.pinned ? mgr.pinSession(sessionId) : mgr.unpinSession(sessionId);
            if (!success) {
                return handleAPIError(res, notFound('Terminal session'));
            }

            const session = mgr.getSession(sessionId);
            if (session) {
                sendJSON(res, 200, { sessionId, pinned: session.pinned });
            } else {
                sendJSON(res, 200, { sessionId, pinned: body.pinned });
            }
        },
    });
}
