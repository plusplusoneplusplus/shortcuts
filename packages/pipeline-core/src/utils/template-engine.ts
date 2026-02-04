/**
 * Template Engine
 *
 * Shared template variable substitution logic for prompts across the codebase.
 * Provides a centralized implementation of {{variable}} placeholder replacement.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/**
 * Regular expression to match {{variable}} placeholders.
 * Shared across all template substitution implementations.
 */
export const TEMPLATE_VARIABLE_REGEX = /\{\{(\w+)\}\}/g;

/**
 * Special template variables that are automatically provided by the system
 * and should not be validated against item fields.
 *
 * - ITEMS: JSON array of all input items (available in map phase)
 * - RESULTS: JSON array of map results (available in reduce phase)
 * - RESULTS_FILE: Path to temp file with results (available in reduce phase)
 * - COUNT: Total count of items/results
 * - SUCCESS_COUNT: Count of successful items
 * - FAILURE_COUNT: Count of failed items
 */
export const SPECIAL_VARIABLES = new Set([
    'ITEMS',
    'RESULTS',
    'RESULTS_FILE',
    'COUNT',
    'SUCCESS_COUNT',
    'FAILURE_COUNT'
]);

/**
 * Options for template variable substitution
 */
export interface SubstituteVariablesOptions {
    /**
     * If true, throws on missing variables; if false, behavior depends on missingValueBehavior.
     * @default false
     */
    strict?: boolean;

    /**
     * Behavior when a variable is missing and strict mode is false.
     * - 'empty': Replace with empty string (default, backward compatible)
     * - 'preserve': Leave the {{variable}} placeholder as-is
     */
    missingValueBehavior?: 'empty' | 'preserve';

    /**
     * If true, special system variables (ITEMS, RESULTS, etc.) are always preserved
     * even in strict mode.
     * @default true
     */
    preserveSpecialVariables?: boolean;
}

/**
 * Error thrown when a template variable is missing in strict mode
 */
export class TemplateVariableError extends Error {
    constructor(
        message: string,
        public readonly variableName?: string
    ) {
        super(message);
        this.name = 'TemplateVariableError';
    }
}

/**
 * Substitute template variables in a string with values from a variables object.
 *
 * @param template Template string with {{variable}} placeholders
 * @param variables Object containing variable values (key-value pairs)
 * @param options Substitution options
 * @returns String with variables substituted
 * @throws TemplateVariableError if strict mode is enabled and a variable is missing
 *
 * @example
 * ```typescript
 * // Basic usage
 * substituteVariables('Hello {{name}}!', { name: 'World' });
 * // Returns: 'Hello World!'
 *
 * // Strict mode
 * substituteVariables('Hello {{name}}!', {}, { strict: true });
 * // Throws: TemplateVariableError
 *
 * // Preserve missing variables
 * substituteVariables('Hello {{name}}!', {}, { missingValueBehavior: 'preserve' });
 * // Returns: 'Hello {{name}}!'
 * ```
 */
export function substituteVariables(
    template: string,
    variables: Record<string, unknown>,
    options: SubstituteVariablesOptions = {}
): string {
    const {
        strict = false,
        missingValueBehavior = 'empty',
        preserveSpecialVariables = true
    } = options;

    // Need to reset lastIndex since we're using a global regex
    const regex = new RegExp(TEMPLATE_VARIABLE_REGEX.source, 'g');

    return template.replace(regex, (match, variableName: string) => {
        // Handle special system variables - always preserve them
        if (preserveSpecialVariables && SPECIAL_VARIABLES.has(variableName)) {
            return match;
        }

        // Check if variable exists
        if (variableName in variables) {
            const value = variables[variableName];
            // Handle null/undefined explicitly
            if (value === null || value === undefined) {
                return '';
            }
            // Handle objects by JSON stringifying them
            if (typeof value === 'object') {
                return JSON.stringify(value);
            }
            return String(value);
        }

        // Variable not found
        if (strict) {
            throw new TemplateVariableError(
                `Missing variable "${variableName}" in template`,
                variableName
            );
        }

        // Non-strict: behavior depends on option
        if (missingValueBehavior === 'preserve') {
            return match;
        }
        return ''; // 'empty' is the default
    });
}

/**
 * Extract all variable names from a template string.
 *
 * @param template Template string to analyze
 * @param excludeSpecial If true, excludes special system variables (ITEMS, RESULTS, etc.)
 * @returns Array of unique variable names found in the template
 *
 * @example
 * ```typescript
 * extractVariables('Hello {{name}}, you have {{count}} messages');
 * // Returns: ['name', 'count']
 *
 * extractVariables('Items: {{ITEMS}}, Name: {{name}}', true);
 * // Returns: ['name'] (ITEMS is excluded)
 *
 * extractVariables('Items: {{ITEMS}}, Name: {{name}}', false);
 * // Returns: ['ITEMS', 'name']
 * ```
 */
export function extractVariables(template: string, excludeSpecial: boolean = true): string[] {
    const variables = new Set<string>();
    const regex = new RegExp(TEMPLATE_VARIABLE_REGEX.source, 'g');
    const matches = template.matchAll(regex);

    for (const match of matches) {
        const varName = match[1];
        // Optionally exclude special system-provided variables
        if (!excludeSpecial || !SPECIAL_VARIABLES.has(varName)) {
            variables.add(varName);
        }
    }

    return Array.from(variables);
}

/**
 * Check if a template contains any variables.
 *
 * @param template Template string to check
 * @returns True if the template contains at least one {{variable}} placeholder
 */
export function hasVariables(template: string): boolean {
    return TEMPLATE_VARIABLE_REGEX.test(template);
}

/**
 * Check if a template contains any of the specified variables.
 *
 * @param template Template string to check
 * @param variableNames Variable names to look for
 * @returns True if the template contains any of the specified variables
 */
export function containsVariables(template: string, variableNames: string[]): boolean {
    const found = extractVariables(template, false);
    return variableNames.some(name => found.includes(name));
}

/**
 * Validate that all required variables are present in a variables object.
 *
 * @param template Template string
 * @param variables Variables object to validate
 * @returns Object with validation result and missing variables
 */
export function validateVariables(
    template: string,
    variables: Record<string, unknown>
): { valid: boolean; missingVariables: string[] } {
    const requiredVariables = extractVariables(template, true); // Exclude special vars
    const missingVariables = requiredVariables.filter(v => !(v in variables));

    return {
        valid: missingVariables.length === 0,
        missingVariables
    };
}
