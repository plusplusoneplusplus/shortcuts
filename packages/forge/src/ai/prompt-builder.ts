/**
 * Prompt Builder (Pure Implementation)
 *
 * Pure template variable substitution for AI prompts.
 * No VS Code dependencies - can be used in CLI tools and other environments.
 */

import { substituteVariables } from '../utils/template-engine';

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
 * Prompt-specific variable names used in AI prompts.
 * These map to PromptContext fields.
 */
const PROMPT_VARIABLE_NAMES = ['selection', 'file', 'heading', 'context', 'headings'] as const;

/**
 * Substitute template variables in a prompt
 *
 * Template variables supported:
 * - {{selection}} - The selected text
 * - {{file}} - The file path
 * - {{heading}} - The nearest heading above selection
 * - {{context}} - Surrounding content
 * - {{headings}} - All document headings (comma-separated)
 *
 * @param template - The prompt template with variables
 * @param context - The context for variable substitution
 * @returns The prompt with variables substituted
 */
export function substitutePromptVariables(template: string, context: PromptContext): string {
    // Build variables object from context
    const variables: Record<string, string> = {
        selection: context.selectedText,
        file: context.filePath,
        heading: context.nearestHeading ?? '',
        context: context.surroundingContent ?? '',
        headings: context.headings?.join(', ') ?? ''
    };

    return substituteVariables(template, variables, {
        strict: false,
        missingValueBehavior: 'empty',
        preserveSpecialVariables: false
    });
}

/**
 * Build a prompt from a template and context
 *
 * If the prompt contains template variables, they are substituted.
 * Otherwise, a simple format is used: "{prompt} "{selection}" in the file {file}"
 *
 * @param promptTemplate - The prompt template
 * @param context - The context for variable substitution
 * @param isCustomInstruction - Whether this is a custom instruction (affects simple format)
 * @returns The built prompt string
 */
export function buildPromptFromContext(
    promptTemplate: string,
    context: PromptContext,
    isCustomInstruction: boolean = false
): string {
    // Apply template variable substitutions
    let prompt = substitutePromptVariables(promptTemplate, context);

    // Append the selected text and file path if not using template variables
    // This maintains backward compatibility with simple prompts
    if (!prompt.includes('{{')) {
        // Simple prompt format: "{prompt} "{selection}" in the file {file}"
        if (isCustomInstruction) {
            return `${prompt}: "${context.selectedText}" in the file ${context.filePath}`;
        }
        return `${prompt} "${context.selectedText}" in the file ${context.filePath}`;
    }

    return prompt;
}

/**
 * Check if a prompt template uses template variables
 */
export function usesTemplateVariables(template: string): boolean {
    const pattern = new RegExp(`\\{\\{(${PROMPT_VARIABLE_NAMES.join('|')})\\}\\}`);
    return pattern.test(template);
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
