/**
 * Prompt Template
 *
 * Lightweight template system for building prompts from templates with variable substitution.
 * Supports required variables validation and optional response parsing.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { PromptRenderOptions, PromptTemplate } from './types';
import {
    TEMPLATE_VARIABLE_REGEX,
    substituteVariables,
    extractVariables as extractTemplateVariables
} from '../utils/template-engine';
import { PipelineCoreError, ErrorCode } from '../errors';

// Re-export PromptTemplate for convenience
export type { PromptTemplate } from './types';

/**
 * Error thrown when a required variable is missing
 */
export class MissingVariableError extends PipelineCoreError {
    /** Name of the missing variable */
    readonly variableName: string;
    /** Name of the template (if available) */
    readonly templateName?: string;

    constructor(
        variableName: string,
        templateName?: string
    ) {
        const context = templateName ? ` in template "${templateName}"` : '';
        super(`Missing required variable "${variableName}"${context}`, {
            code: ErrorCode.MISSING_VARIABLE,
            meta: {
                variableName,
                ...(templateName && { templateName }),
            },
        });
        this.name = 'MissingVariableError';
        this.variableName = variableName;
        this.templateName = templateName;
    }
}

/**
 * Error thrown when template rendering fails
 */
export class TemplateRenderError extends PipelineCoreError {
    constructor(
        message: string,
        cause?: Error
    ) {
        super(message, {
            code: ErrorCode.TEMPLATE_ERROR,
            cause,
        });
        this.name = 'TemplateRenderError';
    }
}

/**
 * Render a prompt template with the given variables
 * @param template The prompt template to render
 * @param options Render options including variables
 * @returns The rendered prompt string
 * @throws MissingVariableError if a required variable is missing
 * @throws TemplateRenderError if rendering fails
 */
export function renderTemplate(
    template: PromptTemplate,
    options: PromptRenderOptions
): string {
    const { variables, includeSystemPrompt = false } = options;

    // Validate required variables
    for (const required of template.requiredVariables) {
        if (!(required in variables) || variables[required] === undefined || variables[required] === null) {
            throw new MissingVariableError(required);
        }
    }

    try {
        // Perform variable substitution using shared engine
        // Use 'preserve' mode for missing variables (they may be optional)
        let rendered = substituteVariables(template.template, variables, {
            strict: false,
            missingValueBehavior: 'preserve',
            preserveSpecialVariables: false // Don't treat any as special in this context
        });

        // Prepend system prompt if requested
        if (includeSystemPrompt && template.systemPrompt) {
            rendered = `${template.systemPrompt}\n\n${rendered}`;
        }

        return rendered;
    } catch (error) {
        throw new TemplateRenderError(
            'Failed to render template',
            error instanceof Error ? error : undefined
        );
    }
}

/**
 * Create a new prompt template
 * @param config Template configuration
 * @returns PromptTemplate instance
 */
export function createTemplate(config: {
    template: string;
    requiredVariables?: string[];
    systemPrompt?: string;
    responseParser?: (response: string) => unknown;
}): PromptTemplate {
    // Auto-detect required variables from template if not provided
    const requiredVariables = config.requiredVariables ?? extractVariables(config.template);

    return {
        template: config.template,
        requiredVariables,
        systemPrompt: config.systemPrompt,
        responseParser: config.responseParser
    };
}

/**
 * Extract variable names from a template string
 * @param template The template string
 * @returns Array of variable names found in the template
 */
export function extractVariables(template: string): string[] {
    // Use shared implementation but don't exclude any variables
    return extractTemplateVariables(template, false);
}

/**
 * Validate that a template has all required variables defined
 * @param template The template to validate
 * @returns Object with valid flag and any missing variables
 */
