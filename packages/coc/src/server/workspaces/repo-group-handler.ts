/**
 * Repo-Group REST API Handler.
 *
 * CRUD endpoints for repo-group virtual workspaces. Creation and updates
 * validate membership against the workspace registry (only registered,
 * non-virtual repo workspaces may be members); reads resolve members
 * against the live registry so stale entries surface in the edit dialog.
 * Deleting a group only deregisters the workspace — its data directory
 * stays on disk.
 */

import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, badRequest, notFound, missingFields } from '../errors';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import {
    createRepoGroup,
    deleteRepoGroup,
    readRepoGroup,
    resolveRepoGroupMembers,
    updateRepoGroup,
    RepoGroupValidationError,
} from './repo-group-workspace';

/** Minimal broadcast surface of the process WebSocket server. */
interface TopologyBroadcaster {
    broadcastProcessEvent(event: {
        type: 'workspace-topology-changed';
        workspaceId: string;
        action: 'added' | 'updated' | 'removed';
        timestamp: number;
    }): void;
}

export interface RepoGroupRouteDeps {
    /** Broadcast workspace topology changes to connected dashboard clients. */
    getWsServer?: () => TopologyBroadcaster | undefined;
    /**
     * Called after a new group workspace is registered so the server can wire
     * runtime services (queue-bridge repo-id map, schedule manager) the same
     * way the startup workspace sweep does for pre-existing workspaces.
     */
    onGroupRegistered?: (ws: WorkspaceInfo) => void | Promise<void>;
}

/** Members must arrive as an array of workspace-ID strings. */
function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function registerRepoGroupRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
    deps: RepoGroupRouteDeps = {},
): void {

    function broadcast(workspaceId: string, action: 'added' | 'updated' | 'removed'): void {
        deps.getWsServer?.()?.broadcastProcessEvent({
            type: 'workspace-topology-changed',
            workspaceId,
            action,
            timestamp: Date.now(),
        });
    }

    // ------------------------------------------------------------------
    // POST /api/repo-groups — Create a repo group
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/repo-groups',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.name !== 'string' || body.members === undefined) {
                return handleAPIError(res, missingFields(['name', 'members']));
            }
            if (!isStringArray(body.members)) {
                return handleAPIError(res, badRequest('members must be an array of workspace IDs'));
            }
            try {
                const ws = await createRepoGroup(dataDir, store, { name: body.name, members: body.members });
                await deps.onGroupRegistered?.(ws);
                broadcast(ws.id, 'added');
                const members = await resolveRepoGroupMembers(dataDir, store, ws.id);
                sendJSON(res, 201, { workspace: ws, members });
            } catch (err) {
                handleAPIError(res, err instanceof RepoGroupValidationError ? badRequest(err.message) : err);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/repo-groups/:id — Membership file + registry-resolved members
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/repo-groups\/([^/]+)$/,
        handler: async (_req, res, match) => {
            try {
                const id = decodeURIComponent(match![1]);
                const file = readRepoGroup(dataDir, id);
                if (!file) {
                    return handleAPIError(res, notFound('Repo group'));
                }
                const members = await resolveRepoGroupMembers(dataDir, store, id);
                sendJSON(res, 200, { id, name: file.name, members });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/repo-groups/:id — Rename and/or replace membership
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/repo-groups\/([^/]+)$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (body.name !== undefined && typeof body.name !== 'string') {
                return handleAPIError(res, badRequest('name must be a string'));
            }
            if (body.members !== undefined && !isStringArray(body.members)) {
                return handleAPIError(res, badRequest('members must be an array of workspace IDs'));
            }
            try {
                const id = decodeURIComponent(match![1]);
                const updated = await updateRepoGroup(dataDir, store, id, {
                    name: body.name,
                    members: body.members,
                });
                if (!updated) {
                    return handleAPIError(res, notFound('Repo group'));
                }
                broadcast(id, 'updated');
                const members = await resolveRepoGroupMembers(dataDir, store, id);
                sendJSON(res, 200, { id, name: updated.name, members });
            } catch (err) {
                handleAPIError(res, err instanceof RepoGroupValidationError ? badRequest(err.message) : err);
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/repo-groups/:id — Deregister; data stays on disk
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/repo-groups\/([^/]+)$/,
        handler: async (_req, res, match) => {
            try {
                const id = decodeURIComponent(match![1]);
                const removed = await deleteRepoGroup(store, id);
                if (!removed) {
                    return handleAPIError(res, notFound('Repo group'));
                }
                broadcast(id, 'removed');
                res.writeHead(204);
                res.end();
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });
}
