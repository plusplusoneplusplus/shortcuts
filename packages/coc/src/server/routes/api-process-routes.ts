/**
 * Process REST API Routes
 *
 * Process CRUD, SSE streaming, conversation output, children, cancel, follow-up message,
 * and aggregate stats.
 * Extracted from `api-handler.ts` to keep each route module focused on one domain.
 */

import * as url from 'url';
import * as fs from 'fs';
import type {
    ProcessStore, ProcessFilter, AIProcess, AIProcessStatus,
    CreateTaskInput, Attachment,
} from '@plusplusoneplusplus/forge';
import { deserializeProcess } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import {
    sendJSON, parseBody, parseQueryParams, stripExcludedFields,
} from '../api-handler';
import type { QueueExecutorBridge } from '../api-handler';
import { handleAPIError, missingFields, notFound, badRequest, internalError, APIError } from '../errors';
import { handleProcessStream, emitMessageQueued } from '../sse-handler';
import { saveImagesToTempFiles, cleanupTempDir, isImageDataUrl } from '../image-utils';
import { parseBodyOrReject } from '../shared/handler-utils';
import { truncateDisplayName } from '../shared/queue-utils';
import { recordUserMessage } from '../memory/conversation-recorder';
import type { ApiRouteContext } from './api-shared';

/** Valid AIProcessStatus values for validation. */
const VALID_STATUSES: Set<string> = new Set(['queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled']);

/** Terminal statuses that cannot be cancelled. */
const TERMINAL_STATUSES: Set<string> = new Set(['completed', 'failed', 'cancelled']);

