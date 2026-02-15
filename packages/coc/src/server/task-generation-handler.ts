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
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import {
    buildCreateTaskPrompt,
    buildCreateTaskPromptWithName,
    buildCreateFromFeaturePrompt,
    buildDeepModePrompt,
    gatherFeatureContext,
    parseCreatedFilePath,
    buildDiscoveryPrompt,
    parseDiscoveryResponse,
    getCopilotSDKService,
    approveAllPermissions,
    denyAllPermissions,
    DEFAULT_AI_TIMEOUT_MS,
} from '@plusplusoneplusplus/pipeline-core';
import type { SelectedContext } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError, parseBody } from './api-handler';
import type { Route } from './types';

// ============================================================================
// Workspace resolution helper
// ============================================================================

async function resolveWorkspace(store: ProcessStore, id: string) {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === id);
}

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
export function registerTaskGenerationRoutes(routes: Route[], store: ProcessStore): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/tasks/generate — AI task generation
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/generate$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            const { prompt, targetFolder, name, model, mode, depth } = body || {};

            if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
                return sendError(res, 400, 'Missing required field: prompt');
            }

            // Resolve target folder
            const tasksBase = path.resolve(ws.rootPath, '.vscode/tasks');
            const resolvedTarget = targetFolder
                ? path.resolve(tasksBase, targetFolder)
                : tasksBase;

            // Ensure target folder exists
            try {
                fs.mkdirSync(resolvedTarget, { recursive: true });
            } catch {
                return sendError(res, 500, 'Failed to create target folder');
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
                aiPrompt = buildCreateTaskPromptWithName(name, prompt, resolvedTarget);
            } else {
                aiPrompt = buildCreateTaskPrompt(prompt, resolvedTarget);
            }

            // Switch to SSE streaming
            writeSSEHeaders(res);
            sendEvent(res, 'progress', { phase: 'generating', message: 'Sending prompt to AI...' });

            let clientDisconnected = false;
            req.on('close', () => { clientDisconnected = true; });

            try {
                const service = getCopilotSDKService();
                const available = await service.isAvailable();
                if (!available.available) {
                    sendEvent(res, 'error', { message: 'AI service unavailable' });
                    sendEvent(res, 'done', { success: false });
                    res.end();
                    return;
                }

                sendEvent(res, 'progress', { phase: 'generating', message: 'AI is generating task...' });

                const result = await service.sendMessage({
                    prompt: aiPrompt,
                    model: model || undefined,
                    workingDirectory: ws.rootPath,
                    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
                    usePool: false,
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

                // Try to find the created file
                const filePath = parseCreatedFilePath(result.response, resolvedTarget);

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
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            const { featureDescription, keywords, scope } = body || {};

            if (!featureDescription || typeof featureDescription !== 'string' || !featureDescription.trim()) {
                return sendError(res, 400, 'Missing required field: featureDescription');
            }

            try {
                const service = getCopilotSDKService();
                const available = await service.isAvailable();
                if (!available.available) {
                    return sendError(res, 503, 'AI service unavailable');
                }

                const discoveryPrompt = buildDiscoveryPrompt({
                    featureDescription: featureDescription.trim(),
                    keywords: Array.isArray(keywords) ? keywords.filter((k: any) => typeof k === 'string') : undefined,
                    scope: scope && typeof scope === 'object' ? scope : undefined,
                    workspaceRoot: ws.rootPath,
                });

                const result = await service.sendMessage({
                    prompt: discoveryPrompt,
                    workingDirectory: ws.rootPath,
                    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
                    usePool: false,
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
}
