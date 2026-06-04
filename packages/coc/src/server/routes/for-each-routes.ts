import * as http from 'http';
import type { Route } from '../types';
import { parseBody, sendJSON } from '../core/api-handler';
import { APIError, badRequest, conflict, handleAPIError, notFound } from '../errors';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';
import { VALID_CHAT_PROVIDERS, VALID_REASONING_EFFORTS } from '../tasks/task-types';
import type { FileForEachRunStore } from '../for-each/for-each-run-store';
import type { ForEachChildMode, ForEachItem } from '../for-each/types';
import { FOR_EACH_CHILD_MODES } from '../for-each/types';
import type { GenerateForEachItemPlanFn } from '../for-each/for-each-plan-generator';

export interface ForEachRouteContext {
    routes: Route[];
    store: FileForEachRunStore;
    getForEachEnabled: () => boolean;
    generateItemPlan: GenerateForEachItemPlanFn;
}

interface GenerateForEachRunRequest {
    prompt?: unknown;
    sharedInstructions?: unknown;
    childMode?: unknown;
    provider?: unknown;
    config?: unknown;
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

function parseAiSelection(body: GenerateForEachRunRequest): {
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

function toRouteError(error: unknown): APIError {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found/i.test(message)) {
        return notFound('For Each run');
    }
    if (/only draft runs/i.test(message)) {
        return conflict(message);
    }
    return badRequest(message);
}

export function registerForEachRoutes(ctx: ForEachRouteContext): void {
    const { routes, store } = ctx;

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
                const { provider, model, reasoningEffort } = parseAiSelection(body);

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
                    provider,
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
}
