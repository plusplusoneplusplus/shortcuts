/**
 * Shared AI Response Parsing Utility
 *
 * Consolidates the repeated JSON extraction + validation pattern
 * used across multiple response parsers in deep-wiki.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { extractJSON } from '@plusplusoneplusplus/pipeline-core';

export interface ParseOptions {
    /** Context string for error messages (e.g., 'discovery', 'probe') */
    context: string;
    /** Whether to attempt JSON repair on parse failure. Default: false */
    repair?: boolean;
}

/**
 * Validates an AI response string, extracts JSON, parses it, and validates it's an object.
 * Throws descriptive errors at each step.
 */
export function parseAIJsonResponse(response: string | undefined | null, options: ParseOptions): Record<string, unknown> {
    const { context, repair = false } = options;

    if (!response || typeof response !== 'string') {
        throw new Error(`Empty or invalid response from AI (${context})`);
    }

    const jsonStr = extractJSON(response);
    if (!jsonStr) {
        throw new Error(`No JSON found in AI response (${context}). The AI may not have returned structured output.`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonStr);
    } catch (parseError) {
        if (repair) {
            const fixed = attemptJsonRepair(jsonStr);
            if (fixed) {
                try {
                    parsed = JSON.parse(fixed);
                } catch {
                    throw new Error(`Invalid JSON in ${context} response: ${(parseError as Error).message}`);
                }
            } else {
                throw new Error(`Invalid JSON in ${context} response: ${(parseError as Error).message}`);
            }
        } else {
            throw new Error(`Invalid JSON in ${context} response: ${(parseError as Error).message}`);
        }
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`${context} response is not a JSON object`);
    }

    return parsed as Record<string, unknown>;
}

/**
 * Attempt to repair common JSON formatting issues.
 */
export function attemptJsonRepair(jsonStr: string): string | null {
    try {
        let fixed = jsonStr;
        // Replace single quotes with double quotes
        fixed = fixed.replace(/'/g, '"');
        // Quote unquoted keys
        fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
        // Remove trailing commas
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
        // Fix missing commas between properties
        fixed = fixed.replace(/"\s*\n\s*"/g, '",\n"');
        JSON.parse(fixed);
        return fixed;
    } catch {
        return null;
    }
}
