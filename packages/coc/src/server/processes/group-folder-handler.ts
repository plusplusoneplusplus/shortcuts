/**
 * HTTP API for filing a whole chat *group* into a chat folder.
 *
 * Sits alongside `chat-folder-handler.ts`, which files individual processes.
 * The split exists because a group has no process row to file — see
 * `group-folder-store.ts` for why membership is keyed on the group instead.
 */

import { sendJSON } from '../core/api-handler';
import { parseBodyOrReject, resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { parseFolderIdField, resolveTargetFolder, type ChatFolderGroupStore } from './chat-folder-handler';
import {
    GroupFolderStore,
    normalizeGroupFolderId,
    normalizeGroupFolderType,
} from './group-folder-store';

export function registerGroupFolderRoutes(
    routes: Route[],
    store: ProcessStore,
    groups: ChatFolderGroupStore,
    groupFolders: GroupFolderStore,
): void {
    // GET /api/workspaces/:workspaceId/group-folders — the whole map
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/group-folders$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            sendJSON(res, 200, {
                groups: groupFolders.getFolderMap(ws.id),
                assignments: groupFolders.listAssignments(ws.id),
            });
        },
    });

    // PATCH /api/workspaces/:workspaceId/group-folders/:type/:groupId — file or unfile a group
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/group-folders\/([^/]+)\/([^/]+)$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const type = normalizeGroupFolderType(decodeURIComponent(match![2]));
            if (!type) {
                sendJSON(res, 400, { error: 'Invalid group type' });
                return;
            }

            const groupId = normalizeGroupFolderId(decodeURIComponent(match![3]));
            if (!groupId) {
                sendJSON(res, 400, { error: 'Invalid group ID' });
                return;
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const folderId = parseFolderIdField(body);
            if (!folderId.ok) {
                sendJSON(res, 400, { error: folderId.error });
                return;
            }

            const now = new Date().toISOString();
            if (folderId.value === null) {
                groupFolders.clearFolder(ws.id, type, groupId, now);
                sendJSON(res, 200, { type, groupId, folderId: null });
                return;
            }

            // Checked at write time, like the single-chat move: a concurrent
            // folder delete makes this reject rather than strand the group.
            if (!resolveTargetFolder(groups, ws.id, folderId.value, res)) return;

            const assignment = groupFolders.setFolder(ws.id, type, groupId, folderId.value, now);
            sendJSON(res, 200, assignment);
        },
    });
}
