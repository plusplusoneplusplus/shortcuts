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

import {
    AIModel,
    IAIProcessManager,
    DEFAULT_PROMPTS,
    escapeShellArg,
    getAICommandRegistry,
    getAIModelSetting,
    getPromptTemplate,
    parseCopilotOutput,
    VALID_MODELS
} from '../ai-service';
import {
    getCommentType as baseGetCommentType,
    getResponseLabel as baseGetResponseLabel,
    handleAIClarificationBase,
    validateAndTruncatePromptBase
} from '../shared/ai-clarification-handler-base';
import { DiffClarificationContext } from './types';

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
 * Build a clarification prompt from the context.
 * Uses the AI command registry for configurable prompts.
 * The AI tool can read the file directly for additional context.
 *
 * @param context - The clarification context from the webview
 * @returns The formatted prompt string
 */
export function buildDiffClarificationPrompt(context: DiffClarificationContext): string {
    const registry = getAICommandRegistry();
    const selectedText = context.selectedText.trim();

    // Get the prompt from the registry
    const promptPrefix = registry.getPromptForCommand(context.instructionType, context.customInstruction);

    // Include diff side information for context
    const sideInfo = context.side === 'old' ? ' (from old version)' : context.side === 'new' ? ' (from new version)' : '';

    // Check if this is a custom input command
    const command = registry.getCommand(context.instructionType);
    const isCustomInput = command?.isCustomInput && context.customInstruction;

    // For custom instructions, format slightly differently
    if (isCustomInput) {
        return `${promptPrefix}: "${selectedText}"${sideInfo} in the file ${context.filePath}`;
    }

    return `${promptPrefix} "${selectedText}"${sideInfo} in the file ${context.filePath}`;
}

/**
 * Get the response label for a command (for adding AI comments)
 */
export function getDiffResponseLabel(commandId: string): string {
    return baseGetResponseLabel(commandId);
}

/**
 * Get the comment type for a command (for styling)
 */
export function getDiffCommentType(commandId: string): 'ai-clarification' | 'ai-critique' | 'ai-suggestion' | 'ai-question' {
    return baseGetCommentType(commandId);
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
    
    return validateAndTruncatePromptBase(
        prompt,
        context.selectedText,
        (truncatedText) => buildDiffClarificationPrompt({ ...context, selectedText: truncatedText })
    );
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
    processManager?: IAIProcessManager
): Promise<DiffClarificationResult> {
    const { prompt, truncated } = validateAndTruncateDiffPrompt(context);
    return handleAIClarificationBase(prompt, truncated, workspaceRoot, processManager);
}

