import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON } from '../core/api-handler';
import { badRequest, handleAPIError } from '../errors';
import { parseBodyOrReject, resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { Route } from '../types';
import { GroupPinStore, isGroupPinType, normalizeGroupId } from './group-pin-store';

export function registerGroupPinRoutes(routes: Route[], store: ProcessStore, dataDir: string): void {
    const groupPinStore = new GroupPinStore(dataDir);

    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/group-pins$/,
        handler: async (_req, res, match) => {
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) return;

            sendJSON(res, 200, { pins: groupPinStore.listPins(workspace.id) });
        },
    });

    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/group-pins\/([^/]+)\/([^/]+)$/,
        handler: async (req, res, match) => {
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) return;

            const type = decodeURIComponent(match![2]);
            if (!isGroupPinType(type)) {
                handleAPIError(res, badRequest('Invalid group pin type', { allowedTypes: ['ralph-session', 'for-each-run'] }));
                return;
            }

            const groupId = normalizeGroupId(decodeURIComponent(match![3]));
            if (!groupId) {
                handleAPIError(res, badRequest('Invalid group ID'));
                return;
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (typeof body?.pinned !== 'boolean') {
                handleAPIError(res, badRequest('Body must contain pinned: boolean'));
                return;
            }

            const now = new Date().toISOString();
            if (body.pinned) {
                const pin = groupPinStore.setPin(workspace.id, type, groupId, now);
                sendJSON(res, 200, { pin });
                return;
            }

            groupPinStore.clearPin(workspace.id, type, groupId, now);
            sendJSON(res, 200, { pin: null });
        },
    });
}
