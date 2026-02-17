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
import { sendJSON, sendError, parseBody } from './api-handler';
import type { Route } from './types';
import { DataWiper } from './data-wiper';
import type { ProcessWebSocketServer } from './websocket';
import { getResolvedConfigWithSource, loadConfigFile, writeConfigFile, getConfigFilePath } from '../config';
import type { CLIConfig } from '../config';

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
    /** Optional config file path override (for tests). When absent, uses getConfigFilePath(). */
    configPath?: string;
}

/**
 * Register admin API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
/** Allowed output values for PUT validation. */
const VALID_OUTPUT_VALUES = ['table', 'json', 'csv', 'markdown'] as const;

export function registerAdminRoutes(routes: Route[], options: AdminRouteOptions): void {
    const { store, dataDir, getWsServer, configPath } = options;
    const wiper = new DataWiper(dataDir, store);
    const resolvedConfigPath = configPath ?? getConfigFilePath();

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
    // GET /api/admin/config — Return resolved config with sources
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/config',
        handler: async (_req, res) => {
            const result = getResolvedConfigWithSource(configPath);
            sendJSON(res, 200, result);
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/admin/config — Update editable runtime settings
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: '/api/admin/config',
        handler: async (req, res) => {
            let body: Record<string, unknown>;
            try {
                const parsed = await parseBody(req);
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    return sendError(res, 400, 'Request body must be a JSON object');
                }
                body = parsed;
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            // Validate editable fields
            const errors: string[] = [];

            if ('model' in body) {
                if (typeof body.model !== 'string' || body.model.length === 0) {
                    errors.push('model must be a non-empty string');
                }
            }
            if ('parallel' in body) {
                if (typeof body.parallel !== 'number' || body.parallel <= 0) {
                    errors.push('parallel must be a number greater than 0');
                }
            }
            if ('timeout' in body) {
                if (typeof body.timeout !== 'number' || body.timeout <= 0) {
                    errors.push('timeout must be a number greater than 0');
                }
            }
            if ('output' in body) {
                if (typeof body.output !== 'string' || !(VALID_OUTPUT_VALUES as readonly string[]).includes(body.output)) {
                    errors.push(`output must be one of: ${VALID_OUTPUT_VALUES.join(', ')}`);
                }
            }

            if (errors.length > 0) {
                return sendError(res, 400, errors.join('; '));
            }

            // Merge with existing config
            const existing: CLIConfig = loadConfigFile(configPath) ?? {};
            if ('model' in body) { existing.model = body.model as string; }
            if ('parallel' in body) { existing.parallel = body.parallel as number; }
            if ('timeout' in body) { existing.timeout = body.timeout as number; }
            if ('output' in body) { existing.output = body.output as CLIConfig['output']; }

            writeConfigFile(resolvedConfigPath, existing);

            // Return updated resolved config (same shape as GET)
            const result = getResolvedConfigWithSource(configPath);
            sendJSON(res, 200, result);
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
