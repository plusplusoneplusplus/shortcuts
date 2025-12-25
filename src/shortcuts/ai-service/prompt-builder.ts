/**
 * Prompt Builder
 *
 * Builds AI prompts using command templates and context variables.
 */

import { getAICommandRegistry } from './ai-command-registry';

/**
 * Context for building prompts
 */
export interface PromptContext {
    /** The selected text to process */
    selectedText: string;
    /** File path being reviewed */
    filePath: string;
    /** Surrounding content for context */
    surroundingContent?: string;
    /** Nearest heading above selection */
    nearestHeading?: string | null;
    /** All document headings */
    headings?: string[];
}

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

    // Apply template variable substitutions
    prompt = substituteVariables(prompt, context);

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

/**
 * Substitute template variables in a prompt
 */
function substituteVariables(template: string, context: PromptContext): string {
    let result = template;

    // {{selection}} - The selected text
    result = result.replace(/\{\{selection\}\}/g, context.selectedText);

    // {{file}} - The file path
    result = result.replace(/\{\{file\}\}/g, context.filePath);

    // {{heading}} - The nearest heading above selection
    result = result.replace(/\{\{heading\}\}/g, context.nearestHeading ?? '');

    // {{context}} - Surrounding content
    result = result.replace(/\{\{context\}\}/g, context.surroundingContent ?? '');

    // {{headings}} - All document headings (comma-separated)
    result = result.replace(/\{\{headings\}\}/g, context.headings?.join(', ') ?? '');

    return result;
}

/**
 * Check if a prompt template uses template variables
 */
export function usesTemplateVariables(template: string): boolean {
    return /\{\{(selection|file|heading|context|headings)\}\}/.test(template);
}

/**
 * Get available template variables
 */
export function getAvailableVariables(): { name: string; description: string }[] {
    return [
        { name: '{{selection}}', description: 'The selected text' },
        { name: '{{file}}', description: 'The file path being reviewed' },
        { name: '{{heading}}', description: 'The nearest heading above the selection' },
        { name: '{{context}}', description: 'Surrounding content for context' },
        { name: '{{headings}}', description: 'All document headings (comma-separated)' }
    ];
}
