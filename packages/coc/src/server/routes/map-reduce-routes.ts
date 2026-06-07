import * as http from 'http';
import type { Route } from '../types';
import { parseBody, sendJSON } from '../core/api-handler';
import { APIError, badRequest, conflict, handleAPIError, notFound } from '../errors';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';
import { VALID_CHAT_PROVIDERS, VALID_REASONING_EFFORTS } from '../tasks/task-types';
import type { FileMapReduceRunStore } from '../map-reduce/map-reduce-run-store';
import type { MapReduceRunExecutor } from '../map-reduce/map-reduce-run-executor';
import type { MapReduceChildMode, MapReduceItem } from '../map-reduce/types';
import { MAP_REDUCE_CHILD_MODES } from '../map-reduce/types';
import type { GenerateMapReducePlanFn } from '../map-reduce/map-reduce-plan-generator';
import type { AutoProviderResolutionResult } from '../agent-providers/auto-provider-router';

export interface MapReduceRouteContext {
    routes: Route[];
    store: FileMapReduceRunStore;
    getMapReduceEnabled: () => boolean;
    generatePlan: GenerateMapReducePlanFn;
    executor: MapReduceRunExecutor;
    resolveDefaultProvider?: () => Promise<AutoProviderResolutionResult>;
}

interface GenerateMapReduceRunRequest {
    prompt?: unknown;
    sharedInstructions?: unknown;
    childMode?: unknown;
    provider?: unknown;
    config?: unknown;
}

interface CreateMapReduceRunRequest {
    originalRequest?: unknown;
    sharedInstructions?: unknown;
    reduceInstructions?: unknown;
    maxParallel?: unknown;
    childMode?: unknown;
    provider?: unknown;
    config?: unknown;
    generationProcessId?: unknown;
    generationId?: unknown;
    items?: unknown;
}

interface UpdateMapReducePlanRequest {
    items?: unknown;
    sharedInstructions?: unknown;
    reduceInstructions?: unknown;
    maxParallel?: unknown;
    childMode?: unknown;
}

function decodeCapture(match: RegExpMatchArray, index: number): string {
    return decodeURIComponent(match[index]);
}

function requireEnabled(ctx: MapReduceRouteContext, res: http.ServerResponse): boolean {
    if (ctx.getMapReduceEnabled()) {
        return true;
    }
    handleAPIError(res, notFound('Map Reduce feature'));
    return false;
}

function parseChildMode(value: unknown): MapReduceChildMode {
    if (MAP_REDUCE_CHILD_MODES.includes(value as MapReduceChildMode)) {
        return value as MapReduceChildMode;
    }
    throw badRequest(`childMode must be one of: ${MAP_REDUCE_CHILD_MODES.join(', ')}`);
}

function optionalString(value: unknown, fieldName: string): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw badRequest(`${fieldName} must be a string`);
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

function optionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        throw badRequest(`${fieldName} must be a positive integer`);
    }
    return value;
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
    ctx: MapReduceRouteContext,
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
        return notFound('Map Reduce run');
    }
    if (/only draft runs/i.test(message)) {
        return conflict(message);
    }
    if (/must be approved|blocked by failed|cannot be retried|cannot be skipped|only failed items|only pending or failed items|no runnable pending items|still draining|cannot reduce before|only failed reduce steps/i.test(message)) {
        return conflict(message);
    }
    return badRequest(message);
}

