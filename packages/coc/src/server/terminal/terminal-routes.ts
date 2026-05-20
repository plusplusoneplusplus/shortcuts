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
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound } from '../errors';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';

export function registerTerminalRoutes(
    routes: Route[],
    store: ProcessStore,
    getTerminalSessionManager: () => TerminalSessionManager | undefined,
    resolvedConfig?: ResolvedCLIConfig,
    runtimeConfigService?: RuntimeConfigService,
): void {
    // GET /api/terminal/status — always registered regardless of manager.
    // Uses runtimeConfigService (when available) so the status endpoint
    // reports the saved config value, not just the startup-captured one.
    // Terminal infrastructure itself is restart-required.
    routes.push({
        method: 'GET',
        pattern: '/api/terminal/status',
        handler: async (_req, res) => {
            const mgr = getTerminalSessionManager();
            const liveEnabled = runtimeConfigService
                ? (runtimeConfigService.config.terminal?.enabled ?? true)
                : (resolvedConfig?.terminal?.enabled ?? true);
            sendJSON(res, 200, {
                enabled: liveEnabled,
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

            let body: unknown;
            try {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(chunk as Buffer);
                body = JSON.parse(Buffer.concat(chunks).toString());
            } catch {
                sendJSON(res, 400, { error: 'Invalid JSON body' });
                return;
            }

            if (!body || typeof body !== 'object' || typeof (body as { pinned?: unknown }).pinned !== 'boolean') {
                sendJSON(res, 400, { error: 'Missing or invalid "pinned" field (boolean required)' });
                return;
            }

            const sessionBeforeUpdate = mgr.getSession(sessionId);
            if (!sessionBeforeUpdate || sessionBeforeUpdate.workspaceId !== ws.id) {
                return handleAPIError(res, notFound('Terminal session'));
            }

            const { pinned } = body as { pinned: boolean };
            const success = pinned ? mgr.pinSession(sessionId) : mgr.unpinSession(sessionId);
            if (!success) {
                return handleAPIError(res, notFound('Terminal session'));
            }

            const session = mgr.getSession(sessionId);
            if (session && session.workspaceId === ws.id) {
                sendJSON(res, 200, { sessionId, pinned: session.pinned });
            } else {
                return handleAPIError(res, notFound('Terminal session'));
            }
        },
    });
}
