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
import type { ProcessStore, TaskQueueManager } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError, parseBody } from '@plusplusoneplusplus/coc-server';
import { handleAPIError, invalidJSON, badRequest, forbidden } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { DataWiper } from './data-wiper';
import { exportAllData } from './data-exporter';
import { importData } from './data-importer';
import { validateExportPayload } from '@plusplusoneplusplus/coc-server';
import type { CoCExportPayload, ImportMode } from '@plusplusoneplusplus/coc-server';
import type { ProcessWebSocketServer } from '@plusplusoneplusplus/coc-server';
import { getResolvedConfigWithSource, loadConfigFile, writeConfigFile, getConfigFilePath } from '../config';
import type { CLIConfig } from '../config';

// ============================================================================
// Token Management
// ============================================================================

const TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

interface TokenData {
    token: string;
    createdAt: number;
}

/** Manages a single time-limited, one-time-use confirmation token. */
class TokenManager {
    private active: TokenData | null = null;

    /** Generate a fresh confirmation token. */
    generate(): TokenData {
        const token = crypto.randomBytes(16).toString('hex');
        this.active = { token, createdAt: Date.now() };
        return this.active;
    }

    /** Validate a token string. Returns true if valid and not expired. Consumes the token. */
    validate(token: string): boolean {
        if (!this.active) { return false; }
        if (this.active.token !== token) { return false; }
        if (Date.now() - this.active.createdAt > TOKEN_EXPIRY_MS) {
            this.active = null;
            return false;
        }
        // Consume the token (one-time use)
        this.active = null;
        return true;
    }

    /** Reset token state (for tests). */
    reset(): void {
        this.active = null;
    }

    /** Current active token (exposed for testing). */
    get activeToken(): TokenData | null {
        return this.active;
    }
}

const wipeTokenManager = new TokenManager();
const importTokenManager = new TokenManager();

// Thin wrappers preserving the original exported API
function generateWipeToken() { return wipeTokenManager.generate(); }
function validateWipeToken(token: string) { return wipeTokenManager.validate(token); }
function resetWipeToken() { wipeTokenManager.reset(); }

function generateImportToken() { return importTokenManager.generate(); }
function validateImportToken(token: string) { return importTokenManager.validate(token); }
function resetImportToken() { importTokenManager.reset(); }

