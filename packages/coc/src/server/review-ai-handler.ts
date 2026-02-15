/**
 * Review AI REST API Handler
 *
 * HTTP routes for AI-powered review features: ask-AI clarification
 * (background and queued), prompt generation from comments, and
 * prompt file discovery/reading.
 *
 * Follows the same registration pattern as review-handler.ts and
 * queue-handler.ts.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import type { ProcessStore, TaskQueueManager } from '@plusplusoneplusplus/pipeline-core';
import { getCopilotSDKService } from '@plusplusoneplusplus/pipeline-core';
import type { Route } from './types';
import { sendJSON, sendError, parseBody } from './api-handler';
import { safePath } from './review-handler';
import type { ReviewCommentsManager } from './review-handler';
import { executeAIClarification } from './review-ai-executor';
import type { ReviewAIClarificationRequest } from './review-ai-executor';
import { discoverPromptFiles, readPromptFileContent } from './prompt-utils';

// ============================================================================
// Types
// ============================================================================

export interface ReviewAIDeps {
    projectDir: string;
    store: ProcessStore;
    queueManager: TaskQueueManager;
    commentsManager: ReviewCommentsManager;
}

// ============================================================================
// Validation
// ============================================================================

const VALID_INSTRUCTION_TYPES = new Set(['clarify', 'go-deeper', 'custom']);

function validateAskAIBody(body: any): { valid: true; request: Omit<ReviewAIClarificationRequest, 'filePath'> } | { valid: false; error: string } {
    if (!body || typeof body !== 'object') {
        return { valid: false, error: 'Invalid request body' };
    }
    if (typeof body.selectedText !== 'string' || !body.selectedText.trim()) {
        return { valid: false, error: 'Missing required field: selectedText' };
    }
    if (typeof body.startLine !== 'number') {
        return { valid: false, error: 'Missing required field: startLine' };
    }
    if (typeof body.endLine !== 'number') {
        return { valid: false, error: 'Missing required field: endLine' };
    }
    if (!body.instructionType || !VALID_INSTRUCTION_TYPES.has(body.instructionType)) {
        return { valid: false, error: `Invalid instructionType. Valid values: ${Array.from(VALID_INSTRUCTION_TYPES).join(', ')}` };
    }

    return {
        valid: true,
        request: {
            selectedText: body.selectedText,
            startLine: body.startLine,
            endLine: body.endLine,
            surroundingLines: body.surroundingLines,
            nearestHeading: body.nearestHeading,
            instructionType: body.instructionType,
            customInstruction: body.customInstruction,
            promptFileContent: body.promptFileContent,
            model: body.model,
            timeoutMs: body.timeoutMs,
        },
    };
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register review AI REST API routes.
 * Mutates the `routes` array in-place.
 */
