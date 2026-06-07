/**
 * Task Generation API Handler
 *
 * HTTP API routes for AI-powered task generation and feature-folder discovery.
 * Exposes the prompt-building logic from pipeline-core as REST endpoints with SSE streaming.
 *
 * Endpoints:
 *   POST /api/workspaces/:id/tasks/generate  — Generate a task with AI (SSE stream)
 *   POST /api/workspaces/:id/tasks/discover  — Discover related items for a feature
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ServerResponse } from 'http';
import type { CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from './task-types';
import {
    buildCreateTaskPrompt,
    buildCreateTaskPromptWithName,
    buildCreateFromFeaturePrompt,
    buildDeepModePrompt,
    buildPlanGenerationSystemPrompt,
    gatherFeatureContext,
    parseCreatedFilePath,
    buildDiscoveryPrompt,
    parseDiscoveryResponse,
    approveAllPermissions,
    denyAllPermissions,
    DEFAULT_AI_TIMEOUT_MS,
    AUTO_FOLDER_SENTINEL,
} from '@plusplusoneplusplus/forge';
import type { SelectedContext, ISDKService, AutoFolderContext } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { resolveTaskRoot } from './task-root-resolver';
import { isValidTaskFolder } from '../executors/auto-folder-utils';
import { validateAndParseTask } from '../routes/queue-shared';

// ============================================================================
// SSE Helpers
// ============================================================================

/** Write SSE headers to the response. */
function writeSSEHeaders(res: ServerResponse): void {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
}