export {
    TokenManager, TOKEN_EXPIRY_MS,
    generateWipeToken, validateWipeToken, resetWipeToken,
    generateImportToken, validateImportToken, resetImportToken,
    wipeTokenManager, importTokenManager,
};

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
    /** Lazy getter for the queue manager (for import reset). */
    getQueueManager?: () => TaskQueueManager | undefined;
    /** Lazy getter for queue persistence (for import restore). */
    getQueuePersistence?: () => { restore(): void } | undefined;
    /** Exit code to use for restart (injected to avoid circular import). Defaults to 75. */
    restartExitCode?: number;
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
                    return handleAPIError(res, badRequest('Request body must be a JSON object'));
                }
                body = parsed;
            } catch {
                return handleAPIError(res, invalidJSON());
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
                if (body.timeout !== null && (typeof body.timeout !== 'number' || body.timeout <= 0)) {
                    errors.push('timeout must be a number greater than 0, or null to clear');
                }
            }
            if ('output' in body) {
                if (typeof body.output !== 'string' || !(VALID_OUTPUT_VALUES as readonly string[]).includes(body.output)) {
                    errors.push(`output must be one of: ${VALID_OUTPUT_VALUES.join(', ')}`);
                }
            }
            if ('showReportIntent' in body) {
                if (typeof body.showReportIntent !== 'boolean') {
                    errors.push('showReportIntent must be a boolean');
                }
            }
            if ('toolCompactness' in body) {
                if (
                    typeof body.toolCompactness !== 'number' ||
                    !Number.isInteger(body.toolCompactness) ||
                    body.toolCompactness < 0 ||
                    body.toolCompactness > 2
                ) {
                    errors.push('toolCompactness must be 0, 1, or 2');
                }
            }

            // Validate nested chat.followUpSuggestions fields
            const chatBody = body['chat.followUpSuggestions.enabled'] !== undefined || body['chat.followUpSuggestions.count'] !== undefined
                ? body : null;
            if (chatBody && 'chat.followUpSuggestions.enabled' in chatBody) {
                if (typeof chatBody['chat.followUpSuggestions.enabled'] !== 'boolean') {
                    errors.push('chat.followUpSuggestions.enabled must be a boolean');
                }
            }
            if (chatBody && 'chat.followUpSuggestions.count' in chatBody) {
                const count = chatBody['chat.followUpSuggestions.count'];
                if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 5) {
                    errors.push('chat.followUpSuggestions.count must be an integer between 1 and 5');
                }
            }

            if (errors.length > 0) {
                return handleAPIError(res, badRequest(errors.join('; ')));
            }

            // Merge with existing config
            const existing: CLIConfig = loadConfigFile(configPath) ?? {};
            if ('model' in body) { existing.model = body.model as string; }
            if ('parallel' in body) { existing.parallel = body.parallel as number; }
            if ('timeout' in body) {
                if (body.timeout === null) {
                    delete existing.timeout;
                } else {
                    existing.timeout = body.timeout as number;
                }
            }
            if ('output' in body) { existing.output = body.output as CLIConfig['output']; }
            if ('showReportIntent' in body) { existing.showReportIntent = body.showReportIntent as boolean; }
            if ('toolCompactness' in body) { existing.toolCompactness = body.toolCompactness as CLIConfig['toolCompactness']; }

            // Handle nested chat.followUpSuggestions fields
            if ('chat.followUpSuggestions.enabled' in body) {
                if (!existing.chat) { existing.chat = {}; }
                if (!existing.chat.followUpSuggestions) { existing.chat.followUpSuggestions = {}; }
                existing.chat.followUpSuggestions.enabled = body['chat.followUpSuggestions.enabled'] as boolean;
            }
            if ('chat.followUpSuggestions.count' in body) {
                if (!existing.chat) { existing.chat = {}; }
                if (!existing.chat.followUpSuggestions) { existing.chat.followUpSuggestions = {}; }
                existing.chat.followUpSuggestions.count = body['chat.followUpSuggestions.count'] as number;
            }

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
                return handleAPIError(res, badRequest('Missing confirmation token. GET /api/admin/data/wipe-token first.'));
            }

            if (!validateWipeToken(confirmToken)) {
                return handleAPIError(res, forbidden('Invalid or expired confirmation token'));
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

    // ------------------------------------------------------------------
    // GET /api/admin/export — Download full export as JSON attachment
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/export',
        handler: async (_req, res) => {
            const payload = await exportAllData({ store, dataDir });
            const body = JSON.stringify(payload);

            // Build filename with current timestamp (colons replaced for FS safety)
            const ts = new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
            const filename = `coc-export-${ts}.json`;

            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': Buffer.byteLength(body),
            });
            res.end(body);
        },
    });

    // ------------------------------------------------------------------
    // GET /api/admin/import-token — Generate an import confirmation token
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/import-token',
        handler: async (_req, res) => {
            const it = generateImportToken();
            sendJSON(res, 200, {
                token: it.token,
                expiresIn: TOKEN_EXPIRY_MS / 1000,
            });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/admin/import/preview — Validate payload and return preview
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/admin/import/preview',
        handler: async (req, res) => {
            let body: unknown;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            const validation = validateExportPayload(body);
            if (!validation.valid) {
                return sendJSON(res, 400, {
                    valid: false,
                    error: validation.error,
                });
            }

            const payload = body as CoCExportPayload;
            sendJSON(res, 200, {
                valid: true,
                preview: {
                    processCount: payload.metadata.processCount,
                    workspaceCount: payload.metadata.workspaceCount,
                    wikiCount: payload.metadata.wikiCount,
                    queueFileCount: payload.metadata.queueFileCount,
                    sampleProcessIds: payload.processes.slice(0, 5).map(p => p.id),
                },
            });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/admin/import — Execute import with token confirmation
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/admin/import',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const confirmToken = typeof parsed.query.confirm === 'string' ? parsed.query.confirm : '';
            const mode: ImportMode = parsed.query.mode === 'merge' ? 'merge' : 'replace';

            if (!confirmToken) {
                return handleAPIError(res, badRequest('Missing confirmation token. GET /api/admin/import-token first.'));
            }

            if (!validateImportToken(confirmToken)) {
                return handleAPIError(res, forbidden('Invalid or expired confirmation token'));
            }

            let body: unknown;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            const validation = validateExportPayload(body);
            if (!validation.valid) {
                return handleAPIError(res, badRequest(`Invalid payload: ${validation.error}`));
            }

            const payload = body as CoCExportPayload;

            // Rehydrate Date fields lost during JSON round-trip
            for (const proc of payload.processes) {
                if (typeof proc.startTime === 'string') { proc.startTime = new Date(proc.startTime); }
                if (typeof proc.endTime === 'string') { proc.endTime = new Date(proc.endTime); }
            }

            const result = await importData(payload, {
                store,
                dataDir,
                mode,
                wiper,
                getQueueManager: options.getQueueManager,
                getQueuePersistence: options.getQueuePersistence,
            });

            // Broadcast import event to all WebSocket clients
            const wsServer = getWsServer?.();
            if (wsServer) {
                wsServer.broadcastProcessEvent({
                    type: 'data-imported',
                    timestamp: Date.now(),
                    mode,
                } as any);
            }

            sendJSON(res, 200, result);
        },
    });

    // ------------------------------------------------------------------
    // POST /api/admin/restart — Rebuild & restart the server
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/admin/restart',
        handler: async (_req, res) => {
            const exitCode = options.restartExitCode ?? 75;
            sendJSON(res, 200, { message: 'Server is restarting...' });

            // Give the response time to flush, then exit with the restart code
            setTimeout(() => {
                process.exit(exitCode);
            }, 200);
        },
    });
}
