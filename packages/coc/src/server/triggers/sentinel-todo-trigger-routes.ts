import { sendJSON, sendError } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import { SentinelTodoError } from '../sentinel-todos/sentinel-todo-store';
import { SentinelTodoTriggerError, type SentinelTodoTriggerService } from './sentinel-todo-trigger-service';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';

const base = '/api/workspaces/([^/]+)/sentinel-todos/([^/]+)/triggers';

export function registerSentinelTodoTriggerRoutes(
    routes: Route[], service: SentinelTodoTriggerService, enabled: boolean,
): void {
    const register = (
        method: Route['method'], suffix: string,
        operation: (owner: { workspaceId: string; processId: string }, id: string, body: unknown) => Promise<unknown>,
        status = 200,
    ) => routes.push({
        method, pattern: new RegExp(`^${base}${suffix}$`),
        handler: async (req, res, match) => {
            if (!enabled) return sendError(res, 403, 'Triggers are disabled (triggers.enabled is off)');
            try {
                const owner = { workspaceId: decodeURIComponent(match![1]), processId: decodeURIComponent(match![2]) };
                const id = match![3] ? decodeURIComponent(match![3]) : '';
                const body: unknown = method === 'GET' ? {} : await parseBodyOrReject(req, res);
                if (body === null) return;
                sendJSON(res, status, await operation(owner, id, body));
            } catch (error) {
                if (error instanceof SentinelTodoTriggerError) {
                    return sendJSON(res, error.statusCode, {
                        error: error.message, ...(error.current ? { current: error.current } : {}),
                    });
                }
                if (error instanceof SentinelTodoError) {
                    return sendError(res, error.code === 'not_found' ? 404 : 400, error.message);
                }
                if (error instanceof URIError) return sendError(res, 400, 'Invalid route encoding');
                getLogger().error(LogCategory.AI, `[SentinelTodoTriggerRoutes] Operation failed: ${String(error)}`);
                sendError(res, 500, 'Trigger operation failed');
            }
        },
    });
    register('GET', '', async owner => ({ triggers: await service.list(owner) }));
    register('POST', '', async (owner, _id, body) => ({ trigger: await service.create(owner, body, 'user') }), 201);
    register('POST', '/preview', (owner, _id, body) => service.preview(owner, body));
    register('PATCH', '/([^/]+)', async (owner, id, body) => ({ trigger: await service.edit(owner, id, body) }));
    register('DELETE', '/([^/]+)', async (owner, id, body) => ({ deleted: true, trigger: await service.remove(owner, id, body) }));
    register('POST', '/([^/]+)/pause', async (owner, id, body) => ({ trigger: await service.setPaused(owner, id, body, true) }));
    register('POST', '/([^/]+)/resume', async (owner, id, body) => ({ trigger: await service.setPaused(owner, id, body, false) }));
    register('POST', '/([^/]+)/run-now', async (owner, id, body) => ({ trigger: await service.runNow(owner, id, body) }));
}
