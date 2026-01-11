/**
 * Base AI Clarification Handler
 *
 * Provides shared functionality for AI clarification requests.
 * Routes requests to configured AI tools (Copilot CLI or clipboard).
 * Can capture Copilot CLI output and return it for adding as a comment.
 *
 * This module uses the generic ai-service for CLI invocation while
 * providing a base for system-specific prompt building and orchestration.
 */

import * as vscode from 'vscode';
import {
    AIInvocationResult,
    IAIProcessManager,
    copyToClipboard,
    getAICommandRegistry,
    getAIToolSetting,
    invokeCopilotCLI
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

    // If selected text is too long, truncate it and rebuild the prompt
    const maxSelectedLength = MAX_PROMPT_SIZE - 200; // Leave more room for instruction text
    const truncatedText = selectedText.substring(0, maxSelectedLength) + '...';
    const truncatedPrompt = rebuildPrompt(truncatedText);

    return { prompt: truncatedPrompt, truncated: true };
}

/**
 * Handle an AI clarification request.
 * Routes to the configured AI tool (Copilot CLI or clipboard).
 * Falls back to clipboard if Copilot CLI fails.
 *
 * @param prompt - The prompt to send
 * @param truncated - Whether the prompt was truncated
 * @param workspaceRoot - The workspace root directory (needed for copilot CLI)
 * @param processManager - Optional process manager for tracking running processes
 * @returns The clarification result if successful
 */
export async function handleAIClarificationBase(
    prompt: string,
    truncated: boolean,
    workspaceRoot: string,
    processManager?: IAIProcessManager
): Promise<BaseClarificationResult> {
    // Show truncation warning if necessary
    if (truncated) {
        vscode.window.showWarningMessage('AI clarification prompt was truncated to fit size limits.');
    }

    // Get the configured AI tool
    const tool = getAIToolSetting();

    if (tool === 'copilot-cli') {
        // Try to invoke Copilot CLI and capture output
        const result = await invokeCopilotCLI(prompt, workspaceRoot, processManager);
        const clarificationResult = toClarificationResult(result);

        if (!clarificationResult.success) {
            // Fall back to clipboard
            await copyToClipboard(prompt);
            vscode.window.showWarningMessage(
                `${clarificationResult.error || 'Failed to get AI clarification'}. Prompt copied to clipboard.`,
                'Open Terminal'
            ).then(selection => {
                if (selection === 'Open Terminal') {
                    vscode.commands.executeCommand('workbench.action.terminal.new');
                }
            });
            return clarificationResult;
        }

        return clarificationResult;
    } else {
        // Copy to clipboard
        await copyToClipboard(prompt);
        vscode.window.showInformationMessage(
            'AI clarification prompt copied to clipboard!',
            'Open Copilot Chat'
        ).then(selection => {
            if (selection === 'Open Copilot Chat') {
                // Try to open Copilot chat if available
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
}

