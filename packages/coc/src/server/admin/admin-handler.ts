/**
 * Admin REST API Handler
 *
 * HTTP API routes for administrative operations (data wipe).
 * Uses time-limited tokens for confirmation of destructive operations.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ProcessStore, TaskQueueManager, SDKServiceRegistry } from '@plusplusoneplusplus/forge';
import { MEMORY_SCHEMA, READ_ONLY_SYSTEM_MESSAGE, SECURITY_PATTERNS_DESCRIPTION } from '@plusplusoneplusplus/forge';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import { validateConfigWithSchema } from '../../config/schema';
import { parseBody, sendJSON } from '../core/api-handler';
import { badRequest, forbidden, handleAPIError, invalidJSON, notFound } from '../errors';
import { exportAllData } from '../storage/data-exporter';
import { importData } from '../storage/data-importer';
import { DataWiper } from '../storage/data-wiper';
import type { ImportProgress } from '../storage/directory-history-importer';
import { DirectoryHistoryImporter } from '../storage/directory-history-importer';
import type { CLIConfig, CoCExportPayload, ImportMode, QueuePersistence } from '../storage/export-import-types';
import { validateExportPayload } from '../storage/export-import-types';
import type { MigrationProgress } from '../storage/storage-migration';
import { StorageMigrationEngine } from '../storage/storage-migration';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { Route } from '../types';
import { sendSSE } from '../wiki/ask-handler';
import { ADMIN_CONFIG_FIELDS, ADMIN_EDITABLE_KEYS, getAdminFieldMetadata } from './admin-config-fields';
import {
    getAllPromptOverrides,
    savePromptOverride as writeSavedPromptOverride,
    deletePromptOverride as removePromptOverride,
} from './admin-prompt-overrides';

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
    private readonly ttlMs: number;

    constructor(ttlMs = TOKEN_EXPIRY_MS) {
        this.ttlMs = ttlMs;
    }

    /** Token TTL in ms (for response headers). */
    get ttl(): number { return this.ttlMs; }

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
        if (Date.now() - this.active.createdAt > this.ttlMs) {
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
const migrateTokenManager = new TokenManager();
const directoryImportTokenManager = new TokenManager();

// Thin wrappers preserving the original exported API
function generateWipeToken() { return wipeTokenManager.generate(); }
function validateWipeToken(token: string) { return wipeTokenManager.validate(token); }
function resetWipeToken() { wipeTokenManager.reset(); }

function generateImportToken() { return importTokenManager.generate(); }
function validateImportToken(token: string) { return importTokenManager.validate(token); }
function resetImportToken() { importTokenManager.reset(); }

function generateMigrateToken() { return migrateTokenManager.generate(); }
function validateMigrateToken(token: string) { return migrateTokenManager.validate(token); }
function resetMigrateToken() { migrateTokenManager.reset(); }

function resetDirectoryImportToken() { directoryImportTokenManager.reset(); }

export { directoryImportTokenManager, generateImportToken, generateMigrateToken, generateWipeToken, importTokenManager, migrateTokenManager, resetDirectoryImportToken, resetImportToken, resetMigrateToken, resetWipeToken, TOKEN_EXPIRY_MS, TokenManager, validateImportToken, validateMigrateToken, validateWipeToken, wipeTokenManager };

// ============================================================================
// Route Registration
// ============================================================================

/** Functions for reading/writing the CLIConfig file. Injected by the caller so coc-server stays decoupled from the CLI config module. */
export interface AdminConfigFunctions {
    getConfigFilePath: () => string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getResolvedConfigWithSource: (configPath?: string) => any;
    loadConfigFile: (configPath?: string) => CLIConfig | undefined;
    writeConfigFile: (configPath: string, config: CLIConfig) => void;
}

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
    getQueuePersistence?: () => QueuePersistence | undefined;
    /** Config file functions (injected from CLI layer). Falls back when runtimeConfigService is absent. */
    configFunctions?: AdminConfigFunctions;
    /** Central runtime config service. When provided, GET/PUT admin config use this instead of configFunctions. */
    runtimeConfigService?: RuntimeConfigService;
    /** Exit code to use for restart (injected to avoid circular import). Defaults to 75. */
    restartExitCode?: number;
    /** SDK service registry for per-provider availability checks. */
    sdkServiceRegistry?: SDKServiceRegistry;
    /** Override token TTL in ms (for testing). Defaults to TOKEN_EXPIRY_MS (5 min). */
    tokenTtlMs?: number;
}

