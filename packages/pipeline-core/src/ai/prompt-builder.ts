/**
 * Prompt Builder (Pure Implementation)
 *
 * Pure template variable substitution for AI prompts.
 * No VS Code dependencies - can be used in CLI tools and other environments.
 */

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
