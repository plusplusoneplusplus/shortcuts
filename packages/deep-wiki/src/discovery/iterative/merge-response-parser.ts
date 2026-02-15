/**
 * Iterative Discovery — Merge Response Parser
 *
 * Parses AI responses from merge sessions into MergeResult.
 * Handles JSON extraction, validation, and normalization.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ComponentGraph, ThemeSeed } from '../../types';
import type { MergeResult } from './types';
import { parseComponentGraphResponse } from '../response-parser';
import { normalizeComponentId } from '../../schemas';
import { parseAIJsonResponse } from '../../utils/parse-ai-response';
import { getErrorMessage } from '../../utils/error-utils';

// ============================================================================
// Merge Response Parsing
// ============================================================================

/**
 * Parse an AI response into a MergeResult.
 *
 * @param response - Raw AI response string
 * @returns Parsed MergeResult
 * @throws Error if response cannot be parsed
 */
export function parseMergeResponse(response: string): MergeResult {
    const obj = parseAIJsonResponse(response, { context: 'merge' });

    // Validate required fields
    if (typeof obj.graph !== 'object' || obj.graph === null) {
        throw new Error('Missing or invalid "graph" field in merge response');
    }

    // Parse graph using existing parser
    let graph: ComponentGraph;
    try {
        graph = parseComponentGraphResponse(JSON.stringify(obj.graph));
    } catch (parseError) {
        throw new Error(`Invalid graph in merge response: ${getErrorMessage(parseError)}`);
    }

    // Parse newThemes (optional, defaults to empty array)
    const newThemes: ThemeSeed[] = [];
    if (Array.isArray(obj.newThemes)) {
        for (const item of obj.newThemes) {
            if (typeof item !== 'object' || item === null) {
                continue;
            }
            const theme = item as Record<string, unknown>;
            if (typeof theme.theme === 'string' && typeof theme.description === 'string') {
                newThemes.push({
                    theme: normalizeComponentId(String(theme.theme)),
                    description: String(theme.description),
                    hints: parseStringArray(theme.hints),
                });
            }
        }
    }

    // Parse converged (required boolean)
    const converged = typeof obj.converged === 'boolean' ? obj.converged : false;

    // Parse coverage (default to 0 if not provided)
    let coverage = 0;
    if (typeof obj.coverage === 'number') {
        coverage = Math.max(0, Math.min(1, obj.coverage));
    }

    // Parse reason (default to empty string)
    const reason = typeof obj.reason === 'string' ? String(obj.reason) : '';

    return {
        graph,
        newThemes,
        converged,
        coverage,
        reason,
    };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Safely parse an unknown value as a string array.
 */
function parseStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .filter(item => typeof item === 'string')
        .map(item => String(item));
}