/**
 * Register admin API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerAdminRoutes(routes: Route[], options: AdminRouteOptions): void {
    const { store, dataDir, getWsServer, configPath, configFunctions, runtimeConfigService } = options;
    const wiper = new DataWiper(dataDir, store);
    const resolvedConfigPath = configPath ?? configFunctions?.getConfigFilePath?.() ?? '';

    // Route-scoped token managers — isolated per server instance; TTL configurable for tests.
    const routeWipeTokenMgr = new TokenManager(options.tokenTtlMs);
    const routeImportTokenMgr = new TokenManager(options.tokenTtlMs);
    const routeMigrateTokenMgr = new TokenManager(options.tokenTtlMs);
    const routeDirImportTokenMgr = new TokenManager(options.tokenTtlMs);

    // ------------------------------------------------------------------
    // GET /api/admin/data/wipe-token — Generate a wipe confirmation token
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/data/wipe-token',
        handler: async (_req, res) => {
            const wt = routeWipeTokenMgr.generate();
            sendJSON(res, 200, {
                token: wt.token,
                expiresIn: routeWipeTokenMgr.ttl / 1000,
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
            if (runtimeConfigService) {
                const snapshot = runtimeConfigService.getSnapshot();
                sendJSON(res, 200, {
                    resolved: snapshot.config,
                    sources: snapshot.sources,
                    defaults: runtimeConfigService.defaults,
                    configFilePath: runtimeConfigService.configPath,
                    revision: snapshot.revision,
                    fieldMetadata: getAdminFieldMetadata(),
                });
            } else {
                const result = configFunctions?.getResolvedConfigWithSource?.(configPath) ?? { config: {}, sources: {} };
                sendJSON(res, 200, result);
            }
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

            // Reject empty body (no editable keys)
            const hasEditableKey = ADMIN_EDITABLE_KEYS.some(k => k in body);
            if (!hasEditableKey) {
                return handleAPIError(res, badRequest('Request body must contain at least one editable field'));
            }

            if (runtimeConfigService) {
                // Delegate validation, disk write, refresh, and revision bump to the service
                try {
                    const updateResult = await runtimeConfigService.updateConfig(body);
                    sendJSON(res, 200, {
                        resolved: updateResult.config,
                        sources: updateResult.sources,
                        defaults: runtimeConfigService.defaults,
                        configFilePath: runtimeConfigService.configPath,
                        revision: updateResult.revision,
                        effects: updateResult.effects,
                        fieldMetadata: getAdminFieldMetadata(),
                    });
                } catch (err) {
                    return handleAPIError(res, badRequest((err as Error).message));
                }
            } else {
                // Legacy path: validate and write through configFunctions
                const errors: string[] = [];
                for (const field of ADMIN_CONFIG_FIELDS) {
                    if (field.key in body) {
                        const err = field.validate(body[field.key]);
                        if (err) { errors.push(err); }
                    }
                }
                if (errors.length > 0) {
                    return handleAPIError(res, badRequest(errors.join('; ')));
                }

                const existing: CLIConfig = configFunctions?.loadConfigFile?.(configPath) ?? {};
                for (const field of ADMIN_CONFIG_FIELDS) {
                    if (field.key in body) {
                        field.apply(existing, body[field.key]);
                    }
                }

                try {
                    validateConfigWithSchema(existing);
                } catch (err) {
                    return handleAPIError(res, badRequest((err as Error).message));
                }

                configFunctions?.writeConfigFile?.(resolvedConfigPath, existing);

                const result = configFunctions?.getResolvedConfigWithSource?.(configPath) ?? { config: {}, sources: {} };
                sendJSON(res, 200, result);
            }
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

            if (!routeWipeTokenMgr.validate(confirmToken)) {
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
            const payload = await exportAllData({ store, dataDir, loadConfigFile: configFunctions?.loadConfigFile });
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
            const it = routeImportTokenMgr.generate();
            sendJSON(res, 200, {
                token: it.token,
                expiresIn: routeImportTokenMgr.ttl / 1000,
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

            if (!routeImportTokenMgr.validate(confirmToken)) {
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
    // GET /api/admin/prompts — Return built-in prompt default texts
    // (annotated with active overrides when dataDir is available)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/prompts',
        handler: async (_req, res) => {
            sendJSON(res, 200, dataDir ? getPromptsWithOverrides(dataDir) : getBuiltInPrompts());
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/admin/prompts/:id — Save an admin override for a prompt
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/admin\/prompts\/([^/]+)$/,
        handler: async (req, res, match) => {
            const promptId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            if (!promptId) return handleAPIError(res, badRequest('Missing prompt ID'));
            if (!dataDir) return handleAPIError(res, badRequest('dataDir not configured'));

            const builtins = getBuiltInPrompts();
            const prompt = builtins[promptId];
            if (!prompt) return handleAPIError(res, notFound(`prompt '${promptId}'`));
            if (!prompt.editable) return handleAPIError(res, forbidden(`Prompt '${promptId}' is not editable`));

            let body: { text?: unknown };
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }
            if (typeof body.text !== 'string' || !body.text.trim()) {
                return handleAPIError(res, badRequest('Body must contain a non-empty "text" string'));
            }

            const validationError = validatePromptOverride(prompt, body.text);
            if (validationError) return handleAPIError(res, badRequest(validationError));

            try {
                writeSavedPromptOverride(promptId, body.text, dataDir);
            } catch (err) {
                return handleAPIError(res, err);
            }

            sendJSON(res, 200, {
                ...prompt,
                overrideText: body.text,
                hasOverride: true,
                saved: true,
            });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/admin/prompts/:id — Reset a prompt to its built-in default
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/admin\/prompts\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const promptId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            if (!promptId) return handleAPIError(res, badRequest('Missing prompt ID'));
            if (!dataDir) return handleAPIError(res, badRequest('dataDir not configured'));

            const builtins = getBuiltInPrompts();
            const prompt = builtins[promptId];
            if (!prompt) return handleAPIError(res, notFound(`prompt '${promptId}'`));
            if (!prompt.editable) return handleAPIError(res, forbidden(`Prompt '${promptId}' is not editable`));

            try {
                removePromptOverride(promptId, dataDir);
            } catch (err) {
                return handleAPIError(res, err);
            }

            sendJSON(res, 200, { id: promptId, reset: true });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/admin/version — Return build version and commit hash
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/version',
        handler: async (_req, res) => {
            let commit = 'dev';
            let version = 'dev';
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const info = require('../core/build-info');
                commit = info.BUILD_COMMIT ?? 'dev';
                version = info.BUILD_VERSION ?? 'dev';
            } catch {
                // build-info.ts not generated yet (dev mode) — fall back gracefully
            }
            sendJSON(res, 200, { version, commit });
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

    // ------------------------------------------------------------------
    // Storage Migration Endpoints
    // ------------------------------------------------------------------
    let activeMigration: { controller: AbortController; running: boolean } | null = null;

    // ------------------------------------------------------------------
    // GET /api/admin/storage/status — Current storage backend info
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/storage/status',
        handler: async (_req, res) => {
            try {
                const config = configFunctions?.loadConfigFile?.(resolvedConfigPath);
                const backend = config?.store?.backend ?? 'sqlite';

                const [workspaces, processCount] = await Promise.all([
                    store.getWorkspaces(),
                    store.getProcessCount(),
                ]);

                const dbPath = path.join(dataDir, 'processes.db');
                const dbExists = fs.existsSync(dbPath);

                const result: Record<string, unknown> = {
                    backend,
                    stats: {
                        processes: processCount,
                        workspaces: workspaces.length,
                    },
                };

                if (backend === 'sqlite' && dbExists) {
                    result.dbPath = dbPath;
                }

                sendJSON(res, 200, result);
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/admin/storage/migrate-token — Generate a migration token
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/storage/migrate-token',
        handler: async (_req, res) => {
            const mt = routeMigrateTokenMgr.generate();
            sendJSON(res, 200, {
                token: mt.token,
                expiresIn: routeMigrateTokenMgr.ttl / 1000,
            });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/admin/storage/migrate?confirm=<token> — Run migration
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/admin/storage/migrate',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const confirmToken = typeof parsed.query.confirm === 'string' ? parsed.query.confirm : '';
            const skipValidation = parsed.query.skipValidation === '1' || parsed.query.skipValidation === 'true';

            if (!confirmToken) {
                return handleAPIError(res, badRequest('Missing confirmation token. GET /api/admin/storage/migrate-token first.'));
            }

            if (!routeMigrateTokenMgr.validate(confirmToken)) {
                return handleAPIError(res, forbidden('Invalid or expired confirmation token'));
            }

            if (activeMigration?.running) {
                sendJSON(res, 409, { error: 'Migration already in progress' });
                return;
            }

            // SSE headers
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            });

            const controller = new AbortController();
            activeMigration = { controller, running: true };

            req.on('close', () => {
                if (activeMigration?.running) {
                    controller.abort();
                }
            });

            const engine = new StorageMigrationEngine({
                dataDir,
                dbPath: path.join(dataDir, 'processes.db'),
                onProgress: (event: MigrationProgress) => {
                    sendSSE(res, event as unknown as Record<string, unknown>);
                },
                signal: controller.signal,
                skipValidation,
            });

            let migrationSucceeded = false;
            try {
                const summary = await engine.run();
                sendSSE(res, { type: 'done', success: true, ...summary });
                migrationSucceeded = true;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                sendSSE(res, { type: 'error', message });
                sendSSE(res, { type: 'done', success: false, error: message });
            } finally {
                activeMigration = null;
                res.end();

                // Restart server so it boots with the new SQLite backend
                if (migrationSucceeded) {
                    const exitCode = options.restartExitCode ?? 75;
                    setTimeout(() => process.exit(exitCode), 500);
                }
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/admin/storage/migrate/cancel — Cancel active migration
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/admin/storage/migrate/cancel',
        handler: async (_req, res) => {
            if (!activeMigration?.running) {
                sendJSON(res, 409, { error: 'No active migration to cancel' });
                return;
            }
            activeMigration.controller.abort();
            sendJSON(res, 200, { success: true });
        },
    });

    // ------------------------------------------------------------------
    // Directory History Import Endpoints
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // POST /api/admin/storage/scan-directory — Scan a directory for importable history
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/admin/storage/scan-directory',
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

            const dirPath = body.path;
            if (typeof dirPath !== 'string' || dirPath.length === 0) {
                return handleAPIError(res, badRequest('path must be a non-empty string'));
            }

            if (!path.isAbsolute(dirPath)) {
                return handleAPIError(res, badRequest('path must be absolute'));
            }

            try {
                const importer = new DirectoryHistoryImporter();
                const scanResult = importer.scan(dirPath);
                const workspaces = await store.getWorkspaces();
                const matchResult = importer.matchWorkspaces(scanResult, workspaces);
                sendJSON(res, 200, matchResult);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return handleAPIError(res, badRequest(message));
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/admin/storage/import-directory-token — Generate a directory import token
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/storage/import-directory-token',
        handler: async (_req, res) => {
            const dt = routeDirImportTokenMgr.generate();
            sendJSON(res, 200, {
                token: dt.token,
                expiresIn: routeDirImportTokenMgr.ttl / 1000,
            });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/admin/storage/import-directory?confirm=<token> — Run directory import (SSE)
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/admin/storage/import-directory',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const confirmToken = typeof parsed.query.confirm === 'string' ? parsed.query.confirm : '';

            if (!confirmToken) {
                return handleAPIError(res, badRequest('Missing confirmation token. GET /api/admin/storage/import-directory-token first.'));
            }

            if (!routeDirImportTokenMgr.validate(confirmToken)) {
                return handleAPIError(res, forbidden('Invalid or expired confirmation token'));
            }

            let body: Record<string, unknown>;
            try {
                const bodyParsed = await parseBody(req);
                if (typeof bodyParsed !== 'object' || bodyParsed === null || Array.isArray(bodyParsed)) {
                    return handleAPIError(res, badRequest('Request body must be a JSON object'));
                }
                body = bodyParsed;
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            const dirPath = body.path;
            if (typeof dirPath !== 'string' || dirPath.length === 0) {
                return handleAPIError(res, badRequest('path must be a non-empty string'));
            }

            if (!path.isAbsolute(dirPath)) {
                return handleAPIError(res, badRequest('path must be absolute'));
            }

            const dbPath = path.join(dataDir, 'processes.db');
            if (!fs.existsSync(dbPath)) {
                return handleAPIError(res, badRequest('SQLite database not found. Import requires an existing SQLite backend.'));
            }

            // SSE headers
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            });

            try {
                const importer = new DirectoryHistoryImporter();
                sendSSE(res, { type: 'progress', phase: 'scanning', message: 'Scanning directory…' });

                const scanResult = importer.scan(dirPath);
                sendSSE(res, { type: 'progress', phase: 'matching', message: `Found ${scanResult.workspaces.length} workspace directories` });

                const workspaces = await store.getWorkspaces();
                const matchResult = importer.matchWorkspaces(scanResult, workspaces);
                sendSSE(res, {
                    type: 'progress',
                    phase: 'matching',
                    message: `Matched ${matchResult.matched.length} workspaces (${matchResult.totalMatchedProcesses} processes)`,
                });

                if (matchResult.matched.length === 0) {
                    sendSSE(res, { type: 'done', success: true, summary: { imported: 0, skipped: 0, failed: 0, perWorkspace: [] } });
                    res.end();
                    return;
                }

                const summary = importer.importProcesses(
                    matchResult,
                    scanResult.reposDir,
                    dbPath,
                    (event: ImportProgress) => {
                        sendSSE(res, { type: 'progress', ...event });
                    },
                );

                sendSSE(res, { type: 'done', success: true, summary });

                // Broadcast import event to WebSocket clients
                const wsServer = getWsServer?.();
                if (wsServer) {
                    wsServer.broadcastProcessEvent({
                        type: 'data-imported',
                        timestamp: Date.now(),
                        mode: 'directory-import',
                    } as any);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                sendSSE(res, { type: 'error', message });
                sendSSE(res, { type: 'done', success: false, error: message });
            } finally {
                res.end();
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/admin/providers/availability — per-provider SDK install check
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/providers/availability',
        handler: async (_req, res) => {
            const registry = options.sdkServiceRegistry;
            if (!registry || registry.size === 0) {
                sendJSON(res, 200, {});
                return;
            }
            const result: Record<string, { available: boolean; error?: string }> = {};
            await Promise.all(
                registry.getProviderNames().map(async (name) => {
                    try {
                        const avail = await registry.get(name)!.isAvailable();
                        result[name] = { available: avail.available, ...(avail.error ? { error: avail.error } : {}) };
                    } catch (err) {
                        result[name] = { available: false, error: err instanceof Error ? err.message : String(err) };
                    }
                }),
            );
            sendJSON(res, 200, result);
        },
    });
}
// ============================================================================

export interface BuiltInPrompt {
    id: string;
    title: string;
    group: string;
    source: string;
    description: string;
    /** Built-in default text. */
    text: string;
    /** Whether this prompt supports admin overrides. */
    editable?: boolean;
    /** Required template variable names that must appear in any override. */
    templateVars?: string[];
    /** Active override text, if set. */
    overrideText?: string;
    /** True when an override is currently active. */
    hasOverride?: boolean;
}