/** Send a single SSE event frame. */
function sendEvent(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register task generation API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerTaskGenerationRoutes(
    routes: Route[],
    store: ProcessStore,
    bridge: MultiRepoQueueRouter,
    aiService: ISDKService,
    dataDir: string,
    prepareTaskForEnqueue?: (input: CreateTaskInput) => Promise<void>,
): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/tasks/generate — AI task generation
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/generate$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { prompt, targetFolder, name, model, mode, depth } = body || {};

            if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
                return sendError(res, 400, 'Missing required field: prompt');
            }

            // Resolve target folder (handle auto-folder sentinel)
            const tasksBase = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
            const isAutoFolder = targetFolder === AUTO_FOLDER_SENTINEL;
            const resolvedTarget = (isAutoFolder || !targetFolder)
                ? tasksBase
                : path.resolve(tasksBase, targetFolder);

            // Ensure target folder exists
            try {
                fs.mkdirSync(resolvedTarget, { recursive: true });
            } catch {
                return sendError(res, 500, 'Failed to create target folder');
            }

            // Build autoFolderContext when auto-folder mode is requested
            let autoFolderContext: AutoFolderContext | undefined;
            if (isAutoFolder) {
                const entries = await fs.promises.readdir(tasksBase, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
                const subfolders = entries
                    .filter(e => e.isDirectory() && e.name !== 'archive' && isValidTaskFolder(e.name))
                    .map(e => e.name);
                autoFolderContext = { tasksRoot: tasksBase, existingFolders: subfolders };
            }

            // Build the AI prompt based on mode
            let aiPrompt: string;

            if (mode === 'from-feature') {
                // Gather feature context from the target folder
                const context = await gatherFeatureContext(resolvedTarget, ws.rootPath);
                const selectedContext: SelectedContext = {
                    description: context.description,
                    planContent: context.planContent,
                    specContent: context.specContent,
                    relatedFiles: context.relatedFiles,
                };

                if (depth === 'deep') {
                    aiPrompt = buildDeepModePrompt(
                        selectedContext, prompt, name, resolvedTarget, ws.rootPath
                    );
                } else {
                    aiPrompt = buildCreateFromFeaturePrompt(
                        selectedContext, prompt, name, resolvedTarget
                    );
                }
            } else if (name && name.trim()) {
                aiPrompt = buildCreateTaskPromptWithName(name, prompt, resolvedTarget, autoFolderContext);
            } else if (isAutoFolder) {
                aiPrompt = buildCreateTaskPromptWithName(undefined, prompt, resolvedTarget, autoFolderContext);
            } else {
                aiPrompt = buildCreateTaskPrompt(prompt, resolvedTarget);
            }

            // Build system prompt for plan generation
            const systemPrompt = buildPlanGenerationSystemPrompt({
                targetPath: resolvedTarget,
                autoFolder: isAutoFolder,
                tasksRoot: isAutoFolder ? tasksBase : undefined,
                existingFolders: autoFolderContext?.existingFolders,
            });

            // Switch to SSE streaming
            writeSSEHeaders(res);
            sendEvent(res, 'progress', { phase: 'generating', message: 'Sending prompt to AI...' });

            let clientDisconnected = false;
            req.on('close', () => { clientDisconnected = true; });

            try {
                const available = await aiService.isAvailable();
                if (!available.available) {
                    sendEvent(res, 'error', { message: 'AI service unavailable' });
                    sendEvent(res, 'done', { success: false });
                    res.end();
                    return;
                }

                sendEvent(res, 'progress', { phase: 'generating', message: 'AI is generating task...' });

                const result = await aiService.sendMessage({
                    prompt: aiPrompt,
                    model: model || undefined,
                    workingDirectory: ws.rootPath,
                    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
                    systemMessage: { mode: 'append', content: systemPrompt },
                    onPermissionRequest: approveAllPermissions,
                    onStreamingChunk: (chunk: string) => {
                        if (!clientDisconnected) {
                            sendEvent(res, 'chunk', { content: chunk });
                        }
                    },
                });

                if (clientDisconnected) {
                    res.end();
                    return;
                }

                if (!result.success) {
                    sendEvent(res, 'error', { message: result.error || 'AI generation failed' });
                    sendEvent(res, 'done', { success: false });
                    res.end();
                    return;
                }

                // Try to find the created file (search from tasksBase when auto-folder)
                const searchRoot = isAutoFolder ? tasksBase : resolvedTarget;
                const filePath = parseCreatedFilePath(result.response, searchRoot);

                sendEvent(res, 'progress', { phase: 'complete', message: 'Task generated' });
                sendEvent(res, 'done', {
                    success: true,
                    filePath: filePath || null,
                    content: result.response || '',
                });
                res.end();
            } catch (error) {
                if (!clientDisconnected) {
                    const message = error instanceof Error ? error.message : String(error);
                    // Timeout → 504
                    if (message.toLowerCase().includes('timeout')) {
                        sendEvent(res, 'error', { message: 'AI request timed out' });
                    } else {
                        sendEvent(res, 'error', { message });
                    }
                    sendEvent(res, 'done', { success: false });
                    res.end();
                }
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/tasks/discover — Feature discovery
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/discover$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { featureDescription, keywords, scope } = body || {};

            if (!featureDescription || typeof featureDescription !== 'string' || !featureDescription.trim()) {
                return sendError(res, 400, 'Missing required field: featureDescription');
            }

            try {
                const available = await aiService.isAvailable();
                if (!available.available) {
                    return sendError(res, 503, 'AI service unavailable');
                }

                const discoveryPrompt = buildDiscoveryPrompt({
                    featureDescription: featureDescription.trim(),
                    keywords: Array.isArray(keywords) ? keywords.filter((k: any) => typeof k === 'string') : undefined,
                    scope: scope && typeof scope === 'object' ? scope : undefined,
                    workspaceRoot: ws.rootPath,
                });

                const result = await aiService.sendMessage({
                    prompt: discoveryPrompt,
                    workingDirectory: ws.rootPath,
                    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
                    onPermissionRequest: denyAllPermissions,
                });

                if (!result.success) {
                    return sendError(res, 500, result.error || 'Discovery failed');
                }

                const items = parseDiscoveryResponse(result.response || '');
                sendJSON(res, 200, { items });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.toLowerCase().includes('timeout')) {
                    return sendError(res, 504, 'Discovery request timed out');
                }
                return sendError(res, 500, 'Discovery failed: ' + message);
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/queue/generate — Queued task generation
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/queue\/generate$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { prompt, targetFolder, name, model, provider, reasoningEffort, effortTier, autoProviderRouting, mode, depth, priority, images } = body || {};

            if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
                return sendError(res, 400, 'Missing required field: prompt');
            }

            // Validate images: filter to strings, cap at 10
            const validImages = Array.isArray(images)
                ? images.filter((img: unknown) => typeof img === 'string').slice(0, 10)
                : undefined;

            const payload: ChatPayload = {
                kind: 'chat',
                mode: 'ask',
                prompt: prompt.trim(),
                workingDirectory: ws.rootPath,
                workspaceId: id,
                ...(typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
                ...(typeof provider === 'string' && provider.trim() ? { provider: provider.trim() as ChatPayload['provider'] } : {}),
                ...(typeof reasoningEffort === 'string' && reasoningEffort.trim() ? { reasoningEffort: reasoningEffort.trim() as ChatPayload['reasoningEffort'] } : {}),
                // Images must be at the top level for chat-base-executor and
                // process-lifecycle-runner to forward them to the AI SDK.
                ...(validImages && validImages.length > 0 ? { images: validImages } : {}),
                context: {
                    ...(autoProviderRouting === true ? { autoProviderRouting: { requested: true } } : {}),
                    taskGeneration: {
                        targetFolder,
                        name,
                        depth,
                        mode,
                        ...(validImages && validImages.length > 0 ? { images: validImages } : {}),
                    },
                },
            };

            const taskSpec = {
                type: 'chat',
                priority: priority || 'normal',
                payload: payload as unknown as Record<string, unknown>,
                config: {
                    ...(typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
                    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
                    ...(typeof reasoningEffort === 'string' && reasoningEffort.trim() ? { reasoningEffort: reasoningEffort.trim() } : {}),
                    ...(typeof effortTier === 'string' && effortTier.trim() ? { effortTier: effortTier.trim() } : {}),
                },
                displayName: name || prompt.trim().slice(0, 60),
            };
            const validation = validateAndParseTask(taskSpec);
            if (!validation.valid || !validation.input) {
                return sendError(res, 400, validation.error || 'Invalid queue task');
            }
            if (prepareTaskForEnqueue) {
                try {
                    await prepareTaskForEnqueue(validation.input);
                } catch (err) {
                    return sendError(res, 400, err instanceof Error ? err.message : 'Failed to resolve provider or effort tier');
                }
            }

            bridge.getOrCreateBridge(ws.rootPath);
            const queueManager = bridge.registry.getQueueForRepo(ws.rootPath);
            const taskId = queueManager.enqueue(validation.input);

            sendJSON(res, 201, { taskId, queuedAt: Date.now() });
        },
    });
}
