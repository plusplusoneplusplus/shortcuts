import type * as http from 'node:http';
import { z } from 'zod';
import { sendError, sendJSON } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../shared/router';
import { isValidWorkspaceId } from '../tasks/comments/base-comments-manager';
import { SentinelTodoError, type SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import { JobError, jobInputSchema, type SentinelJobStore } from './job-store';
import type { SentinelJobService } from './job-service';

const BASE = '/api/workspaces/([^/]+)/sentinel-todos/([^/]+)/jobs';
const revision = z.number().int().positive();
const updateSchema = jobInputSchema.partial().extend({
    mode: jobInputSchema.shape.mode.removeDefault().optional(),
    enabled: jobInputSchema.shape.enabled.removeDefault().optional(),
    autoCompactThreshold: jobInputSchema.shape.autoCompactThreshold.removeDefault().optional(),
    expectedRevision: revision,
}).strict();
const deleteSchema = z.object({ expectedRevision: revision }).strict();

export function registerSentinelJobRoutes(opts: {
    routes: Route[];
    jobs: SentinelJobStore;
    service: SentinelJobService;
    onConfigChange?: () => void;
}): void {
    const add = (method: string, suffix: string, command: (
        req: http.IncomingMessage, res: http.ServerResponse, owner: SentinelTodoOwner, match: RegExpMatchArray,
    ) => Promise<unknown>) => opts.routes.push({
        method, pattern: new RegExp(`^${BASE}${suffix}$`),
        handler: async (req, res, match) => {
            try {
                const owner = { workspaceId: decodeURIComponent(match![1]), processId: decodeURIComponent(match![2]) };
                if (!isValidWorkspaceId(owner.workspaceId) || !owner.processId || owner.processId.includes('/')) {
                    return sendError(res, 400, 'Invalid workspace or chat');
                }
                await opts.service.assertOwner(owner);
                await command(req, res, owner, match!);
            } catch (error) {
                if (error instanceof URIError) return sendError(res, 400, 'Invalid URL encoding');
                if (error instanceof JobError || error instanceof SentinelTodoError) {
                    const status = { invalid: 400, not_found: 404, conflict: 409, limit: 400 }[error.code];
                    return sendJSON(res, status, { error: error.message, code: error.code });
                }
                console.error('[sentinel-jobs] Job request failed:', error);
                return sendError(res, 500, 'Failed to update Sentinel jobs');
            }
        },
    });
    const body = async <T>(req: http.IncomingMessage, res: http.ServerResponse, schema: z.ZodType<T>): Promise<T | undefined> => {
        const value = await parseBodyOrReject(req, res);
        if (value === null) { if (!res.headersSent) sendError(res, 400, 'Expected an object'); return; }
        const result = schema.safeParse(value);
        if (!result.success) { sendError(res, 400, 'Invalid job settings'); return; }
        return result.data;
    };
    add('GET', '', async (_req, res, owner) => sendJSON(res, 200,
        { jobs: opts.jobs.list(owner).map(job => opts.service.view(owner, job)) }));
    add('POST', '', async (req, res, owner) => {
        const input = await body(req, res, jobInputSchema);
        if (!input) return;
        await opts.service.assertOwner(owner);
        const job = opts.jobs.create(owner, input);
        opts.onConfigChange?.();
        sendJSON(res, 201, opts.service.view(owner, job));
    });
    add('PATCH', '/([^/]+)', async (req, res, owner, match) => {
        const input = await body(req, res, updateSchema);
        if (!input) return;
        await opts.service.assertOwner(owner);
        const { expectedRevision, ...settings } = input;
        const job = opts.jobs.update(owner, decodeURIComponent(match[3]), settings, expectedRevision);
        opts.onConfigChange?.();
        sendJSON(res, 200, opts.service.view(owner, job));
    });
    add('DELETE', '/([^/]+)', async (req, res, owner, match) => {
        const input = await body(req, res, deleteSchema);
        if (!input) return;
        await opts.service.assertOwner(owner);
        const id = decodeURIComponent(match[3]);
        opts.jobs.delete(owner, id, input.expectedRevision);
        opts.onConfigChange?.();
        await opts.service.removeSnapshots(owner, id);
        sendJSON(res, 200, { deleted: true });
    });
    add('POST', '/([^/]+)/runs', async (_req, res, owner, match) =>
        sendJSON(res, 202, await opts.service.start(owner, decodeURIComponent(match[3]))));
    add('POST', '/([^/]+)/runs/([^/]+)/cancel', async (_req, res, owner, match) =>
        sendJSON(res, 200, await opts.service.cancel(owner, decodeURIComponent(match[3]), decodeURIComponent(match[4]))));
}
