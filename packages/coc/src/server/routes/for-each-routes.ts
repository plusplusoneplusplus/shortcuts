import * as http from 'http';
import type { Route } from '../types';
import { parseBody, sendJSON } from '../core/api-handler';
import { APIError, badRequest, conflict, handleAPIError, notFound } from '../errors';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';
import { VALID_CHAT_PROVIDERS, VALID_REASONING_EFFORTS } from '../tasks/task-types';
import type { FileForEachRunStore } from '../for-each/for-each-run-store';
import type { ForEachRunExecutor } from '../for-each/for-each-run-executor';
import type { ForEachChildMode, ForEachItem } from '../for-each/types';
import { FOR_EACH_CHILD_MODES } from '../for-each/types';
import type { GenerateForEachItemPlanFn } from '../for-each/for-each-plan-generator';
import type { AutoProviderResolutionResult } from '../agent-providers/auto-provider-router';

export interface ForEachRouteContext {
    routes: Route[];
    store: FileForEachRunStore;
    getForEachEnabled: () => boolean;
    generateItemPlan: GenerateForEachItemPlanFn;
    executor: ForEachRunExecutor;
    resolveDefaultProvider?: () => Promise<AutoProviderResolutionResult>;
}

interface GenerateForEachRunRequest {
    prompt?: unknown;
    sharedInstructions?: unknown;
    childMode?: unknown;
    provider?: unknown;
    config?: unknown;
}

interface CreateForEachRunRequest {
    originalRequest?: unknown;
    sharedInstructions?: unknown;
    childMode?: unknown;
    provider?: unknown;
    config?: unknown;
    generationProcessId?: unknown;
    generationId?: unknown;
    items?: unknown;
}

interface UpdateForEachPlanRequest {
    items?: unknown;
    sharedInstructions?: unknown;
    childMode?: unknown;
}

function decodeCapture(match: RegExpMatchArray, index: number): string {
    return decodeURIComponent(match[index]);
}

function requireEnabled(ctx: ForEachRouteContext, res: http.ServerResponse): boolean {
    if (ctx.getForEachEnabled()) return true;
    handleAPIError(res, notFound('For Each feature'));
    return false;
}

function parseChildMode(value: unknown): ForEachChildMode {
    if (FOR_EACH_CHILD_MODES.includes(value as ForEachChildMode)) {
        return value as ForEachChildMode;
    }
    throw badRequest(`childMode must be one of: ${FOR_EACH_CHILD_MODES.join(', ')}`);
}

function optionalString(value: unknown, fieldName: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
        throw badRequest(`${fieldName} must be a string`);
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

function parseAiSelection(body: { provider?: unknown; config?: unknown }): {
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
} {
    const provider = body.provider === undefined ? undefined : body.provider as ChatProvider;
    if (provider !== undefined && !VALID_CHAT_PROVIDERS.has(provider)) {
        throw badRequest(`Invalid provider: '${String(body.provider)}'. Valid providers: ${[...VALID_CHAT_PROVIDERS].join(', ')}`);
    }

    const config = body.config && typeof body.config === 'object' && !Array.isArray(body.config)
        ? body.config as Record<string, unknown>
        : {};
    if (body.config !== undefined && (typeof body.config !== 'object' || Array.isArray(body.config) || body.config === null)) {
        throw badRequest('config must be an object');
    }

    const model = optionalString(config.model, 'config.model');
    const rawReasoningEffort = config.reasoningEffort;
    const reasoningEffort = rawReasoningEffort === undefined
        ? undefined
        : rawReasoningEffort as ReasoningEffort;
    if (reasoningEffort !== undefined && !VALID_REASONING_EFFORTS.has(reasoningEffort)) {
        throw badRequest(`Invalid reasoningEffort: '${String(rawReasoningEffort)}'. Valid reasoningEffort values: ${[...VALID_REASONING_EFFORTS].join(', ')}`);
    }

    return { provider, model, reasoningEffort };
}

async function resolveAiSelection(
    ctx: ForEachRouteContext,
    body: { provider?: unknown; config?: unknown },
): Promise<{
    provider?: ChatProvider;
    runProvider?: ChatProvider;
    autoProviderRouting?: { requested: true };
    model?: string;
    reasoningEffort?: ReasoningEffort;
}> {
    const selection = parseAiSelection(body);
    if (selection.provider || !ctx.resolveDefaultProvider) {
        return { ...selection, runProvider: selection.provider };
    }
    const resolution = await ctx.resolveDefaultProvider();
    if (!resolution.provider) {
        throw badRequest(resolution.error ?? 'Default provider resolution did not select a concrete provider.');
    }
    return {
        ...selection,
        provider: resolution.provider,
        runProvider: resolution.selectedByAuto ? undefined : resolution.provider,
        ...(resolution.selectedByAuto ? { autoProviderRouting: { requested: true as const } } : {}),
    };
}

function toRouteError(error: unknown): APIError {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found/i.test(message)) {
        return notFound('For Each run');
    }
    if (/only draft runs/i.test(message)) {
        return conflict(message);
    }
    if (/must be approved|blocked by failed|already has a running item|cannot be retried|cannot be skipped|only failed items|only pending or failed items|no runnable pending items/i.test(message)) {
        return conflict(message);
    }
    return badRequest(message);
}