export function validateTemplate(template: PromptTemplate): {
    valid: boolean;
    missingInTemplate: string[];
    undeclaredVariables: string[];
} {
    const templateVariables = extractVariables(template.template);
    const requiredSet = new Set(template.requiredVariables);
    const templateSet = new Set(templateVariables);

    // Find required variables not in template
    const missingInTemplate = template.requiredVariables.filter(v => !templateSet.has(v));

    // Find template variables not declared as required
    const undeclaredVariables = templateVariables.filter(v => !requiredSet.has(v));

    return {
        valid: missingInTemplate.length === 0,
        missingInTemplate,
        undeclaredVariables
    };
}

/**
 * Compose multiple templates into one
 * @param templates Array of templates to compose
 * @param separator Separator between templates (default: '\n\n')
 * @returns Combined template
 */
export function composeTemplates(
    templates: PromptTemplate[],
    separator: string = '\n\n'
): PromptTemplate {
    const combinedTemplate = templates.map(t => t.template).join(separator);
    const combinedRequired = Array.from(
        new Set(templates.flatMap(t => t.requiredVariables))
    );

    // Use first template's system prompt if available
    const systemPrompt = templates.find(t => t.systemPrompt)?.systemPrompt;

    return {
        template: combinedTemplate,
        requiredVariables: combinedRequired,
        systemPrompt
    };
}

/**
 * Built-in template helpers
 */
export const TemplateHelpers = {
    /**
     * Escape special characters in a string for use in templates
     */
    escape(str: string): string {
        return str
            .replace(/\\/g, '\\\\')
            .replace(/\{/g, '\\{')
            .replace(/\}/g, '\\}');
    },

    /**
     * Truncate a string to a maximum length
     */
    truncate(str: string, maxLength: number, suffix: string = '...'): string {
        if (str.length <= maxLength) {
            return str;
        }
        return str.slice(0, maxLength - suffix.length) + suffix;
    },

    /**
     * Indent all lines in a string
     */
    indent(str: string, spaces: number = 2): string {
        const indent = ' '.repeat(spaces);
        return str.split('\n').map(line => indent + line).join('\n');
    },

    /**
     * Convert an object to a formatted string for use in prompts
     */
    formatObject(obj: Record<string, unknown>, indent: number = 0): string {
        const indentStr = ' '.repeat(indent);
        const lines: string[] = [];

        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                lines.push(`${indentStr}${key}:`);
                lines.push(this.formatObject(value as Record<string, unknown>, indent + 2));
            } else if (Array.isArray(value)) {
                lines.push(`${indentStr}${key}:`);
                for (const item of value) {
                    lines.push(`${indentStr}  - ${String(item)}`);
                }
            } else {
                lines.push(`${indentStr}${key}: ${String(value)}`);
            }
        }

        return lines.join('\n');
    }
};

/**
 * Common response parsers
 */
export const ResponseParsers = {
    /**
     * Parse JSON from a response
     */
    json<T>(response: string): T {
        // Try to extract JSON from markdown code blocks first
        const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[1].trim());
        }

        // Try to find JSON object or array
        const objectMatch = response.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            return JSON.parse(objectMatch[0]);
        }

        const arrayMatch = response.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            return JSON.parse(arrayMatch[0]);
        }

        throw new Error('No JSON found in response');
    },

    /**
     * Parse a list from a response (one item per line or bullet points)
     */
    list(response: string): string[] {
        const lines = response.split('\n');
        const items: string[] = [];

        for (const line of lines) {
            // Remove bullet points, numbers, and leading whitespace
            const cleaned = line.replace(/^\s*[-*•]\s*/, '')
                .replace(/^\s*\d+[.)]\s*/, '')
                .trim();

            if (cleaned) {
                items.push(cleaned);
            }
        }

        return items;
    },

    /**
     * Parse key-value pairs from a response
     */
    keyValue(response: string): Record<string, string> {
        const result: Record<string, string> = {};
        const lines = response.split('\n');

        for (const line of lines) {
            const match = line.match(/^\s*([^:]+):\s*(.+)\s*$/);
            if (match) {
                result[match[1].trim()] = match[2].trim();
            }
        }

        return result;
    }
};
