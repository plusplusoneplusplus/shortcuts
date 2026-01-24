/**
 * Base AI Clarification Handler
 *
 * Provides shared functionality for AI clarification requests.
 * Routes requests to configured AI backends:
 * - copilot-sdk: Use the @github/copilot-sdk for structured JSON-RPC communication (recommended)
 * - copilot-cli: Use the copilot CLI via child process (legacy)
 * - clipboard: Copy prompt to clipboard for manual use
 *
 * This module uses the generic ai-service for backend invocation while
 * providing a base for system-specific prompt building and orchestration.
 */

import * as vscode from 'vscode';
import {
    AIInvocationResult,
    IAIProcessManager,
    copyToClipboard,
    getAICommandRegistry,
    getAIBackendSetting,
    getExtensionLogger,
    LogCategory,
    invokeAIWithFallback
} from '../ai-service';

/** Maximum prompt size in characters */
export const MAX_PROMPT_SIZE = 8000;

/**
 * Base result of AI clarification request
 */
export interface BaseClarificationResult {
    /** Whether the clarification was successful */
    success: boolean;
    /** The clarification text from the AI */
    clarification?: string;
    /** Error message if failed */
    error?: string;
}

/**
 * Base context for AI clarification requests
 */
export interface BaseClarificationContext {
    /** The selected text to clarify */
    selectedText: string;
    /** File being reviewed */
    filePath: string;
    /** Type of AI instruction */
    instructionType: string;
    /** Custom instruction text (only used when instructionType is 'custom') */
    customInstruction?: string;
}

/**
 * Get the response label for a command (for adding AI comments)
 */
export function getResponseLabel(commandId: string): string {
    return getAICommandRegistry().getResponseLabel(commandId);
}

/**
 * Get the comment type for a command (for styling)
 */
export function getCommentType(commandId: string): 'ai-clarification' | 'ai-critique' | 'ai-suggestion' | 'ai-question' {
    return getAICommandRegistry().getCommentType(commandId);
}

/**
 * Convert generic AI invocation result to clarification result
 */
export function toClarificationResult(result: AIInvocationResult): BaseClarificationResult {
    return {
        success: result.success,
        clarification: result.response,
        error: result.error
    };
}

/**
 * Validate and truncate prompt if necessary.
 * 
 * @param prompt - The full prompt string
 * @param selectedText - The selected text that can be truncated
 * @param rebuildPrompt - Function to rebuild prompt with truncated text
 * @returns Object containing the prompt and whether truncation occurred
 */
export function validateAndTruncatePromptBase(
    prompt: string,
    selectedText: string,
    rebuildPrompt: (truncatedText: string) => string
): { prompt: string; truncated: boolean } {
    if (prompt.length <= MAX_PROMPT_SIZE) {
        return { prompt, truncated: false };
    }

    // Calculate how much we need to reduce the selected text
    // The overhead is the prompt length minus the selected text length
    const overhead = prompt.length - selectedText.length;
    const maxSelectedLength = Math.max(100, MAX_PROMPT_SIZE - overhead - 10); // Leave 10 chars for "..."
    const truncatedText = selectedText.substring(0, maxSelectedLength) + '...';
    const truncatedPrompt = rebuildPrompt(truncatedText);

    return { prompt: truncatedPrompt, truncated: true };
}

/**
 * Handle an AI clarification request.
 * Routes to the configured AI backend:
 * - copilot-sdk: Use the @github/copilot-sdk for structured communication (recommended)
 * - copilot-cli: Use the copilot CLI via child process (legacy)
 * - clipboard: Copy prompt to clipboard for manual use
 *
 * Falls back to CLI if SDK fails, then to clipboard if CLI also fails.
 *
 * @param prompt - The prompt to send
 * @param truncated - Whether the prompt was truncated
 * @param workspaceRoot - The workspace root directory (needed for copilot CLI/SDK)
 * @param processManager - Optional process manager for tracking running processes
 * @returns The clarification result if successful
 */
export async function handleAIClarificationBase(
    prompt: string,
    truncated: boolean,
    workspaceRoot: string,
    processManager?: IAIProcessManager
): Promise<BaseClarificationResult> {
    const logger = getExtensionLogger();

    // Show truncation warning if necessary
    if (truncated) {
        vscode.window.showWarningMessage('AI clarification prompt was truncated to fit size limits.');
    }

    // Get the configured AI backend for special handling
    const backend = getAIBackendSetting();
    logger.debug(LogCategory.AI, `AI Clarification: Using backend '${backend}'`);

    // Handle clipboard-only backend
    if (backend === 'clipboard') {
        await copyToClipboard(prompt);
        vscode.window.showInformationMessage(
            'AI clarification prompt copied to clipboard!',
            'Open Copilot Chat'
        ).then(selection => {
            if (selection === 'Open Copilot Chat') {
                vscode.commands.executeCommand('github.copilot.chat.focus').then(
                    () => { /* success */ },
                    () => { /* Copilot chat not available, ignore */ }
                );
            }
        });
        return {
            success: false,
            error: 'Using clipboard mode - no automatic clarification'
        };
    }

    // Register the process before starting the AI call
    let processId: string | undefined;
    if (processManager) {
        processId = processManager.registerProcess(prompt);
        logger.debug(LogCategory.AI, `AI Clarification: Registered process ${processId}`);
    }

    try {
        // Use the unified AI invoker with SDK/CLI fallback and clipboard fallback
        const result = await invokeAIWithFallback(prompt, {
            usePool: false, // Clarification is a one-off request
            workingDirectory: workspaceRoot,
            clipboardFallback: true,
            featureName: 'Clarification'
        });

        // Attach SDK session ID for potential cancellation (if we got one)
        if (processId && result.sessionId && processManager) {
            processManager.attachSdkSessionId(processId, result.sessionId);
        }

        if (result.success) {
            // Mark process as completed
            if (processId && processManager) {
                processManager.completeProcess(processId, result.response);
            }
            return toClarificationResult(result);
        }

        // Failed - mark process and show UI message
        if (processId && processManager) {
            processManager.failProcess(processId, result.error || 'Request failed');
        }

        // Show clipboard fallback message if prompt was copied
        if (result.error?.includes('copied to clipboard')) {
            vscode.window.showWarningMessage(
                result.error,
                'Open Terminal'
            ).then(selection => {
                if (selection === 'Open Terminal') {
                    vscode.commands.executeCommand('workbench.action.terminal.new');
                }
            });
        }

        return toClarificationResult(result);
    } catch (error) {
        // Handle unexpected errors
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (processId && processManager) {
            processManager.failProcess(processId, errorMessage);
        }
        logger.error(LogCategory.AI, 'AI Clarification: Unexpected error', error instanceof Error ? error : undefined);
        return {
            success: false,
            error: errorMessage
        };
    }
}

