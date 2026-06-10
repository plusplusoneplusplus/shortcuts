import * as http from 'http';
import type { Route } from '../types';
import { parseBody, sendJSON } from '../core/api-handler';
import { APIError, badRequest, conflict, handleAPIError, notFound } from '../errors';
import { VALID_CHAT_PROVIDERS, VALID_REASONING_EFFORTS, type ChatProvider, type ReasoningEffort } from '../tasks/task-types';
import type { FileDreamStore } from './dream-store';
import type { DreamRunRequestOptions } from './dream-runner';
import {
    DREAM_CARD_STATUSES,
    DREAM_CONVERSION_ARTIFACT_TYPES,
    type DreamCardStatus,
    type DreamConversionArtifactType,
    type DreamConversionLink,
} from './types';

export interface DreamRouteContext {
    routes: Route[];
    store: FileDreamStore;
    enqueueRun: (workspaceId: string, options: DreamRunRequestOptions) => Promise<Record<string, unknown>>;
    getDreamsEnabled: () => boolean | Promise<boolean>;
}

interface DreamRunRequestBody {
    provider?: unknown;
    config?: unknown;
    confidenceThreshold?: unknown;
    maxCandidates?: unknown;
    conversationLimit?: unknown;
    timeoutMs?: unknown;
}

interface DismissDreamRequestBody {
    dedupRationale?: unknown;
}

interface ConvertDreamRequestBody {
    artifactType?: unknown;
    artifactId?: unknown;
    artifactUrl?: unknown;
}

interface SupersedeDreamRequestBody {
    supersededByCardId?: unknown;
    dedupRationale?: unknown;
}

function decodeCapture(match: RegExpMatchArray, index: number): string {
    return decodeURIComponent(match[index]);
}

async function requireEnabled(ctx: DreamRouteContext, res: http.ServerResponse): Promise<boolean> {
    if (await ctx.getDreamsEnabled()) {
        return true;
    }
    handleAPIError(res, notFound('Dreams feature'));
    return false;
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

function requiredString(value: unknown, fieldName: string): string {
    const parsed = optionalString(value, fieldName);
    if (!parsed) {
        throw badRequest(`${fieldName} is required`);
    }
    return parsed;
}

function optionalObject(value: unknown, fieldName: string): Record<string, unknown> {
    if (value === undefined || value === null) {
        return {};
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw badRequest(`${fieldName} must be an object`);
    }
    return value as Record<string, unknown>;
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

function optionalConfidence(value: unknown, fieldName: string): number | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw badRequest(`${fieldName} must be a number between 0 and 1`);
    }
    return value;
}

function optionalProvider(value: unknown): ChatProvider | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    if (!VALID_CHAT_PROVIDERS.has(value as ChatProvider)) {
        throw badRequest(`Invalid provider: '${String(value)}'. Valid providers: ${[...VALID_CHAT_PROVIDERS].join(', ')}`);
    }
    return value as ChatProvider;
}

function optionalReasoningEffort(value: unknown): ReasoningEffort | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    if (!VALID_REASONING_EFFORTS.has(value as ReasoningEffort)) {
        throw badRequest(`Invalid reasoningEffort: '${String(value)}'. Valid reasoningEffort values: ${[...VALID_REASONING_EFFORTS].join(', ')}`);
    }
    return value as ReasoningEffort;
}

