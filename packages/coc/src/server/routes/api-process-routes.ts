/**
 * Process REST API Routes
 *
 * Process CRUD, SSE streaming, conversation output, children, cancel, follow-up message,
 * and aggregate stats.
 * Extracted from `api-handler.ts` to keep each route module focused on one domain.
 */

import * as url from 'url';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    ProcessStore, ProcessFilter, AIProcess, AIProcessStatus,
    CreateTaskInput, Attachment, QueuedTask, SearchFilter,
} from '@plusplusoneplusplus/forge';
import { deserializeProcess, getLogger, LogCategory, PASTE_THRESHOLD, isQueueProcessId, resolveModelForProvider, toTaskId, toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import {
    sendJSON, parseBody, parseQueryParams, parseIncludeFields, stripExcludedFields,
} from '../core/api-handler';
import type { QueueExecutorBridge } from '../core/api-handler';
import { handleAPIError, missingFields, notFound, badRequest, internalError, APIError } from '../errors';
import { handleProcessStream, emitMessageQueued, emitPendingMessageAdded, emitMessageSteering } from '../streaming/sse-handler';
import { saveImagesToTempFiles, cleanupTempDir, isImageDataUrl } from '../core/image-utils';
import { processMessageAttachments } from '../core/attachment-utils';
import { parseBodyOrReject } from '../shared/handler-utils';
import { truncateDisplayName } from '../shared/queue-utils';
import { prependSelectedSkillsDirective } from '../executors/prompt-builder';
import { normalizeChatMode } from '../tasks/task-types';
import type { ChatProvider } from '../tasks/task-types';
import type { ApiRouteContext } from './api-shared';
import { createRoute, asString } from './route-utils';

/** Valid AIProcessStatus values for validation. */
const VALID_STATUSES: Set<string> = new Set(['queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled']);

/** Terminal statuses that cannot be cancelled. */
const TERMINAL_STATUSES: Set<string> = new Set(['completed', 'failed', 'cancelled']);

/** Non-terminal statuses where a task may still be executing. */
const NONTERMINAL_STATUSES: Set<string> = new Set(['queued', 'running', 'cancelling', 'created']);

/**
 * Synthesize a minimal AIProcess from a QueuedTask.
 * Used when a process record hasn't been created yet — either because the
 * task is still queued, or because the queue executor has marked the task
 * `running` but hasn't yet persisted the AIProcess to the store. Mapping the
 * task's actual status (queued/running) avoids a race where SPA polling
 * receives a synthesized `queued` process for a task that is already running
 * and gets stuck in the PendingTaskInfoPanel.
 */
function queuedTaskToProcess(task: QueuedTask): AIProcess {
    const prompt = task.displayName
        ?? (task.payload as any)?.prompt as string | undefined
        ?? '';
    // QueueStatus is a subset of AIProcessStatus (no 'cancelling'), so a direct
    // assignment satisfies the synthesised AIProcess shape.
    const status: AIProcessStatus = task.status;
    return {
        id: toQueueProcessId(task.id),
        type: task.type || 'chat',
        status,
        promptPreview: prompt.slice(0, 57) + (prompt.length > 57 ? '...' : ''),
        fullPrompt: prompt,
        startTime: new Date(task.createdAt),
        title: task.displayName,
        workingDirectory: task.folderPath ?? (task.payload as any)?.workingDirectory,
    };
}

/**
 * Resolve a process by ID with a fallback for mismatched `queue_` prefixes.
 *
 * Forked processes (and other non-queue-created processes) have bare UUID IDs,
 * but the SPA may prefix them with `queue_` (the standard convention for
 * queue-created processes). This helper tries the given ID first, then falls
 * back to the bare ID (prefix stripped) or the prefixed ID, so lookups succeed
 * regardless of whether the caller added or omitted the `queue_` prefix.
 */
async function resolveProcess(
    store: ProcessStore,
    id: string,
    workspaceId?: string,
): Promise<AIProcess | undefined> {
    const proc = await store.getProcess(id, workspaceId);
    if (proc) return proc;
    // Fallback: try the bare ID if the given ID has the queue_ prefix
    if (isQueueProcessId(id)) {
        const bareId = toTaskId(id);
        return store.getProcess(bareId, workspaceId);
    }
    return undefined;
}

export function registerApiProcessRoutes(ctx: ApiRouteContext): void {
    const { routes, store, bridge, dataDir, getWsServer } = ctx;

    // GET /api/processes/summaries — Lightweight index-only process list (no file I/O per process)
    routes.push(createRoute({
        method: 'GET',
        pattern: '/api/processes/summaries',
        handler: async ({ req, res }) => {
            if (!store.getProcessSummaries) {
                return void handleAPIError(res, badRequest('Summaries not supported by this store'));
            }
            const filter = parseQueryParams(req.url || '/');
            const limit = filter.limit ?? 100;
            const offset = filter.offset ?? 0;
            const paginatedFilter: ProcessFilter = { ...filter, limit, offset };
            const { entries, total } = await store.getProcessSummaries(paginatedFilter);
            return { summaries: entries, total, limit, offset };
        },
    }));

    // GET /api/processes — List processes with filtering + pagination
    routes.push(createRoute({
        method: 'GET',
        pattern: '/api/processes',
        handler: async ({ req, res }) => {
            const parsed = url.parse(req.url || '/', true);
            const sdkSessionId = typeof parsed.query.sdkSessionId === 'string' ? parsed.query.sdkSessionId : '';

            if (sdkSessionId) {
                const match = 'getProcessBySdkSessionId' in store
                    ? (store as any).getProcessBySdkSessionId(sdkSessionId) as AIProcess | undefined
                    : (await store.getAllProcesses()).find(p => p.sdkSessionId === sdkSessionId);
                if (!match) {
                    return void handleAPIError(res, notFound('Process with sdkSessionId: ' + sdkSessionId));
                }
                return { process: match };
            }

            const filter = parseQueryParams(req.url || '/');
            const countFilter: ProcessFilter = { ...filter };
            delete countFilter.limit;
            delete countFilter.offset;
            const total = store.getProcessSummaries
                ? (await store.getProcessSummaries(countFilter)).total
                : await store.getProcessCount(countFilter);

            const limit = filter.limit ?? 100;
            const offset = filter.offset ?? 0;
            const paginatedFilter: ProcessFilter = { ...filter, limit, offset };
            const processes = await store.getAllProcesses(paginatedFilter);
            const responseProcesses = filter.exclude
                ? processes.map(p => stripExcludedFields(p, filter.exclude))
                : processes;
            return { processes: responseProcesses, total, limit, offset };
        },
    }));

    // DELETE /api/processes — Bulk-clear processes by status
    routes.push(createRoute({
        method: 'DELETE',
        pattern: '/api/processes',
        handler: async ({ req, res }) => {
            const parsed = url.parse(req.url || '/', true);
            const statusParam = parsed.query.status;

            if (typeof statusParam !== 'string' || !statusParam) {
                return void handleAPIError(res, badRequest('Query parameter "status" is required for bulk delete'));
            }

            const statuses = statusParam
                .split(',')
                .map(s => s.trim())
                .filter(s => VALID_STATUSES.has(s)) as AIProcessStatus[];

            if (statuses.length === 0) {
                return void handleAPIError(res, badRequest('No valid status values provided'));
            }

            const removed = await store.clearProcesses({ status: statuses });
            return { removed };
        },
    }));

    // POST /api/processes — Create a new process
    routes.push(createRoute({
        statusCode: 201,
        method: 'POST',
        pattern: '/api/processes',
        handler: async ({ req, res }) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.id || !body.promptPreview || !body.status || !body.startTime) {
                return void handleAPIError(res, missingFields(['id', 'promptPreview', 'status', 'startTime']));
            }

            const proc: AIProcess = deserializeProcess({
                id: body.id,
                type: body.type,
                promptPreview: body.promptPreview,
                fullPrompt: body.fullPrompt || '',
                status: body.status,
                startTime: body.startTime,
                endTime: body.endTime,
                error: body.error,
                result: body.result,
                resultFilePath: body.resultFilePath,
                rawStdoutFilePath: body.rawStdoutFilePath,
                metadata: body.metadata,
                groupMetadata: body.groupMetadata,
                structuredResult: body.structuredResult,
                parentProcessId: body.parentProcessId,
                sdkSessionId: body.sdkSessionId,
                backend: body.backend,
                workingDirectory: body.workingDirectory,
            });

            if (body.workspaceId) {
                proc.metadata = {
                    type: proc.metadata?.type ?? proc.type ?? 'unknown',
                    ...proc.metadata,
                    workspaceId: body.workspaceId,
                };
            }

            await store.addProcess(proc);
            return proc;
        },
    }));

    // GET /api/processes/search — Full-text search across conversations
    // Registered before :id regex patterns to avoid "search" matching as a process ID.
    routes.push(createRoute({
        method: 'GET',
        pattern: '/api/processes/search',
        handler: async ({ req, res }) => {
            const parsed = url.parse(req.url || '/', true);
            const q = typeof parsed.query.q === 'string' ? parsed.query.q.trim() : '';

            if (!q) {
                return { results: [], total: 0, query: '' };
            }

            if (!store.searchConversations) {
                return void handleAPIError(res, badRequest('Full-text search not supported by this store backend'));
            }

            const filter = parseQueryParams(req.url || '/');
            const searchFilter: SearchFilter = {
                workspaceId: filter.workspaceId,
                status: filter.status,
                type: filter.type,
                since: filter.since,
                until: filter.until,
                limit: filter.limit ?? 50,
                offset: filter.offset ?? 0,
            };

            const { results, total } = await store.searchConversations(q, searchFilter);
            return { results, total, query: q, limit: searchFilter.limit, offset: searchFilter.offset };
        },
    }));

    // GET /api/processes/:id/stream — SSE stream for real-time output
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)\/stream$/,
        handler: async (req, res, match) => {
            let id = decodeURIComponent(match![1]);
            // Resolve queue_ prefix mismatch for forked processes
            const resolved = await resolveProcess(store, id);
            if (resolved) id = resolved.id;
            return handleProcessStream(req, res, id, store);
        },
    });

    // GET /api/processes/:id/output — Persisted conversation output
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)\/output$/,
        handler: async ({ req, res, match }) => {
            const id = decodeURIComponent(match[1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const proc = await resolveProcess(store, id, wsId);
            if (!proc) {
                // If the process ID is a queue-derived ID and the task is still queued,
                // return empty output instead of 404.
                if (isQueueProcessId(id) && bridge) {
                    try {
                        const task = bridge.getTask?.(toTaskId(id));
                        if (task) {
                            return { content: '', format: 'markdown' };
                        }
                    } catch { /* toTaskId may throw if prefix is wrong — fall through */ }
                }
                return void handleAPIError(res, notFound('Process'));
            }
            const filePath = proc.rawStdoutFilePath;
            if (!filePath) {
                return void handleAPIError(res, notFound('Conversation output'));
            }
            try {
                await fs.promises.access(filePath);
                const content = await fs.promises.readFile(filePath, 'utf-8');
                return { content, format: 'markdown' };
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return void handleAPIError(res, notFound('Conversation output'));
                }
                return void handleAPIError(res, internalError('Failed to read conversation output'));
            }
        },
    }));

    // GET /api/processes/:id — Single process detail
    // By default, children are NOT embedded (saves an extra SQL query on a hot
    // path that is overwhelmingly used for chat sessions without children).
    // Opt back in with `?include=children`.
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)$/,
        handler: async ({ req, res, match }) => {
            const id = decodeURIComponent(match[1]);
            const filter = parseQueryParams(req.url || '/');
            const include = parseIncludeFields(req.url || '/');
            const proc = await resolveProcess(store, id, filter.workspaceId);
            if (!proc) {
                // Synthesize a response for queued tasks that don't yet have a process record
                if (isQueueProcessId(id) && bridge) {
                    try {
                        const task = bridge.getTask?.(toTaskId(id));
                        if (task) {
                            const synthetic = queuedTaskToProcess(task);
                            const result = filter.exclude ? stripExcludedFields(synthetic, filter.exclude) : synthetic;
                            return { process: result, children: [], total: 0 };
                        }
                    } catch { /* toTaskId may throw if prefix is wrong — fall through */ }
                }
                return void handleAPIError(res, notFound('Process'));
            }
            const result = filter.exclude ? stripExcludedFields(proc, filter.exclude) : proc;

            if (!include.has('children')) {
                return { process: result, children: [], total: 0 };
            }

            // Embed children using the same logic the deleted /children route used
            const childFilter: ProcessFilter = {
                ...filter,
                parentProcessId: proc.id,
            };
            if (!childFilter.exclude) {
                childFilter.exclude = ['conversation'];
            }
            const children = await store.getAllProcesses(childFilter);
            const responseChildren = childFilter.exclude
                ? children.map(p => stripExcludedFields(p, childFilter.exclude))
                : children;

            return { process: result, children: responseChildren, total: children.length };
        },
    }));

    // PATCH /api/processes/:id — Partial update
    routes.push(createRoute({
        method: 'PATCH',
        pattern: /^\/api\/processes\/([^/]+)$/,
        handler: async ({ req, res, match }) => {
            const id = decodeURIComponent(match[1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const existing = await resolveProcess(store, id, wsId);
            if (!existing) {
                return void handleAPIError(res, notFound('Process'));
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const updates: Partial<AIProcess> = {};
            if (body.status !== undefined) { updates.status = body.status; }
            if (body.result !== undefined) { updates.result = body.result; }
            if (body.error !== undefined) { updates.error = body.error; }
            if (body.endTime !== undefined) { updates.endTime = new Date(body.endTime); }
            if (body.structuredResult !== undefined) { updates.structuredResult = body.structuredResult; }
            if (body.metadata !== undefined) { updates.metadata = body.metadata; }
            if (body.sdkSessionId !== undefined) { updates.sdkSessionId = body.sdkSessionId; }
            if (body.conversationTurns !== undefined) { updates.conversationTurns = body.conversationTurns; }
            if (body.customTitle !== undefined) {
                const raw = body.customTitle;
                if (raw !== null && typeof raw !== 'string') {
                    return void handleAPIError(res, badRequest('customTitle must be a string or null'));
                }
                const trimmed = typeof raw === 'string' ? raw.trim() : '';
                if (trimmed.length > 80) {
                    return void handleAPIError(res, badRequest('customTitle exceeds 80 characters'));
                }
                updates.customTitle = trimmed;
            }

            await store.updateProcess(existing.id, updates);

            // Sync queue task displayName when the user-set custom title changes.
            if (updates.customTitle !== undefined && isQueueProcessId(existing.id) && bridge) {
                const displayName = updates.customTitle || existing.title || existing.promptPreview || existing.id;
                bridge.updateTaskDisplayName?.(existing.id, displayName, { customTitle: updates.customTitle });
            }

            const updated = await store.getProcess(existing.id, wsId);
            return { process: updated };
        },
    }));

    // DELETE /api/processes/:id — Remove a single process
    // @deprecated — does not clean up in-memory queue state or child processes.
    // Prefer DELETE /api/workspaces/:id/history/:processId instead.
    routes.push(createRoute({
        method: 'DELETE',
        pattern: /^\/api\/processes\/([^/]+)$/,
        handler: async ({ req, res, match }) => {
            const id = decodeURIComponent(match[1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const existing = await resolveProcess(store, id, wsId);
            if (!existing) {
                return void handleAPIError(res, notFound('Process'));
            }
            await store.removeProcess(existing.id);
            res.writeHead(204);
            res.end();
        },
    }));

    // POST /api/processes/:id/cancel — Cancel a running process
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/cancel$/,
        handler: async ({ req, res, match }) => {
            const id = decodeURIComponent(match[1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const existing = await resolveProcess(store, id, wsId);
            if (!existing) {
                return void handleAPIError(res, notFound('Process'));
            }

            if (TERMINAL_STATUSES.has(existing.status)) {
                return void handleAPIError(res, new APIError(409, `Process is already in terminal state: ${existing.status}`, 'CONFLICT'));
            }

            await store.updateProcess(existing.id, {
                status: 'cancelling' as any,
            });

            process.stderr.write(`[Process] cancel id=${existing.id} prevStatus=${existing.status}\n`);

            // Await the abort with a timeout so we don't hang the HTTP response
            const CANCEL_TIMEOUT_MS = 30_000;
            try {
                await Promise.race([
                    bridge?.cancelProcess?.(existing.id),
                    new Promise<void>((_, reject) =>
                        setTimeout(() => reject(new Error('Cancel timeout')), CANCEL_TIMEOUT_MS)),
                ]);
            } catch {
                // Timeout or abort error — fall through to finalize
            }

            // Finalize: set terminal cancelled status (unless lifecycle runner already did)
            const current = await store.getProcess(existing.id, wsId);
            if (current && !TERMINAL_STATUSES.has(current.status)) {
                await store.updateProcess(existing.id, {
                    status: 'cancelled',
                    endTime: new Date(),
                });
            }

            const updated = await store.getProcess(existing.id, wsId);
            return { process: updated };
        },
    }));

    // POST /api/processes/:id/fork — Fork a completed process
    routes.push(createRoute({
        statusCode: 201,
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/fork$/,
        handler: async ({ req, res, match }) => {
            const id = decodeURIComponent(match[1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const proc = await resolveProcess(store, id, wsId);
            if (!proc) {
                return void handleAPIError(res, notFound('Process'));
            }
            if (!proc.sdkSessionId) {
                return void handleAPIError(res, badRequest('Process has no SDK session to fork'));
            }
            if (!store.forkProcess) {
                return void handleAPIError(res, badRequest('Fork not supported by this store'));
            }

            const newId = crypto.randomUUID();
            let newSdkSessionId: string;
            try {
                const { sdkServiceRegistry, SDK_PROVIDER_COPILOT } = await import('@plusplusoneplusplus/forge');
                const sdkService = sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT);
                newSdkSessionId = await sdkService.forkSession(proc.sdkSessionId);
            } catch (err: any) {
                return void handleAPIError(res, internalError(`Failed to fork SDK session: ${err?.message || err}`));
            }

            try {
                const forked = await store.forkProcess(proc.id, newId, newSdkSessionId);
                const wsServer = getWsServer?.();
                if (wsServer && forked.metadata?.workspaceId) {
                    wsServer.broadcastProcessEvent({
                        type: 'process-added',
                        process: {
                            id: forked.id,
                            status: forked.status,
                            type: forked.type ?? 'chat',
                            promptPreview: forked.promptPreview,
                            startTime: forked.startTime.toISOString(),
                            endTime: forked.endTime?.toISOString(),
                            title: forked.title,
                            workspaceId: forked.metadata?.workspaceId as string,
                        },
                    });
                }
                return { process: forked };
            } catch (err: any) {
                return void handleAPIError(res, internalError(`Failed to fork process: ${err?.message || err}`));
            }
        },
    }));

    // POST /api/processes/:id/message — Send a follow-up message
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/message$/,
        handler: async (req, res, match) => {
            let id = decodeURIComponent(match![1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const proc = await resolveProcess(store, id, wsId);
            if (!proc) {
                return handleAPIError(res, notFound('Process'));
            }
            // Normalize: the resolved process ID may differ from the request ID
            // (e.g. forked processes use bare UUIDs, but client may send queue_ prefix)
            id = proc.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.content || typeof body.content !== 'string') {
                return handleAPIError(res, missingFields(['content']));
            }


            // Process both new-style attachments and legacy images
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-attach-'));
            const {
                sdkAttachments: processedAttachments,
                textContext,
                imageTempDir,
                validatedImages,
                fileAttachmentMeta,
            } = processMessageAttachments(body, tempDir);
            const attachments: Attachment[] | undefined = processedAttachments.length > 0 ? processedAttachments : undefined;

            // Append text file contents to the message for AI context
            const messageContentWithContext = textContext
                ? (body.content as string) + textContext
                : undefined;

            // Check session liveness before forwarding the prompt
            if (bridge && !(await bridge.isSessionAlive(id))) {
                return handleAPIError(res, new APIError(410, 'The AI session has ended. Please start a new task.', 'SESSION_EXPIRED'));
            }

            if (!bridge) {
                return handleAPIError(res, new APIError(501, 'Follow-up execution not available', 'NOT_IMPLEMENTED'));
            }

            // Validate optional mode override; legacy `plan` is accepted as Ask.
            const normalizedMode = normalizeChatMode(body.mode);
            const modeOverride: string | undefined = normalizedMode === 'ralph' ? undefined : normalizedMode;

            // Validate optional deliveryMode (immediate | enqueue), default to 'enqueue'
            const VALID_DELIVERY_MODES = ['immediate', 'enqueue'];
            if (body.deliveryMode !== undefined && body.deliveryMode !== null) {
                if (typeof body.deliveryMode !== 'string' || !VALID_DELIVERY_MODES.includes(body.deliveryMode)) {
                    return handleAPIError(res, badRequest(`Invalid deliveryMode: must be one of ${VALID_DELIVERY_MODES.join(', ')}`));
                }
            }
            const deliveryMode: 'immediate' | 'enqueue' = (body.deliveryMode === 'immediate') ? 'immediate' : 'enqueue';
            const requestedSkillNames = Array.isArray(body.skillNames) ? body.skillNames as unknown[] : undefined;
            const selectedSkillNames: string[] | undefined = requestedSkillNames
                ? [...new Set(requestedSkillNames.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
                : undefined;

            // Read optional client-provided optimistic ID for reconciliation
            const optimisticId: string | undefined = typeof body.optimisticId === 'string' ? body.optimisticId : undefined;

            // Validate optional model override against the conversation provider.
            const rawModelOverride: string | undefined = typeof body.model === 'string' && body.model.trim().length > 0 ? body.model.trim() : undefined;
            const sessionProvider: ChatProvider = proc.metadata?.provider === 'codex' || proc.metadata?.provider === 'claude' || proc.metadata?.provider === 'copilot'
                ? proc.metadata.provider
                : 'copilot';
            const resolvedModelOverride = resolveModelForProvider(sessionProvider, rawModelOverride);
            if (resolvedModelOverride.coerced) {
                getLogger().warn(
                    LogCategory.AI,
                    `[Process] Dropping model '${resolvedModelOverride.requestedModel}' for process ${id} because provider '${sessionProvider}' does not support it; using provider default.`,
                );
            }
            const modelOverride = resolvedModelOverride.model;

            // Validate optional per-turn reasoning-effort override. Accepted
            // values mirror the SDK contract: low | medium | high | xhigh.
            // Unknown values are silently dropped so a stale client never
            // breaks an otherwise-valid follow-up.
            const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
            const effortOverride: 'low' | 'medium' | 'high' | 'xhigh' | undefined =
                typeof body.reasoningEffort === 'string' && VALID_EFFORTS.has(body.reasoningEffort)
                    ? (body.reasoningEffort as 'low' | 'medium' | 'high' | 'xhigh')
                    : undefined;

            // Pass content through as-is — /skill tokens are kept in the prompt
            // so the AI SDK receives the full user intent (e.g. "/impl fix the bug").
            const messageContent = (body.content as string);
            const displayContent = prependSelectedSkillsDirective(messageContent, selectedSkillNames);

            const priorStatus = proc.status;
            const isPasteExternalized = messageContent.length > PASTE_THRESHOLD;

            // Helper: buffer a follow-up as a pending message for server-side drain.
            // The server drains pending messages when the running task completes,
            // avoiding duplicate task IDs in the queue.
            // When buffered, the user turn is NOT appended to conversationTurns yet —
            // it is deferred until drainPendingMessages runs, preserving correct
            // [user, assistant, user, assistant] ordering.
            let buffered = false;
            const bufferAsPendingMessage = async () => {
                buffered = true;
                const pendingMsg = {
                    id: crypto.randomUUID(),
                    content: messageContent,
                    displayContent,
                    ...(validatedImages ? { images: validatedImages } : {}),
                    ...(isPasteExternalized ? { pasteExternalized: true } : {}),
                    ...(modelOverride ? { model: modelOverride } : {}),
                    ...(effortOverride ? { reasoningEffort: effortOverride } : {}),
                    ...(modeOverride ? { mode: modeOverride } : {}),
                    ...(attachments ? { attachments } : {}),
                    ...(imageTempDir ? { imageTempDir } : {}),
                    ...(fileAttachmentMeta ? { fileAttachmentMeta } : {}),
                    ...(selectedSkillNames && selectedSkillNames.length > 0 ? { skillNames: selectedSkillNames } : {}),
                    createdAt: new Date().toISOString(),
                };
                const current = await store.getProcess(id);
                const existing = current?.pendingMessages ?? [];
                await store.updateProcess(id, {
                    pendingMessages: [...existing, pendingMsg],
                });
                emitPendingMessageAdded(store, id, pendingMsg);
            };

            let steerSucceeded = false;

            try {
                if (bridge.enqueue) {
                    const displayName = truncateDisplayName(messageContent.trim());
                    const parentTask = bridge.findTaskByProcessId?.(id);
                    if (parentTask && parentTask.status === 'running' && deliveryMode === 'immediate' && bridge.steerProcess) {
                        const steered = await bridge.steerProcess(id, messageContent);
                        if (!steered) {
                            // Steering failed (no active SDK session); buffer for server-side drain
                            await bufferAsPendingMessage();
                        } else {
                            steerSucceeded = true;
                        }
                    } else if (
                        (parentTask && (parentTask.status === 'running' || parentTask.status === 'queued')) ||
                        (!parentTask && NONTERMINAL_STATUSES.has(priorStatus))
                    ) {
                        // Task running/queued, or task not found but process was non-terminal:
                        // buffer as pending message — server drains on task completion
                        await bufferAsPendingMessage();
                    } else {
                        // Terminal status (failed/cancelled) or restart fallback → enqueue
                        const enqueueWsId = (proc.metadata?.workspaceId as string) ?? undefined;
                        await bridge.enqueue({
                            ...(isQueueProcessId(id) ? { id: toTaskId(id) } : {}),
                            processId: id,
                            type: 'chat',
                            priority: 'normal',
                            payload: {
                                kind: 'chat',
                                prompt: messageContentWithContext ?? messageContent,
                                processId: id,
                                attachments,
                                imageTempDir,
                                images: validatedImages,
                                ...(fileAttachmentMeta ? { fileAttachmentMeta } : {}),
                                workingDirectory: proc.workingDirectory,
                                ...(enqueueWsId ? { workspaceId: enqueueWsId } : {}),
                                readonly: (proc as any).payload?.readonly,
                                ...(selectedSkillNames && selectedSkillNames.length > 0 ? { context: { skills: selectedSkillNames } } : {}),
                                ...(modeOverride ? { mode: modeOverride } : {}),
                                ...(modelOverride ? { model: modelOverride } : {}),
                                ...(effortOverride ? { reasoningEffort: effortOverride } : {}),
                                deliveryMode,
                            },
                            // Mirror the per-turn reasoning-effort into
                            // config so executors that inspect
                            // `task.config.reasoningEffort` (e.g. chat-base
                            // executor for non-follow-up forks) see it too.
                            config: effortOverride ? { reasoningEffort: effortOverride } : {},
                            displayName,
                        });
                    }
                } else {
                    bridge.executeFollowUp(id, messageContentWithContext ?? messageContent, attachments, modeOverride, deliveryMode, validatedImages, selectedSkillNames, modelOverride, undefined, effortOverride).catch(() => {
                    }).finally(() => {
                        if (imageTempDir) { cleanupTempDir(imageTempDir); }
                    });
                }
            } catch (err) {
                await store.updateProcess(id, { status: priorStatus as AIProcessStatus }).catch(() => {});
                return handleAPIError(res, new APIError(500, 'Failed to enqueue follow-up', 'ENQUEUE_FAILED'));
            }

            // Persist the user turn and mark the process as running atomically.
            // Skipped for the buffered path — the turn is deferred until
            // drainPendingMessages appends it at the correct position after
            // the current assistant response completes.
            let turnIndex = -1;
            if (!buffered) {
                const appendResult = await store.appendConversationTurn(
                    id,
                    (idx) => ({
                        role: 'user' as const,
                        content: displayContent,
                        timestamp: new Date(),
                        turnIndex: idx,
                        timeline: [],
                        images: validatedImages,
                        ...(isPasteExternalized ? { pasteExternalized: true } : {}),
                        ...(modelOverride ? { model: modelOverride } : {}),
                        ...(modeOverride ? { mode: modeOverride } : {}),
                    }),
                    { additionalUpdates: { status: 'running' } },
                );
                turnIndex = appendResult?.turn.turnIndex ?? (proc.conversationTurns?.length ?? 0);
            }

            emitMessageQueued(store, id, {
                turnIndex,
                deliveryMode,
                queuePosition: deliveryMode === 'immediate' ? 0 : 1,
                optimisticId,
            });

            if (steerSucceeded) {
                emitMessageSteering(store, id, { turnIndex, optimisticId });
            }

            globalThis.process.stderr.write(`[Process] message id=${id} turnIndex=${turnIndex}\n`);

            sendJSON(res, 202, {
                processId: id,
                turnIndex,
                ...(isPasteExternalized ? { pasteExternalized: true } : {}),
            });
        },
    });

    // ------------------------------------------------------------------
    // Ask-user response endpoint
    // ------------------------------------------------------------------

    // POST /api/processes/:id/ask-user-response — Answer or skip a pending ask-user question batch
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/ask-user-response$/,
        handler: async ({ req, res, match }) => {
            const id = decodeURIComponent(match[1]);

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.batchId || typeof body.batchId !== 'string') {
                return void handleAPIError(res, missingFields(['batchId']));
            }
            if (!Array.isArray(body.answers) || body.answers.length === 0) {
                return void handleAPIError(res, missingFields(['answers']));
            }
            const answers = body.answers as Array<{ questionId?: unknown; answer?: unknown; skipped?: unknown }>;
            for (const answer of answers) {
                if (!answer.questionId || typeof answer.questionId !== 'string') {
                    return void handleAPIError(res, missingFields(['answers[].questionId']));
                }
                if (answer.skipped !== true && answer.answer === undefined) {
                    return void handleAPIError(res, missingFields(['answers[].answer']));
                }
            }

            if (!bridge) {
                return void handleAPIError(res, notFound('Bridge not available'));
            }

            const resolved = await bridge.answerAskUserQuestions?.(id, body.batchId as string, answers.map(answer => ({
                questionId: answer.questionId as string,
                answer: answer.answer as string | string[] | boolean | undefined,
                skipped: answer.skipped === true,
            }))) ?? false;

            if (!resolved) {
                return void handleAPIError(res, notFound('Question batch not found or already answered'));
            }

            return { ok: true };
        },
    }));

    // ------------------------------------------------------------------
    // Pending messages endpoints
    // ------------------------------------------------------------------

    // POST /api/processes/:id/pending-messages — Queue a message while AI is busy
    routes.push(createRoute({
        statusCode: 201,
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/pending-messages$/,
        handler: async ({ req, res, match }) => {
            const id = decodeURIComponent(match[1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const proc = await resolveProcess(store, id, wsId);
            if (!proc) {
                return void handleAPIError(res, notFound('Process'));
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.content || typeof body.content !== 'string') {
                return void handleAPIError(res, missingFields(['content']));
            }

            const pendingMsg = {
                id: crypto.randomUUID(),
                content: body.content as string,
                mode: normalizeChatMode(body.mode),
                createdAt: new Date().toISOString(),
            };

            const existing = proc.pendingMessages ?? [];
            await store.updateProcess(id, {
                pendingMessages: [...existing, pendingMsg],
            });

            emitPendingMessageAdded(store, id, pendingMsg);

            return { message: pendingMsg };
        },
    }));

    // DELETE /api/processes/:id/pending-messages/:msgId — Remove a consumed pending message
    routes.push(createRoute({
        method: 'DELETE',
        pattern: /^\/api\/processes\/([^/]+)\/pending-messages\/([^/]+)$/,
        handler: async ({ req, res, match }) => {
            const id = decodeURIComponent(match[1]);
            const msgId = decodeURIComponent(match[2]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const proc = await resolveProcess(store, id, wsId);
            if (!proc) {
                return void handleAPIError(res, notFound('Process'));
            }

            const existing = proc.pendingMessages ?? [];
            const filtered = existing.filter(m => m.id !== msgId);
            await store.updateProcess(proc.id, { pendingMessages: filtered });

            res.writeHead(204);
            res.end();
        },
    }));

    // ------------------------------------------------------------------
    // Stats endpoint
    // ------------------------------------------------------------------

    // GET /api/stats — Aggregate statistics
    routes.push(createRoute({
        method: 'GET',
        pattern: '/api/stats',
        handler: async () => {
            const allProcesses = store.getProcessSummaries
                ? (await store.getProcessSummaries()).entries
                : await store.getAllProcesses();
            const workspaces = await store.getWorkspaces();

            const byStatus: Record<string, number> = {
                queued: 0,
                running: 0,
                completed: 0,
                failed: 0,
                cancelled: 0,
            };
            const workspaceCounts: Record<string, number> = {};

            for (const proc of allProcesses) {
                byStatus[proc.status] = (byStatus[proc.status] || 0) + 1;
                const wsId = ('workspaceId' in proc ? (proc as any).workspaceId : proc.metadata?.workspaceId) || '';
                workspaceCounts[wsId] = (workspaceCounts[wsId] || 0) + 1;
            }

            const byWorkspace = workspaces.map(ws => ({
                workspaceId: ws.id,
                name: ws.name,
                count: workspaceCounts[ws.id] || 0,
            }));

            return {
                totalProcesses: allProcesses.length,
                byStatus,
                byWorkspace,
            };
        },
    }));
}
