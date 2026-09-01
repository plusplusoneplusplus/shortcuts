/**
 * Template variable substitution for AI prompts.
 */

import { substituteVariables } from '../utils/template-engine';

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
 * Template variables supported:
 * - {{selection}} - The selected text
 * - {{file}} - The file path
 * - {{heading}} - The nearest heading above selection
 * - {{context}} - Surrounding content
 * - {{headings}} - All document headings (comma-separated)
 *
 * Unknown placeholders are substituted away too (missing values become empty).
 */
export function substitutePromptVariables(template: string, context: PromptContext): string {
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
 * Substitutes template variables, then — when no `{{` placeholder is left in the
 * result — appends `"{selection}" in the file {file}`.
 *
 * @param isCustomInstruction - inserts a `:` before the appended selection
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

export function usesTemplateVariables(template: string): boolean {
    const pattern = new RegExp(`\\{\\{(${PROMPT_VARIABLE_NAMES.join('|')})\\}\\}`);
    return pattern.test(template);
}

export function getAvailableVariables(): { name: string; description: string }[] {
    return [
        { name: '{{selection}}', description: 'The selected text' },
        { name: '{{file}}', description: 'The file path being reviewed' },
        { name: '{{heading}}', description: 'The nearest heading above the selection' },
        { name: '{{context}}', description: 'Surrounding content for context' },
        { name: '{{headings}}', description: 'All document headings (comma-separated)' }
    ];
}
