/**
 * Admin REST API Handler
 *
 * HTTP API routes for administrative operations (data wipe).
 * Uses time-limited tokens for confirmation of destructive operations.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as crypto from 'crypto';
import * as url from 'url';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError } from './api-handler';
import type { Route } from './types';
import { DataWiper } from './data-wiper';
import type { ProcessWebSocketServer } from './websocket';

// ============================================================================
// Token Management
// ============================================================================

const TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

interface WipeToken {
    token: string;
    createdAt: number;
}

let activeWipeToken: WipeToken | null = null;

/** Generate a fresh wipe confirmation token. */
function generateWipeToken(): WipeToken {
    const token = crypto.randomBytes(16).toString('hex');
    const wt: WipeToken = { token, createdAt: Date.now() };
    activeWipeToken = wt;
    return wt;
}

/** Validate a token string. Returns true if valid and not expired. */
function validateWipeToken(token: string): boolean {
    if (!activeWipeToken) { return false; }
    if (activeWipeToken.token !== token) { return false; }
    if (Date.now() - activeWipeToken.createdAt > TOKEN_EXPIRY_MS) {
        activeWipeToken = null;
        return false;
    }
    // Consume the token (one-time use)
    activeWipeToken = null;
    return true;
}

// Exported for testing
export { generateWipeToken, validateWipeToken, activeWipeToken, TOKEN_EXPIRY_MS };

/** Reset token state (for tests). */
export function resetWipeToken(): void {
    activeWipeToken = null;
}

// ============================================================================
// Route Registration
// ============================================================================

export interface AdminRouteOptions {
    store: ProcessStore;
    dataDir: string;
    /** Lazy getter for the WebSocket server (may not be created at route registration time). */
    getWsServer?: () => ProcessWebSocketServer | undefined;
}

/**
 * Register admin API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerAdminRoutes(routes: Route[], options: AdminRouteOptions): void {
    const { store, dataDir, getWsServer } = options;
    const wiper = new DataWiper(dataDir, store);

    // ------------------------------------------------------------------
    // GET /api/admin/data/wipe-token — Generate a wipe confirmation token
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/data/wipe-token',
        handler: async (_req, res) => {
            const wt = generateWipeToken();
            sendJSON(res, 200, {
                token: wt.token,
                expiresIn: TOKEN_EXPIRY_MS / 1000,
            });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/admin/data/stats — Get storage statistics (dry-run preview)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/data/stats',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const includeWikis = parsed.query.includeWikis === 'true';

            const summary = await wiper.getDryRunSummary({ includeWikis });
            sendJSON(res, 200, summary);
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/admin/data — Wipe all runtime data
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: '/api/admin/data',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const confirmToken = typeof parsed.query.confirm === 'string' ? parsed.query.confirm : '';
            const includeWikis = parsed.query.includeWikis === 'true';

            if (!confirmToken) {
                return sendError(res, 400, 'Missing confirmation token. GET /api/admin/data/wipe-token first.');
            }

            if (!validateWipeToken(confirmToken)) {
                return sendError(res, 403, 'Invalid or expired confirmation token');
            }

            const result = await wiper.wipeData({ includeWikis });

            // Broadcast wipe event to all WebSocket clients
            const wsServer = getWsServer?.();
            if (wsServer) {
                wsServer.broadcastProcessEvent({
                    type: 'data-wiped',
                    timestamp: Date.now(),
                } as any);
            }

            sendJSON(res, 200, result);
        },
    });
}
