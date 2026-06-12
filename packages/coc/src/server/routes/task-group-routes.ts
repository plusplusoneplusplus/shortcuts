import * as url from 'url';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound } from '../errors';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { TaskGroupService } from '../task-groups/task-group-service';

export interface TaskGroupRouteContext {
    routes: Route[];
    store: ProcessStore;
    taskGroupService: TaskGroupService;
}

/**
 * Generic task-group registry routes. Always registered — the registry is
 * relationship infrastructure, not a feature: an empty workspace simply
 * returns an empty list.
 */
export function registerTaskGroupRoutes(ctx: TaskGroupRouteContext): void {
    const { routes, store, taskGroupService } = ctx;

    // GET /api/workspaces/:id/task-groups?type=&includeHidden=
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/task-groups$/,
        handler: async (req, res, match) => {
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) {return;}

            const query = url.parse(req.url || '', true).query;
            const type = typeof query.type === 'string' && query.type.trim() ? query.type.trim() : undefined;
            const includeHidden = query.includeHidden === 'true';

            const groups = taskGroupService.listGroups(workspace.id, { type, includeHidden });
            sendJSON(res, 200, { groups });
        },
    });

    // GET /api/workspaces/:id/task-groups/:groupId
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/task-groups\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) {return;}

            const groupId = decodeURIComponent(match![2]);
            const group = taskGroupService.getGroup(workspace.id, groupId);
            if (!group) {
                handleAPIError(res, notFound('Task group'));
                return;
            }
            sendJSON(res, 200, { group });
        },
    });
}