function parseRunOptions(body: DreamRunRequestBody): DreamRunRequestOptions {
    const config = optionalObject(body.config, 'config');
    const provider = optionalProvider(body.provider);
    const model = optionalString(config.model, 'config.model');
    const reasoningEffort = optionalReasoningEffort(config.reasoningEffort);
    const confidenceThreshold = optionalConfidence(body.confidenceThreshold, 'confidenceThreshold');
    const maxCandidates = optionalPositiveInteger(body.maxCandidates, 'maxCandidates');
    const conversationLimit = optionalPositiveInteger(body.conversationLimit, 'conversationLimit');
    const timeoutMs = optionalPositiveInteger(body.timeoutMs, 'timeoutMs');
    return {
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(confidenceThreshold !== undefined ? { confidenceThreshold } : {}),
        ...(maxCandidates !== undefined ? { maxCandidates } : {}),
        ...(conversationLimit !== undefined ? { conversationLimit } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    };
}

async function readObjectBody<T extends object>(
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<T | null> {
    try {
        const body = await parseBody(req);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            throw badRequest('Request body must be a JSON object');
        }
        return body as T;
    } catch (err) {
        handleAPIError(res, err instanceof APIError ? err : badRequest('Invalid JSON body'));
        return null;
    }
}

function parseBooleanQuery(value: string | null): boolean | undefined {
    if (value === null) {
        return undefined;
    }
    if (value === 'true' || value === '1') {
        return true;
    }
    if (value === 'false' || value === '0') {
        return false;
    }
    throw badRequest('includeHidden must be true or false');
}

function parseStatusesQuery(values: string[]): DreamCardStatus[] | undefined {
    if (values.length === 0) {
        return undefined;
    }
    const statuses = values
        .flatMap(raw => raw.split(','))
        .map(raw => raw.trim())
        .filter(Boolean);
    for (const status of statuses) {
        if (!(DREAM_CARD_STATUSES as readonly string[]).includes(status)) {
            throw badRequest(`Invalid dream card status: ${status}`);
        }
    }
    return statuses.length > 0 ? [...new Set(statuses)] as DreamCardStatus[] : undefined;
}

function parseCardListOptions(req: http.IncomingMessage): {
    includeHidden?: boolean;
    statuses?: DreamCardStatus[];
} {
    const parsed = new URL(req.url ?? '/', 'http://coc.local');
    const includeHidden = parseBooleanQuery(parsed.searchParams.get('includeHidden'));
    const statuses = parseStatusesQuery([
        ...parsed.searchParams.getAll('status'),
        ...parsed.searchParams.getAll('statuses'),
    ]);
    return {
        ...(includeHidden !== undefined ? { includeHidden } : {}),
        ...(statuses ? { statuses } : {}),
    };
}

function parseConversion(body: ConvertDreamRequestBody): Omit<DreamConversionLink, 'createdAt'> {
    const artifactType = body.artifactType;
    if (!DREAM_CONVERSION_ARTIFACT_TYPES.includes(artifactType as DreamConversionArtifactType)) {
        throw badRequest(`artifactType must be one of: ${DREAM_CONVERSION_ARTIFACT_TYPES.join(', ')}`);
    }
    const artifactUrl = optionalString(body.artifactUrl, 'artifactUrl');
    return {
        artifactType: artifactType as DreamConversionArtifactType,
        artifactId: requiredString(body.artifactId, 'artifactId'),
        ...(artifactUrl ? { artifactUrl } : {}),
    };
}

function toRouteError(error: unknown): APIError {
    if (error instanceof APIError) {
        return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/disabled by global config/i.test(message)) {
        return notFound('Dreams feature');
    }
    if (/not found/i.test(message)) {
        return notFound('Dream card');
    }
    if (/not enabled for workspace|only candidate|only visible|cannot supersede|already/i.test(message)) {
        return conflict(message);
    }
    return badRequest(message);
}

export function registerDreamRoutes(ctx: DreamRouteContext): void {
    const { routes, store, enqueueRun } = ctx;

    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/dreams\/cards$/,
        handler: async (req, res, match) => {
            if (!await requireEnabled(ctx, res)) return;
            try {
                const workspaceId = decodeCapture(match!, 1);
                const options = parseCardListOptions(req);
                const cards = await store.listCards(workspaceId, options);
                sendJSON(res, 200, { cards });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/dreams\/run$/,
        handler: async (req, res, match) => {
            if (!await requireEnabled(ctx, res)) return;
            const body = await readObjectBody<DreamRunRequestBody>(req, res);
            if (body === null) return;
            try {
                const workspaceId = decodeCapture(match!, 1);
                const task = await enqueueRun(workspaceId, parseRunOptions(body));
                sendJSON(res, 202, { task });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/dreams\/cards\/([^/]+)$/,
        handler: async (_req, res, match) => {
            if (!await requireEnabled(ctx, res)) return;
            try {
                const workspaceId = decodeCapture(match!, 1);
                const cardId = decodeCapture(match!, 2);
                const card = await store.getCard(workspaceId, cardId);
                if (!card) {
                    return handleAPIError(res, notFound('Dream card'));
                }
                sendJSON(res, 200, { card });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/dreams\/cards\/([^/]+)\/approve$/,
        handler: async (_req, res, match) => {
            if (!await requireEnabled(ctx, res)) return;
            try {
                const card = await store.approveCard(decodeCapture(match!, 1), decodeCapture(match!, 2));
                sendJSON(res, 200, { card });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/dreams\/cards\/([^/]+)\/dismiss$/,
        handler: async (req, res, match) => {
            if (!await requireEnabled(ctx, res)) return;
            const body = await readObjectBody<DismissDreamRequestBody>(req, res);
            if (body === null) return;
            try {
                const dedupRationale = optionalString(body.dedupRationale, 'dedupRationale');
                const card = await store.dismissCard(decodeCapture(match!, 1), decodeCapture(match!, 2), {
                    ...(dedupRationale ? { dedupRationale } : {}),
                });
                sendJSON(res, 200, { card });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/dreams\/cards\/([^/]+)\/convert$/,
        handler: async (req, res, match) => {
            if (!await requireEnabled(ctx, res)) return;
            const body = await readObjectBody<ConvertDreamRequestBody>(req, res);
            if (body === null) return;
            try {
                const card = await store.convertCard(decodeCapture(match!, 1), decodeCapture(match!, 2), parseConversion(body));
                sendJSON(res, 200, { card });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/dreams\/cards\/([^/]+)\/supersede$/,
        handler: async (req, res, match) => {
            if (!await requireEnabled(ctx, res)) return;
            const body = await readObjectBody<SupersedeDreamRequestBody>(req, res);
            if (body === null) return;
            try {
                const supersededByCardId = optionalString(body.supersededByCardId, 'supersededByCardId');
                const card = await store.markSuperseded(decodeCapture(match!, 1), decodeCapture(match!, 2), {
                    ...(supersededByCardId ? { supersededByCardId } : {}),
                    dedupRationale: requiredString(body.dedupRationale, 'dedupRationale'),
                });
                sendJSON(res, 200, { card });
            } catch (err) {
                handleAPIError(res, toRouteError(err));
            }
        },
    });
}
