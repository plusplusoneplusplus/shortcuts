/**
 * Iterative Discovery — Probe Response Parser
 *
 * Parses AI responses from theme probe sessions into ThemeProbeResult.
 * Handles JSON extraction, validation, and normalization.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ThemeProbeResult, ProbeFoundComponent, DiscoveredTheme } from './types';
import { normalizeComponentId } from '../../schemas';
import { parseAIJsonResponse } from '../../utils/parse-ai-response';

// ============================================================================
// Probe Response Parsing
// ============================================================================

/**
 * Parse an AI response into a ThemeProbeResult.
 *
 * @param response - Raw AI response string
 * @param theme - The theme that was probed (for validation)
 * @returns Parsed ThemeProbeResult
 * @throws Error if response cannot be parsed
 */
export function parseProbeResponse(response: string, theme: string): ThemeProbeResult {
    const obj = parseAIJsonResponse(response, { context: 'probe' });

    // Validate required fields
    if (typeof obj.theme !== 'string') {
        throw new Error('Missing or invalid "theme" field in probe response');
    }

    if (!Array.isArray(obj.foundComponents)) {
        throw new Error('Missing or invalid "foundComponents" field in probe response');
    }

    // Parse foundComponents
    const foundComponents: ProbeFoundComponent[] = [];
    for (let i = 0; i < obj.foundComponents.length; i++) {
        const item = obj.foundComponents[i];
        if (typeof item !== 'object' || item === null) {
            continue; // Skip invalid items
        }

        const mod = item as Record<string, unknown>;

        // Required fields
        if (typeof mod.id !== 'string' || typeof mod.name !== 'string' || typeof mod.path !== 'string') {
            continue; // Skip components missing required fields
        }

        // Normalize component ID
        const id = normalizeComponentId(String(mod.id));

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

        foundComponents.push({
            id,
            name: String(mod.name),
            path: String(mod.path),
            purpose: String(mod.purpose || ''),
            keyFiles: parseStringArray(mod.keyFiles),
            evidence: String(mod.evidence || ''),
            lineRanges,
        });
    }

    // Parse discoveredThemes (optional)
    const discoveredThemes: DiscoveredTheme[] = [];
    if (Array.isArray(obj.discoveredThemes)) {
        for (const item of obj.discoveredThemes) {
            if (typeof item !== 'object' || item === null) {
                continue;
            }
            const dt = item as Record<string, unknown>;
            if (typeof dt.theme === 'string' && typeof dt.description === 'string') {
                discoveredThemes.push({
                    theme: normalizeComponentId(String(dt.theme)),
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
        theme: String(obj.theme),
        foundComponents,
        discoveredThemes,
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
