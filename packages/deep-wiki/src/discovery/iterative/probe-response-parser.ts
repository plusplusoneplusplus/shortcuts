/**
 * Iterative Discovery — Probe Response Parser
 *
 * Parses AI responses from topic probe sessions into TopicProbeResult.
 * Handles JSON extraction, validation, and normalization.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { TopicProbeResult, ProbeFoundModule, DiscoveredTopic } from '../../types';
import { normalizeModuleId } from '../../schemas';
import { parseAIJsonResponse } from '../../utils/parse-ai-response';

// ============================================================================
// Probe Response Parsing
// ============================================================================

/**
 * Parse an AI response into a TopicProbeResult.
 *
 * @param response - Raw AI response string
 * @param topic - The topic that was probed (for validation)
 * @returns Parsed TopicProbeResult
 * @throws Error if response cannot be parsed
 */
export function parseProbeResponse(response: string, topic: string): TopicProbeResult {
    const obj = parseAIJsonResponse(response, { context: 'probe' });

    // Validate required fields
    if (typeof obj.topic !== 'string') {
        throw new Error('Missing or invalid "topic" field in probe response');
    }

    if (!Array.isArray(obj.foundModules)) {
        throw new Error('Missing or invalid "foundModules" field in probe response');
    }

    // Parse foundModules
    const foundModules: ProbeFoundModule[] = [];
    for (let i = 0; i < obj.foundModules.length; i++) {
        const item = obj.foundModules[i];
        if (typeof item !== 'object' || item === null) {
            continue; // Skip invalid items
        }

        const mod = item as Record<string, unknown>;

        // Required fields
        if (typeof mod.id !== 'string' || typeof mod.name !== 'string' || typeof mod.path !== 'string') {
            continue; // Skip modules missing required fields
        }

        // Normalize module ID
        const id = normalizeModuleId(String(mod.id));

        // Parse lineRanges if present
        let lineRanges: [number, number][] | undefined;
        if (Array.isArray(mod.lineRanges)) {
            const ranges: [number, number][] = [];
            for (const range of mod.lineRanges) {
                if (Array.isArray(range) && range.length === 2 &&
                    typeof range[0] === 'number' && typeof range[1] === 'number') {
                    ranges.push([range[0], range[1]]);
                }
            }
            if (ranges.length > 0) {
                lineRanges = ranges;
            }
        }

        foundModules.push({
            id,
            name: String(mod.name),
            path: String(mod.path),
            purpose: String(mod.purpose || ''),
            keyFiles: parseStringArray(mod.keyFiles),
            evidence: String(mod.evidence || ''),
            lineRanges,
        });
    }

    // Parse discoveredTopics (optional)
    const discoveredTopics: DiscoveredTopic[] = [];
    if (Array.isArray(obj.discoveredTopics)) {
        for (const item of obj.discoveredTopics) {
            if (typeof item !== 'object' || item === null) {
                continue;
            }
            const dt = item as Record<string, unknown>;
            if (typeof dt.topic === 'string' && typeof dt.description === 'string') {
                discoveredTopics.push({
                    topic: normalizeModuleId(String(dt.topic)),
                    description: String(dt.description),
                    hints: parseStringArray(dt.hints),
                    source: String(dt.source || ''),
                });
            }
        }
    }

    // Parse dependencies (optional)
    const dependencies: string[] = parseStringArray(obj.dependencies);

    // Parse confidence (default to 0.5 if not provided)
    let confidence = 0.5;
    if (typeof obj.confidence === 'number') {
        confidence = Math.max(0, Math.min(1, obj.confidence));
    }

    return {
        topic: String(obj.topic),
        foundModules,
        discoveredTopics,
        dependencies,
        confidence,
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
