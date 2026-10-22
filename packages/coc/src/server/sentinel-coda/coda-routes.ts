import type * as http from 'node:http';
import { z } from 'zod';
import { sendError, sendJSON } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../shared/router';
import { isValidWorkspaceId } from '../tasks/comments/base-comments-manager';
import type { SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';
import { SentinelTodoError, type SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import type { CodaEngine } from './coda-engine';
import { CodaCommands } from './coda-commands';
import type { CodaRunService } from './coda-runs';
import { CodaStoreError, type CodaStore } from './coda-store';

const BASE = '/api/workspaces/([^/]+)/sentinel-todos/([^/]+)/scrubber';
const configSchema = z.object({
    enabled: z.boolean(), cron: z.string().trim().min(1).max(200), expectedRevision: z.number().int().nonnegative(),
}).strict();
const startSchema = z.object({ itemIds: z.array(z.string().min(1).max(200)).min(1).max(500).optional() }).strict();
const actionSchema = z.object({ expectedItemRevision: z.number().int().positive() }).strict();

/** Owner-validated REST commands. Remote callers use their ledger's owning server. */
export function registerCodaRoutes(opts: {
    routes: Route[];
    todos: Pick<SentinelTodoService, 'assertOwner'>;
    scrubber: CodaStore;
    engine: Pick<CodaEngine, 'accept' | 'dismiss' | 'undo'>;
    runs: Pick<CodaRunService, 'start' | 'cancel'>;
    /** True only when the scrubber flag is enabled. */
    getEnabled: () => boolean;
    onChange?: (owner: SentinelTodoOwner, change: { runId?: string; ledgerChanged?: boolean; configChanged?: boolean }) => void;
    /** Shared with the `sentinel_jobs` tool; built from the options above when omitted. */
    commands?: CodaCommands;
}): void {
    const { routes, todos, scrubber, engine } = opts;
    const commands = opts.commands ?? new CodaCommands(opts);
    const fail = (res: http.ServerResponse, error: unknown) => {
        if (error instanceof CodaStoreError || error instanceof SentinelTodoError) {
            const status = { not_found: 404, conflict: 409, invalid: 400, limit: 400 }[error.code];
            return sendJSON(res, status, { error: error.message, code: error.code,
                ...(error instanceof SentinelTodoError && error.current ? { current: error.current } : {}) });
        }
        return sendError(res, 500, 'Failed to update Coda');
    };
    const add = (method: string, suffix: string, command: (
        req: http.IncomingMessage, res: http.ServerResponse, owner: SentinelTodoOwner, match: RegExpMatchArray,
    ) => Promise<unknown>) => routes.push({
        method, pattern: new RegExp(`^${BASE}${suffix}$`),
        handler: async (req, res, match) => {
            if (!opts.getEnabled()) return sendError(res, 404, 'Sentinel Coda is disabled');
            try {
                const owner = { workspaceId: decodeURIComponent(match![1]), processId: decodeURIComponent(match![2]) };
                if (!isValidWorkspaceId(owner.workspaceId) || !owner.processId || owner.processId.includes('/')) {
                    return sendError(res, 400, 'Invalid workspace or chat');
                }
                // Prove the Sentinel/workspace identity before any scrubber read or write.
                await todos.assertOwner(owner);
                await command(req, res, owner, match!);
            } catch (error) {
                if (error instanceof URIError) return sendError(res, 400, 'Invalid URL encoding');
                fail(res, error);
            }
        },
    });
    add('GET', '', async (_req, res, owner) => sendJSON(res, 200, await commands.view(owner)));
    add('PUT', '/config', async (req, res, owner) => {
        const body = await parseBodyOrReject(req, res);
        if (body === null) {
            if (!res.headersSent) sendError(res, 400, 'Expected an object');
            return;
        }
        const parsed = configSchema.safeParse(body);
        if (!parsed.success) return sendError(res, 400, 'Invalid Coda configuration');
        const { expectedRevision, ...input } = parsed.data;
        sendJSON(res, 200, await commands.putConfig(owner, input, expectedRevision));
    });
    add('POST', '/runs', async (req, res, owner) => {
        const body = await parseBodyOrReject(req, res);
        if (body === null) {
            if (!res.headersSent) sendError(res, 400, 'Expected an object');
            return;
        }
        const parsed = startSchema.safeParse(body ?? {});
        if (!parsed.success) return sendError(res, 400, 'Invalid Coda selection');
        const run = await commands.start(owner, parsed.data.itemIds);
        sendJSON(res, 202, { runId: run.id, processId: run.childProcessId });
    });
    add('GET', '/runs/([^/]+)', async (_req, res, owner, match) => {
        const run = scrubber.getRun(owner, decodeURIComponent(match[3]));
        if (!run) throw new CodaStoreError('not_found', 'Coda run not found');
        sendJSON(res, 200, { ...run, findings: scrubber.listFindings(owner, run.id) });
    });
    add('POST', '/runs/([^/]+)/cancel', async (_req, res, owner, match) => {
        sendJSON(res, 200, await commands.cancel(owner, decodeURIComponent(match[3])));
    });
    add('POST', '/runs/([^/]+)/findings/([^/]+)/(accept|dismiss|undo)', async (req, res, owner, match) => {
        const body = await parseBodyOrReject(req, res);
        if (body === null) {
            if (!res.headersSent) sendError(res, 400, 'Expected an object');
            return;
        }
        const parsed = actionSchema.safeParse(body);
        if (!parsed.success) return sendError(res, 400, 'Missing or invalid expectedItemRevision');
        const runId = decodeURIComponent(match[3]);
        const itemId = decodeURIComponent(match[4]);
        const action = match[5];
        const result = action === 'dismiss' ? { finding: engine.dismiss(owner, runId, itemId) }
            : engine[action as 'accept' | 'undo'](owner, runId, itemId, parsed.data.expectedItemRevision);
        opts.onChange?.(owner, { runId, ledgerChanged: action !== 'dismiss' });
        sendJSON(res, 200, result);
    });
}