export function registerReviewAIRoutes(routes: Route[], deps: ReviewAIDeps): void {
    const { projectDir, store, queueManager, commentsManager } = deps;

    // ------------------------------------------------------------------
    // POST /api/review/files/:path/ask-ai — background AI clarification
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/review\/files\/(.+)\/ask-ai$/,
        handler: async (req, res, match) => {
            const filePath = decodeURIComponent(match![1]);
            const resolved = safePath(projectDir, filePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const validation = validateAskAIBody(body);
            if (!validation.valid) {
                return sendError(res, 400, validation.error);
            }

            // Check SDK availability
            try {
                const sdkService = getCopilotSDKService();
                const availability = await sdkService.isAvailable();
                if (!availability.available) {
                    return sendError(res, 503, 'AI service not available');
                }
            } catch {
                return sendError(res, 503, 'AI service not available');
            }

            const request: ReviewAIClarificationRequest = {
                ...validation.request,
                filePath,
            };

            // Fire and forget — caller tracks via WebSocket or polling
            const resultPromise = executeAIClarification(request, store, projectDir);

            // Generate a process ID synchronously for the response
            const processId = `ai-review-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

            // Wait briefly for the process to be created so we can return the real ID
            try {
                const result = await Promise.race([
                    resultPromise,
                    new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
                ]);
                if (result) {
                    sendJSON(res, 202, {
                        processId: result.processId,
                        status: result.success ? 'completed' : 'failed',
                        message: result.success ? 'AI clarification completed' : result.error,
                    });
                    return;
                }
            } catch {
                // Continue with fire-and-forget
            }

            // If still running after 100ms, return 202 immediately
            resultPromise.catch(() => {}); // prevent unhandled rejection
            sendJSON(res, 202, {
                processId,
                status: 'running',
                message: 'AI clarification started',
            });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/review/files/:path/ask-ai-queued — queued AI request
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/review\/files\/(.+)\/ask-ai-queued$/,
        handler: async (req, res, match) => {
            const filePath = decodeURIComponent(match![1]);
            const resolved = safePath(projectDir, filePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const validation = validateAskAIBody(body);
            if (!validation.valid) {
                return sendError(res, 400, validation.error);
            }

            const payload: ReviewAIClarificationRequest = {
                ...validation.request,
                filePath,
            };

            const displayName = `AI: ${payload.instructionType} (${path.basename(filePath)}:${payload.startLine})`;

            try {
                const taskId = queueManager.enqueue({
                    type: 'ai-clarification',
                    priority: 'normal',
                    payload: payload as any,
                    config: {
                        model: payload.model,
                        timeoutMs: payload.timeoutMs,
                        retryOnFailure: false,
                    },
                    displayName,
                });

                const position = queueManager.getPosition(taskId);
                const stats = queueManager.getStats();

                sendJSON(res, 202, {
                    taskId,
                    position: position ?? 0,
                    totalQueued: stats.queued,
                    message: `Added to queue (#${position ?? 0})`,
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to enqueue task';
                return sendError(res, 400, message);
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/review/files/:path/generate-prompt — generate prompt
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/review\/files\/(.+)\/generate-prompt$/,
        handler: async (req, res, match) => {
            const filePath = decodeURIComponent(match![1]);
            const resolved = safePath(projectDir, filePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                // body stays empty — all fields optional
            }

            commentsManager.loadComments();
            const comments = commentsManager.getCommentsForFile(filePath)
                .filter(c => c.status === 'open');

            if (comments.length === 0) {
                return sendJSON(res, 200, { prompts: [], totalComments: 0 });
            }

            // Build a prompt from the comments
            const includeLineNumbers = body.includeLineNumbers !== false;
            const lines: string[] = [];

            if (body.customPreamble) {
                lines.push(body.customPreamble, '');
            }

            lines.push(`## Review Comments for ${filePath}`, '');

            for (const c of comments) {
                const lineInfo = includeLineNumbers && c.selection
                    ? ` (L${c.selection.startLine}-${c.selection.endLine})`
                    : '';
                lines.push(`### Comment${lineInfo}`);
                if (c.selectedText) {
                    lines.push('```', c.selectedText, '```');
                }
                lines.push(c.comment, '');
            }

            if (body.customInstructions) {
                lines.push('---', body.customInstructions);
            }

            const promptText = lines.join('\n');

            sendJSON(res, 200, {
                prompts: [{
                    prompt: promptText,
                    commentCount: comments.length,
                    chunkIndex: 0,
                    totalChunks: 1,
                }],
                totalComments: comments.length,
            });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/review/prompts — list available .prompt.md files
    // (must appear before the :path regex below)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/review/prompts',
        handler: async (_req, res) => {
            try {
                const prompts = await discoverPromptFiles(projectDir);
                sendJSON(res, 200, { prompts });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to discover prompt files';
                return sendError(res, 500, message);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/review/prompts/:path — read a single .prompt.md file
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/review\/prompts\/(.+)$/,
        handler: async (_req, res, match) => {
            const relativePath = decodeURIComponent(match![1]);
            const resolved = safePath(projectDir, relativePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            if (!resolved.endsWith('.prompt.md')) {
                return sendError(res, 400, 'Path must reference a .prompt.md file');
            }

            try {
                const content = await readPromptFileContent(resolved);
                const name = path.basename(resolved).replace('.prompt.md', '');
                sendJSON(res, 200, {
                    path: relativePath,
                    name,
                    content,
                });
            } catch {
                return sendError(res, 404, `Prompt file not found: ${relativePath}`);
            }
        },
    });
}
