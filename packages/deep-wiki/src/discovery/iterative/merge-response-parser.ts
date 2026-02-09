/**
 * Iterative Discovery — Merge Response Parser
 *
 * Parses AI responses from merge sessions into MergeResult.
 * Handles JSON extraction, validation, and normalization.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { extractJSON } from '@plusplusoneplusplus/pipeline-core';
import type { MergeResult, ModuleGraph, TopicSeed } from '../../types';
import { parseModuleGraphResponse } from '../response-parser';
import { normalizeModuleId } from '../../schemas';

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
    if (!response || typeof response !== 'string') {
        throw new Error('Empty or invalid response from AI');
    }

    // Extract JSON from response
    const jsonStr = extractJSON(response);
    if (!jsonStr) {
        throw new Error('No JSON found in AI response');
    }

    // Parse JSON
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonStr);
    } catch (parseError) {
        throw new Error(`Invalid JSON in merge response: ${(parseError as Error).message}`);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Merge response is not a JSON object');
    }

    const obj = parsed as Record<string, unknown>;

    // Validate required fields
    if (typeof obj.graph !== 'object' || obj.graph === null) {
        throw new Error('Missing or invalid "graph" field in merge response');
    }

    // Parse graph using existing parser
    let graph: ModuleGraph;
    try {
        graph = parseModuleGraphResponse(JSON.stringify(obj.graph));
    } catch (parseError) {
        throw new Error(`Invalid graph in merge response: ${(parseError as Error).message}`);
    }

    // Parse newTopics (optional, defaults to empty array)
    const newTopics: TopicSeed[] = [];
    if (Array.isArray(obj.newTopics)) {
        for (const item of obj.newTopics) {
            if (typeof item !== 'object' || item === null) {
                continue;
            }
            const topic = item as Record<string, unknown>;
            if (typeof topic.topic === 'string' && typeof topic.description === 'string') {
                newTopics.push({
                    topic: normalizeModuleId(String(topic.topic)),
                    description: String(topic.description),
                    hints: parseStringArray(topic.hints),
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
        newTopics,
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
