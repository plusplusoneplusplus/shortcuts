import type * as http from 'node:http';
import { z } from 'zod';
import { sendError, sendJSON } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../shared/router';
import { isValidWorkspaceId } from '../tasks/comments/base-comments-manager';
import { SentinelTodoError, type SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import { RefrainError, refrainInputSchema, type SentinelRefrainStore } from './refrain-store';
import type { SentinelRefrainService } from './refrain-service';
import { SentinelRefrainCommands } from './refrain-commands';

const BASE = '/api/workspaces/([^/]+)/sentinel-todos/([^/]+)/jobs';
const revision = z.number().int().positive();
const updateSchema = refrainInputSchema.partial().extend({
    mode: refrainInputSchema.shape.mode.removeDefault().optional(),
    enabled: refrainInputSchema.shape.enabled.removeDefault().optional(),
    autoCompactThreshold: refrainInputSchema.shape.autoCompactThreshold.removeDefault().optional(),
    expectedRevision: revision,
}).strict();
const deleteSchema = z.object({ expectedRevision: revision }).strict();

export function registerSentinelRefrainRoutes(opts: {
    routes: Route[];
    jobs: SentinelRefrainStore;
    service: SentinelRefrainService;
    onConfigChange?: () => void;
    /** Shared with the `sentinel_jobs` tool; built from the options above when omitted. */
    commands?: SentinelRefrainCommands;
}): void {
    const commands = opts.commands ?? new SentinelRefrainCommands(opts);
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
                if (error instanceof RefrainError || error instanceof SentinelTodoError) {
                    const status = { invalid: 400, not_found: 404, conflict: 409, limit: 400 }[error.code];
                    return sendJSON(res, status, { error: error.message, code: error.code });
                }
                console.error('[sentinel-jobs] Job request failed:', error);
                return sendError(res, 500, 'Failed to update Sentinel refrains');
            }
        },
    });
    const body = async <T>(req: http.IncomingMessage, res: http.ServerResponse, schema: z.ZodType<T>): Promise<T | undefined> => {
        const value = await parseBodyOrReject(req, res);
        if (value === null) { if (!res.headersSent) sendError(res, 400, 'Expected an object'); return; }
        const result = schema.safeParse(value);
        if (!result.success) { sendError(res, 400, 'Invalid refrain settings'); return; }
        return result.data;
    };
    add('GET', '', async (_req, res, owner) => sendJSON(res, 200, { jobs: await commands.list(owner) }));
    add('POST', '', async (req, res, owner) => {
        const input = await body(req, res, refrainInputSchema);
        if (!input) return;
        sendJSON(res, 201, await commands.create(owner, input));
    });
    add('PATCH', '/([^/]+)', async (req, res, owner, match) => {
        const input = await body(req, res, updateSchema);
        if (!input) return;
        const { expectedRevision, ...settings } = input;
        sendJSON(res, 200, await commands.update(owner, decodeURIComponent(match[3]), settings, expectedRevision));
    });
    add('DELETE', '/([^/]+)', async (req, res, owner, match) => {
        const input = await body(req, res, deleteSchema);
        if (!input) return;
        await commands.delete(owner, decodeURIComponent(match[3]), input.expectedRevision);
        sendJSON(res, 200, { deleted: true });
    });
    add('POST', '/([^/]+)/runs', async (_req, res, owner, match) =>
        sendJSON(res, 202, await commands.start(owner, decodeURIComponent(match[3]))));
    add('POST', '/([^/]+)/runs/([^/]+)/cancel', async (_req, res, owner, match) =>
        sendJSON(res, 200, await commands.cancel(owner, decodeURIComponent(match[3]), decodeURIComponent(match[4]))));
    add('POST', '/([^/]+)/gate/test', async (_req, res, owner, match) => {
        // A client that leaves before the result arrives cancels the gate run.
        const controller = new AbortController();
        res.once('close', () => controller.abort(new Error('The request was closed')));
        sendJSON(res, 200, await commands.testGate(owner, decodeURIComponent(match[3]), controller.signal));
    });
    add('POST', '/([^/]+)/gate/resume', async (_req, res, owner, match) =>
        sendJSON(res, 200, await commands.resumeGate(owner, decodeURIComponent(match[3]))));
}
