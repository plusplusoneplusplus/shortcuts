/**
 * Review AI Executor
 *
 * AI execution logic for the review editor, separated from HTTP concerns
 * for testability. Builds clarification prompts, executes via CopilotSDKService,
 * and tracks processes in the ProcessStore.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    ProcessStore,
    AIProcess,
    TokenUsage,
    TaskExecutor,
    TaskExecutionResult,
    QueuedTask,
} from '@plusplusoneplusplus/pipeline-core';
import {
    getCopilotSDKService,
    approveAllPermissions,
    DEFAULT_AI_TIMEOUT_MS,
} from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Types
// ============================================================================

export interface ReviewAIClarificationRequest {
    filePath: string;
    selectedText: string;
    startLine: number;
    endLine: number;
    surroundingLines?: string;
    nearestHeading?: string;
    instructionType: 'clarify' | 'go-deeper' | 'custom';
    customInstruction?: string;
    promptFileContent?: string;
    model?: string;
    timeoutMs?: number;
}

export interface ReviewAIClarificationResult {
    processId: string;
    success: boolean;
    clarification?: string;
    error?: string;
    tokenUsage?: TokenUsage;
}

// ============================================================================
// Prompt Builder
// ============================================================================

/**
 * Build a clarification prompt from the request fields.
 * Mirrors the prompt-building logic from the VS Code extension's
 * ai-clarification-handler.ts, adapted without vscode deps.
 */
export function buildClarificationPrompt(request: ReviewAIClarificationRequest): string {
    const parts: string[] = [];

    if (request.promptFileContent) {
        parts.push('--- Instructions from template ---');
        parts.push(request.promptFileContent);
        parts.push('', '--- Document context ---');
    }

    parts.push(`File: ${request.filePath}`);
    if (request.nearestHeading) {
        parts.push(`Section: ${request.nearestHeading}`);
    }
    parts.push(`Lines: ${request.startLine}-${request.endLine}`, '');
    parts.push('Selected text:', '```', request.selectedText, '```', '');

    // Instruction
    const instructionMap: Record<string, string> = {
        'clarify': 'Please clarify and explain the selected text.',
        'go-deeper': 'Please provide a deep analysis of the selected text, including implications, edge cases, and related concepts.',
        'custom': request.customInstruction || 'Please help me understand the selected text.',
    };
    parts.push(instructionMap[request.instructionType] || instructionMap['clarify']);

    if (request.surroundingLines) {
        parts.push('', 'Surrounding context:', '```', request.surroundingLines, '```');
    }

    return parts.join('\n');
}

// ============================================================================
// AI Executor
// ============================================================================

/**
 * Resolve the working directory for AI sessions.
 * Defaults to projectDir; uses projectDir/src if it exists.
 */
function resolveWorkingDirectory(projectDir: string): string {
    const srcDir = path.join(projectDir, 'src');
    try {
        if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
            return srcDir;
        }
    } catch {
        // fall through
    }
    return projectDir;
}

/**
 * Execute an AI clarification request.
 *
 * 1. Checks SDK availability
 * 2. Builds prompt from request fields
 * 3. Creates AIProcess in ProcessStore (status: running)
 * 4. Calls CopilotSDKService.sendMessage()
 * 5. Updates process to completed/failed
 * 6. Returns result
 */
export async function executeAIClarification(
    request: ReviewAIClarificationRequest,
    store: ProcessStore,
    projectDir: string,
): Promise<ReviewAIClarificationResult> {
    const sdkService = getCopilotSDKService();
    const availability = await sdkService.isAvailable();
    if (!availability.available) {
        throw new Error(`Copilot SDK not available: ${availability.error || 'unknown reason'}`);
    }

    const prompt = buildClarificationPrompt(request);
    const processId = `ai-review-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const workingDirectory = resolveWorkingDirectory(projectDir);

    // Create process record
    const process: AIProcess = {
        id: processId,
        type: 'clarification',
        promptPreview: prompt.length > 80 ? prompt.substring(0, 77) + '...' : prompt,
        fullPrompt: prompt,
        status: 'running',
        startTime: new Date(),
        workingDirectory,
        metadata: {
            type: 'clarification',
            source: 'review-editor',
            filePath: request.filePath,
            startLine: request.startLine,
            endLine: request.endLine,
            instructionType: request.instructionType,
        },
    };

    try {
        await store.addProcess(process);
    } catch {
        // Non-fatal
    }

    try {
        const result = await sdkService.sendMessage({
            prompt,
            model: request.model,
            workingDirectory,
            timeoutMs: request.timeoutMs || DEFAULT_AI_TIMEOUT_MS,
            usePool: false,
            onPermissionRequest: approveAllPermissions,
        });

        if (!result.success) {
            throw new Error(result.error || 'AI execution failed');
        }

        // Update process as completed
        try {
            await store.updateProcess(processId, {
                status: 'completed',
                endTime: new Date(),
                result: result.response || '',
            });
        } catch {
            // Non-fatal
        }

        return {
            processId,
            success: true,
            clarification: result.response || '',
            tokenUsage: result.tokenUsage,
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Update process as failed
        try {
            await store.updateProcess(processId, {
                status: 'failed',
                endTime: new Date(),
                error: errorMsg,
            });
        } catch {
            // Non-fatal
        }

        return {
            processId,
            success: false,
            error: errorMsg,
        };
    }
}

// ============================================================================
// Task Executor (for queued AI tasks)
// ============================================================================

/**
 * Create a TaskExecutor that processes review AI clarification tasks
 * through the queue system.
 */
export function createReviewTaskExecutor(store: ProcessStore, projectDir: string): TaskExecutor {
    return {
        async execute(task: QueuedTask): Promise<TaskExecutionResult> {
            const startTime = Date.now();
            const request = task.payload as ReviewAIClarificationRequest;
            try {
                const result = await executeAIClarification(request, store, projectDir);
                return {
                    success: result.success,
                    result,
                    durationMs: Date.now() - startTime,
                    error: result.error ? new Error(result.error) : undefined,
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error : new Error(String(error)),
                    durationMs: Date.now() - startTime,
                };
            }
        },
    };
}
