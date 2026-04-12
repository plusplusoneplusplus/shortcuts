/**
 * Pin & Archive REST API Handler
 *
 * HTTP API routes for managing pinned and archived state of processes.
 * Delegates to SqliteProcessStore's pin/archive methods.
 */

import { sendJSON } from './api-handler';
import { parseBodyOrReject } from './shared/handler-utils';
import type { Route } from './types';
import type { ProcessIndexEntry } from '@plusplusoneplusplus/forge';

// ============================================================================
// Types
// ============================================================================

/** Narrow interface for the pin/archive store methods. */
export interface PinArchiveStore {
    pinProcess(id: string, pinnedAt: string): void;
    unpinProcess(id: string): void;
    archiveProcess(id: string): void;
    unarchiveProcess(id: string): void;
    archiveProcesses(ids: string[]): void;
    unarchiveProcesses(ids: string[]): void;
    getPinnedProcesses(workspaceId: string): ProcessIndexEntry[];
}

// ============================================================================
// Route registration
// ============================================================================

export function registerPinArchiveRoutes(routes: Route[], store: PinArchiveStore): void {
    // PATCH /api/processes/:id/pin — toggle or set pinned_at
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/processes\/([^/]+)\/pin$/,
        handler: async (_req, res, match) => {
            const processId = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(_req, res);
            if (body === null) return;

            const pinned = (body as any).pinned;
            if (pinned === false) {
                store.unpinProcess(processId);
                sendJSON(res, 200, { id: processId, pinnedAt: null });
            } else {
                const pinnedAt = new Date().toISOString();
                store.pinProcess(processId, pinnedAt);
                sendJSON(res, 200, { id: processId, pinnedAt });
            }
        },
    });

    // PATCH /api/processes/:id/archive — toggle or set archived
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/processes\/([^/]+)\/archive$/,
        handler: async (_req, res, match) => {
            const processId = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(_req, res);
            if (body === null) return;

            const archived = (body as any).archived;
            if (archived === false) {
                store.unarchiveProcess(processId);
                sendJSON(res, 200, { id: processId, archived: false });
            } else {
                store.archiveProcess(processId);
                sendJSON(res, 200, { id: processId, archived: true });
            }
        },
    });

    // POST /api/processes/archive — batch archive
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/archive$/,
        handler: async (_req, res) => {
            const body = await parseBodyOrReject(_req, res);
            if (body === null) return;

            const ids = (body as any).ids;
            if (!Array.isArray(ids) || ids.some((id: unknown) => typeof id !== 'string')) {
                sendJSON(res, 400, { error: 'Body must contain ids: string[]' });
                return;
            }
            store.archiveProcesses(ids);
            sendJSON(res, 200, { archived: ids });
        },
    });

    // POST /api/processes/unarchive — batch unarchive
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/unarchive$/,
        handler: async (_req, res) => {
            const body = await parseBodyOrReject(_req, res);
            if (body === null) return;

            const ids = (body as any).ids;
            if (!Array.isArray(ids) || ids.some((id: unknown) => typeof id !== 'string')) {
                sendJSON(res, 400, { error: 'Body must contain ids: string[]' });
                return;
            }
            store.unarchiveProcesses(ids);
            sendJSON(res, 200, { unarchived: ids });
        },
    });

    // GET /api/workspaces/:id/pinned — get pinned processes for a workspace
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/pinned$/,
        handler: async (_req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const entries = store.getPinnedProcesses(workspaceId);
            sendJSON(res, 200, { entries });
        },
    });
}
