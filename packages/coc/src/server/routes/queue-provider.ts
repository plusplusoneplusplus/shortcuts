import { isEffortTierKey, isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import { parse } from 'url';
import { parseBody, sendError, sendJSON } from '../core/api-handler';
import { resolveChatProvider, VALID_CHAT_PROVIDERS } from '../tasks/task-types';
import type { Route } from '../types';
import { getRestartUnsupportedReason, resolveEffortTierConfig } from './queue-enqueue';
import { getManagerByRepoIdentifier, serializeTask, type QueueRouteContext } from './queue-shared';

/** Provider edits apply only to independent first turns still in their owner's queue. */
export function registerQueueProviderRoutes(routes: Route[], ctx: QueueRouteContext): void {
    for (const method of ['GET', 'PATCH']) {
        routes.push({
            method,
            pattern: /^\/api\/queue\/([^/]+)\/provider$/,
            handler: async (req, res, match) => {
                const workspace = parse(req.url!, true).query.workspace;
                if (typeof workspace !== 'string' || !workspace) return sendError(res, 400, 'workspace is required');
                const manager = await getManagerByRepoIdentifier(workspace, ctx.bridge, ctx.store);
                const rawId = decodeURIComponent(match![1]);
                const id = isQueueProcessId(rawId) ? toTaskId(rawId) : rawId;
                const task = manager?.getTask(id);
                if (!manager || !task || task.repoId !== workspace) return sendError(res, 404, 'Task not found in workspace');
                const editable = () => manager.getTask(id) === task && task.repoId === workspace && task.status === 'queued'
                    && !task.payload.processId && !task.payload.resumedFrom
                    && !getRestartUnsupportedReason(task.type, task.payload);
                if (!editable()) return sendError(res, 409, 'Only queued independent Ask/Autopilot chats can change provider');

                if (method === 'GET') {
                    const providers = await Promise.all([...VALID_CHAT_PROVIDERS].map(async provider => {
                        try {
                            await ctx.validateProvider?.(provider);
                            return provider;
                        } catch { return undefined; }
                    }));
                    if (!editable()) return sendError(res, 409, 'Task is no longer queued');
                    return sendJSON(res, 200, { providers: [
                        ...(ctx.isAutoProviderRoutingActive?.() ? ['auto'] : []),
                        ...providers.filter(Boolean),
                    ] });
                }

                let body: any;
                try { body = await parseBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }
                const provider = body?.provider;
                if (provider !== 'auto' && !resolveChatProvider(provider)) return sendError(res, 400, 'Invalid provider');
                try {
                    if (provider === 'auto') {
                        if (!ctx.isAutoProviderRoutingActive?.()) throw new Error('Auto provider routing is disabled');
                    } else {
                        await ctx.validateProvider?.(provider);
                    }
                } catch (error) {
                    return sendError(res, 400, error instanceof Error ? error.message : 'Provider is unavailable');
                }

                // No awaits between this check and updateTask: the executor cannot start
                // the job while its provider/config are being replaced.
                if (!editable()) return sendError(res, 409, 'Task is no longer queued');
                const original = task.payload;
                const payload: Record<string, unknown> & { context: Record<string, unknown> } = {
                    ...original,
                    context: { ...(original.context as Record<string, unknown> | undefined) },
                };
                const config: typeof task.config & { effortTier?: unknown; afterEffortTier?: unknown } = { ...task.config };
                const current = payload.provider ?? ((payload.context.autoProviderRouting as { requested?: boolean } | undefined)?.requested ? 'auto' : undefined);
                if (current !== provider) {
                    delete payload.provider;
                    delete payload.model;
                    delete payload.reasoningEffort;
                    delete payload.context.autoProviderRouting;
                    delete config.model;
                    delete config.reasoningEffort;
                    if (provider === 'auto') payload.context.autoProviderRouting = { requested: true };
                    else payload.provider = provider;
                    // A tier is user intent; resolve it against the new provider's map.
                    const tier = config.afterEffortTier ?? config.effortTier;
                    if (isEffortTierKey(tier)) {
                        config.effortTier = tier;
                        resolveEffortTierConfig({ ...task, payload, config }, ctx);
                    }
                    task.config = config;
                    // The normal queue event persists the complete task and broadcasts it.
                    manager.updateTask(id, { payload });
                }
                return sendJSON(res, 200, { task: serializeTask(task) });
            },
        });
    }
}