export function registerForEachRoutes(ctx: ForEachRouteContext): void {
    const { routes, store, executor } = ctx;

    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/for-each-runs$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) return;
            try {
                const workspaceId = decodeCapture(match!, 1);
                const runs = await store.listRuns(workspaceId);
                sendJSON(res, 200, { runs });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/for-each-runs$/,
        handler: async (req, res, match) => {
            if (!requireEnabled(ctx, res)) return;

            let body: CreateForEachRunRequest;
            try {
                body = await parseBody(req) as CreateForEachRunRequest;
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            try {
                const workspaceId = decodeCapture(match!, 1);
                const originalRequest = optionalString(body.originalRequest, 'originalRequest');
                if (!originalRequest) {
                    throw badRequest('originalRequest is required');
                }
                const sharedInstructions = body.sharedInstructions === undefined
                    ? undefined
                    : optionalString(body.sharedInstructions, 'sharedInstructions') ?? '';
                const childMode = parseChildMode(body.childMode);
                const { runProvider, model, reasoningEffort, autoProviderRouting } = await resolveAiSelection(ctx, body);
                const generationProcessId = optionalString(body.generationProcessId, 'generationProcessId');
                const generationId = optionalString(body.generationId, 'generationId');

                const run = await store.createDraftRun({
                    workspaceId,
                    originalRequest,
                    sharedInstructions,
                    childMode,
                    provider: runProvider,
                    autoProviderRouting,
                    model,
                    reasoningEffort,
                    generationProcessId,
                    generationId,
                    items: body.items as ForEachItem[],
                });
                sendJSON(res, 201, { run });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/for-each-runs\/generate$/,
        handler: async (req, res, match) => {
            if (!requireEnabled(ctx, res)) return;

            let body: GenerateForEachRunRequest;
            try {
                body = await parseBody(req) as GenerateForEachRunRequest;
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            try {
                const workspaceId = decodeCapture(match!, 1);
                const prompt = optionalString(body.prompt, 'prompt');
                if (!prompt) {
                    throw badRequest('prompt is required');
                }
                const sharedInstructions = optionalString(body.sharedInstructions, 'sharedInstructions');
                const childMode = parseChildMode(body.childMode);
                const { provider, runProvider, model, reasoningEffort, autoProviderRouting } = await resolveAiSelection(ctx, body);

                let items: ForEachItem[];
                try {
                    items = await ctx.generateItemPlan({
                        workspaceId,
                        prompt,
                        sharedInstructions,
                        childMode,
                        provider,
                        model,
                        reasoningEffort,
                    });
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    throw new APIError(
                        502,
                        `Failed to generate For Each item plan: ${message}. Edit the request and regenerate.`,
                        'FOR_EACH_PLAN_GENERATION_FAILED',
                    );
                }

                const run = await store.createDraftRun({
                    workspaceId,
                    originalRequest: prompt,
                    sharedInstructions,
                    childMode,
                    provider: runProvider,
                    autoProviderRouting,
                    model,
                    reasoningEffort,
                    items,
                });
                sendJSON(res, 201, { run });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/for-each-runs\/([^/]+)$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) return;
            try {
                const workspaceId = decodeCapture(match!, 1);
                const runId = decodeCapture(match!, 2);
                const run = await store.getRun(workspaceId, runId);
                if (!run) {
                    return handleAPIError(res, notFound('For Each run'));
                }
                sendJSON(res, 200, { run });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/for-each-runs\/([^/]+)\/plan$/,
        handler: async (req, res, match) => {
            if (!requireEnabled(ctx, res)) return;

            let body: UpdateForEachPlanRequest;
            try {
                body = await parseBody(req) as UpdateForEachPlanRequest;
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            try {
                const workspaceId = decodeCapture(match!, 1);
                const runId = decodeCapture(match!, 2);
                const childMode = body.childMode === undefined ? undefined : parseChildMode(body.childMode);
                const sharedInstructions = body.sharedInstructions === undefined
                    ? undefined
                    : optionalString(body.sharedInstructions, 'sharedInstructions') ?? '';
                const run = await store.updateReviewedPlan(workspaceId, runId, {
                    items: body.items as ForEachItem[],
                    childMode,
                    sharedInstructions,
                });
                sendJSON(res, 200, { run });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/for-each-runs\/([^/]+)\/approve$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) return;
            try {
                const workspaceId = decodeCapture(match!, 1);
                const runId = decodeCapture(match!, 2);
                const run = await store.approveRun(workspaceId, runId);
                sendJSON(res, 200, { run });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    const startOrContinue = async (_req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray): Promise<void> => {
        if (!requireEnabled(ctx, res)) return;
        try {
            const workspaceId = decodeCapture(match!, 1);
            const runId = decodeCapture(match!, 2);
            const run = await executor.startOrContinueRun(workspaceId, runId);
            sendJSON(res, 200, { run });
        } catch (err) {
            handleAPIError(res, toRouteError(err));
        }
    };

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/for-each-runs\/([^/]+)\/start$/,
        handler: startOrContinue,
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/for-each-runs\/([^/]+)\/continue$/,
        handler: startOrContinue,
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/for-each-runs\/([^/]+)\/items\/([^/]+)\/retry$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) return;
            try {
                const workspaceId = decodeCapture(match!, 1);
                const runId = decodeCapture(match!, 2);
                const itemId = decodeCapture(match!, 3);
                const run = await executor.retryItem(workspaceId, runId, itemId);
                sendJSON(res, 200, { run });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/for-each-runs\/([^/]+)\/items\/([^/]+)\/skip$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) return;
            try {
                const workspaceId = decodeCapture(match!, 1);
                const runId = decodeCapture(match!, 2);
                const itemId = decodeCapture(match!, 3);
                const run = await executor.skipItemAndContinue(workspaceId, runId, itemId);
                sendJSON(res, 200, { run });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/for-each-runs\/([^/]+)\/cancel$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) return;
            try {
                const workspaceId = decodeCapture(match!, 1);
                const runId = decodeCapture(match!, 2);
                const run = await executor.cancelRun(workspaceId, runId);
                sendJSON(res, 200, { run });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });
}
