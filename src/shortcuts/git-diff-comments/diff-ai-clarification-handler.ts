/**
 * Diff AI Clarification Handler
 * 
 * Handles AI clarification requests from the diff review editor.
 * Routes requests to configured AI tools (Copilot CLI or clipboard).
 * Can capture Copilot CLI output and return it for adding as a comment.
 * 
 * This module uses the generic ai-service for CLI invocation while
 * providing diff-specific prompt building and orchestration.
 */

import * as vscode from 'vscode';
import {
    AIInvocationResult,
    AIModel,
    AIProcessManager,
    copyToClipboard,
    DEFAULT_PROMPTS,
    escapeShellArg,
    getAIModelSetting,
    getAIToolSetting,
    getPromptTemplate,
    invokeCopilotCLI,
    parseCopilotOutput,
    VALID_MODELS
} from '../ai-service';
import { DiffClarificationContext } from './types';

/** Maximum prompt size in characters */
const MAX_PROMPT_SIZE = 8000;

/**
 * Result of AI clarification request
 * Maps the generic AIInvocationResult to clarification-specific naming
 */
export interface DiffClarificationResult {
    /** Whether the clarification was successful */
    success: boolean;
    /** The clarification text from the AI */
    clarification?: string;
    /** Error message if failed */
    error?: string;
}

// Re-export commonly used items from ai-service for backward compatibility
export {
    DEFAULT_PROMPTS,
    escapeShellArg,
    getAIModelSetting,
    getPromptTemplate,
    parseCopilotOutput,
    VALID_MODELS
};
export type { AIModel };

/**
 * Build prompt instructions based on the instruction type.
 * Uses configurable prompt templates from VS Code settings.
 * 
 * @param context - The clarification context from the webview
 * @returns The instruction-specific prompt prefix
 */
function getInstructionPrefix(context: DiffClarificationContext): string {
    switch (context.instructionType) {
        case 'clarify':
            return getPromptTemplate('clarify');
        case 'go-deeper':
            return getPromptTemplate('goDeeper');
        case 'custom':
            // For custom instructions, the user's instruction is the prefix
            // Fall back to the configurable default if no custom instruction provided
            return context.customInstruction || getPromptTemplate('customDefault');
        default:
            return getPromptTemplate('clarify');
    }
}

/**
 * Build a clarification prompt from the context.
 * Uses different prompt templates based on the instruction type.
 * The AI tool can read the file directly for additional context.
 * 
 * @param context - The clarification context from the webview
 * @returns The formatted prompt string
 */
export function buildDiffClarificationPrompt(context: DiffClarificationContext): string {
    const selectedText = context.selectedText.trim();
    const instructionPrefix = getInstructionPrefix(context);
    
    // Include diff side information for context
    const sideInfo = context.side === 'old' ? ' (from old version)' : context.side === 'new' ? ' (from new version)' : '';

    // For custom instructions, format slightly differently
    if (context.instructionType === 'custom') {
        return `${instructionPrefix}: "${selectedText}"${sideInfo} in the file ${context.filePath}`;
    }

    return `${instructionPrefix} "${selectedText}"${sideInfo} in the file ${context.filePath}`;
}

/**
 * Validate and truncate prompt if necessary.
 * With the simplified prompt format, truncation is rarely needed.
 * 
 * @param context - The clarification context
 * @returns Object containing the prompt and whether truncation occurred
 */
export function validateAndTruncateDiffPrompt(context: DiffClarificationContext): { prompt: string; truncated: boolean } {
    const prompt = buildDiffClarificationPrompt(context);

    if (prompt.length <= MAX_PROMPT_SIZE) {
        return { prompt, truncated: false };
    }

    // If selected text is too long, truncate it and rebuild the prompt
    const maxSelectedLength = MAX_PROMPT_SIZE - 200; // Leave more room for instruction text
    const truncatedText = context.selectedText.substring(0, maxSelectedLength) + '...';
    const truncatedContext: DiffClarificationContext = {
        ...context,
        selectedText: truncatedText
    };
    const truncatedPrompt = buildDiffClarificationPrompt(truncatedContext);

    return { prompt: truncatedPrompt, truncated: true };
}

/**
 * Convert generic AI invocation result to clarification result
 */
function toDiffClarificationResult(result: AIInvocationResult): DiffClarificationResult {
    return {
        success: result.success,
        clarification: result.response,
        error: result.error
    };
}

/**
 * Handle an AI clarification request for diff view.
 * Routes to the configured AI tool (Copilot CLI or clipboard).
 * Falls back to clipboard if Copilot CLI fails.
 *
 * @param context - The clarification context from the webview
 * @param workspaceRoot - The workspace root directory (needed for copilot CLI)
 * @param processManager - Optional process manager for tracking running processes
 * @returns The clarification result if successful
 */
export async function handleDiffAIClarification(
    context: DiffClarificationContext,
    workspaceRoot: string,
    processManager?: AIProcessManager
): Promise<DiffClarificationResult> {
    // Validate and build the prompt
    const { prompt, truncated } = validateAndTruncateDiffPrompt(context);

    // Show truncation warning if necessary
    if (truncated) {
        vscode.window.showWarningMessage('AI clarification prompt was truncated to fit size limits.');
    }

    // Get the configured AI tool
    const tool = getAIToolSetting();

    if (tool === 'copilot-cli') {
        // Try to invoke Copilot CLI and capture output
        const result = await invokeCopilotCLI(prompt, workspaceRoot, processManager);
        const clarificationResult = toDiffClarificationResult(result);

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

