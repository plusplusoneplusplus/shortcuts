/**
 * Template Engine
 *
 * Simple template substitution for pipeline prompts.
 * Replaces {{column}} placeholders with values from pipeline items.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { PipelineItem } from './types';

/**
 * Error thrown when a template variable is missing
 */
export class TemplateError extends Error {
    constructor(
        message: string,
        public readonly variableName?: string
    ) {
        super(message);
        this.name = 'TemplateError';
    }
}

/**
 * Regular expression to match {{variable}} placeholders
 */
const TEMPLATE_VARIABLE_REGEX = /\{\{(\w+)\}\}/g;

/**
 * Substitute template variables with values from a pipeline item
 * @param template Template string with {{variable}} placeholders
 * @param item Pipeline item containing values
 * @param strict If true, throws on missing variables; if false, leaves as empty string
 * @returns Substituted string
 */
export function substituteTemplate(
    template: string,
    item: PipelineItem,
    strict: boolean = false
): string {
    return template.replace(TEMPLATE_VARIABLE_REGEX, (match, variableName) => {
        if (variableName in item) {
            return item[variableName];
        }

        if (strict) {
            throw new TemplateError(
                `Missing variable "${variableName}" in template`,
                variableName
            );
        }

        // Non-strict: replace with empty string
        return '';
    });
}

/**
 * Extract all variable names from a template
 * @param template Template string
 * @returns Array of unique variable names
 */
export function extractVariables(template: string): string[] {
    const variables = new Set<string>();
    const matches = template.matchAll(TEMPLATE_VARIABLE_REGEX);

    for (const match of matches) {
        variables.add(match[1]);
    }

    return Array.from(variables);
}

/**
 * Validate that a pipeline item has all required template variables
 * @param template Template string
 * @param item Pipeline item to validate
 * @returns Object with validation result and missing variables
 */
export function validateItemForTemplate(
    template: string,
    item: PipelineItem
): { valid: boolean; missingVariables: string[] } {
    const requiredVariables = extractVariables(template);
    const missingVariables = requiredVariables.filter(v => !(v in item));

    return {
        valid: missingVariables.length === 0,
        missingVariables
    };
}

/**
 * Build the full prompt for AI by appending output field instructions
 * @param userPrompt User's prompt template (already substituted)
 * @param outputFields Field names expected in AI response
 * @returns Full prompt with JSON output instruction
 */
export function buildFullPrompt(userPrompt: string, outputFields: string[]): string {
    if (outputFields.length === 0) {
        return userPrompt;
    }

    const fieldsStr = outputFields.join(', ');
    return `${userPrompt}

Return JSON with these fields: ${fieldsStr}`;
}

/**
 * Build a complete prompt from template, item, and output fields
 * Combines template substitution and output instruction appending
 * @param template Prompt template with {{variable}} placeholders
 * @param item Pipeline item with values
 * @param outputFields Expected output field names
 * @param strict Strict mode for variable validation
 * @returns Complete prompt ready for AI
 */
export function buildPromptFromTemplate(
    template: string,
    item: PipelineItem,
    outputFields: string[],
    strict: boolean = false
): string {
    const substituted = substituteTemplate(template, item, strict);
    return buildFullPrompt(substituted, outputFields);
}

/**
 * Parse JSON response from AI, extracting only the declared fields
 * @param response AI response string
 * @param outputFields Expected field names
 * @returns Object with extracted fields (missing fields become null)
 */
export function parseAIResponse(
    response: string,
    outputFields: string[]
): Record<string, unknown> {
    // Try to extract JSON from the response
    const jsonStr = extractJSON(response);

    if (!jsonStr) {
        throw new TemplateError('No JSON found in AI response');
    }

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        throw new TemplateError(`Invalid JSON in AI response: ${jsonStr.substring(0, 100)}...`);
    }

    // Extract only declared fields
    const result: Record<string, unknown> = {};
    for (const field of outputFields) {
        result[field] = field in parsed ? parsed[field] : null;
    }

    return result;
}

/**
 * Extract JSON from a response string
 * Handles JSON in markdown code blocks or inline
 * @param response Response string
 * @returns Extracted JSON string or null
 */
export function extractJSON(response: string): string | null {
    // Try markdown code block first
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        return codeBlockMatch[1].trim();
    }

    // Try to find a JSON object
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        return objectMatch[0];
    }

    // Try to find a JSON array
    const arrayMatch = response.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        return arrayMatch[0];
    }

    return null;
}

/**
 * Escape special characters in a value for safe template use
 * @param value Value to escape
 * @returns Escaped value
 */
export function escapeTemplateValue(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}');
}

/**
 * Preview how a template will render with sample values
 * @param template Template string
 * @param item Sample item
 * @param maxLength Maximum output length
 * @returns Preview string
 */
export function previewTemplate(
    template: string,
    item: PipelineItem,
    maxLength: number = 200
): string {
    try {
        const result = substituteTemplate(template, item, false);
        if (result.length > maxLength) {
            return result.substring(0, maxLength) + '...';
        }
        return result;
    } catch {
        return `[Error rendering template]`;
    }
}