export function registerMapReduceRoutes(ctx: MapReduceRouteContext): void {
    const { routes, store, executor } = ctx;

    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) {
                return;
            }
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
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs$/,
        handler: async (req, res, match) => {
            if (!requireEnabled(ctx, res)) {
                return;
            }

            let body: CreateMapReduceRunRequest;
            try {
                body = await parseBody(req) as CreateMapReduceRunRequest;
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            try {
                const workspaceId = decodeCapture(match!, 1);
                const originalRequest = optionalString(body.originalRequest, 'originalRequest');
                if (!originalRequest) {
                    throw badRequest('originalRequest is required');
                }
                const reduceInstructions = optionalString(body.reduceInstructions, 'reduceInstructions');
                if (!reduceInstructions) {
                    throw badRequest('reduceInstructions is required');
                }
                const sharedInstructions = body.sharedInstructions === undefined
                    ? undefined
                    : optionalString(body.sharedInstructions, 'sharedInstructions') ?? '';
                const childMode = parseChildMode(body.childMode);
                const maxParallel = optionalPositiveInteger(body.maxParallel, 'maxParallel');
                const { runProvider, model, reasoningEffort, autoProviderRouting } = await resolveAiSelection(ctx, body);
                const generationProcessId = optionalString(body.generationProcessId, 'generationProcessId');
                const generationId = optionalString(body.generationId, 'generationId');

                const run = await store.createDraftRun({
                    workspaceId,
                    originalRequest,
                    sharedInstructions,
                    reduceInstructions,
                    maxParallel,
                    childMode,
                    provider: runProvider,
                    autoProviderRouting,
                    model,
                    reasoningEffort,
                    generationProcessId,
                    generationId,
                    items: body.items as MapReduceItem[],
                });
                sendJSON(res, 201, { run });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs\/generate$/,
        handler: async (req, res, match) => {
            if (!requireEnabled(ctx, res)) {
                return;
            }

            let body: GenerateMapReduceRunRequest;
            try {
                body = await parseBody(req) as GenerateMapReduceRunRequest;
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

                let plan: Awaited<ReturnType<GenerateMapReducePlanFn>>;
                try {
                    plan = await ctx.generatePlan({
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
                        `Failed to generate Map Reduce plan: ${message}. Edit the request and regenerate.`,
                        'MAP_REDUCE_PLAN_GENERATION_FAILED',
                    );
                }

                const run = await store.createDraftRun({
                    workspaceId,
                    originalRequest: prompt,
                    sharedInstructions,
                    reduceInstructions: plan.reduceInstructions,
                    maxParallel: plan.maxParallel,
                    childMode,
                    provider: runProvider,
                    autoProviderRouting,
                    model,
                    reasoningEffort,
                    items: plan.items,
                });
                sendJSON(res, 201, { run });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs\/([^/]+)$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) {
                return;
            }
            try {
                const workspaceId = decodeCapture(match!, 1);
                const runId = decodeCapture(match!, 2);
                const run = await store.getRun(workspaceId, runId);
                if (!run) {
                    return handleAPIError(res, notFound('Map Reduce run'));
                }
                sendJSON(res, 200, { run });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs\/([^/]+)\/plan$/,
        handler: async (req, res, match) => {
            if (!requireEnabled(ctx, res)) {
                return;
            }

            let body: UpdateMapReducePlanRequest;
            try {
                body = await parseBody(req) as UpdateMapReducePlanRequest;
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
                const reduceInstructions = body.reduceInstructions === undefined
                    ? undefined
                    : optionalString(body.reduceInstructions, 'reduceInstructions') ?? '';
                const maxParallel = optionalPositiveInteger(body.maxParallel, 'maxParallel');
                const run = await store.updateReviewedPlan(workspaceId, runId, {
                    items: body.items as MapReduceItem[],
                    childMode,
                    sharedInstructions,
                    reduceInstructions,
                    maxParallel,
                });
                sendJSON(res, 200, { run });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs\/([^/]+)\/approve$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) {
                return;
            }
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
        if (!requireEnabled(ctx, res)) {
            return;
        }
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
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs\/([^/]+)\/start$/,
        handler: startOrContinue,
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs\/([^/]+)\/continue$/,
        handler: startOrContinue,
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs\/([^/]+)\/items\/([^/]+)\/retry$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) {
                return;
            }
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
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs\/([^/]+)\/items\/([^/]+)\/skip$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) {
                return;
            }
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
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs\/([^/]+)\/reduce\/retry$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) {
                return;
            }
            try {
                const workspaceId = decodeCapture(match!, 1);
                const runId = decodeCapture(match!, 2);
                const run = await executor.retryReduce(workspaceId, runId);
                sendJSON(res, 200, { run });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/map-reduce-runs\/([^/]+)\/cancel$/,
        handler: async (_req, res, match) => {
            if (!requireEnabled(ctx, res)) {
                return;
            }
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
