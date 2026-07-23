/**
 * Queue enqueue routes.
 *
 * POST /api/queue — Enqueue new task
 * POST /api/queue/:id/retry — Re-run a failed/cancelled task as a fresh copy
 * POST /api/queue/bulk — Bulk enqueue
 * POST /api/queue/summarize — Summarize conversations
 * GET  /api/queue/models — List available AI models
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getActiveModels, modelMetadataStore, ensureQueueProcessId, toQueueProcessId, isQueueProcessId, toTaskId, SqliteProcessStore, sdkServiceRegistry, mergeEffortTiersWithDefaults, isEffortTierKey, resolveModelForProvider, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { CreateTaskInput, QueuedTask } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError, parseBody } from '../core/api-handler';
import { setStaticConfigCacheHeaders } from '../shared/router';
import {
    isWireAttachmentArray,
    processMessageAttachments,
    validateAttachments,
} from '../core/attachment-utils';
import { processToTaskDetail } from '../shared/process-history-mapper';
import type { Route } from '../types';
import {
    serializeTask,
    validateAndParseTask,
    enqueueViaBridge,
    buildSummarizePrompt,
    type QueueRouteContext,
    type ResolveDefaultProviderOptions,
    type TaskValidationResult,
    type SummarizeConversation,
} from './queue-shared';
import { NoteChatBindingStore } from '../notes/note-chat-binding-store';
import { normalizeRelativeNotePath } from '../notes/note-chat-bindings-handler';
import { isInheritedLensChatMode, type ChatProvider } from '../tasks/task-types';
import type { AutoProviderResolutionResult } from '../agent-providers/auto-provider-router';

type ResolvedDefaultProviderResolution = AutoProviderResolutionResult & { provider: ChatProvider };

export function registerQueueEnqueueRoutes(routes: Route[], ctx: QueueRouteContext): void {
    const { bridge, store, globalWorkspaceRootPath, state } = ctx;

    /**
     * Note-chat binding store. Lazily resolved because we only need it when an
     * enqueued chat payload carries a `notePath` and we can only access the
     * shared DB through SqliteProcessStore.
     */
    let bindingStore: NoteChatBindingStore | undefined;
    const getBindingStore = (): NoteChatBindingStore | undefined => {
        if (bindingStore) return bindingStore;
        if (store instanceof SqliteProcessStore) {
            bindingStore = new NoteChatBindingStore(store.getDatabase());
        }
        return bindingStore;
    };

    /**
     * If the just-enqueued task is a per-note chat, persist a note→task
     * binding so the Notes view can resolve the chat by path on reload.
     */
    const maybeBindNoteChat = (input: { type: string; payload: unknown }, taskId: string): void => {
        const binding = resolveNoteChatBinding(input);
        if (!binding) return;
        const bs = getBindingStore();
        if (!bs) return;
        try {
            bs.bind(binding.workspaceId, binding.notePath, taskId);
        } catch (err) {
            process.stderr.write(
                `[Queue] note-chat bind failed taskId=${taskId} notePath=${binding.notePath}: ${(err as Error).message}\n`,
            );
        }
    };

    // ------------------------------------------------------------------
    // GET /api/queue/models — List available AI model IDs (provider-aware)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue/models',
        handler: async (_req, res) => {
            let resolution: ResolvedDefaultProviderResolution;
            try {
                resolution = await resolveDefaultProviderResolution(ctx);
            } catch (err) {
                return sendError(res, 500, err instanceof Error ? err.message : 'Failed to resolve default provider');
            }
            const activeProvider = resolution.provider;
            // Static config — short-lived private cache (resolution succeeded; all
            // branches below are 200s). Skipped on the 500 early-return above.
            setStaticConfigCacheHeaders(res);
            if (activeProvider === 'copilot') {
                const live = modelMetadataStore.getCachedModels()
                    .filter(m => m.policy?.state !== 'disabled');
                const models = live.length > 0
                    ? live.map(m => m.id)
                    : getActiveModels().map(m => m.id);
                sendJSON(res, 200, buildQueueModelsResponse(activeProvider, models, resolution));
            } else {
                const sdkService = sdkServiceRegistry.get(activeProvider);
                if (!sdkService) {
                    sendJSON(res, 200, buildQueueModelsResponse(activeProvider, [], resolution));
                    return;
                }
                try {
                    const providerModels = await sdkService.listModels();
                    sendJSON(res, 200, buildQueueModelsResponse(
                        activeProvider,
                        providerModels.map((m: any) => m.id),
                        resolution,
                    ));
                } catch {
                    sendJSON(res, 200, buildQueueModelsResponse(activeProvider, [], resolution));
                }
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue — Enqueue a new task
    // ------------------------------------------------------------------
    const enqueueHandler: Route['handler'] = async (req, res) => {
        let body: any;
        try {
            body = await parseBody(req);
        } catch {
            return sendError(res, 400, 'Invalid JSON');
        }

        const validation = validateAndParseTask(body);
        if (!validation.valid) {
            return sendError(res, 400, validation.error!);
        }
        try {
            await prepareTaskForEnqueue(validation.input!, ctx);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to resolve provider or effort tier';
            return sendError(res, 400, message);
        }

        // For brand-new chat tasks, the SPA sends raw data-URL attachments on
        // payload.attachments. Decode them to temp files now so the executor
        // (which only knows how to read payload.images and SDK-form attachments)
        // and the lifecycle runner (which renders the initial user turn from
        // payload.images) both see the right shapes.
        try {
            decodeChatPayloadAttachments(validation.input!.payload as Record<string, unknown>);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to process attachments';
            return sendError(res, 400, message);
        }

        try {
            const taskId = await enqueueViaBridge(validation.input!, bridge, state, globalWorkspaceRootPath, store);
            const task = bridge.findManagerForTask(taskId)?.getTask(taskId);
            const inp = validation.input!;
            process.stderr.write(`[Queue] enqueue task=${taskId} type=${inp.type} priority=${inp.priority} repoId=${inp.repoId || '-'}\n`);
            maybeBindNoteChat(inp, taskId);
            sendJSON(res, 201, { task: task ? serializeTask(task) : { id: taskId } });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to enqueue task';
            return sendError(res, 400, message);
        }
    };
    routes.push({ method: 'POST', pattern: '/api/queue', handler: enqueueHandler });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/retry — Re-run a failed/cancelled task
    //
    // Recovery affordance for the case where the *very first* message of a
    // chat task failed before any resumable session existed. Re-enqueues a
    // brand-new task from the original's preserved payload/config rather than
    // resuming, so it starts a fresh conversation.
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/retry$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            // The route id may arrive as either a bare task id or the
            // `queue_<taskId>` process id (activity-tab links use the latter).
            const bareId = isQueueProcessId(id) ? toTaskId(id) : id;

            // Resolve the original task: prefer the in-memory record (full
            // payload/config preserved), then fall back to the persisted
            // process (survives server restarts).
            let source: Partial<QueuedTask> | undefined = bridge.findManagerForTask(bareId)?.getTask(bareId);
            if (!source && store) {
                const proc = (await store.getProcess(toQueueProcessId(bareId)))
                    ?? (await store.getProcess(bareId));
                if (proc) source = processToTaskDetail(proc);
            }
            if (!source) {
                return sendError(res, 404, 'Task not found');
            }

            // Only terminal failed/cancelled tasks can be retried — a running
            // or queued task is still live and must not be duplicated.
            if (source.status !== 'failed' && source.status !== 'cancelled') {
                return sendError(
                    res,
                    409,
                    `Cannot retry task in status '${source.status}'; only failed or cancelled tasks can be retried`,
                );
            }

            // Build a fresh task spec from the original. Strip:
            //  - processId: so the retry starts a NEW conversation instead of
            //    being treated as a follow-up to the failed process.
            //  - imageTempDir / attachments / fileAttachmentMeta: these point at
            //    temp files from the original enqueue that may have been cleaned
            //    up. payload.images (self-contained data URLs) and payload.prompt
            //    (already includes any text-file content) are preserved.
            const payload: Record<string, unknown> = { ...((source.payload as Record<string, unknown>) ?? {}) };
            delete payload.processId;
            delete payload.imageTempDir;
            delete payload.attachments;
            delete payload.fileAttachmentMeta;

            const taskSpec: Record<string, unknown> = {
                type: source.type,
                priority: source.priority ?? 'normal',
                payload,
                config: { ...((source.config as Record<string, unknown>) ?? {}) },
                displayName: source.displayName,
            };
            if (source.repoId) taskSpec.repoId = source.repoId;
            if (source.folderPath) taskSpec.folderPath = source.folderPath;

            const validation = validateAndParseTask(taskSpec);
            if (!validation.valid) {
                return sendError(res, 400, validation.error!);
            }

            try {
                await prepareTaskForEnqueue(validation.input!, ctx);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to resolve provider or effort tier';
                return sendError(res, 400, message);
            }

            try {
                const taskId = await enqueueViaBridge(validation.input!, bridge, state, globalWorkspaceRootPath, store);
                const task = bridge.findManagerForTask(taskId)?.getTask(taskId);
                process.stderr.write(`[Queue] retry source=${bareId} task=${taskId}\n`);
                maybeBindNoteChat(validation.input!, taskId);
                sendJSON(res, 201, { task: task ? serializeTask(task) : { id: taskId } });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to enqueue retry task';
                return sendError(res, 400, message);
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/bulk — Enqueue multiple tasks atomically
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/bulk',
        handler: async (req, res) => {
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            if (!body.tasks || !Array.isArray(body.tasks)) {
                return sendError(res, 400, 'Missing or invalid field: tasks (must be an array)');
            }
            if (body.tasks.length === 0) {
                return sendError(res, 400, 'tasks array cannot be empty');
            }
            if (body.tasks.length > 100) {
                return sendError(res, 400, 'tasks array cannot exceed 100 items');
            }

            // Phase 1: Validate ALL tasks before enqueueing ANY
            const validations: TaskValidationResult[] = [];
            const validationErrors: Array<{ index: number; error: string; taskSpec: any }> = [];

            for (let i = 0; i < body.tasks.length; i++) {
                const taskSpec = body.tasks[i];
                const validation = validateAndParseTask(taskSpec);
                validations.push(validation);

                if (!validation.valid) {
                    validationErrors.push({ index: i, error: validation.error!, taskSpec });
                }
            }

            if (validationErrors.length > 0) {
                return sendJSON(res, 400, {
                    success: [],
                    failed: validationErrors,
                    summary: {
                        total: body.tasks.length,
                        succeeded: 0,
                        failed: validationErrors.length,
                    },
                });
            }

            // Phase 2: Enqueue all validated tasks
            const successResults: Array<{ index: number; taskId: string; task: Record<string, unknown> }> = [];
            const enqueueErrors: Array<{ index: number; error: string; taskSpec: any }> = [];

            for (let i = 0; i < validations.length; i++) {
                const validation = validations[i];
                const taskSpec = body.tasks[i];

                try {
                    await prepareTaskForEnqueue(validation.input!, ctx);
                    const taskId = await enqueueViaBridge(validation.input!, bridge, state, globalWorkspaceRootPath, store);
                    const task = bridge.findManagerForTask(taskId)?.getTask(taskId);

                    successResults.push({
                        index: i,
                        taskId,
                        task: task ? serializeTask(task) : { id: taskId },
                    });
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Failed to enqueue task';
                    enqueueErrors.push({ index: i, error: message, taskSpec });
                }
            }

            if (successResults.length > 0) {
                const taskIds = successResults.map(r => r.taskId).join(',');
                process.stderr.write(`[Queue] bulk-enqueue count=${successResults.length} taskIds=${taskIds}\n`);
            }

            const response = {
                success: successResults,
                failed: enqueueErrors,
                summary: {
                    total: body.tasks.length,
                    succeeded: successResults.length,
                    failed: enqueueErrors.length,
                },
            };

            const statusCode = enqueueErrors.length === 0 ? 201 : 207;
            sendJSON(res, statusCode, response);
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/summarize — Summarize multiple conversations
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/summarize',
        handler: async (req, res) => {
            if (!store) {
                return sendError(res, 500, 'Process store not available');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            if (!Array.isArray(body.processIds)) {
                return sendError(res, 400, 'Missing or invalid field: processIds (must be an array)');
            }
            if (body.processIds.length < 1) {
                return sendError(res, 400, 'processIds must contain at least 1 item');
            }
            if (body.processIds.length > 20) {
                return sendError(res, 400, 'processIds cannot exceed 20 items');
            }
            if (!body.processIds.every((id: any) => typeof id === 'string' && id.trim().length > 0)) {
                return sendError(res, 400, 'Each processId must be a non-empty string');
            }

            if (typeof body.workspaceId !== 'string' || !body.workspaceId.trim()) {
                return sendError(res, 400, 'Missing required field: workspaceId');
            }

            const workspaceId = body.workspaceId.trim();
            const rawUserPrompt = typeof body.userPrompt === 'string'
                ? body.userPrompt.trim().slice(0, 2000)
                : undefined;
            const lensChat = isInheritedLensChatMode(body.lensChat) ? body.lensChat : undefined;
            const conversations: SummarizeConversation[] = [];
            for (const id of body.processIds as string[]) {
                const normalized = ensureQueueProcessId(id.trim());
                const proc = await store!.getProcess(normalized, workspaceId);
                if (proc) {
                    conversations.push({
                        id: proc.id,
                        title: proc.title,
                        status: proc.status,
                        turns: proc.conversationTurns ?? [],
                    });
                }
            }

            if (conversations.length === 0) {
                return sendError(res, 404, 'None of the requested processes were found');
            }

            const prompt = buildSummarizePrompt(conversations, rawUserPrompt);

            const taskSpec = {
                type: 'chat' as const,
                priority: 'normal' as const,
                payload: {
                    kind: 'chat' as const,
                    mode: 'ask' as const,
                    prompt,
                    workspaceId,
                    ...(lensChat ? { context: { lensChat } } : {}),
                },
                displayName: `Summarize ${body.processIds.length} conversations`,
            };

            const validation = validateAndParseTask(taskSpec);
            if (!validation.valid) {
                return sendError(res, 400, validation.error!);
            }

            try {
                await prepareTaskForEnqueue(validation.input!, ctx);
                const taskId = await enqueueViaBridge(validation.input!, bridge, state, globalWorkspaceRootPath, store);
                process.stderr.write(
                    `[Queue] summarize processIds=${body.processIds.length} taskId=${taskId}\n`
                );
                sendJSON(res, 201, { taskId });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to enqueue summarize task';
                return sendError(res, 400, message);
            }
        },
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @internal exported for tests
 */
export async function prepareTaskForEnqueue(input: CreateTaskInput, ctx: Pick<QueueRouteContext, 'getDefaultProvider' | 'resolveDefaultProvider' | 'isAutoProviderRoutingActive' | 'getEffortTiersForProvider'>): Promise<void> {
    await resolveDefaultProviderForTask(input, ctx);
    resolveEffortTierConfig(input, ctx);
}

/**
 * @internal exported for tests
 */
export async function resolveDefaultProviderForTask(input: CreateTaskInput, ctx: Pick<QueueRouteContext, 'getDefaultProvider' | 'resolveDefaultProvider' | 'isAutoProviderRoutingActive'>): Promise<void> {
    const payload = input.payload as Record<string, unknown>;
    if (payload.kind === 'dream-run') {
        await resolveDreamRunProviderForTask(input, ctx);
        return;
    }
    if (payload.kind !== 'chat') return;
    if (isChatProvider(payload.provider)) return;
    if (typeof payload.processId === 'string' && payload.processId.trim()) return;

    const autoRequested = isAutoProviderRoutingRequested(payload);
    const autoRoutingActive = ctx.isAutoProviderRoutingActive?.() === true;
    if (!autoRequested && !autoRoutingActive) return;
    if (autoRequested && ctx.isAutoProviderRoutingActive && !autoRoutingActive) {
        throw new Error('Auto provider routing requires features.autoAgentProviderRouting: true.');
    }

    markAutoProviderRoutingRequested(payload);
}

async function resolveDreamRunProviderForTask(input: CreateTaskInput, ctx: Pick<QueueRouteContext, 'getDefaultProvider' | 'resolveDefaultProvider' | 'isAutoProviderRoutingActive'>): Promise<void> {
    const payload = input.payload as Record<string, unknown>;
    if (isChatProvider(payload.provider)) {
        resolveDreamRunModelForProvider(input, payload.provider);
        return;
    }

    const autoRequested = isAutoProviderRoutingRequested(payload);
    const autoRoutingActive = ctx.isAutoProviderRoutingActive?.() === true;
    if (autoRequested && ctx.isAutoProviderRoutingActive && !autoRoutingActive) {
        throw new Error('Auto provider routing requires features.autoAgentProviderRouting: true.');
    }

    const fallbackProvider = ctx.getDefaultProvider?.() ?? 'copilot';
    const resolution: ResolvedDefaultProviderResolution = autoRequested || autoRoutingActive
        ? await resolveDefaultProviderResolution(ctx, { forceAuto: autoRequested })
        : { ...concreteDefaultProviderResolution(fallbackProvider), provider: fallbackProvider };
    payload.provider = resolution.provider;
    if (resolution.selectedByAuto) {
        markResolvedAutoProviderRouting(payload, resolution);
    }
    resolveDreamRunModelForProvider(input, resolution.provider);
}

function resolveDreamRunModelForProvider(input: CreateTaskInput, provider: ChatProvider): void {
    const payload = input.payload as Record<string, unknown>;
    const config = input.config as Record<string, unknown>;
    const rawModel = typeof config.model === 'string' && config.model.trim()
        ? config.model
        : typeof payload.model === 'string' && payload.model.trim()
            ? payload.model
            : undefined;
    if (!rawModel) return;

    const resolvedModel = resolveModelForProvider(provider, rawModel);
    if (resolvedModel.coerced) {
        getLogger().warn(
            LogCategory.AI,
            `[Queue] Dropping model '${resolvedModel.requestedModel}' because provider '${provider}' does not support it; using provider default.`,
        );
    }

    if (resolvedModel.model) {
        config.model = resolvedModel.model;
        payload.model = resolvedModel.model;
    } else {
        delete config.model;
        delete payload.model;
    }
}

function markAutoProviderRoutingRequested(payload: Record<string, unknown>): void {
    const context = payload.context && typeof payload.context === 'object' && !Array.isArray(payload.context)
        ? payload.context as Record<string, unknown>
        : {};
    payload.context = {
        ...context,
        autoProviderRouting: { requested: true },
    };
}

function markResolvedAutoProviderRouting(payload: Record<string, unknown>, resolution: ResolvedDefaultProviderResolution): void {
    const context = payload.context && typeof payload.context === 'object' && !Array.isArray(payload.context)
        ? payload.context as Record<string, unknown>
        : {};
    payload.context = {
        ...context,
        autoProviderRouting: {
            requested: true,
            selectedByAuto: true,
            provider: resolution.provider,
            fallbackUsed: resolution.fallbackUsed,
            warnings: resolution.warnings,
            decisions: resolution.decisions,
            ...(resolution.fallback ? { fallback: resolution.fallback } : {}),
        },
    };
}

/**
 * @internal exported for tests
 */
export async function resolveDefaultProviderForQueue(ctx: Pick<QueueRouteContext, 'getDefaultProvider' | 'resolveDefaultProvider'>): Promise<ChatProvider> {
    return (await resolveDefaultProviderResolution(ctx)).provider;
}

function buildQueueModelsResponse(
    provider: ChatProvider,
    models: string[],
    resolution: ResolvedDefaultProviderResolution,
): Record<string, unknown> {
    return {
        provider,
        models,
        ...buildAutoProviderRoutingMetadata(resolution),
    };
}

function buildAutoProviderRoutingMetadata(resolution: ResolvedDefaultProviderResolution): Record<string, unknown> {
    if (!resolution.selectedByAuto) {
        return {};
    }
    return {
        autoProviderRouting: {
            selectedByAuto: true,
            provider: resolution.provider,
            fallbackUsed: resolution.fallbackUsed,
            warnings: resolution.warnings,
            decisions: resolution.decisions,
            ...(resolution.fallback ? { fallback: resolution.fallback } : {}),
        },
    };
}

async function resolveDefaultProviderResolution(
    ctx: Pick<QueueRouteContext, 'getDefaultProvider' | 'resolveDefaultProvider'>,
    options?: ResolveDefaultProviderOptions,
): Promise<ResolvedDefaultProviderResolution> {
    const resolution = ctx.resolveDefaultProvider
        ? await ctx.resolveDefaultProvider(options)
        : concreteDefaultProviderResolution(ctx.getDefaultProvider?.() ?? 'copilot');
    if (!isChatProvider(resolution.provider)) {
        throw new Error(resolution.error ?? 'Default provider resolution did not select a concrete provider.');
    }
    return { ...resolution, provider: resolution.provider };
}

function isAutoProviderRoutingRequested(payload: Record<string, unknown>): boolean {
    const context = payload.context;
    if (!context || typeof context !== 'object' || Array.isArray(context)) return false;
    const routing = (context as Record<string, unknown>).autoProviderRouting;
    return Boolean(
        routing
        && typeof routing === 'object'
        && !Array.isArray(routing)
        && (routing as Record<string, unknown>).requested === true
    );
}

function concreteDefaultProviderResolution(provider: ChatProvider): AutoProviderResolutionResult {
    return {
        provider,
        selectedByAuto: false,
        fallbackUsed: false,
        decisions: [],
        warnings: [],
    };
}

/**
 * @internal exported for tests
 */
export function resolveEffortTierConfig(input: CreateTaskInput, ctx: Pick<QueueRouteContext, 'getDefaultProvider' | 'getEffortTiersForProvider'>): void {
    const config = input.config as Record<string, unknown>;
    const rawTier = config.effortTier;
    if (rawTier === undefined) return;
    delete config.effortTier;

    if (!isEffortTierKey(rawTier)) return;

    // Preserve the launched tier on the task config so process creation can seed
    // it onto the conversation record as `metadata.afterEffortTier` (AC-01).
    // `effortTier` itself is consumed/deleted above (resolved into model +
    // reasoningEffort for execution), so this dedicated field is what survives to
    // the lifecycle runner for per-chat after-tier read-back.
    config.afterEffortTier = rawTier;

    const payload = input.payload as Record<string, unknown> | undefined;

    // Auto routing picks the provider at execution, not here. Seeding a model now
    // would resolve the tier against whichever provider happens to be the default,
    // and execution would then coerce that model away for the provider Auto really
    // chose — dropping the tier the user asked for. Leave model/reasoningEffort
    // unset and let the runner resolve `afterEffortTier` once the provider is known.
    if (payload && !isChatProvider(payload.provider) && isAutoProviderRoutingRequested(payload)) return;

    const provider = isChatProvider(payload?.provider)
        ? payload.provider
        : (ctx.getDefaultProvider?.() ?? 'copilot');
    const tiers = mergeEffortTiersWithDefaults(provider, ctx.getEffortTiersForProvider?.(provider));
    const tier = tiers[rawTier];
    if (!tier) return;

    if (typeof config.model !== 'string' || config.model.length === 0) {
        config.model = tier.model;
    }
    if (typeof config.reasoningEffort !== 'string' || config.reasoningEffort.length === 0) {
        if (tier.reasoningEffort !== null) {
            config.reasoningEffort = tier.reasoningEffort;
        } else {
            delete config.reasoningEffort;
        }
    }
}

function isChatProvider(value: unknown): value is ChatProvider {
    return value === 'copilot' || value === 'codex' || value === 'claude' || value === 'opencode';
}

/**
 * Decide whether a just-enqueued task should create a per-note chat binding, and
 * with what (workspaceId + normalized notePath). Returns null when no per-note
 * binding should be created.
 *
 * A per-note binding is created only for a `type:'chat'` task whose
 * `context.noteChat` carries a note path AND is not declared Workspace scope.
 * A `per-workspace` submission may include the currently-selected note path
 * purely as first-message context; it must NOT create or replace that note's
 * per-note binding (AC-04). An omitted scope keeps the legacy per-note default
 * so existing callers are unaffected.
 *
 * @internal exported for tests
 */
export function resolveNoteChatBinding(
    input: { type: string; payload: unknown },
): { workspaceId: string; notePath: string } | null {
    if (input.type !== 'chat') return null;
    const payload = input.payload as {
        workspaceId?: unknown;
        context?: { noteChat?: { notePath?: unknown; scope?: unknown } };
    } | undefined;
    const noteChat = payload?.context?.noteChat;
    // Workspace-scope chats reference the note path only for context — never bind.
    if (noteChat?.scope === 'per-workspace') return null;
    const workspaceId = typeof payload?.workspaceId === 'string' ? payload.workspaceId : undefined;
    if (!workspaceId) return null;
    const notePath = normalizeRelativeNotePath(noteChat?.notePath);
    if (!notePath) return null;
    return { workspaceId, notePath };
}

/**
 * If `payload.attachments` is the wire AttachmentPayload[] format produced by
 * the SPA's NewChatArea (objects with a `dataUrl` field), decode them into
 * temp files and rewrite `payload` to the shapes the chat executor expects:
 *
 *   - payload.images            string[]   data URLs (images only) — used both
 *                                          for AI image attachments and for
 *                                          rendering the initial user turn
 *   - payload.attachments       Attachment[] (SDK form, file-path references)
 *                                          — pre-built so the executor can use
 *                                          them directly without re-decoding
 *   - payload.imageTempDir      string     temp dir to clean up after run
 *   - payload.fileAttachmentMeta FileAttachmentMeta[] — per-attachment display meta
 *
 * Text-file attachments have their content appended to `payload.prompt` so the
 * AI sees them in-context (mirrors the follow-up route).
 *
 * If `payload.attachments` is already in SDK form (or absent), this is a no-op.
 *
 * Idempotent and safe to call before any non-chat payload — exits early when
 * `payload.kind !== 'chat'`.
 */
/**
 * @internal exported for tests
 */
export function decodeChatPayloadAttachments(payload: Record<string, unknown>): void {
    if (payload.kind !== 'chat') return;
    if (!isWireAttachmentArray(payload.attachments)) return;

    const { payloads } = validateAttachments(payload.attachments);
    if (payloads.length === 0) {
        delete payload.attachments;
        return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-attach-'));
    const result = processMessageAttachments(
        { attachments: payloads } as Record<string, unknown>,
        tempDir,
    );

    if (result.sdkAttachments.length > 0) {
        payload.attachments = result.sdkAttachments;
    } else {
        delete payload.attachments;
        // No usable attachments — drop the empty temp dir.
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
        return;
    }

    if (result.validatedImages && result.validatedImages.length > 0) {
        payload.images = result.validatedImages;
    }
    payload.imageTempDir = result.imageTempDir;
    if (result.fileAttachmentMeta && result.fileAttachmentMeta.length > 0) {
        payload.fileAttachmentMeta = result.fileAttachmentMeta;
    }

    if (result.textContext) {
        const existingPrompt = typeof payload.prompt === 'string' ? payload.prompt : '';
        payload.prompt = existingPrompt + result.textContext;
    }
}