export function registerApiProcessRoutes(ctx: ApiRouteContext): void {
    const { routes, store, bridge, dataDir } = ctx;

    // GET /api/processes/summaries — Lightweight index-only process list (no file I/O per process)
    routes.push({
        method: 'GET',
        pattern: '/api/processes/summaries',
        handler: async (req, res) => {
            if (!store.getProcessSummaries) {
                return handleAPIError(res, badRequest('Summaries not supported by this store'));
            }
            const filter = parseQueryParams(req.url || '/');
            const limit = filter.limit ?? 50;
            const offset = filter.offset ?? 0;
            const paginatedFilter: ProcessFilter = { ...filter, limit, offset };
            const { entries, total } = await store.getProcessSummaries(paginatedFilter);
            sendJSON(res, 200, { summaries: entries, total, limit, offset });
        },
    });

    // GET /api/processes — List processes with filtering + pagination
    routes.push({
        method: 'GET',
        pattern: '/api/processes',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const sdkSessionId = typeof parsed.query.sdkSessionId === 'string' ? parsed.query.sdkSessionId : '';

            if (sdkSessionId) {
                const all = await store.getAllProcesses();
                const match = all.find(p => p.sdkSessionId === sdkSessionId);
                if (!match) {
                    return handleAPIError(res, notFound('Process with sdkSessionId: ' + sdkSessionId));
                }
                return sendJSON(res, 200, { process: match });
            }

            const filter = parseQueryParams(req.url || '/');

            const countFilter: ProcessFilter = { ...filter };
            delete countFilter.limit;
            delete countFilter.offset;
            const total = store.getProcessSummaries
                ? (await store.getProcessSummaries(countFilter)).total
                : (await store.getAllProcesses(countFilter)).length;

            const limit = filter.limit ?? 50;
            const offset = filter.offset ?? 0;
            const paginatedFilter: ProcessFilter = { ...filter, limit, offset };
            const processes = await store.getAllProcesses(paginatedFilter);

            const responseProcesses = filter.exclude
                ? processes.map(p => stripExcludedFields(p, filter.exclude))
                : processes;

            sendJSON(res, 200, { processes: responseProcesses, total, limit, offset });
        },
    });

    // DELETE /api/processes — Bulk-clear processes by status
    routes.push({
        method: 'DELETE',
        pattern: '/api/processes',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const statusParam = parsed.query.status;

            if (typeof statusParam !== 'string' || !statusParam) {
                return handleAPIError(res, badRequest('Query parameter "status" is required for bulk delete'));
            }

            const statuses = statusParam
                .split(',')
                .map(s => s.trim())
                .filter(s => VALID_STATUSES.has(s)) as AIProcessStatus[];

            if (statuses.length === 0) {
                return handleAPIError(res, badRequest('No valid status values provided'));
            }

            const removed = await store.clearProcesses({ status: statuses });
            sendJSON(res, 200, { removed });
        },
    });

    // POST /api/processes — Create a new process
    routes.push({
        method: 'POST',
        pattern: '/api/processes',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.id || !body.promptPreview || !body.status || !body.startTime) {
                return handleAPIError(res, missingFields(['id', 'promptPreview', 'status', 'startTime']));
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
            sendJSON(res, 201, proc);
        },
    });

    // GET /api/processes/:id/stream — SSE stream for real-time output
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)\/stream$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            return handleProcessStream(req, res, id, store);
        },
    });

    // GET /api/processes/:id/output — Persisted conversation output
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)\/output$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const proc = await store.getProcess(id, wsId);
            if (!proc) {
                return handleAPIError(res, notFound('Process'));
            }
            const filePath = proc.rawStdoutFilePath;
            if (!filePath) {
                return handleAPIError(res, notFound('Conversation output'));
            }
            try {
                await fs.promises.access(filePath);
                const content = await fs.promises.readFile(filePath, 'utf-8');
                sendJSON(res, 200, { content, format: 'markdown' });
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return handleAPIError(res, notFound('Conversation output'));
                }
                return handleAPIError(res, internalError('Failed to read conversation output'));
            }
        },
    });

    // GET /api/processes/:id/children — Child processes for a pipeline run
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)\/children$/,
        handler: async (req, res, match) => {
            const parentId = decodeURIComponent(match![1]);

            const baseFilter = parseQueryParams(req.url || '/');
            const filter: ProcessFilter = {
                ...baseFilter,
                parentProcessId: parentId,
            };

            if (!filter.exclude) {
                filter.exclude = ['conversation'];
            }

            const children = await store.getAllProcesses(filter);
            const responseChildren = filter.exclude
                ? children.map(p => stripExcludedFields(p, filter.exclude))
                : children;

            sendJSON(res, 200, { children: responseChildren, total: children.length });
        },
    });

    // GET /api/processes/:id — Single process detail
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const filter = parseQueryParams(req.url || '/');
            const proc = await store.getProcess(id, filter.workspaceId);
            if (!proc) {
                return handleAPIError(res, notFound('Process'));
            }
            const result = filter.exclude ? stripExcludedFields(proc, filter.exclude) : proc;
            sendJSON(res, 200, { process: result });
        },
    });

    // PATCH /api/processes/:id — Partial update
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/processes\/([^/]+)$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const existing = await store.getProcess(id, wsId);
            if (!existing) {
                return handleAPIError(res, notFound('Process'));
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

            await store.updateProcess(id, updates);
            const updated = await store.getProcess(id, wsId);
            sendJSON(res, 200, { process: updated });
        },
    });

    // DELETE /api/processes/:id — Remove a single process
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/processes\/([^/]+)$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const existing = await store.getProcess(id, wsId);
            if (!existing) {
                return handleAPIError(res, notFound('Process'));
            }
            await store.removeProcess(id);
            res.writeHead(204);
            res.end();
        },
    });

    // POST /api/processes/:id/cancel — Cancel a running process
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/cancel$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const existing = await store.getProcess(id, wsId);
            if (!existing) {
                return handleAPIError(res, notFound('Process'));
            }

            if (TERMINAL_STATUSES.has(existing.status)) {
                return handleAPIError(res, new APIError(409, `Process is already in terminal state: ${existing.status}`, 'CONFLICT'));
            }

            await store.updateProcess(id, {
                status: 'cancelling' as any,
            });

            process.stderr.write(`[Process] cancel id=${id} prevStatus=${existing.status}\n`);

            // Await the abort with a timeout so we don't hang the HTTP response
            const CANCEL_TIMEOUT_MS = 30_000;
            try {
                await Promise.race([
                    bridge?.cancelProcess?.(id),
                    new Promise<void>((_, reject) =>
                        setTimeout(() => reject(new Error('Cancel timeout')), CANCEL_TIMEOUT_MS)),
                ]);
            } catch {
                // Timeout or abort error — fall through to finalize
            }

            // Finalize: set terminal cancelled status (unless lifecycle runner already did)
            const current = await store.getProcess(id, wsId);
            if (current && !TERMINAL_STATUSES.has(current.status)) {
                await store.updateProcess(id, {
                    status: 'cancelled',
                    endTime: new Date(),
                });
            }

            const updated = await store.getProcess(id, wsId);
            sendJSON(res, 200, { process: updated });
        },
    });

    // POST /api/processes/:id/message — Send a follow-up message
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/message$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const wsId = parseQueryParams(req.url || '/').workspaceId;
            const proc = await store.getProcess(id, wsId);
            if (!proc) {
                return handleAPIError(res, notFound('Process'));
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.content || typeof body.content !== 'string') {
                return handleAPIError(res, missingFields(['content']));
            }

            // Record user message to repo memory (fire-and-forget)
            const recordWsId = (proc.metadata?.workspaceId as string) ?? '';
            if (dataDir && recordWsId && body.content) {
                try { recordUserMessage(dataDir, recordWsId, body.content); } catch { /* never block the response */ }
            }

            // Validate and extract image data URLs for persistence (cap at 5)
            let validatedImages: string[] | undefined;
            if (Array.isArray(body.images) && body.images.length > 0) {
                const filtered = body.images
                    .filter((img: unknown): img is string => typeof img === 'string' && isImageDataUrl(img as string))
                    .slice(0, 5);
                if (filtered.length > 0) {
                    validatedImages = filtered;
                }
            }

            // Decode optional base64 images to temp files for SDK attachment
            let attachments: Attachment[] | undefined;
            let imageTempDir: string | undefined;
            if (Array.isArray(body.images) && body.images.length > 0) {
                const validImages = body.images
                    .filter((img: unknown) => typeof img === 'string')
                    .slice(0, 10);
                if (validImages.length > 0) {
                    const result = saveImagesToTempFiles(validImages);
                    imageTempDir = result.tempDir;
                    attachments = result.attachments.length > 0 ? result.attachments : undefined;
                }
            }

            // Check session liveness before forwarding the prompt
            if (bridge && !(await bridge.isSessionAlive(id))) {
                return handleAPIError(res, new APIError(410, 'The AI session has ended. Please start a new task.', 'SESSION_EXPIRED'));
            }

            if (!bridge) {
                return handleAPIError(res, new APIError(501, 'Follow-up execution not available', 'NOT_IMPLEMENTED'));
            }

            // Validate optional mode override (ask | plan | autopilot)
            const VALID_MODES = ['ask', 'plan', 'autopilot'];
            const modeOverride: string | undefined = typeof body.mode === 'string' && VALID_MODES.includes(body.mode) ? body.mode : undefined;

            // Validate optional deliveryMode (immediate | enqueue), default to 'enqueue'
            const VALID_DELIVERY_MODES = ['immediate', 'enqueue'];
            if (body.deliveryMode !== undefined && body.deliveryMode !== null) {
                if (typeof body.deliveryMode !== 'string' || !VALID_DELIVERY_MODES.includes(body.deliveryMode)) {
                    return handleAPIError(res, badRequest(`Invalid deliveryMode: must be one of ${VALID_DELIVERY_MODES.join(', ')}`));
                }
            }
            const deliveryMode: 'immediate' | 'enqueue' = (body.deliveryMode === 'immediate') ? 'immediate' : 'enqueue';

            // Read optional client-provided optimistic ID for reconciliation
            const optimisticId: string | undefined = typeof body.optimisticId === 'string' ? body.optimisticId : undefined;

            // Pass content through as-is — /skill tokens are kept in the prompt
            // so the AI SDK receives the full user intent (e.g. "/impl fix the bug").
            const messageContent = (body.content as string);

            // Persist the user turn and mark the process as running atomically.
            // This ensures the SSE snapshot always includes the user message,
            // preventing a race where the snapshot replaces optimistic UI state
            // before the executor has written the turn.
            const appendResult = await store.appendConversationTurn(
                id,
                (turnIndex) => ({
                    role: 'user' as const,
                    content: messageContent,
                    timestamp: new Date(),
                    turnIndex,
                    timeline: [],
                    images: validatedImages,
                }),
                { additionalUpdates: { status: 'running' } },
            );
            const turnIndex = appendResult?.turn.turnIndex ?? (proc.conversationTurns?.length ?? 0);

            if (bridge.enqueue) {
                const displayName = truncateDisplayName(messageContent.trim());
                const parentTask = bridge.findTaskByProcessId?.(id);
                if (parentTask && parentTask.status === 'completed' && bridge.requeueForFollowUp) {
                    await bridge.requeueForFollowUp(parentTask.id, messageContent, attachments, imageTempDir, modeOverride, deliveryMode, validatedImages);
                } else {
                    await bridge.enqueue({
                        type: 'chat',
                        priority: 'normal',
                        payload: {
                            kind: 'chat',
                            prompt: messageContent,
                            processId: id,
                            attachments,
                            imageTempDir,
                            images: validatedImages,
                            workingDirectory: proc.workingDirectory,
                            readonly: (proc as any).payload?.readonly,
                            ...(modeOverride ? { mode: modeOverride } : {}),
                            deliveryMode,
                        },
                        config: {},
                        displayName,
                    });
                }
            } else {
                bridge.executeFollowUp(id, messageContent, attachments, modeOverride, deliveryMode, validatedImages).catch(() => {
                }).finally(() => {
                    if (imageTempDir) { cleanupTempDir(imageTempDir); }
                });
            }

            emitMessageQueued(store, id, {
                turnIndex,
                deliveryMode,
                queuePosition: deliveryMode === 'immediate' ? 0 : 1,
                optimisticId,
            });

            globalThis.process.stderr.write(`[Process] message id=${id} turnIndex=${turnIndex}\n`);

            sendJSON(res, 202, { processId: id, turnIndex });
        },
    });

    // ------------------------------------------------------------------
    // Stats endpoint
    // ------------------------------------------------------------------

    // GET /api/stats — Aggregate statistics
    routes.push({
        method: 'GET',
        pattern: '/api/stats',
        handler: async (_req, res) => {
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

            sendJSON(res, 200, {
                totalProcesses: allProcesses.length,
                byStatus,
                byWorkspace,
            });
        },
    });
}
