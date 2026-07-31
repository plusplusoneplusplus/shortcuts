/**
 * Admin Storage Routes
 *
 * Storage backend status, SQLite migration (SSE + cancel), and directory
 * history import (scan + SSE import). Owns the private `activeMigration` state
 * and its own confirmation token managers.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { parseBody, sendJSON } from '../core/api-handler';
import { badRequest, forbidden, handleAPIError, invalidJSON } from '../errors';
import type { ImportProgress } from '../storage/directory-history-importer';
import { DirectoryHistoryImporter } from '../storage/directory-history-importer';
import type { MigrationProgress } from '../storage/storage-migration';
import { StorageMigrationEngine } from '../storage/storage-migration';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { Route } from '../types';
import { sendSSE } from '../wiki/ask-handler';
import type { AdminRouteOptions } from './admin-route-types';
import { resolveConfigPath } from './admin-route-types';
import { TokenManager } from './token-manager';

/** Register storage status / migration / directory-import routes. */
export function registerStorageRoutes(routes: Route[], options: AdminRouteOptions): void {
    const { store, dataDir, getWsServer, configFunctions } = options;
    const resolvedConfigPath = resolveConfigPath(options);

    // Route-scoped token managers — isolated per server instance; TTL configurable for tests.
    const routeMigrateTokenMgr = new TokenManager(options.tokenTtlMs);
    const routeDirImportTokenMgr = new TokenManager(options.tokenTtlMs);

    // Private migration state — a single migration may run at a time.
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
                const wsServer: ProcessWebSocketServer | undefined = getWsServer?.();
                if (wsServer) {
                    wsServer.broadcastProcessEvent({
                        type: 'data-imported',
                        timestamp: Date.now(),
                        mode: 'directory-import',
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
}
