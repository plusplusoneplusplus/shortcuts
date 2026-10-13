import type * as http from 'node:http';
import { z } from 'zod';
import { sendError, sendJSON } from '../core/api-handler';
import { nextCronTime } from '../schedule/cron-utils';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../shared/router';
import { isValidWorkspaceId } from '../tasks/comments/base-comments-manager';
import type { SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';
import { SentinelTodoError, type SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import type { ScrubberEngine } from './scrubber-engine';
import { validateScrubCron } from './scrubber-model';
import type { ScrubberRunService } from './scrubber-runs';
import { ScrubberStoreError, type ScrubberStore, type ScrubRunRecord } from './scrubber-store';

const BASE = '/api/workspaces/([^/]+)/sentinel-todos/([^/]+)/scrubber';
const configSchema = z.object({
    enabled: z.boolean(), cron: z.string().trim().min(1).max(200), expectedRevision: z.number().int().nonnegative(),
}).strict();
const startSchema = z.object({ itemIds: z.array(z.string().min(1).max(200)).min(1).max(500).optional() }).strict();
const actionSchema = z.object({ expectedItemRevision: z.number().int().positive() }).strict();

/** Owner-validated REST commands. Remote callers use their ledger's owning server. */
export function registerScrubberRoutes(opts: {
    routes: Route[];
    todos: Pick<SentinelTodoService, 'list'>;
    scrubber: ScrubberStore;
    engine: Pick<ScrubberEngine, 'accept' | 'dismiss' | 'undo'>;
    runs: Pick<ScrubberRunService, 'start' | 'cancel'>;
    /** True only when the scrubber flag is enabled. */
    getEnabled: () => boolean;
    onChange?: (owner: SentinelTodoOwner, change: { runId?: string; ledgerChanged?: boolean; configChanged?: boolean }) => void;
}): void {
    const { routes, todos, scrubber, engine, runs } = opts;
    const fail = (res: http.ServerResponse, error: unknown) => {
        if (error instanceof ScrubberStoreError || error instanceof SentinelTodoError) {
            const status = { not_found: 404, conflict: 409, invalid: 400, limit: 400 }[error.code];
            return sendJSON(res, status, { error: error.message, code: error.code,
                ...(error instanceof SentinelTodoError && error.current ? { current: error.current } : {}) });
        }
        return sendError(res, 500, 'Failed to update the scrubber');
    };
    const add = (method: string, suffix: string, command: (
        req: http.IncomingMessage, res: http.ServerResponse, owner: SentinelTodoOwner, match: RegExpMatchArray,
    ) => Promise<unknown>) => routes.push({
        method, pattern: new RegExp(`^${BASE}${suffix}$`),
        handler: async (req, res, match) => {
            if (!opts.getEnabled()) return sendError(res, 404, 'Sentinel to-do scrubber is disabled');
            try {
                const owner = { workspaceId: decodeURIComponent(match![1]), processId: decodeURIComponent(match![2]) };
                if (!isValidWorkspaceId(owner.workspaceId) || !owner.processId || owner.processId.includes('/')) {
                    return sendError(res, 400, 'Invalid workspace or chat');
                }
                // Prove the Sentinel/workspace identity before any scrubber read or write.
                await todos.list(owner);
                await command(req, res, owner, match!);
            } catch (error) {
                if (error instanceof URIError) return sendError(res, 400, 'Invalid URL encoding');
                fail(res, error);
            }
        },
    });
    const configFor = (owner: SentinelTodoOwner) => {
        const config = scrubber.getConfig(owner);
        const next = config.enabled && !config.paused ? nextCronTime(config.cron, new Date()) : undefined;
        return { ...config, ...(next ? { nextRunAt: next.toISOString() } : {}) };
    };
    const summary = (owner: SentinelTodoOwner, run: ScrubRunRecord) => {
        const findings = scrubber.listFindings(owner, run.id);
        return {
            id: run.id, trigger: run.trigger, status: run.status, createdAt: run.createdAt,
            startedAt: run.startedAt, finishedAt: run.finishedAt, childProcessId: run.childProcessId,
            error: run.error, skipReason: run.skipReason, itemCount: run.snapshot.length,
            deferredCount: run.deferredItemIds.length, awaitingReviewCount: run.awaitingReviewItemIds.length,
            counts: {
                done: findings.filter(f => (f.state === 'applied' || f.state === 'accepted')
                    && (f.finding.verdict === 'done' || f.finding.verdict === 'obsolete')).length,
                proposals: findings.filter(f => f.state === 'proposed').length,
                unverified: findings.filter(f => f.state === 'unverified').length,
            },
        };
    };

    add('GET', '', async (_req, res, owner) => sendJSON(res, 200, {
        config: configFor(owner), activeRun: scrubber.activeRun(owner),
        runs: scrubber.listRuns(owner).map(run => summary(owner, run)),
    }));
    add('PUT', '/config', async (req, res, owner) => {
        const body = await parseBodyOrReject(req, res);
        if (body === null) {
            if (!res.headersSent) sendError(res, 400, 'Expected an object');
            return;
        }
        const parsed = configSchema.safeParse(body);
        if (!parsed.success) return sendError(res, 400, 'Invalid scrubber configuration');
        const error = validateScrubCron(parsed.data.cron);
        if (error) return sendError(res, 400, error);
        scrubber.putConfig(owner, parsed.data, parsed.data.expectedRevision);
        opts.onChange?.(owner, { configChanged: true });
        sendJSON(res, 200, configFor(owner));
    });
    add('POST', '/runs', async (req, res, owner) => {
        const body = await parseBodyOrReject(req, res);
        if (body === null) {
            if (!res.headersSent) sendError(res, 400, 'Expected an object');
            return;
        }
        const parsed = startSchema.safeParse(body ?? {});
        if (!parsed.success) return sendError(res, 400, 'Invalid scrub selection');
        // Also enforce single-flight when the ledger currently has no eligible items.
        if (scrubber.activeRun(owner)) throw new ScrubberStoreError('conflict', 'A scrub is already running for this ledger');
        const run = await runs.start(owner, { trigger: 'manual', ...parsed.data });
        sendJSON(res, 202, { runId: run.id, processId: run.childProcessId });
    });
    add('GET', '/runs/([^/]+)', async (_req, res, owner, match) => {
        const run = scrubber.getRun(owner, decodeURIComponent(match[3]));
        if (!run) throw new ScrubberStoreError('not_found', 'Scrub run not found');
        sendJSON(res, 200, { ...run, findings: scrubber.listFindings(owner, run.id) });
    });
    add('POST', '/runs/([^/]+)/cancel', async (_req, res, owner, match) => {
        sendJSON(res, 200, await runs.cancel(owner, decodeURIComponent(match[3])));
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
