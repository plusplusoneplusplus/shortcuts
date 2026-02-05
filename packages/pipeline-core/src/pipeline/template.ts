/**
 * Template Engine
 *
 * Simple template substitution for pipeline prompts.
 * Replaces {{column}} placeholders with values from pipeline items.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { PromptItem } from './types';
import { 
    extractJSON as sharedExtractJSON, 
    parseAIResponse as sharedParseAIResponse 
} from '../utils/ai-response-parser';
import {
    TEMPLATE_VARIABLE_REGEX,
    SPECIAL_VARIABLES,
    TemplateVariableError,
    extractVariables as extractTemplateVariables,
    validateVariables
} from '../utils/template-engine';
import { PipelineCoreError, ErrorCode } from '../errors';

/**
 * Error thrown when a template variable is missing
 */
export class TemplateError extends PipelineCoreError {
    /** Name of the variable that caused the error */
    readonly variableName?: string;

    constructor(
        message: string,
        variableName?: string
    ) {
        super(message, {
            code: ErrorCode.TEMPLATE_ERROR,
            meta: variableName ? { variableName } : undefined,
        });
        this.name = 'TemplateError';
        this.variableName = variableName;
    }
}

/**
 * Options for template substitution
 */
export interface SubstituteTemplateOptions {
    /** If true, throws on missing variables; if false, leaves as empty string */
    strict?: boolean;
    /** All items in the input (for {{ITEMS}} template variable) */
    allItems?: PromptItem[];
}

/**
 * Substitute template variables with values from a pipeline item
 * 
 * Supports special variable {{ITEMS}} which is replaced with JSON array of all items.
 * This allows prompts to reference the full context of all items being processed.
 * 
 * @param template Template string with {{variable}} placeholders
 * @param item Pipeline item containing values
 * @param strictOrOptions If boolean, strict mode; if object, full options
 * @returns Substituted string
 */
export function substituteTemplate(
    template: string,
    item: PromptItem,
    strictOrOptions: boolean | SubstituteTemplateOptions = false
): string {
    // Handle backward compatibility: boolean for strict mode
    const options: SubstituteTemplateOptions = typeof strictOrOptions === 'boolean'
        ? { strict: strictOrOptions }
        : strictOrOptions;
    
    const { strict = false, allItems } = options;
    
    // Create a fresh regex instance to avoid issues with global flag and lastIndex
    const regex = new RegExp(TEMPLATE_VARIABLE_REGEX.source, 'g');
    
    return template.replace(regex, (match, variableName) => {
        // Handle special {{ITEMS}} variable - returns JSON array of all items
        if (variableName === 'ITEMS' && allItems) {
            return JSON.stringify(allItems, null, 2);
        }
        
        // Handle special system variables that are not in item (don't error in strict mode)
        if (SPECIAL_VARIABLES.has(variableName)) {
            // In non-strict mode, return placeholder; in strict mode, also return placeholder
            // since these are system-provided at runtime
            return match;
        }
        
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
 * @param excludeSpecial If true, excludes special system variables (ITEMS, RESULTS, etc.)
 * @returns Array of unique variable names
 */
export function extractVariables(template: string, excludeSpecial: boolean = true): string[] {
    return extractTemplateVariables(template, excludeSpecial);
}

/**
 * Validate that a pipeline item has all required template variables
 * @param template Template string
 * @param item Pipeline item to validate
 * @returns Object with validation result and missing variables
 */
export function validateItemForTemplate(
    template: string,
    item: PromptItem
): { valid: boolean; missingVariables: string[] } {
    return validateVariables(template, item);
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
    item: PromptItem,
    outputFields: string[],
    strict: boolean = false
): string {
    const substituted = substituteTemplate(template, item, strict);
    return buildFullPrompt(substituted, outputFields);
}

/**
 * Parse JSON response from AI, extracting only the declared fields
 * Wrapper that adds TemplateError for backward compatibility
 * @param response AI response string
 * @param outputFields Expected field names
 * @returns Object with extracted fields (missing fields become null)
 */
export function parseAIResponse(
    response: string,
    outputFields: string[]
): Record<string, unknown> {
    try {
        return sharedParseAIResponse(response, outputFields);
    } catch (error) {
        throw new TemplateError(error instanceof Error ? error.message : String(error));
    }
}

/**
 * Extract JSON from a response string
 * Re-exported from shared utilities
 * @param response Response string
 * @returns Extracted JSON string or null
 */
export function extractJSON(response: string): string | null {
    return sharedExtractJSON(response);
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
 * @param allItems Optional array of all items (for {{ITEMS}} variable preview)
 * @returns Preview string
 */
export function previewTemplate(
    template: string,
    item: PromptItem,
    maxLength: number = 200,
    allItems?: PromptItem[]
): string {
    try {
        const result = substituteTemplate(template, item, { strict: false, allItems });
        if (result.length > maxLength) {
            return result.substring(0, maxLength) + '...';
        }
        return result;
    } catch {
        return `[Error rendering template]`;
    }
}
