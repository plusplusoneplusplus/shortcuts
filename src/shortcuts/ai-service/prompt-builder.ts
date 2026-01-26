/**
 * Prompt Builder (VS Code Integration)
 *
 * Builds AI prompts using command templates and context variables.
 * Uses the VS Code-specific AICommandRegistry for command lookup.
 * 
 * Pure template substitution functions are provided by pipeline-core.
 */

import { getAICommandRegistry } from './ai-command-registry';
import {
    PromptContext,
    substitutePromptVariables,
    usesTemplateVariables as pureUsesTemplateVariables,
    getAvailableVariables as pureGetAvailableVariables
} from '@plusplusoneplusplus/pipeline-core';

// Re-export pure functions and types from pipeline-core
export { PromptContext } from '@plusplusoneplusplus/pipeline-core';
export { usesTemplateVariables, getAvailableVariables } from '@plusplusoneplusplus/pipeline-core';

/**
 * Build a prompt from a command and context
 *
 * Template variables supported:
 * - {{selection}} - The selected text
 * - {{file}} - The file path
 * - {{heading}} - The nearest heading above selection
 * - {{context}} - Surrounding content
 * - {{headings}} - All document headings (comma-separated)
 *
 * @param commandId - The command ID to use
 * @param context - The context for variable substitution
 * @param customInstruction - Optional custom instruction (for custom input commands)
 * @returns The built prompt string
 */
export function buildPrompt(
    commandId: string,
    context: PromptContext,
    customInstruction?: string
): string {
    const registry = getAICommandRegistry();
    let prompt = registry.getPromptForCommand(commandId, customInstruction);

    // Apply template variable substitutions using pipeline-core function
    prompt = substitutePromptVariables(prompt, context);

    // Append the selected text and file path if not using template variables
    // This maintains backward compatibility with simple prompts
    if (!prompt.includes('{{')) {
        // Simple prompt format: "{prompt} "{selection}" in the file {file}"
        if (customInstruction) {
            return `${prompt}: "${context.selectedText}" in the file ${context.filePath}`;
        }
        return `${prompt} "${context.selectedText}" in the file ${context.filePath}`;
    }

    return prompt;
}
