/**
 * AI Clarification Handler
 *
 * Handles AI clarification requests from the review editor.
 * Routes requests to configured AI tools (Copilot CLI or clipboard).
 * Can capture Copilot CLI output and return it for adding as a comment.
 *
 * This module uses the generic ai-service for CLI invocation while
 * providing markdown-specific prompt building and orchestration.
 */

import {
    AIModel,
    IAIProcessManager,
    buildPrompt,
    DEFAULT_PROMPTS,
    getAIModelSetting,
    getPromptTemplate,
    parseCopilotOutput,
    PromptContext,
    VALID_MODELS
} from '../ai-service';
import { escapeShellArg } from '@plusplusoneplusplus/pipeline-core';
import {
    getCommentType as baseGetCommentType,
    getResponseLabel as baseGetResponseLabel,
    handleAIClarificationBase,
    validateAndTruncatePromptBase
} from '../shared/ai-clarification-handler-base';
import { ClarificationContext } from './types';

/**
 * Result of AI clarification request
 * Maps the generic AIInvocationResult to clarification-specific naming
 */
export interface ClarificationResult {
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
export function buildClarificationPrompt(context: ClarificationContext): string {
    // Build prompt context from clarification context
    const promptContext: PromptContext = {
        selectedText: context.selectedText.trim(),
        filePath: context.filePath,
        surroundingContent: context.surroundingContent,
        nearestHeading: context.nearestHeading,
        headings: context.headings
    };

    // Build the base prompt using the command registry
    let prompt = buildPrompt(
        context.instructionType,
        promptContext,
        context.customInstruction
    );

    // If prompt file content is provided, prepend it to the prompt
    if (context.promptFileContent) {
        const templateHeader = context.skillName 
            ? `--- Instructions from skill: ${context.skillName} ---`
            : '--- Instructions from prompt file ---';
        prompt = `${templateHeader}\n${context.promptFileContent}\n\n--- Document Context ---\n${prompt}`;
    }

    return prompt;
}

/**
 * Get the response label for a command (for adding AI comments)
 */
export function getResponseLabel(commandId: string): string {
    return baseGetResponseLabel(commandId);
}

/**
 * Get the comment type for a command (for styling)
 */
export function getCommentType(commandId: string): 'ai-clarification' | 'ai-critique' | 'ai-suggestion' | 'ai-question' {
    return baseGetCommentType(commandId);
}

/**
 * Validate and truncate prompt if necessary.
 * With the simplified prompt format, truncation is rarely needed.
 * 
 * @param context - The clarification context
 * @returns Object containing the prompt and whether truncation occurred
 */
export function validateAndTruncatePrompt(context: ClarificationContext): { prompt: string; truncated: boolean } {
    const prompt = buildClarificationPrompt(context);
    
    return validateAndTruncatePromptBase(
        prompt,
        context.selectedText,
        (truncatedText) => buildClarificationPrompt({ ...context, selectedText: truncatedText })
    );
}

/**
 * Handle an AI clarification request.
 * Routes to the configured AI tool (Copilot CLI or clipboard).
 * Falls back to clipboard if Copilot CLI fails.
 *
 * @param context - The clarification context from the webview
 * @param workspaceRoot - The workspace root directory (needed for copilot CLI)
 * @param processManager - Optional process manager for tracking running processes
 * @returns The clarification result if successful
 */
export async function handleAIClarification(
    context: ClarificationContext,
    workspaceRoot: string,
    processManager?: IAIProcessManager
): Promise<ClarificationResult> {
    const { prompt, truncated } = validateAndTruncatePrompt(context);
    return handleAIClarificationBase(prompt, truncated, workspaceRoot, processManager);
}