/** Return all built-in prompts as a record keyed by prompt id. */
export function getBuiltInPrompts(): Record<string, BuiltInPrompt> {
    return {
        'read-only-mode': {
            id: 'read-only-mode',
            title: 'Read-only Mode',
            group: 'Pipeline',
            source: 'forge/copilot-sdk-wrapper/types.ts',
            description: 'System message injected in Ask-mode sessions blocking file edits',
            text: READ_ONLY_SYSTEM_MESSAGE,
        },
        'task-creation': {
            id: 'task-creation',
            title: 'Task Creation',
            group: 'Pipeline',
            source: 'forge/tasks/task-prompt-builder.ts',
            description: 'Instructions for creating .plan.md files — naming, structure',
            text: `Can you draft a plan given user's ask: \${description}

**IMPORTANT: Output Location Requirement**
1. You MUST save the file to this EXACT directory: \${targetPath}
- Create a single .plan.md file
- Do NOT save to any other location
- Do NOT use your session state or any other directory
2. You MUST NOT implement the task, you are only responsible for creating the plan file.`,
        },
        'plan-generation': {
            id: 'plan-generation',
            title: 'Plan Generation',
            group: 'Pipeline',
            source: 'forge/tasks/task-prompt-builder.ts',
            description: 'System message governing plan document structure and output location',
            text: `You are a plan generator. Your sole responsibility is to produce a .plan.md file(s).

## Output Rules
\${locationBlock}
- File names MUST be kebab-case and end with \`.plan.md\` (e.g. \`oauth2-authentication.plan.md\`).
- You MUST NOT implement the plan. Only create the plan document.
- Do NOT save files to your session state or any directory other than the specified target.

## Plan Document Structure
The plan file should include:
- A clear title (H1)
- Problem statement and proposed approach
- Acceptance criteria
- Subtasks broken into actionable items
- Notes or open questions (if any)`,
        },
        'skill-prompt-wrapper': {
            id: 'skill-prompt-wrapper',
            title: 'Skill Prompt Wrapper',
            group: 'Pipeline',
            source: 'forge/pipeline/phases/prompt-resolution.ts',
            description: 'Section headers [Skill Guidance] / [Task] wrapping skill + main prompt',
            text: `[Skill Guidance: \${skillName}]
\${skillContent}

[Task]
\${mainPrompt}`,
        },
        'memory-tool-schema': {
            id: 'memory-tool-schema',
            title: 'Memory Tool — Schema & Behavioral Guidance',
            group: 'Memory',
            source: 'forge/memory/memory-tool.ts',
            description: 'Tool definition with add/replace/remove actions, capacity-awareness, and proactive-save guidance',
            text: MEMORY_SCHEMA,
        },
        'memory-security-patterns': {
            id: 'memory-security-patterns',
            title: 'Memory — Security Scanning Patterns',
            group: 'Memory',
            source: 'forge/memory/memory-security.ts',
            description: 'Injection/exfiltration patterns blocked before memory writes are accepted',
            text: SECURITY_PATTERNS_DESCRIPTION,
        },
        'follow-up-suggestions': {
            id: 'follow-up-suggestions',
            title: 'Follow-up Suggestions',
            group: 'UI',
            source: 'coc/server/suggest-follow-ups-tool.ts',
            description: 'Tool description controlling when/how AI calls suggest_follow_ups',
            text: 'After completing your response, call this tool to suggest 2-3 brief follow-up actions the user might want to take next. Each suggestion should be a short, direct action phrase (imperative, not a question) that continues the conversation — e.g., "Show an example", "Explain the config options", "Generate the fix". IMPORTANT: Never list follow-up suggestions in your response text. Always call this tool instead.',
        },
    };
}

/**
 * Return all built-in prompts annotated with any active admin overrides.
 * Called by GET /api/admin/prompts so the UI sees override state without a
 * separate request.
 */
export function getPromptsWithOverrides(dataDir: string): Record<string, BuiltInPrompt> {
    const builtins = getBuiltInPrompts();
    const overrides = getAllPromptOverrides(dataDir);
    for (const [id, overrideText] of Object.entries(overrides)) {
        if (builtins[id]) {
            builtins[id].overrideText = overrideText;
            builtins[id].hasOverride = true;
        }
    }
    return builtins;
}

/**
 * Validate a prompt override.  Returns an error message, or undefined if valid.
 * Currently only checks required template variables.
 */
export function validatePromptOverride(prompt: BuiltInPrompt, text: string): string | undefined {
    const vars = prompt.templateVars ?? [];
    const missing = vars.filter(v => !text.includes(v));
    if (missing.length > 0) {
        return `Override must contain required template variable(s): ${missing.join(', ')}`;
    }
    return undefined;
}
