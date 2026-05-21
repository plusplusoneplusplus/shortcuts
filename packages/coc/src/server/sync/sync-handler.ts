/**
 * REST handler for the per-workspace sync subsystem.
 *
 * POST /api/workspaces/:workspaceId/sync/trigger  — force an immediate sync
 * GET  /api/workspaces/:workspaceId/sync/status   — current sync status
 */

import type { Route } from '../types';
import type { SyncEngine } from './sync-engine';
import type { PerRepoPreferences } from '../preferences-handler';

/** Valid workspace IDs that support sync. */
const SYNC_WORKSPACE_IDS = new Set(['my_work', 'my_life']);

export function registerSyncRoutes(
    routes: Route[],
    getSyncEngine: (workspaceId: string) => SyncEngine | undefined,
    getPreferences: (workspaceId: string) => PerRepoPreferences | undefined,
): void {
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/sync\/status$/,
        handler: (_req, res, match) => {
            const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            if (!workspaceId || !SYNC_WORKSPACE_IDS.has(workspaceId)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Sync not available for this workspace' }));
                return;
            }
            const engine = getSyncEngine(workspaceId);
            if (!engine) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    enabled: false,
                    inProgress: false,
                    lastSyncTime: null,
                    lastError: null,
                }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(engine.getStatus()));
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/sync\/trigger$/,
        handler: async (_req, res, match) => {
            const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            if (!workspaceId || !SYNC_WORKSPACE_IDS.has(workspaceId)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Sync not available for this workspace' }));
                return;
            }
            const engine = getSyncEngine(workspaceId);
            const prefs = getPreferences(workspaceId);
            const gitRemote = prefs?.sync?.gitRemote;
            if (!engine || !gitRemote) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Sync is not configured' }));
                return;
            }

            try {
                const status = await engine.triggerSync(gitRemote);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(status));
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: message }));
            }
        },
    });
}
