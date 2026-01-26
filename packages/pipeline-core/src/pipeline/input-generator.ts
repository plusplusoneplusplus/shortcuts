/**
 * Input Generator
 *
 * AI-powered input generation for pipeline items.
 * Constructs prompts from user configuration and parses AI responses into items.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { GenerateInputConfig, PromptItem, AIInvoker } from './types';
import { extractJSON } from '../utils/ai-response-parser';

/**
 * Error thrown when input generation fails
 */
export class InputGenerationError extends Error {
    constructor(
        message: string,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = 'InputGenerationError';
    }
}

/**
 * Result of generating input items
 */
export interface GenerateInputResult {
    /** Whether generation was successful */
    success: boolean;
    /** Generated items (if successful) */
    items?: PromptItem[];
    /** Error message (if failed) */
    error?: string;
    /** Raw AI response for debugging */
    rawResponse?: string;
}

/**
 * A generated item with selection state for the review UI
 */
export interface GeneratedItem {
    /** The actual item data */
    data: PromptItem;
    /** Whether this item is selected for execution */
    selected: boolean;
}

/**
 * State for the preview webview when using generate
 */
export type GenerateState =
    | { status: 'initial' }
    | { status: 'generating' }
    | { status: 'review'; items: GeneratedItem[] }
    | { status: 'error'; message: string };

/**
 * Build the AI prompt for generating input items
 * 
 * @param config The generate configuration from the pipeline
 * @returns The constructed prompt to send to AI
 */
export function buildGeneratePrompt(config: GenerateInputConfig): string {
    const { prompt, schema } = config;
    
    // Build the field list
    const fieldsList = schema.join(', ');
    
    // Build example object
    const exampleObj: Record<string, string> = {};
    for (const field of schema) {
        exampleObj[field] = '...';
    }
    const exampleJson = JSON.stringify(exampleObj, null, 2);
    
    return `${prompt}

Return a JSON array where each object has these fields: ${fieldsList}

Example format:
[
  ${exampleJson},
  ...
]

IMPORTANT: Return ONLY the JSON array, no additional text or explanation.`;
}

/**
 * Parse the AI response into generated items
 * 
 * @param response The raw AI response
 * @param schema The expected field names
 * @returns Parsed items array
 * @throws InputGenerationError if parsing fails
 */
export function parseGenerateResponse(
    response: string,
    schema: string[]
): PromptItem[] {
    // Try to extract JSON from the response
    const jsonStr = extractJSON(response);
    
    if (!jsonStr) {
        throw new InputGenerationError(
            'AI response does not contain valid JSON. Expected a JSON array.',
            undefined
        );
    }
    
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonStr);
    } catch (e) {
        throw new InputGenerationError(
            `Failed to parse JSON from AI response: ${e instanceof Error ? e.message : String(e)}`,
            e instanceof Error ? e : undefined
        );
    }
    
    // Validate it's an array
    if (!Array.isArray(parsed)) {
        throw new InputGenerationError(
            `AI response is not an array. Got: ${typeof parsed}`
        );
    }
    
    // Validate and normalize each item
    const items: PromptItem[] = [];
    for (let i = 0; i < parsed.length; i++) {
        const rawItem = parsed[i];
        
        if (typeof rawItem !== 'object' || rawItem === null) {
            throw new InputGenerationError(
                `Item at index ${i} is not an object. Got: ${typeof rawItem}`
            );
        }
        
        // Create normalized item with all schema fields
        const item: PromptItem = {};
        for (const field of schema) {
            if (field in rawItem) {
                // Convert value to string for consistency
                const value = (rawItem as Record<string, unknown>)[field];
                item[field] = value === null || value === undefined 
                    ? '' 
                    : String(value);
            } else {
                // Missing field - set to empty string
                item[field] = '';
            }
        }
        
        items.push(item);
    }
    
    return items;
}

/**
 * Generate input items using AI
 * 
 * @param config The generate configuration
 * @param aiInvoker Function to invoke AI
 * @returns Generation result with items or error
 */
export async function generateInputItems(
    config: GenerateInputConfig,
    aiInvoker: AIInvoker
): Promise<GenerateInputResult> {
    // Build the prompt
    const prompt = buildGeneratePrompt(config);
    
    // Invoke AI with optional model from config
    const aiResult = await aiInvoker(prompt, config.model ? { model: config.model } : undefined);
    
    if (!aiResult.success) {
        return {
            success: false,
            error: aiResult.error || 'AI invocation failed',
            rawResponse: aiResult.response
        };
    }
    
    if (!aiResult.response) {
        return {
            success: false,
            error: 'AI returned empty response'
        };
    }
    
    // Parse the response
    try {
        const items = parseGenerateResponse(aiResult.response, config.schema);
        return {
            success: true,
            items,
            rawResponse: aiResult.response
        };
    } catch (e) {
        return {
            success: false,
            error: e instanceof InputGenerationError ? e.message : String(e),
            rawResponse: aiResult.response
        };
    }
}

/**
 * Convert generated items to GeneratedItem array with selection state
 * All items are selected by default
 * 
 * @param items The generated items
 * @returns Items wrapped with selection state
 */
export function toGeneratedItems(items: PromptItem[]): GeneratedItem[] {
    return items.map(data => ({
        data,
        selected: true
    }));
}

/**
 * Filter generated items to only those that are selected
 * 
 * @param items The generated items with selection state
 * @returns Only the selected item data
 */
export function getSelectedItems(items: GeneratedItem[]): PromptItem[] {
    return items.filter(item => item.selected).map(item => item.data);
}

/**
 * Create an empty item matching the schema
 * 
 * @param schema The field names
 * @returns Empty item with all fields set to empty string
 */
export function createEmptyItem(schema: string[]): PromptItem {
    const item: PromptItem = {};
    for (const field of schema) {
        item[field] = '';
    }
    return item;
}

/**
 * Validate that a generate config is well-formed
 * 
 * @param config The config to validate
 * @returns Validation result with errors if invalid
 */
export function validateGenerateConfig(
    config: GenerateInputConfig
): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!config.prompt || typeof config.prompt !== 'string') {
        errors.push('Generate config requires a "prompt" string');
    } else if (config.prompt.trim().length === 0) {
        errors.push('Generate config "prompt" cannot be empty');
    }
    
    if (!config.schema || !Array.isArray(config.schema)) {
        errors.push('Generate config requires a "schema" array');
    } else if (config.schema.length === 0) {
        errors.push('Generate config "schema" must have at least one field');
    } else {
        // Validate each schema field
        for (let i = 0; i < config.schema.length; i++) {
            const field = config.schema[i];
            if (typeof field !== 'string') {
                errors.push(`Schema field at index ${i} must be a string`);
            } else if (field.trim().length === 0) {
                errors.push(`Schema field at index ${i} cannot be empty`);
            } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
                errors.push(`Schema field "${field}" must be a valid identifier (letters, numbers, underscore, not starting with number)`);
            }
        }
        
        // Check for duplicates
        const seen = new Set<string>();
        for (const field of config.schema) {
            if (seen.has(field)) {
                errors.push(`Duplicate schema field: "${field}"`);
            }
            seen.add(field);
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}
